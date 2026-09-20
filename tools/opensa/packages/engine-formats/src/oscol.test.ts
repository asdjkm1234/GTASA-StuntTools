import { describe, expect, it } from 'vitest';

import { decodeOscol, encodeOscol, type Oscol, type OscolRegion, oscolTriangleCount } from './oscol';

/** One quad (two triangles) with a placement — the smallest region that exercises every array. */
function region(overrides: Partial<OscolRegion> = {}): OscolRegion {
  return {
    boxes: [],
    indices: Uint32Array.from([0, 1, 2, 0, 2, 3]),
    name: 'roads32_law2',
    spheres: [],
    transforms: [Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 12.5, -3, 7, 1])],
    vertices: Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    ...overrides,
  };
}

describe('oscol', () => {
  describe('negative cases', () => {
    it('rejects bytes that are not an .oscol', () => {
      expect(() => decodeOscol(Uint8Array.from([1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0]))).toThrow(/not an \.oscol/);
    });

    it('rejects a version the reader does not know', () => {
      const bytes = encodeOscol({ regions: [] });
      new DataView(bytes.buffer, bytes.byteOffset).setUint32(4, 99, true);

      expect(() => decodeOscol(bytes)).toThrow(/unsupported \.oscol version 99/);
    });

    it('REFUSES a surface table that is not one id per triangle', () => {
      // The failure this guards is silent by nature: a short table still decodes, and every lookup past its
      // end reports the wrong surface — a car driving on grass that answers tarmac.
      const cell: Oscol = { regions: [region({ materials: Uint8Array.from([4]) })] };

      expect(() => encodeOscol(cell)).toThrow(/one surface id per TRIANGLE/);
    });

    it('REFUSES instance keys that do not line up with the placements', () => {
      const cell: Oscol = { regions: [region({ instanceKeys: ['a', 'b'] })] };

      expect(() => encodeOscol(cell)).toThrow(/2 instance keys for 1 transforms/);
    });

    it('keeps "no material" distinct from surface 0', () => {
      // Surface 0 is a real row in surfinfo.dat, so a reader that collapses the two silently retextures
      // every primitive whose source carried nothing.
      const cell: Oscol = {
        regions: [
          region({
            spheres: [
              { center: [0, 0, 0], radius: 1 },
              { center: [1, 2, 3], material: 0, radius: 2 },
            ],
          }),
        ],
      };

      const read = decodeOscol(encodeOscol(cell)).regions[0];

      expect(read.spheres[0].material).toBeUndefined();
      expect(read.spheres[1].material).toBe(0);
    });

    it('carries no materials at all when the source had none', () => {
      const read = decodeOscol(encodeOscol({ regions: [region()] })).regions[0];

      expect(read.materials).toBeUndefined();
    });
  });

  describe('positive cases', () => {
    it('round-trips the surface id of every triangle', () => {
      const materials = Uint8Array.from([4, 17]); // two triangles: grass, then tarmac
      const cell: Oscol = { regions: [region({ materials })] };

      const read = decodeOscol(encodeOscol(cell)).regions[0];

      expect(read.materials).toEqual(materials);
      expect(oscolTriangleCount({ regions: [read] })).toBe(2);
    });

    it('round-trips geometry, primitives and placements', () => {
      const cell: Oscol = {
        regions: [
          region({
            boxes: [{ material: 2, max: [1, 1, 1], min: [-1, -1, -1] }],
            spheres: [{ center: [0, 0, 2], material: 9, radius: 1.5 }],
            transforms: [
              Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 12.5, -3, 7, 1]),
              Float32Array.from([0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 40, 8, 0, 1]),
            ],
          }),
        ],
      };

      const read = decodeOscol(encodeOscol(cell));

      expect(read).toEqual(cell);
    });

    it('round-trips a breakable region, whose instance keys are what make it one', () => {
      const cell: Oscol = { regions: [region({ instanceKeys: ['crate@12,-4#0'] })] };

      expect(decodeOscol(encodeOscol(cell)).regions[0].instanceKeys).toEqual(['crate@12,-4#0']);
    });

    it('round-trips several regions, including an empty cell', () => {
      const many: Oscol = { regions: [region(), region({ name: 'lamppost1' })] };

      expect(decodeOscol(encodeOscol(many)).regions.map((entry) => entry.name)).toEqual(['roads32_law2', 'lamppost1']);
      expect(decodeOscol(encodeOscol({ regions: [] })).regions).toEqual([]);
    });

    it('decodes from an UNALIGNED view over a larger buffer', () => {
      // A pak range read hands out a subarray, so the reader may never assume byteOffset 0.
      const encoded = encodeOscol({ regions: [region({ materials: Uint8Array.from([4, 17]) })] });
      const padded = new Uint8Array(encoded.byteLength + 3);
      padded.set(encoded, 3);

      expect(decodeOscol(padded.subarray(3)).regions[0].materials).toEqual(Uint8Array.from([4, 17]));
    });
  });
});
