import { describe, expect, it } from 'vitest';

import { buildBvh, type BvhMesh } from './bvh';

/** A unit quad in the XY plane at the given z (two triangles). */
function quad(z: number, size = 1): BvhMesh {
  return {
    indices: Uint32Array.of(0, 1, 2, 0, 2, 3),
    positions: Float32Array.of(-size, -size, z, size, -size, z, size, size, z, -size, size, z),
  };
}

describe('buildBvh / anyHit', () => {
  describe('negative cases', () => {
    it('misses on an empty mesh set', () => {
      expect(buildBvh([]).anyHit([0, 0, 0], [0, 0, 1], 0, 10)).toBe(false);
    });

    it('misses a ray passing beside the geometry', () => {
      expect(buildBvh([quad(5)]).anyHit([10, 10, 0], [0, 0, 1], 0, 100)).toBe(false);
    });

    it('misses when the hit lies outside (tMin, tMax)', () => {
      const bvh = buildBvh([quad(5)]);

      expect(bvh.anyHit([0, 0, 0], [0, 0, 1], 0, 4.9)).toBe(false); // hit at t=5, past tMax
      expect(bvh.anyHit([0, 0, 0], [0, 0, 1], 5.1, 100)).toBe(false); // hit at t=5, before tMin
    });
  });

  describe('positive cases', () => {
    it('hits a quad straight ahead (both winding sides)', () => {
      const bvh = buildBvh([quad(5)]);

      expect(bvh.anyHit([0, 0, 0], [0, 0, 1], 0, 10)).toBe(true);
      expect(bvh.anyHit([0, 0, 10], [0, 0, -1], 0, 10)).toBe(true);
    });

    it('supports unnormalized segment queries (dir = full segment, tMax = 1)', () => {
      const bvh = buildBvh([quad(5)]);

      expect(bvh.anyHit([0, 0, 0], [0, 0, 8], 0.001, 1)).toBe(true);
      expect(bvh.anyHit([0, 0, 0], [0, 0, 4], 0.001, 1)).toBe(false); // segment stops short of z=5
    });

    it('finds hits across many triangles (deep BVH) and merged occluder meshes', () => {
      // 32 stacked quads → several BVH levels; the extra occluder sits off to the side.
      const stack = Array.from({ length: 32 }, (_, i) => quad(i + 1));
      const side: BvhMesh = {
        indices: Uint32Array.of(0, 1, 2),
        positions: Float32Array.of(100, 0, 0, 101, 0, 0, 100, 1, 0),
      };
      const bvh = buildBvh([...stack, side]);

      expect(bvh.anyHit([0, 0, 0], [0, 0, 1], 0, 100)).toBe(true);
      expect(bvh.anyHit([100.2, 0.2, -5], [0, 0, 1], 0, 100)).toBe(true);
      expect(bvh.anyHit([0, 0, 32.5], [0, 0, 1], 0, 100)).toBe(false); // above the whole stack
    });
  });
});
