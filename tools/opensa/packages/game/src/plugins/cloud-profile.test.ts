import { describe, expect, it } from 'vitest';

import { cloudProfile } from './cloud-profile';

describe('cloudProfile', () => {
  describe('negative cases', () => {
    it('falls back to the default profile for an unmatched weather (e.g. storm/sandstorm)', () => {
      expect(cloudProfile('SANDSTORM')).toEqual({ coverage: 0.5, darkness: 0.3, scale: 1, tint: [1, 1, 1] });
    });
  });

  describe('positive cases', () => {
    it('gives EXTRASUNNY fewer clouds than SUNNY (substring order holds)', () => {
      const extrasunny = cloudProfile('EXTRASUNNY');
      const sunny = cloudProfile('SUNNY');
      expect(extrasunny.coverage).toBeLessThan(sunny.coverage);
      expect(extrasunny.scale).toBeGreaterThan(sunny.scale); // smaller scattered puffs
    });

    it('maps the overcast families: CLOUDY dark broken deck, RAINY full storm slate', () => {
      const cloudy = cloudProfile('CLOUDY');
      const rainy = cloudProfile('RAINY');
      expect(cloudy.coverage).toBeGreaterThan(0.8);
      expect(rainy.coverage).toBe(1);
      expect(rainy.darkness).toBeGreaterThan(cloudy.darkness);
      // Storm hue: colder (blue-shifted) than the cloudy grey.
      expect(rainy.tint[2] / rainy.tint[0]).toBeGreaterThan(cloudy.tint[2] / cloudy.tint[0]);
    });

    it('turns SMOG variants into big dirty clumps (scale + warm tint) over their base coverage', () => {
      const smog = cloudProfile('EXTRASUNNY_SMOG');
      const base = cloudProfile('EXTRASUNNY');
      expect(smog.coverage).toBeCloseTo(base.coverage + 0.12, 5);
      expect(smog.scale).toBeLessThan(1); // bigger clumps
      expect(smog.tint[0]).toBeGreaterThan(smog.tint[2]); // dirty warm haze
    });

    it('clamps the smog bump to 1', () => {
      const profile = cloudProfile('CLOUDY_SMOG');
      expect(profile.coverage).toBe(1);
      expect(profile.darkness).toBeCloseTo(0.65, 5);
    });
  });
});
