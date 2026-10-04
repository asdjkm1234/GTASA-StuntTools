import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { describe, expect, it } from 'vitest';

import { FILLER_ROWS_PER_AREA, fillerIplText, gridPositions, planInflation } from './plan';

const MODEL = { id: 1234, name: 'dummy' };

describe('planInflation', () => {
  describe('negative cases', () => {
    it('throws when the base already meets the target', () => {
      expect(() => planInflation({ baseRows: 33000, baseSlots: 30, targetRows: 33000 })).toThrow(/already has/);
    });
  });

  describe('positive cases', () => {
    it('splits the added rows into dense filler areas', () => {
      const plan = planInflation({ baseRows: 21000, baseSlots: 30, targetRows: 33000 });

      expect(plan.addRows).toBe(12000);
      expect(plan.fillerRows).toBe(12000);
      expect(plan.fillerAreas).toBe(3); // 12000 / 4000
      expect(plan.newSlots).toBe(3);
      expect(plan.totalSlots).toBe(33);
      expect(plan.totalRows).toBe(33000);
    });

    it('rounds partial filler rows up to a whole area', () => {
      const plan = planInflation({ baseRows: 32000, baseSlots: 35, targetRows: 32500 });

      expect(plan.addRows).toBe(500);
      expect(plan.fillerAreas).toBe(1); // ceil(500 / 4000)
      expect(plan.totalSlots).toBe(36);
    });
  });
});

describe('gridPositions', () => {
  describe('positive cases', () => {
    it('lays out exactly count points, wrapping by columns', () => {
      const points = gridPositions(3, [100, 200, -1000], 4, 2);

      expect(points).toHaveLength(3);
      expect(points[0]).toEqual([100, 200, -1000]);
      expect(points[1]).toEqual([104, 200, -1000]);
      expect(points[2]).toEqual([100, 204, -1000]); // wraps to next row after 2 cols
    });
  });
});

describe('fillerIplText', () => {
  describe('positive cases', () => {
    it('emits parseable 11-column inst rows counted by parseIpl', () => {
      const text = fillerIplText(MODEL, gridPositions(FILLER_ROWS_PER_AREA, [0, 0, -1000]));
      const parsed = parseIpl(text);

      expect(parsed).toHaveLength(FILLER_ROWS_PER_AREA);
      expect(parsed[0].id).toBe(MODEL.id);
      expect(parsed[0].modelName).toBe(MODEL.name);
      expect(parsed[0].lod).toBe(-1);
    });
  });
});
