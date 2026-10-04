import { describe, expect, it } from 'vitest';

import { packReflectionScene, type ReflectionTriangle } from './canopy-reflection';

const triangle = (x: number): ReflectionTriangle => ({
  color: [0.4, 0.5, 0.6],
  layer: x,
  night: [0.1, 0.2, 0.3],
  normal: [0, 0, 1],
  occlusion: 0.5,
  points: [
    [x, 0, 0],
    [x + 0.5, 0, 0],
    [x, 0.5, 0],
  ],
  uv: [
    [0, 0],
    [1, 0],
    [0, 1],
  ],
});

describe('cockpit reflection BVH', () => {
  it('disables empty and oversized scenes instead of truncating occluders', () => {
    expect([...packReflectionScene([], 0, 2)]).toEqual([0, 0, 0, 1]);
    expect([
      ...packReflectionScene(
        Array.from({ length: 513 }, (_, x) => triangle(x)),
        0,
        2,
      ),
    ]).toEqual([0, 0, 0, 1]);
  });

  it('retains triangle position, UV and material in the GPU layout', () => {
    const scene = packReflectionScene([triangle(2)], 3, 9);
    expect([...scene.slice(0, 4)]).toEqual([1, 3, 3, 9]);
    expect([...scene.slice(4, 12)]).toEqual([2, 0, 0, 1, 2.5, 0.5, 0, 0]);
    expect([...scene.slice(12, 24)]).toEqual([2, 0, 0, 2, 0.5, 0, 0, 0, 0, 0.5, 0, 0]);
    expect([...scene.slice(28, 36)]).toEqual([0, 0, 1, 0, 0, 1, 0, 0]);
    expect(scene[39]).toBe(0);
  });

  it('threads every subtree past its descendants and encloses each leaf without losing triangles', () => {
    const input = Array.from({ length: 73 }, (_, x) => triangle((x * 29) % 73));
    const scene = packReflectionScene(input, 0, 1);
    const leaves = new Set<number>();
    function visit(node: number): number {
      const at = 4 + node * 8;
      const escape = scene[at + 3];
      expect(escape).toBeGreaterThan(node);
      expect(escape).toBeLessThanOrEqual(scene[0]);
      const index = scene[at + 7];
      if (index >= 0) {
        const tri = scene[1] * 4 + index * 32;
        leaves.add(scene[tri + 3]);
        for (let axis = 0; axis < 3; axis++) {
          for (const offset of [0, 4, 8]) {
            const point = scene[tri + axis] + (offset ? scene[tri + offset + axis] : 0);
            expect(point).toBeGreaterThanOrEqual(scene[at + axis]);
            expect(point).toBeLessThanOrEqual(scene[at + 4 + axis]);
          }
        }
        expect(escape).toBe(node + 1);
      } else {
        const right = visit(node + 1);
        expect(visit(right)).toBe(escape);
        for (const child of [node + 1, right]) {
          for (let axis = 0; axis < 3; axis++) {
            expect(scene[4 + child * 8 + axis]).toBeGreaterThanOrEqual(scene[at + axis]);
            expect(scene[8 + child * 8 + axis]).toBeLessThanOrEqual(scene[at + 4 + axis]);
          }
        }
      }

      return escape;
    }
    expect(visit(0)).toBe(scene[0]);
    expect(leaves.size).toBe(input.length);
  });
});
