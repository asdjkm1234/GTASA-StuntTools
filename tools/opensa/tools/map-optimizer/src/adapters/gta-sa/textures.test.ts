import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { RW_STRUCT, RW_TEXTURE_DICTIONARY, RW_TEXTURE_NATIVE, type RwChunk, writeRw } from '@opensa/rw-codec/chunk';
import { encodeDxt } from '@opensa/rw-codec/dxt-encode';
import { describe, expect, it } from 'vitest';

import { optimizeTxd } from './textures';

const RW_VERSION = 0x1803ffff;
const DXT1_FOURCC = 0x31545844;

/** A single-level 4×4 DXT1 TextureNative Struct (header + one level of compressed blocks). */
function dxt1Struct(name: string, base: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(88 + 4 + base.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, 9, true); // platform
  new TextEncoder().encodeInto(name, out.subarray(8, 40));
  view.setUint32(76, DXT1_FOURCC, true); // d3dFormat
  view.setUint16(80, width, true);
  view.setUint16(82, height, true);
  out[84] = 16; // depth
  out[85] = 1; // numLevels
  view.setUint32(88, base.length, true);
  out.set(base, 92);

  return out;
}

function txd(rasterStruct: Uint8Array): Uint8Array {
  const dictStruct = new Uint8Array(4);
  new DataView(dictStruct.buffer).setUint16(0, 1, true); // numTextures = 1
  const native: RwChunk = {
    children: [{ data: rasterStruct, type: RW_STRUCT, version: RW_VERSION }],
    type: RW_TEXTURE_NATIVE,
    version: RW_VERSION,
  };

  return writeRw({
    chunks: [
      {
        children: [{ data: dictStruct, type: RW_STRUCT, version: RW_VERSION }, native],
        type: RW_TEXTURE_DICTIONARY,
        version: RW_VERSION,
      },
    ],
    trailing: new Uint8Array(0),
  });
}

describe('optimizeTxd (Phase 2 — DXT stays DXT)', () => {
  describe('negative cases', () => {
    it('never leaves a DXT raster whose top level is not a multiple of 4 — it is resampled to a power of two', () => {
      // The real game refuses such a raster and drops the whole dictionary with it (a mod's 932×358 airport
      // sign, our 62×62 hospital door clone — field 2026-08-17). 8×6 → pow2 rounded UP 8×8, full mips, still DXT1.
      const base = encodeDxt('dxt1', new Uint8Array(8 * 5 * 4).fill(120), 8, 5);
      const input = txd(dxt1Struct('sign', base, 8, 5));

      const result = optimizeTxd(input);
      expect(result.resized).toBe(1);
      expect(result.processed).toBe(1);

      const { textures } = parseTxd(result.bytes.buffer as ArrayBuffer);
      expect(textures[0].name).toBe('sign');
      expect(textures[0].format).toBe('dxt1');
      expect([textures[0].width, textures[0].height]).toEqual([8, 8]);
      expect(textures[0].mipmaps.map((m) => [m.width, m.height])).toEqual([
        [8, 8],
        [4, 4],
        [2, 2],
        [1, 1],
      ]);
    });
  });

  describe('positive cases', () => {
    it('adds a mip chain to a single-level DXT1 texture, keeping it DXT1 with the base preserved', () => {
      const base = encodeDxt('dxt1', new Uint8Array(4 * 4 * 4).fill(200), 4, 4); // solid grey 4×4 → 8 bytes
      const input = txd(dxt1Struct('wall', base, 4, 4));

      const result = optimizeTxd(input);
      expect(result.processed).toBe(1);
      expect(result.resized).toBe(0);

      const { textures } = parseTxd(result.bytes.buffer as ArrayBuffer);
      expect(textures).toHaveLength(1);
      expect(textures[0].format).toBe('dxt1'); // still compressed — no 8888 blow-up
      expect(textures[0].mipmaps.map((m) => [m.width, m.height])).toEqual([
        [4, 4],
        [2, 2],
        [1, 1],
      ]);
      expect([...textures[0].mipmaps[0].data]).toEqual([...base]); // base level untouched (lossless)
    });
  });
});
