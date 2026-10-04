import { describe, expect, it } from 'vitest';

import type { IdeObjectDef, IplInstance, MapDefinitions } from '../parsers/text';

import { MODEL_SEARCH_LIMIT, ModelIndex } from './model-search';

type Vec3 = [number, number, number];

function def(id: number, modelName: string): IdeObjectDef {
  return { drawDistance: 300, flags: 0, id, modelName, txdName: 'txd' };
}

function inst(id: number, position: Vec3): IplInstance {
  return { id, interior: 0, lod: -1, modelName: '', position, rotation: [0, 0, 0, 1] };
}

function mapDefs(defs: IdeObjectDef[], instances: IplInstance[]): MapDefinitions {
  return { catalog: new Map(defs.map((d) => [d.id, d])), imgDirs: [], instances };
}

/** Three placements of one name at increasing distance from the origin, plus two other names. */
function sampleIndex(): ModelIndex {
  return new ModelIndex(
    mapDefs(
      [def(1, 'bealantr02_law2'), def(2, 'tree_hipoly11'), def(3, 'law2_beach')],
      [inst(1, [100, 0, 5]), inst(1, [300, 0, 5]), inst(1, [-500, 0, 5]), inst(2, [10, 10, 0]), inst(3, [20, 20, 0])],
    ),
  );
}

describe('ModelIndex.search', () => {
  describe('negative cases', () => {
    it('answers nothing for an empty or blank query', () => {
      const index = sampleIndex();
      expect(index.search('')).toEqual([]);
      expect(index.search('   ')).toEqual([]);
    });

    it('answers nothing for a name the map does not place', () => {
      expect(sampleIndex().search('zzz')).toEqual([]);
    });

    it('leaves out catalog names with no placement — a row that cannot be focused is not offered', () => {
      const index = new ModelIndex(mapDefs([def(1, 'placed'), def(2, 'unplaced')], [inst(1, [0, 0, 0])]));
      expect(index.search('placed').map((hit) => hit.name)).toEqual(['placed']);
    });

    it('caps the rows at the search limit', () => {
      const defs = Array.from({ length: MODEL_SEARCH_LIMIT + 5 }, (_, i) => def(i, `wall_${i}`));
      const index = new ModelIndex(
        mapDefs(
          defs,
          defs.map((d) => inst(d.id, [0, 0, 0])),
        ),
      );
      expect(index.search('wall_')).toHaveLength(MODEL_SEARCH_LIMIT);
    });
  });

  describe('positive cases', () => {
    it('matches case-insensitively on any substring and reports the placement count', () => {
      expect(sampleIndex().search('LANTR')).toEqual([{ count: 3, name: 'bealantr02_law2' }]);
    });

    it('ranks prefix matches before mid-name ones, then alphabetically', () => {
      expect(
        sampleIndex()
          .search('law2')
          .map((hit) => hit.name),
      ).toEqual(['law2_beach', 'bealantr02_law2']);
    });

    it('reports the catalog spelling, not the query', () => {
      const index = new ModelIndex(mapDefs([def(1, 'Beach_Ramp')], [inst(1, [0, 0, 0])]));
      expect(index.search('beach_r')[0]?.name).toBe('Beach_Ramp');
    });
  });
});

describe('ModelIndex.focusNext', () => {
  describe('negative cases', () => {
    it('answers null for an unplaced name', () => {
      expect(sampleIndex().focusNext('nothing_here', [0, 0])).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('takes the placement nearest the camera first', () => {
      expect(sampleIndex().focusNext('bealantr02_law2', [290, 0])).toEqual([300, 0, 5]);
    });

    it('cycles outwards on repeated focus of the same name, and wraps', () => {
      const index = sampleIndex();
      const from: [number, number] = [0, 0];
      expect(index.focusNext('bealantr02_law2', from)).toEqual([100, 0, 5]);
      expect(index.focusNext('bealantr02_law2', from)).toEqual([300, 0, 5]);
      expect(index.focusNext('bealantr02_law2', from)).toEqual([-500, 0, 5]);
      expect(index.focusNext('bealantr02_law2', from)).toEqual([100, 0, 5]);
    });

    it('keeps the order frozen while cycling — the jump itself must not re-rank the list', () => {
      const index = sampleIndex();
      expect(index.focusNext('bealantr02_law2', [0, 0])).toEqual([100, 0, 5]);
      // The camera now stands on the first placement; re-sorting there would answer it again forever.
      expect(index.focusNext('bealantr02_law2', [100, 0])).toEqual([300, 0, 5]);
    });

    it('re-orders when the focused name changes', () => {
      const index = sampleIndex();
      index.focusNext('bealantr02_law2', [0, 0]);
      expect(index.focusNext('tree_hipoly11', [0, 0])).toEqual([10, 10, 0]);
      expect(index.focusNext('bealantr02_law2', [-490, 0])).toEqual([-500, 0, 5]);
    });

    it('matches the name case-insensitively', () => {
      expect(sampleIndex().focusNext('BeaLantr02_LAW2', [0, 0])).toEqual([100, 0, 5]);
    });
  });
});
