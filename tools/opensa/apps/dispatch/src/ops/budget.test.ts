import { describe, expect, it } from 'vitest';

import { DEFAULT_CALLS, DEFAULT_SHIFT, seedSize, UNITS_ON_SCREEN } from './budget';

describe('seedSize', () => {
  describe('negative cases', () => {
    it('falls back to the demo shift when nothing was asked for', () => {
      expect(seedSize(new URLSearchParams())).toEqual({ calls: DEFAULT_CALLS, units: DEFAULT_SHIFT });
    });

    it('falls back on a value that is not a number', () => {
      expect(seedSize(new URLSearchParams('units=lots')).units).toBe(DEFAULT_SHIFT);
    });

    it('falls back on a negative count rather than seeding a board backwards', () => {
      expect(seedSize(new URLSearchParams('calls=-4')).calls).toBe(DEFAULT_CALLS);
    });
  });

  describe('positive cases', () => {
    it('reads the declared worst case off the query string', () => {
      expect(seedSize(new URLSearchParams(`units=${UNITS_ON_SCREEN}&calls=40`))).toEqual({
        calls: 40,
        units: UNITS_ON_SCREEN,
      });
    });

    it('accepts an empty board — a shift can start with nothing on it', () => {
      expect(seedSize(new URLSearchParams('units=0&calls=0'))).toEqual({ calls: 0, units: 0 });
    });
  });
});
