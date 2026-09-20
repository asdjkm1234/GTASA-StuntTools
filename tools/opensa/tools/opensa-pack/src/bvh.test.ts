import { describe, expect, it } from 'vitest';

import { buildBvh, occluded } from './bvh';

/** Unit XY quad at height y, spanning [-size, size]² (two triangles, facing +Y). */
function quadAt(y: number, size = 10): number[] {
  return [-size, y, -size, size, y, -size, size, y, size, -size, y, -size, size, y, size, -size, y, size];
}

describe('bvh', () => {
  describe('negative cases', () => {
    it('reports nothing occluded for an empty soup', () => {
      const bvh = buildBvh(new Float32Array(0));

      expect(occluded(bvh, 0, 0, 0, 0, 1, 0, 100)).toBe(false);
    });

    it('misses a ray pointing away from the geometry', () => {
      const bvh = buildBvh(new Float32Array(quadAt(5)));

      expect(occluded(bvh, 0, 0, 0, 0, -1, 0, 100)).toBe(false);
    });

    it('misses a ray passing beside the geometry', () => {
      const bvh = buildBvh(new Float32Array(quadAt(5, 1)));

      expect(occluded(bvh, 8, 0, 8, 0, 1, 0, 100)).toBe(false);
    });

    it('respects maxDistance (blocker beyond the ray length is invisible)', () => {
      const bvh = buildBvh(new Float32Array(quadAt(50)));

      expect(occluded(bvh, 0, 0, 0, 0, 1, 0, 40)).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('hits a quad straight above', () => {
      const bvh = buildBvh(new Float32Array(quadAt(5)));

      expect(occluded(bvh, 0, 0, 0, 0, 1, 0, 100)).toBe(true);
    });

    it('hits through a large soup (median split exercised past leaf size)', () => {
      // 64 stacked quads offset in x — forces several split levels.
      const soup: number[] = [];
      for (let quad = 0; quad < 64; quad += 1) {
        soup.push(...quadAt(2 + quad, 1).map((value, index) => (index % 3 === 0 ? value + quad * 3 : value)));
      }
      const bvh = buildBvh(new Float32Array(soup));

      for (let quad = 0; quad < 64; quad += 1) {
        expect(occluded(bvh, quad * 3, 0, 0, 0, 1, 0, 100)).toBe(true);
      }
      expect(occluded(bvh, -10, 0, 0, 0, 1, 0, 100)).toBe(false);
    });

    it('hits with a diagonal ray', () => {
      const bvh = buildBvh(new Float32Array(quadAt(5, 20)));
      const inv = 1 / Math.sqrt(2);

      expect(occluded(bvh, 0, 0, 0, inv, inv, 0, 100)).toBe(true);
    });
  });
});
