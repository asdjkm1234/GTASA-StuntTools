import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { describe, expect, it } from 'vitest';

import { RW_STRUCT, RW_TEXTURE_DICTIONARY, RW_TEXTURE_NATIVE, type RwChunk, writeRw } from './chunk';
import { buildMipChain } from './mip';
import {
  encodeDxtStruct,
  encodeRgba8888Struct,
  encodeUncompressedStruct,
  isCompressedRaster,
  readTextureName,
} from './texture-native';

const RW_VERSION = 0x1803ffff; // a real SA RenderWare stream version

/** An 88-byte TextureNative header with the given name (the fields `encodeRgba8888Struct` preserves). */
function originalHeader(name: string): Uint8Array {
  const out = new Uint8Array(88);
  new TextEncoder().encodeInto(name, out.subarray(8, 40));

  return out;
}

/** A flat `size × size` RGBA buffer of one colour. */
function solid(size: number, [r, g, b, a]: [number, number, number, number]): Uint8Array {
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = r;
    out[i + 1] = g;
    out[i + 2] = b;
    out[i + 3] = a;
  }

  return out;
}

/** Wrap a raster Struct in TextureDictionary → TextureNative → Struct so `parseTxd` can read it. */
function wrapTxd(rasterStruct: Uint8Array): Uint8Array {
  const dictStruct = new Uint8Array(4);
  new DataView(dictStruct.buffer).setUint16(0, 1, true); // numTextures = 1
  const chunk = (type: number, children: RwChunk[], data?: Uint8Array): RwChunk => ({
    children,
    data,
    type,
    version: RW_VERSION,
  });

  return writeRw({
    chunks: [
      {
        children: [
          { data: dictStruct, type: RW_STRUCT, version: RW_VERSION },
          chunk(RW_TEXTURE_NATIVE, [{ data: rasterStruct, type: RW_STRUCT, version: RW_VERSION }]),
        ],
        type: RW_TEXTURE_DICTIONARY,
        version: RW_VERSION,
      },
    ],
    trailing: new Uint8Array(0),
  });
}

describe('encodeRgba8888Struct', () => {
  describe('positive cases', () => {
    it('round-trips through parseTxd as an 8888 texture with all mip levels', () => {
      // a 2×2 base level (R, G, B, white) + a 1×1 mip — RGBA input.
      const levels = [
        {
          data: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]),
          height: 2,
          width: 2,
        },
        { data: new Uint8Array([64, 96, 64, 255]), height: 1, width: 1 },
      ];
      const struct = encodeRgba8888Struct(originalHeader('wall'), levels, true);

      expect(readTextureName(struct)).toBe('wall');

      const { textures } = parseTxd(wrapTxd(struct).buffer as ArrayBuffer);
      expect(textures).toHaveLength(1);
      const texture = textures[0];
      expect(texture.name).toBe('wall');
      expect(texture.format).toBe('rgba8888');
      expect(texture.hasAlpha).toBe(true);
      expect(texture.mipmaps.map((m) => [m.width, m.height])).toEqual([
        [2, 2],
        [1, 1],
      ]);
      // base level pixels survive the BGRA store → RGBA read.
      expect([...texture.mipmaps[0].data]).toEqual([...levels[0].data]);
    });
  });
});

describe('encodeDxtStruct', () => {
  describe('positive cases', () => {
    it('round-trips an opaque image through parseTxd as DXT1 with its mip chain', () => {
      const struct = encodeDxtStruct('body', 'dxt1', buildMipChain(solid(4, [200, 50, 25, 255]), 4, 4, 'gamma'));

      expect(readTextureName(struct)).toBe('body');

      const { textures } = parseTxd(wrapTxd(struct).buffer as ArrayBuffer);
      expect(textures).toHaveLength(1);
      expect(textures[0].name).toBe('body');
      expect(textures[0].format).toBe('dxt1');
      expect(textures[0].mipmaps.map((m) => [m.width, m.height])).toEqual([
        [4, 4],
        [2, 2],
        [1, 1],
      ]);
    });

    it('encodes an image with alpha as DXT5', () => {
      const struct = encodeDxtStruct('glass', 'dxt5', buildMipChain(solid(4, [200, 50, 25, 128]), 4, 4, 'gamma'));

      const { textures } = parseTxd(wrapTxd(struct).buffer as ArrayBuffer);
      expect(textures[0].format).toBe('dxt5');
      expect(textures[0].hasAlpha).toBe(true);
    });
  });
});

describe('encodeUncompressedStruct', () => {
  describe('positive cases', () => {
    it('round-trips an opaque image as an uncompressed X8R8G8B8 raster, single level, linear filter', () => {
      const struct = encodeUncompressedStruct(
        'platecharset',
        [{ data: solid(2, [10, 20, 30, 255]), height: 2, width: 2 }],
        false,
      );
      const view = new DataView(struct.buffer);

      expect(readTextureName(struct)).toBe('platecharset');
      expect(view.getUint32(4, true)).toBe(0x1101); // linear, no mip filter declared
      expect(view.getUint32(72, true)).toBe(0x0600); // C888, mipmap bit clear
      expect(view.getUint32(76, true)).toBe(22); // D3DFMT_X8R8G8B8 — not a FourCC
      expect(struct[84]).toBe(32); // depth
      expect(struct[87]).toBe(0); // no alpha flag, no compressed flag

      const { textures } = parseTxd(wrapTxd(struct).buffer as ArrayBuffer);
      expect(textures[0].format).toBe('rgba8888');
      expect(textures[0].hasAlpha).toBe(false);
      expect([...textures[0].mipmaps[0].data.subarray(0, 4)]).toEqual([10, 20, 30, 255]);
    });

    it('declares the mipmap bit and a trilinear filter once it carries more than one level', () => {
      const struct = encodeUncompressedStruct(
        'scratch',
        buildMipChain(solid(4, [200, 50, 25, 128]), 4, 4, 'gamma'),
        true,
      );
      const view = new DataView(struct.buffer);

      expect(view.getUint32(4, true)).toBe(0x1106); // trilinear — the levels are there to be sampled
      expect(view.getUint32(72, true)).toBe(0x8500); // C8888 | mipmap
      expect(view.getUint32(76, true)).toBe(21); // D3DFMT_A8R8G8B8
      expect(struct[87]).toBe(0x01); // alpha

      const { textures } = parseTxd(wrapTxd(struct).buffer as ArrayBuffer);
      expect(textures[0].format).toBe('rgba8888');
      expect(textures[0].mipmaps).toHaveLength(3);
    });
  });
});

describe('isCompressedRaster', () => {
  describe('negative cases', () => {
    it('reads a Struct too short to hold a header as compressed — an unreadable header is not evidence', () => {
      expect(isCompressedRaster(new Uint8Array(40))).toBe(true);
    });

    it('is false for an uncompressed raster', () => {
      expect(
        isCompressedRaster(
          encodeUncompressedStruct('plate', [{ data: solid(1, [0, 0, 0, 255]), height: 1, width: 1 }], false),
        ),
      ).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('is true for every DXT FourCC our encoder writes', () => {
      const levels = buildMipChain(solid(4, [1, 2, 3, 255]), 4, 4, 'gamma');
      expect(isCompressedRaster(encodeDxtStruct('a', 'dxt1', levels))).toBe(true);
      expect(isCompressedRaster(encodeDxtStruct('b', 'dxt3', levels))).toBe(true);
      expect(isCompressedRaster(encodeDxtStruct('c', 'dxt5', levels))).toBe(true);
    });
  });
});
