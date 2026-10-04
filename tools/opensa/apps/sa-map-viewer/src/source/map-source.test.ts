import type { GridCell, IdeObjectDef, IplInstance, MapDefinitions, WorldGrid } from '@opensa/renderware';

import { describe, expect, it } from 'vitest';

import type { LoadedMap } from './map-source';

import { isConverted, mapStats, sourceFromQuery } from './map-source';

function def(id: number, modelName: string): IdeObjectDef {
  return { drawDistance: 300, flags: 0, id, modelName, txdName: 'txd' };
}

function instance(id: number): IplInstance {
  return { id, interior: 0, lod: -1, modelName: '', position: [0, 0, 0], rotation: [0, 0, 0, 1] };
}

function loaded(options: { cells?: GridCell[]; dff?: number; instances?: number; osm?: number }): LoadedMap {
  const grid: WorldGrid = new Map((options.cells ?? []).map((cell) => [`${cell.cx},${cell.cy}`, cell]));
  const defs: MapDefinitions = {
    catalog: new Map([def(1, 'house'), def(2, 'tree')].map((d) => [d.id, d])),
    imgDirs: [],
    instances: Array.from({ length: options.instances ?? 0 }, (_, index) => instance(index)),
  };

  return { defs, grid, models: { dff: options.dff ?? 0, osm: options.osm ?? 0 } } as LoadedMap;
}

describe('sourceFromQuery', () => {
  describe('negative cases', () => {
    it('answers null with no ?src, so the app shows the folder picker', () => {
      expect(sourceFromQuery('')).toBeNull();
      expect(sourceFromQuery('?at=0,0')).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('takes a served dir and strips a trailing slash (it is joined with /path later)', () => {
      expect(sourceFromQuery('?src=http://localhost:3001/game-src/original/')).toEqual({
        base: 'http://localhost:3001/game-src/original',
        kind: 'http-dir',
      });
    });
  });
});

describe('isConverted', () => {
  describe('negative cases', () => {
    it('does not flag an SA-format tree (all DFF)', () => {
      expect(isConverted(loaded({ dff: 12964, osm: 0 }))).toBe(false);
    });

    it('does not flag a mostly-DFF tree that carries a few stray .osm props', () => {
      expect(isConverted(loaded({ dff: 12000, osm: 12 }))).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('flags an OpenSA-converted tree, whose geometry the welder cannot read', () => {
      // Measured on build/original/opensa: the converter replaced the geometry, so the map resolves and
      // then welds nothing. That tree has its own map viewer — the in-game debugger's.
      expect(isConverted(loaded({ dff: 538, osm: 8779 }))).toBe(true);
    });
  });
});

describe('mapStats', () => {
  describe('positive cases', () => {
    it('counts cells, the HD/LOD split and the catalog', () => {
      const stats = mapStats(
        loaded({
          cells: [
            { cx: 0, cy: 0, hd: [instance(1), instance(1)], lod: [instance(2)] },
            { cx: 1, cy: 0, hd: [instance(1)], lod: [] },
          ],
          instances: 5,
        }),
      );
      expect(stats).toEqual({ cells: 2, hd: 3, instances: 5, lod: 1, models: 2 });
    });

    it('reports fewer bucketed instances than resolved ones (interiors + defless are dropped)', () => {
      const stats = mapStats(loaded({ cells: [{ cx: 0, cy: 0, hd: [instance(1)], lod: [] }], instances: 10 }));
      expect(stats.hd + stats.lod).toBeLessThan(stats.instances);
    });
  });
});
