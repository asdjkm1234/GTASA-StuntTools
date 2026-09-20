import { instanceCell } from '@opensa/renderware/map/world-grid';
import { describe, expect, it } from 'vitest';

import { cellOf } from './grid';

/** Positions that exercise sign changes and cell boundaries (GTA coords). */
const PROBES: [number, number, number][] = [
  [0, 0, 0],
  [249.99, -0.01, 10],
  [250, -250, 10],
  [1494.29, -1522.27, 576.77], // the gostown bridge span-a pivot (plan 087)
  [-0.01, 0.01, 0],
  [-2040, -4090, 5],
  [9344, -896, 0], // the far gostown island impostor anchor
];

describe('cellOf vs the pak world-grid bucketing (plan 087)', () => {
  describe('negative cases', () => {
    it('diverges when the two sides run DIFFERENT cell sizes — the split-slot failure mode', () => {
      // The 087 field bug in one line: the span-a pivot buckets to cy −6 on a 256 grid but −7 on 250.
      const [, cy256] = cellOf([1494.29, -1522.27, 576.77], 256);
      const [, cy250] = cellOf([1494.29, -1522.27, 576.77], 250);

      expect(cy256).toBe(-6);
      expect(cy250).toBe(-7);
    });
  });

  describe('positive cases', () => {
    it('buckets every position exactly like the pak weld at the same cell size', () => {
      // The invariant the 250-bake fix relies on: same size ⇒ same floor(pivot / cell) on BOTH sides, so
      // an instance's baked impostor and its welded HD land in the same streaming slot.
      for (const position of PROBES) {
        expect(cellOf(position, 250)).toEqual(instanceCell(position, 250));
      }
    });
  });
});
