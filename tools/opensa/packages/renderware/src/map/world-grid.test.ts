import { describe, expect, it } from 'vitest';

import type { IdeObjectDef, IplInstance, MapDefinitions } from '../parsers/text';

import { buildWorldGrid, cellKey, instanceCell } from './world-grid';

type Vec3 = [number, number, number];

function def(id: number, modelName: string): IdeObjectDef {
  return { drawDistance: 300, flags: 0, id, modelName, txdName: 'txd' };
}

function inst(id: number, position: Vec3, interior = 0): IplInstance {
  return { id, interior, lod: -1, modelName: '', position, rotation: [0, 0, 0, 1] };
}

function mapDefs(defs: IdeObjectDef[], instances: IplInstance[]): MapDefinitions {
  return { catalog: new Map(defs.map((d) => [d.id, d])), imgDirs: [], instances };
}

describe('instanceCell / cellKey', () => {
  describe('positive cases', () => {
    it('floors a position to a cell (X/Y only) and keys it', () => {
      expect(instanceCell([260, -10, 99], 250)).toEqual([1, -1]);
      expect(cellKey(1, -1)).toBe('1,-1');
    });
  });
});

describe('buildWorldGrid', () => {
  describe('negative cases', () => {
    it('skips instances with no catalog def', () => {
      const grid = buildWorldGrid(mapDefs([], [inst(99, [0, 0, 0])]), 250);
      expect(grid.size).toBe(0);
    });

    it('skips hidden-interior instances', () => {
      const grid = buildWorldGrid(mapDefs([def(1, 'house')], [inst(1, [0, 0, 0], 10)]), 250);
      expect(grid.size).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('includes exterior instances with a non-zero world area code (256-multiple or id 13)', () => {
      const defs = mapDefs([def(1, 'house')], [inst(1, [0, 0, 0], 1024), inst(1, [10, 10, 0], 13)]);
      expect(buildWorldGrid(defs, 250).get(cellKey(0, 0))?.hd).toHaveLength(2);
    });

    it('buckets instances into cells by position', () => {
      const defs = mapDefs([def(1, 'house')], [inst(1, [10, 10, 0]), inst(1, [260, 10, 0]), inst(1, [20, 20, 0])]);
      const grid = buildWorldGrid(defs, 250);

      expect(grid.size).toBe(2);
      expect(grid.get(cellKey(0, 0))?.hd).toHaveLength(2);
      expect(grid.get(cellKey(1, 0))?.hd).toHaveLength(1);
    });

    it('splits HD and LOD by the instance isLod flag (not the model name)', () => {
      const hd = inst(1, [10, 10, 0]);
      const lod = { ...inst(2, [20, 20, 0]), isLod: true };
      const defs = mapDefs([def(1, 'house'), def(2, 'houselod')], [hd, lod]);
      const cell = buildWorldGrid(defs, 250).get(cellKey(0, 0));

      expect(cell?.hd).toHaveLength(1);
      expect(cell?.lod).toHaveLength(1);
      expect(cell?.hd[0].id).toBe(1);
      expect(cell?.lod[0].id).toBe(2);
    });

    it('puts ALWAYS-ON lod targets into BOTH layers, other lods stay lod-only (plan 087 gostown forests)', () => {
      // The stub-HD/real-LOD TC pattern: fakebit01 (hd stub) links to LODEnsemble3 — the ensemble IS the
      // forest, so hiding it inside the HD ring hides every tree. Listed models bucket like timed ones.
      const ensemble = { ...inst(2, [20, 20, 0]), isLod: true };
      const plainLod = { ...inst(3, [30, 30, 0]), isLod: true };
      const defs = mapDefs(
        [def(1, 'fakebit01'), def(2, 'LODEnsemble3'), def(3, 'lodhouse')],
        [inst(1, [10, 10, 0]), ensemble, plainLod],
      );
      const cell = buildWorldGrid(defs, 250, new Set(['lodensemble3'])).get(cellKey(0, 0));

      expect(cell?.hd.map((i) => i.id)).toEqual([1, 2]);
      expect(cell?.lod.map((i) => i.id)).toEqual([2, 3]);
    });

    it('puts timed (tobj) instances into BOTH layers (cell LODs bake no hour gate)', () => {
      const defs = mapDefs([def(1, 'house')], [inst(1, [10, 10, 0]), inst(7, [20, 20, 0])]);
      defs.timedCatalog = new Map([[7, { ...def(7, 'lampwin_nt'), time: { off: 6, on: 20 } }]]);
      const cell = buildWorldGrid(defs, 250).get(cellKey(0, 0));

      expect(cell?.hd.map((i) => i.id)).toEqual([1, 7]);
      expect(cell?.lod.map((i) => i.id)).toEqual([7]);
    });
  });
});
