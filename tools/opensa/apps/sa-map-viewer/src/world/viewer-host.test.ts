import type { CellCoord } from '@opensa/game';

import { describe, expect, it } from 'vitest';

import { captureCells } from './viewer-host';

const ALL: CellCoord[] = [
  [0, 0],
  [1, 0],
  [0, -7],
];
const all = (): CellCoord[] => ALL;

function cells(search: string, view: CellCoord | null = [0, -7]): ReturnType<typeof captureCells> {
  return captureCells(new URLSearchParams(search), view, all);
}

describe('captureCells', () => {
  describe('negative cases', () => {
    it('seeds NOTHING while the panel is up — its inspector owns the cell set', () => {
      expect(cells('')).toBeNull();
      expect(cells('?panel=1')).toBeNull();
      expect(cells('?cells=all')).toBeNull(); // even asked explicitly: the panel would fight it
    });

    it('seeds an empty set when the camera sits outside the map', () => {
      expect(cells('?panel=0', null)).toEqual({ cells: [], lod: false });
    });
  });

  describe('positive cases', () => {
    it('pins the cell under the camera by default — the fix for the empty capture', () => {
      expect(cells('?panel=0')).toEqual({ cells: [[0, -7]], lod: false });
      expect(cells('?panel=0&cells=1')).toEqual({ cells: [[0, -7]], lod: false });
    });

    it('pins the whole map on request', () => {
      expect(cells('?panel=0&cells=all')).toEqual({ cells: ALL, lod: false });
    });

    it('pins the LOD layer on request', () => {
      expect(cells('?panel=0&lod=1')?.lod).toBe(true);
      expect(cells('?panel=0&lod=0')?.lod).toBe(false);
    });
  });
});
