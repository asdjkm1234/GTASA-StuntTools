import { describe, expect, it } from 'vitest';

import type { OsmHull } from './osm-hull';

import { decodeOsmHull, encodeOsmHull } from './osm-hull';

/**
 * Values are `Math.fround`ed because the section stores f32 — 0.12 (the production floor on a thin prop's
 * box) is not representable, and the round trip must be exact TO f32, not to f64.
 */
const hull = (): OsmHull => ({
  centre: [0.5, -1.25, 3],
  half: [Math.fround(0.12), 2, 4.5],
  points: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
});

describe('osm hull section', () => {
  describe('negative cases', () => {
    it('survives a hull with no points (the box is then all there is)', () => {
      const floor = Math.fround(0.12);
      const empty: OsmHull = { centre: [0, 0, 0], half: [floor, floor, floor], points: new Float32Array(0) };

      expect(decodeOsmHull(encodeOsmHull(empty))).toEqual(empty);
    });

    it('decodes from an UNALIGNED view over a larger buffer', () => {
      // The section is a view into the container; a Float32Array laid over an odd offset would throw.
      const encoded = encodeOsmHull(hull());
      const padded = new Uint8Array(encoded.byteLength + 3);
      padded.set(encoded, 3);

      expect(decodeOsmHull(padded.subarray(3))).toEqual(hull());
    });
  });

  describe('positive cases', () => {
    it('round-trips the cloud, the centre and the floored half-extents', () => {
      expect(decodeOsmHull(encodeOsmHull(hull()))).toEqual(hull());
    });
  });
});
