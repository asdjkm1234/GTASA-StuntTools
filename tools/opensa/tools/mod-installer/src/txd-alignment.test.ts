import { RW_STRUCT, RW_TEXTURE_DICTIONARY, RW_TEXTURE_NATIVE, type RwChunk, writeRw } from '@opensa/rw-codec/chunk';
import { encodeDxt } from '@opensa/rw-codec/dxt-encode';
import { describe, expect, it, vi } from 'vitest';

import { unalignedDxtTextures, warnUnalignedDxt } from './txd-alignment';

const RW_VERSION = 0x1803ffff;
const DXT1_FOURCC = 0x31545844;

/** A single-level DXT1 TextureNative Struct — the same fixture shape map-optimizer's `textures.test.ts` uses. */
function dxt1Struct(name: string, width: number, height: number): Uint8Array {
  const base = encodeDxt('dxt1', new Uint8Array(width * height * 4).fill(120), width, height);
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

function txd(...rasters: Uint8Array[]): Uint8Array {
  const dictStruct = new Uint8Array(4);
  new DataView(dictStruct.buffer).setUint16(0, rasters.length, true);
  const natives: RwChunk[] = rasters.map((raster) => ({
    children: [{ data: raster, type: RW_STRUCT, version: RW_VERSION }],
    type: RW_TEXTURE_NATIVE,
    version: RW_VERSION,
  }));

  return writeRw({
    chunks: [
      {
        children: [{ data: dictStruct, type: RW_STRUCT, version: RW_VERSION }, ...natives],
        type: RW_TEXTURE_DICTIONARY,
        version: RW_VERSION,
      },
    ],
    trailing: new Uint8Array(0),
  });
}

describe('unalignedDxtTextures', () => {
  describe('negative cases', () => {
    it('names every DXT raster whose side is not a multiple of 4, and only those', () => {
      // 932×358 — mod 57's airport sign, the field's dead dictionary; 8×5 beside a legal 8×8 and an NPOT-but-aligned 12×4.
      const found = unalignedDxtTextures(
        txd(dxt1Struct('sign', 932, 358), dxt1Struct('door', 8, 5), dxt1Struct('ok', 8, 8), dxt1Struct('npot', 12, 4)),
      );

      expect(found).toEqual(['sign 932x358 dxt1', 'door 8x5 dxt1']);
    });

    it('judges nothing it cannot parse', () => {
      expect(unalignedDxtTextures(Uint8Array.of(1, 2, 3))).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('is empty for a dictionary of aligned rasters', () => {
      expect(unalignedDxtTextures(txd(dxt1Struct('a', 64, 64), dxt1Struct('b', 700, 52)))).toEqual([]);
    });
  });
});

describe('warnUnalignedDxt', () => {
  describe('negative cases', () => {
    it('warns once per offending texture, naming the mod, the dictionary and the raster', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      warnUnalignedDxt('sfse_sign.txd', txd(dxt1Struct('sign', 932, 358), dxt1Struct('door', 8, 5)), '57. Airport');

      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls[0][0]).toMatch(
        /57\. Airport ships sfse_sign\.txd: sign 932x358 dxt1 — not a multiple of 4/,
      );
      warn.mockRestore();
    });
  });

  describe('positive cases', () => {
    it('stays silent for a non-.txd entry and for an aligned dictionary', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      warnUnalignedDxt('sign.dff', txd(dxt1Struct('sign', 932, 358)), 'x');
      warnUnalignedDxt('ok.txd', txd(dxt1Struct('a', 64, 64)), 'x');

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
