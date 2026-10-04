import type { RWClump } from '@opensa/renderware/parsers/binary/types';

import { describe, expect, it } from 'vitest';

import { clumpBoundingRadius } from './bounds';

/** A minimal clump: one atomic per positions array, with an optional frame transform. */
function clump(
  parts: { frame?: { position: [number, number, number]; rotation: number[] }; positions: number[] }[],
): RWClump {
  return {
    atomics: parts.map((_, i) => ({ frameIndex: i, geometryIndex: i })),
    frames: parts.map((part) => part.frame ?? { position: [0, 0, 0], rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] }),
    geometries: parts.map((part) => ({ positions: new Float32Array(part.positions) })),
  } as unknown as RWClump;
}

describe('clumpBoundingRadius', () => {
  describe('negative cases', () => {
    it('is 0 for a clump with no geometry', () => {
      expect(clumpBoundingRadius(clump([]))).toBe(0);
    });

    it('ignores an atomic whose geometry index is dangling', () => {
      const broken = clump([{ positions: [3, 0, 0] }]);
      (broken.atomics[0] as { geometryIndex: number }).geometryIndex = 9;

      expect(clumpBoundingRadius(broken)).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('returns the farthest vertex distance from the model origin', () => {
      expect(clumpBoundingRadius(clump([{ positions: [1, 0, 0, 0, -4, 3, 0, 0, 0] }]))).toBe(5);
    });

    it('applies the atomic frame translation before measuring', () => {
      const moved = clump([
        { frame: { position: [10, 0, 0], rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] }, positions: [2, 0, 0] },
      ]);

      expect(clumpBoundingRadius(moved)).toBe(12);
    });

    it('takes the max across atomics', () => {
      expect(clumpBoundingRadius(clump([{ positions: [1, 0, 0] }, { positions: [0, 7, 0] }]))).toBe(7);
    });
  });
});
