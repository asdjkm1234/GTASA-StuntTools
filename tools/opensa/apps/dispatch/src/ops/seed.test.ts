import { describe, expect, it } from 'vitest';

import { UNITS_ON_SCREEN } from './budget';
import { initialOperations } from './seed';

describe('initialOperations', () => {
  describe('negative cases', () => {
    it('seeds nothing when the board is asked for nothing', () => {
      const ops = initialOperations(0, { calls: 0, units: 0 });

      expect(ops.units).toHaveLength(0);
      expect(ops.incidents).toHaveLength(0);
    });

    it('never puts two units on the same id', () => {
      const ops = initialOperations(0, { calls: 4, units: UNITS_ON_SCREEN });
      const ids = new Set(ops.units.map((unit) => unit.id));

      expect(ids.size).toBe(UNITS_ON_SCREEN);
    });
  });

  describe('positive cases', () => {
    it('opens the demo shift with the nine named cars', () => {
      const ops = initialOperations(1000);

      expect(ops.units).toHaveLength(9);
      expect(ops.units[0].callsign).toBe('1-ADAM-12');
      expect(ops.incidents).toHaveLength(2);
    });

    it('loads the board to the declared worst case', () => {
      const ops = initialOperations(0, { calls: 40, units: UNITS_ON_SCREEN });

      expect(ops.units).toHaveLength(UNITS_ON_SCREEN);
      expect(ops.incidents).toHaveLength(40);
      expect(ops.log[0]).toContain('150 units on duty');
    });

    it('is deterministic — the same size is the same board twice', () => {
      expect(initialOperations(0, { calls: 6, units: 60 })).toEqual(initialOperations(0, { calls: 6, units: 60 }));
    });

    it('scatters the generated cars instead of stacking them on the landmarks', () => {
      const ops = initialOperations(0, { calls: 0, units: UNITS_ON_SCREEN });
      const places = new Set(ops.units.slice(9).map((unit) => `${unit.at[0]},${unit.at[1]}`));

      expect(places.size).toBe(UNITS_ON_SCREEN - 9);
    });
  });
});
