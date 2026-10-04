import type { IdeObjectDef, IplInstance } from '@opensa/renderware/parsers/text/types';

import { describe, expect, it } from 'vitest';

import { placedModelNames } from './placed-models';

const CELL = 250;

const def = (id: number, modelName: string): [number, IdeObjectDef] => [
  id,
  { flags: 0, id, modelName, txdName: 'generic' } as IdeObjectDef,
];

const at = (id: number, x: number, y: number, modelName = ''): IplInstance =>
  ({ id, interior: 0, lod: -1, modelName, position: [x, y, 0] }) as unknown as IplInstance;

/** Cells 9,-7 … 10,-6 — the district `npm run phone` converts by default: x 2250…2750, y −1750…−1250. */
const RECT = [9, -7, 10, -6] as const;

describe('placedModelNames', () => {
  describe('negative cases', () => {
    it('leaves out a model placed outside the rect', () => {
      const defs = {
        catalog: new Map([def(1, 'inside'), def(2, 'far_away')]),
        instances: [at(1, 2400, -1700), at(2, 9000, 9000)],
      };

      expect(placedModelNames(defs, RECT, CELL)).toEqual(new Set(['inside']));
    });

    it("excludes the rect's upper edge, which belongs to the next cell", () => {
      const defs = { catalog: new Map([def(1, 'edge')]), instances: [at(1, 2750, -1500)] };

      expect(placedModelNames(defs, RECT, CELL)).toEqual(new Set());
    });

    it('returns nothing when the map places nothing', () => {
      expect(placedModelNames({ catalog: new Map(), instances: [] }, RECT, CELL)).toEqual(new Set());
    });

    it('falls back to the instance name rather than dropping a placement whose id is in no catalogue', () => {
      const defs = { catalog: new Map(), instances: [at(77, 2400, -1700, 'Orphan')] };

      expect(placedModelNames(defs, RECT, CELL)).toEqual(new Set(['orphan']));
    });
  });

  describe('positive cases', () => {
    it('keeps every model placed inside, lowercased and deduped across instances', () => {
      const defs = {
        catalog: new Map([def(1, 'Wall'), def(2, 'Tree')]),
        instances: [at(1, 2250, -1750), at(1, 2600, -1400), at(2, 2749, -1251)],
      };

      expect(placedModelNames(defs, RECT, CELL)).toEqual(new Set(['tree', 'wall']));
    });

    it('reads the timed catalogue too, so a tobj placement is not mistaken for an absent model', () => {
      const defs = {
        catalog: new Map(),
        instances: [at(9, 2400, -1700)],
        timedCatalog: new Map([def(9, 'NeonSign')]),
      };

      expect(placedModelNames(defs, RECT, CELL)).toEqual(new Set(['neonsign']));
    });

    it('accepts a rect given corner-swapped, the way normalizedRect does everywhere else', () => {
      const defs = { catalog: new Map([def(1, 'wall')]), instances: [at(1, 2400, -1700)] };

      expect(placedModelNames(defs, [10, -6, 9, -7], CELL)).toEqual(new Set(['wall']));
    });
  });
});
