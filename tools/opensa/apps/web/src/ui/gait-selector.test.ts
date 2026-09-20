import { describe, expect, it } from 'vitest';

import { GaitSelector } from './gait-selector';

/** idle→walk at 0.3, walk→run at 4.5, run→sprint at 8.5 (the prod midpoints for tiers 2/7/10). */
const THRESHOLDS = [0.3, 4.5, 8.5];

describe('GaitSelector', () => {
  describe('negative cases', () => {
    it('speed noise straddling a boundary does not flicker the gait', () => {
      const selector = new GaitSelector(THRESHOLDS);
      selector.update(4.6); // crossed up into run

      // Oscillating ±0.2 around the up-threshold stays RUN — the drop point is 0.5 below.
      expect(selector.update(4.4)).toBe(2);
      expect(selector.update(4.6)).toBe(2);
      expect(selector.update(4.3)).toBe(2);
    });

    it('sitting exactly ON the up-threshold does not switch up', () => {
      const selector = new GaitSelector(THRESHOLDS);

      expect(selector.update(4.5)).toBe(1);
    });
  });

  describe('positive cases', () => {
    it('ascends through every tier as the speed climbs', () => {
      const selector = new GaitSelector(THRESHOLDS);

      expect(selector.update(0)).toBe(0);
      expect(selector.update(1)).toBe(1);
      expect(selector.update(5)).toBe(2);
      expect(selector.update(9)).toBe(3);
    });

    it('a single update can climb several tiers (teleport into a sprint)', () => {
      const selector = new GaitSelector(THRESHOLDS);

      expect(selector.update(9)).toBe(3);
    });

    it('drops back once the speed falls past the hysteresis gap', () => {
      const selector = new GaitSelector(THRESHOLDS);
      selector.update(5);

      expect(selector.update(3.9)).toBe(1); // below 4.5 − 0.5
      expect(selector.update(0.1)).toBe(0);
    });

    it('the idle boundary keeps a workable gap (half its tiny threshold, not the full 0.5)', () => {
      const selector = new GaitSelector(THRESHOLDS);
      selector.update(1);

      expect(selector.update(0.2)).toBe(1); // above 0.3 − 0.15 → still walking
      expect(selector.update(0.1)).toBe(0); // below 0.15 → idle
    });
  });
});
