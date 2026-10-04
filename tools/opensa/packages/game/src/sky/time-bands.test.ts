import { describe, expect, it } from 'vitest';

import { timeBandGrade } from './time-bands';

const clear = (sunSin: number): ReturnType<typeof timeBandGrade> => timeBandGrade({ overcast: 0, sunSin });

describe('timeBandGrade', () => {
  describe('negative cases', () => {
    it('has no moon and no golden term at high noon', () => {
      const noon = clear(1);
      expect(noon.night).toBe(0);
      expect(noon.moon).toBe(0);
      expect(noon.golden).toBe(0);
    });

    it('has no golden term in the dead of night (the sun is long gone)', () => {
      expect(clear(-0.8).golden).toBe(0);
    });

    it('heavy overcast swallows the moon', () => {
      expect(timeBandGrade({ overcast: 1, sunSin: -0.5 }).moon).toBeLessThan(clear(-0.5).moon * 0.2);
    });
  });

  describe('positive cases', () => {
    it('is deep night below civil twilight and full day above', () => {
      expect(clear(-0.2).night).toBe(1);
      expect(clear(0.2).night).toBe(0);
    });

    it('peaks the golden term at the horizon sun', () => {
      expect(clear(0).golden).toBe(1);
      expect(clear(0.1).golden).toBeLessThan(1);
      expect(clear(-0.06).golden).toBeLessThan(1);
    });

    it('lowers the bloom threshold at night so lamps and neon bloom', () => {
      expect(clear(-0.3).bloomThreshold).toBeCloseTo(0.38, 5);
      expect(clear(1).bloomThreshold).toBeCloseTo(0.7, 5);
      expect(clear(0.02).bloomThreshold).toBeGreaterThan(0.38); // continuous through dusk
    });

    it('is continuous across the twilight boundary (no pop)', () => {
      const a = clear(-0.101).night;
      const b = clear(-0.11).night;
      expect(Math.abs(a - b)).toBeLessThan(0.02);
    });
  });
});
