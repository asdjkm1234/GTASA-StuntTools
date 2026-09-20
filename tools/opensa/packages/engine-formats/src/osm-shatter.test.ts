import { describe, expect, it } from 'vitest';

import type { OsmShatter } from './osm-shatter';

import { decodeOsmShatter, encodeOsmShatter } from './osm-shatter';

/** Two triangles over four vertices, two materials — enough to catch a swapped array or a stride slip. */
function shatter(): OsmShatter {
  return {
    colours: Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 128]),
    materials: [
      { ambient: [1, 1, 1], mask: '', texture: 'crate' },
      { ambient: [0.25, 0.5, 0.75], mask: 'crate_mask', texture: 'crate_side' },
    ],
    positions: Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    triangleMaterials: Uint16Array.from([0, 1]),
    triangles: Uint16Array.from([0, 1, 2, 0, 2, 3]),
    uvs: Float32Array.from([0, 0, 1, 0, 1, 1, 0, 1]),
  };
}

describe('osm shatter section', () => {
  describe('negative cases', () => {
    it('survives a mesh with no materials and no triangles', () => {
      const empty: OsmShatter = {
        colours: new Uint8Array(0),
        materials: [],
        positions: new Float32Array(0),
        triangleMaterials: new Uint16Array(0),
        triangles: new Uint16Array(0),
        uvs: new Float32Array(0),
      };

      expect(decodeOsmShatter(encodeOsmShatter(empty))).toEqual(empty);
    });

    it('decodes correctly from an UNALIGNED view over a larger buffer', () => {
      // The section sits inside a container, so the reader must copy rather than view typed arrays.
      const encoded = encodeOsmShatter(shatter());
      const padded = new Uint8Array(encoded.byteLength + 3);
      padded.set(encoded, 3);

      expect(decodeOsmShatter(padded.subarray(3))).toEqual(shatter());
    });
  });

  describe('positive cases', () => {
    it('round-trips every array and the material table', () => {
      expect(decodeOsmShatter(encodeOsmShatter(shatter()))).toEqual(shatter());
    });

    it('keeps texture names as NAMES — the debris atlas resolves them by name, not by layer', () => {
      const read = decodeOsmShatter(encodeOsmShatter(shatter()));

      expect(read.materials.map((material) => material.texture)).toEqual(['crate', 'crate_side']);
      expect(read.materials[1].mask).toBe('crate_mask');
      expect(read.materials[0].mask).toBe('');
    });
  });
});
