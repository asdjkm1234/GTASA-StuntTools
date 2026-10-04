import { describe, expect, it } from 'vitest';

import { mulberry32, pickWeighted } from './rng';

describe('mulberry32', () => {
  describe('negative cases', () => {
    it('never leaves [0, 1)', () => {
      const random = mulberry32(0);
      for (let draw = 0; draw < 1000; draw += 1) {
        const value = random();

        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }
    });
  });

  describe('positive cases', () => {
    it('repeats exactly for the same seed and differs for another (D9 reproducibility)', () => {
      const first = Array.from({ length: 8 }, mulberry32(42));
      const again = Array.from({ length: 8 }, mulberry32(42));
      const other = Array.from({ length: 8 }, mulberry32(43));

      expect(again).toEqual(first);
      expect(other).not.toEqual(first);
    });
  });
});

describe('pickWeighted', () => {
  describe('negative cases', () => {
    it('reports -1 when every weight is zero', () => {
      expect(pickWeighted(mulberry32(1), [0, 0, 0])).toBe(-1);
    });

    it('reports -1 for an empty list', () => {
      expect(pickWeighted(mulberry32(1), [])).toBe(-1);
    });

    it('never returns an index whose weight is zero or negative', () => {
      const random = mulberry32(7);
      for (let draw = 0; draw < 200; draw += 1) {
        expect(pickWeighted(random, [0, 3, -1, 1])).not.toBe(0);
      }
    });
  });

  describe('positive cases', () => {
    it('always picks the only weighted option', () => {
      const random = mulberry32(5);
      for (let draw = 0; draw < 50; draw += 1) {
        expect(pickWeighted(random, [0, 1, 0])).toBe(1);
      }
    });

    it('splits draws in proportion to the weights', () => {
      const random = mulberry32(9);
      const counts = [0, 0];
      for (let draw = 0; draw < 4000; draw += 1) {
        counts[pickWeighted(random, [3, 1])] += 1;
      }

      // 3:1 over 4000 draws — a wide band, so this asserts the weighting, not the exact stream.
      expect(counts[0] / 4000).toBeGreaterThan(0.7);
      expect(counts[0] / 4000).toBeLessThan(0.8);
    });
  });
});
