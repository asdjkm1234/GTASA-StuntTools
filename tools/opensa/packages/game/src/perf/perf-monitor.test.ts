import { describe, expect, it } from 'vitest';

import { percentile } from './perf-monitor';

describe('percentile', () => {
  describe('negative cases', () => {
    it('returns 0 for an empty sample set', () => {
      expect(percentile([], 95)).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('returns the nearest-rank value without mutating the input', () => {
      const samples = [5, 1, 3, 2, 4];
      expect(percentile(samples, 95)).toBe(5);
      expect(percentile(samples, 50)).toBe(3);
      expect(samples).toEqual([5, 1, 3, 2, 4]);
    });
  });
});
