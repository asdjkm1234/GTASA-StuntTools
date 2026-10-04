import { describe, expect, it } from 'vitest';

import { decodeOsmTextures, encodeOsmTextures, osmTextureFormats } from './osm-textures';
import { encodeOstex, OstexFormat, type OstexFormatId, ostexLayerBytes } from './ostex';

const arrays = [Uint8Array.from([1, 2, 3, 4, 5]), Uint8Array.from([9, 8]), Uint8Array.from([7])];

/** A minimal one-layer, one-mip 4×4 `.ostex` in `format` — enough for a header read. */
function ostex(format: OstexFormatId): Uint8Array {
  return encodeOstex({
    format,
    height: 4,
    layers: [{ alphaClass: 0, cutoutRef: 0, nameHash: 0, wrap: 0 }],
    mipCount: 1,
    payload: new Uint8Array(ostexLayerBytes(format, 4, 4, 1)),
    premultiplied: true,
    width: 4,
  });
}

describe('osm textures section', () => {
  describe('negative cases', () => {
    it('survives a model with no dictionary at all', () => {
      expect(decodeOsmTextures(encodeOsmTextures({ arrays: [] })).arrays).toEqual([]);
    });

    it('keeps arrays APART rather than concatenating them', () => {
      // A single blob would still decode; only the per-array lengths keep (array, layer) addressable.
      const read = decodeOsmTextures(encodeOsmTextures({ arrays }));

      expect(read.arrays.map((array) => array.byteLength)).toEqual([5, 2, 1]);
    });

    it('decodes from an UNALIGNED view over a larger buffer', () => {
      const encoded = encodeOsmTextures({ arrays });
      const padded = new Uint8Array(encoded.byteLength + 3);
      padded.set(encoded, 3);

      expect(decodeOsmTextures(padded.subarray(3)).arrays).toEqual(arrays);
    });

    it('skips the zero-length placeholder a shared-dictionary model writes', () => {
      // A model binding the WORLD's arrays contributes no dictionary of its own; reading a format there
      // would throw on the magic of whatever byte follows.
      const section = encodeOsmTextures({ arrays: [new Uint8Array(0), ostex(OstexFormat.BC1)] });

      expect(osmTextureFormats(section)).toEqual([OstexFormat.BC1]);
    });
  });

  describe('positive cases', () => {
    it('reads every arrays format without copying a payload', () => {
      const section = encodeOsmTextures({ arrays: [ostex(OstexFormat.BC3), ostex(OstexFormat.RGBA8)] });

      expect(osmTextureFormats(section)).toEqual([OstexFormat.BC3, OstexFormat.RGBA8]);
    });

    it('round-trips a single-array model (vehicles, clutter)', () => {
      expect(decodeOsmTextures(encodeOsmTextures({ arrays: [arrays[0]] })).arrays).toEqual([arrays[0]]);
    });

    it('round-trips a multi-array model (a ped whose textures disagree on size)', () => {
      expect(decodeOsmTextures(encodeOsmTextures({ arrays })).arrays).toEqual(arrays);
    });
  });
});
