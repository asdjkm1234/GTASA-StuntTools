import type { GridCell, WorldGrid } from '@opensa/renderware';

import { CELL_SIZE } from '@opensa/cell-weld';
import { describe, expect, it } from 'vitest';

import type { LoadedMap } from '../source/map-source';

import { cellAt, mapCenterGta } from './cell-renderer';

/** A grid holding just the cells named — enough for the coordinate helpers, which read nothing else. */
function gridOf(cells: readonly [number, number][]): LoadedMap {
  const grid: WorldGrid = new Map(
    cells.map(([cx, cy]): [string, GridCell] => [`${cx},${cy}`, { cx, cy, hd: [], lod: [] }]),
  );

  return { grid } as LoadedMap;
}

describe('cellAt', () => {
  describe('negative cases', () => {
    it('FLOORS negative coordinates instead of truncating them', () => {
      // −1 must land in cell −1, not 0: truncation would put the whole south/west map one cell off, and the
      // pack/debugger/LOD generator all name cells by the floored quotient.
      expect(cellAt([-1, -1])).toEqual({ cx: -1, cy: -1 });
      expect(cellAt([-CELL_SIZE, -CELL_SIZE])).toEqual({ cx: -1, cy: -1 });
    });
  });

  describe('positive cases', () => {
    it('names the render-grid cell a GTA position falls in', () => {
      expect(cellAt([0, 0])).toEqual({ cx: 0, cy: 0 });
      expect(cellAt([2375, -1625])).toEqual({ cx: 9, cy: -7 }); // Grove Street
      expect(cellAt([136, -1715])).toEqual({ cx: 0, cy: -7 }); // the blue-strip beach
    });
  });
});

describe('mapCenterGta', () => {
  describe('negative cases', () => {
    it('answers the origin for an empty grid rather than NaN or Infinity', () => {
      expect(mapCenterGta(gridOf([]))).toEqual([0, 0]);
    });

    it('does not follow ONE placement exiled far outside the map', () => {
      // Measured on a merged build: a mod removed a lamppost by moving it 17 km south rather than deleting
      // it, and the extent midpoint took the default camera into open sea — the viewer opened on 0 cells and
      // stayed blank even with "Whole map" ticked. A median does not move for one outlier.
      const map: [number, number][] = [];
      for (let cy = -3; cy <= 3; cy += 1) {
        map.push([0, cy]);
      }
      map.push([0, -80]);
      expect(mapCenterGta(gridOf(map))).toEqual([0.5 * CELL_SIZE, 0.5 * CELL_SIZE]);
    });

    it('never answers a cell with nothing in it', () => {
      // The inspector seeds its resident set from this cell, so an empty answer welds nothing — the same
      // blank screen the outlier caused, by another route. The midpoint here (11, 12) holds no instances.
      const centre = mapCenterGta(
        gridOf([
          [10, 10],
          [12, 14],
        ]),
      );
      expect([
        [10.5 * CELL_SIZE, 10.5 * CELL_SIZE],
        [12.5 * CELL_SIZE, 14.5 * CELL_SIZE],
      ]).toContainEqual(centre);
    });
  });

  describe('positive cases', () => {
    it('centres on the OCCUPIED cells, not on GTA 0,0', () => {
      // A total conversion's world need not sit near the origin; opening on 0,0 would stare at nothing.
      expect(
        mapCenterGta(
          gridOf([
            [10, 10],
            [11, 10],
            [12, 10],
          ]),
        ),
      ).toEqual([11.5 * CELL_SIZE, 10.5 * CELL_SIZE]);
    });

    it('lands mid-cell for a single-cell map', () => {
      expect(mapCenterGta(gridOf([[0, -7]]))).toEqual([0.5 * CELL_SIZE, -6.5 * CELL_SIZE]);
    });
  });
});
