import { describe, expect, it } from 'vitest';

import type { IdeObjectDef, IplInstance, MapDefinitions } from '../parsers/text';
import type { GridCell, WorldGrid } from './world-grid';

import { cellGroups, cellModelNames } from './cell-groups';
import { cellKey } from './world-grid';

type Vec3 = [number, number, number];

function cell(hd: IplInstance[], lod: IplInstance[]): GridCell {
  return { cx: 0, cy: 0, hd, lod };
}

function def(id: number, modelName: string, txdName = 'txd'): IdeObjectDef {
  return { drawDistance: 300, flags: 0, id, modelName, txdName };
}

function inst(id: number, position: Vec3 = [0, 0, 0]): IplInstance {
  return { id, interior: 0, lod: -1, modelName: '', position, rotation: [0, 0, 0, 1] };
}

function mapDefs(defs: IdeObjectDef[], instances: IplInstance[] = []): MapDefinitions {
  return { catalog: new Map(defs.map((d) => [d.id, d])), imgDirs: [], instances };
}

describe('cellGroups', () => {
  describe('positive cases', () => {
    it('selects HD instances and groups them by model+txd', () => {
      const defs = mapDefs([def(1, 'house'), def(2, 'tree')]);
      const groups = cellGroups(defs, cell([inst(1), inst(1), inst(2)], []), false);

      expect([...groups.keys()].sort()).toEqual(['house|txd', 'tree|txd']);
      expect(groups.get('house|txd')?.instances).toHaveLength(2);
    });

    it('selects LOD instances when lod is true', () => {
      const defs = mapDefs([def(1, 'house'), def(2, 'LODhouse')]);
      const groups = cellGroups(defs, cell([inst(1)], [inst(2)]), true);

      expect([...groups.keys()]).toEqual(['lodhouse|txd']);
    });

    it('skips instances with no catalog def', () => {
      const groups = cellGroups(mapDefs([]), cell([inst(99)], []), false);
      expect(groups.size).toBe(0);
    });
  });
});

describe('cellModelNames', () => {
  describe('negative cases', () => {
    it('returns nothing for a cell that is not in the grid', () => {
      expect(cellModelNames(mapDefs([]), new Map(), 5, 5, false)).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('lists each model once for the requested detail level', () => {
      const defs = mapDefs([def(1, 'house'), def(2, 'tree'), def(3, 'LODhouse')]);
      const grid: WorldGrid = new Map([[cellKey(0, 0), cell([inst(1), inst(1), inst(2)], [inst(3)])]]);

      expect(cellModelNames(defs, grid, 0, 0, false).sort()).toEqual(['house', 'tree']); // deduped HD set
      expect(cellModelNames(defs, grid, 0, 0, true)).toEqual(['LODhouse']);
    });
  });
});
