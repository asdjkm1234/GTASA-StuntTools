import { describe, expect, it } from 'vitest';

import type { SkidSegment } from './skid-marks';

import { SKID_LIFE_SECONDS, SKID_SEGMENT_VERTS, SKID_VERTEX_FLOATS, SkidMarkRing } from './skid-marks';

const segment = (v = 0): SkidSegment => ({
  alpha0: 0,
  alpha1: 0.5,
  l0: [0, 0, 0],
  l1: [0, 0, 1],
  r0: [1, 0, 0],
  r1: [1, 0, 1],
  v0: v,
  v1: v + 1,
});

describe('SkidMarkRing', () => {
  describe('negative cases', () => {
    it('draws nothing while empty', () => {
      expect(new SkidMarkRing(8).ranges()).toEqual([]);
    });

    it('reports no change when nothing has expired', () => {
      const ring = new SkidMarkRing(8);
      ring.push(segment(), 10);

      expect(ring.prune(10 + SKID_LIFE_SECONDS - 0.01)).toBe(false);
      expect(ring.count).toBe(1);
    });
  });

  describe('positive cases', () => {
    it('packs the six vertices with position, uv, alpha and birth', () => {
      const ring = new SkidMarkRing(8);
      ring.push(segment(3), 7);

      // Vertex 0 = l0 at (u 0, v v0, alpha0); vertex 4 = r1 at (u 1, v v1, alpha1); birth everywhere.
      expect([...ring.data.subarray(0, SKID_VERTEX_FLOATS)]).toEqual([0, 0, 0, 0, 3, 0, 7]);
      const v4 = 4 * SKID_VERTEX_FLOATS;
      expect([...ring.data.subarray(v4, v4 + SKID_VERTEX_FLOATS)]).toEqual([1, 0, 1, 1, 4, 0.5, 7]);
    });

    it('expires strictly oldest-first on the wall clock', () => {
      const ring = new SkidMarkRing(8);
      ring.push(segment(), 0);
      ring.push(segment(), 1);

      expect(ring.prune(SKID_LIFE_SECONDS)).toBe(true); // the t=0 segment is exactly life-old — gone
      expect(ring.count).toBe(1);
      expect(ring.ranges()).toEqual([{ count: 1, first: 1 }]);
    });

    it('splits the live window into two ranges across the ring seam', () => {
      const ring = new SkidMarkRing(4);
      for (let index = 0; index < 6; index += 1) {
        ring.push(segment(), index);
      }

      expect(ring.count).toBe(4); // the two oldest were recycled — the brief's oldest-first
      expect(ring.ranges()).toEqual([
        { count: 2, first: 2 },
        { count: 2, first: 0 },
      ]);
    });

    it(`keeps segment stride at ${SKID_SEGMENT_VERTS} × ${SKID_VERTEX_FLOATS} floats`, () => {
      const ring = new SkidMarkRing(2);

      expect(ring.data.length).toBe(2 * SKID_SEGMENT_VERTS * SKID_VERTEX_FLOATS);
    });
  });
});
