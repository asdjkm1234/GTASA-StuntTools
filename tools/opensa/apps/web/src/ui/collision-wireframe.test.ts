import type { ModelColliders } from '@opensa/game/interfaces/collider.interface';

import { Matrix4 } from '@opensa/math';
import { describe, expect, it } from 'vitest';

import { buildCollisionLines } from './collision-wireframe';

const EMPTY_SHAPE = { boxes: [], indices: new Uint32Array(), spheres: [], vertices: new Float32Array() };

/** A collider with one triangle, at the identity placement unless a matrix is given. */
function triangle(transform = new Matrix4()): ModelColliders {
  return {
    name: 'tri',
    shape: {
      ...EMPTY_SHAPE,
      indices: Uint32Array.from([0, 1, 2]),
      vertices: Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    },
    transforms: [transform],
  };
}

describe('buildCollisionLines', () => {
  describe('negative cases', () => {
    it('returns nothing for no colliders', () => {
      expect(buildCollisionLines([]).length).toBe(0);
    });

    it('returns nothing for a collider with no shapes', () => {
      expect(buildCollisionLines([{ name: 'x', shape: EMPTY_SHAPE, transforms: [new Matrix4()] }]).length).toBe(0);
    });

    it('emits nothing for a shape with no placements — geometry alone is not an overlay', () => {
      expect(buildCollisionLines([{ ...triangle(), transforms: [] }]).length).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('turns a triangle into its three edges as endpoint PAIRS', () => {
      // 3 edges × 2 endpoints × 3 floats. The line-list pipeline consumes consecutive pairs.
      expect(buildCollisionLines([triangle()].map((c) => c)).length).toBe(18);
    });

    it('converts GTA Z-up to engine Y-up — (x, y, z) becomes (x, z, -y)', () => {
      const collider: ModelColliders = {
        name: 'edge',
        shape: {
          ...EMPTY_SHAPE,
          indices: Uint32Array.from([0, 1, 1]),
          vertices: Float32Array.from([2, 3, 5, 0, 0, 0]),
        },
        transforms: [new Matrix4()],
      };

      const lines = buildCollisionLines([collider]);

      expect([lines[0], lines[1], lines[2]]).toEqual([2, 5, -3]);
    });

    it('applies the placement translation to every endpoint', () => {
      const moved = new Matrix4();
      moved.elements[12] = 10; // translate +10 on GTA x
      const lines = buildCollisionLines([triangle(moved)]);

      expect(lines[0]).toBe(10);
    });

    it('emits one line set per placement of the same model', () => {
      const one = buildCollisionLines([triangle()]).length;
      const two = buildCollisionLines([{ ...triangle(), transforms: [new Matrix4(), new Matrix4()] }]).length;

      expect(two).toBe(one * 2);
    });

    it('draws box edges and sphere rings, not just triangles', () => {
      const box = buildCollisionLines([
        {
          name: 'b',
          shape: { ...EMPTY_SHAPE, boxes: [{ max: [1, 1, 1], min: [0, 0, 0] }] },
          transforms: [new Matrix4()],
        },
      ]);
      const sphere = buildCollisionLines([
        {
          name: 's',
          shape: { ...EMPTY_SHAPE, spheres: [{ center: [0, 0, 0], radius: 2 }] },
          transforms: [new Matrix4()],
        },
      ]);

      expect(box.length).toBe(12 * 2 * 3); // 12 edges × 2 endpoints × 3 floats
      expect(sphere.length).toBe(3 * 12 * 2 * 3); // 3 axes × 12 segments
    });
  });
});
