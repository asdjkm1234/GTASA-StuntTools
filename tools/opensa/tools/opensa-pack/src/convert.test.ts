import type { WeldedCell } from '@opensa/cell-weld/weld';
import type { WorldGrid } from '@opensa/renderware/map/world-grid';

import { describe, expect, it } from 'vitest';

import { cellAabbXZ, occupiedRect } from './convert';

/** A WeldedCell with just the fields the AABB math reads (buckets bounds + origin). */
function weldedWith(
  origin: [number, number, number],
  buckets: { max: [number, number, number]; min: [number, number, number]; vertices: number[] }[],
): WeldedCell {
  return { buckets, origin } as unknown as WeldedCell;
}

describe('cellAabbXZ (plan 087)', () => {
  describe('negative cases', () => {
    it('returns undefined for a cell with no vertex data', () => {
      expect(cellAabbXZ(weldedWith([1375, 0, 1375], []))).toBeUndefined();
      expect(
        cellAabbXZ(weldedWith([1375, 0, 1375], [{ max: [0, 0, 0], min: [0, 0, 0], vertices: [] }])),
      ).toBeUndefined();
    });
  });

  describe('positive cases', () => {
    it('returns the world XZ bounds of all buckets, rounded outward to integers', () => {
      const cell = weldedWith(
        [1375, 0, 1375],
        [
          { max: [10.4, 99, 20.4], min: [-53.6, 0, -109.6], vertices: [1] },
          { max: [332.9, 99, 356.1], min: [0, 0, 0], vertices: [1] },
        ],
      );

      // min = floor(origin + min), max = ceil(origin + max); Y is ignored (the rings are 2D).
      expect(cellAabbXZ(cell)).toEqual([1321, 1708, 1265, 1732]);
    });
  });
});

describe('occupiedRect (plan 087 auto-fit)', () => {
  describe('negative cases', () => {
    it('throws on an empty world grid instead of converting nothing silently', () => {
      expect(() => occupiedRect(new Map() as WorldGrid)).toThrow(/no exterior instances/);
    });
  });

  describe('positive cases', () => {
    it('covers every occupied cell, including a far TC island the old fixed rect dropped', () => {
      const grid = new Map([
        ['5,-6', { cx: 5, cy: -6, hd: [], lod: [] }],
        ['37,-4', { cx: 37, cy: -4, hd: [], lod: [] }],
        ['-8,-16', { cx: -8, cy: -16, hd: [], lod: [] }],
      ]) as WorldGrid;

      expect(occupiedRect(grid)).toEqual([-8, -16, 37, -4]);
    });
  });
});
