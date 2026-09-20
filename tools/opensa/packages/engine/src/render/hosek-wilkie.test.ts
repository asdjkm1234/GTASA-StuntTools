import { describe, expect, it } from 'vitest';

import { cookHosekWilkie, hosekWilkieRadiance, hosekWilkieRadianceFromCos } from './hosek-wilkie';

const ZENITH = 0;
const HORIZON = Math.PI / 2 - 0.01;

describe('cookHosekWilkie / hosekWilkieRadiance', () => {
  describe('negative cases', () => {
    it('clamps out-of-range inputs instead of producing NaN (negative elevation, wild turbidity)', () => {
      for (const channels of [cookHosekWilkie(0, -1, -0.5), cookHosekWilkie(99, 2, Math.PI)]) {
        for (const channel of channels) {
          const value = hosekWilkieRadiance(channel, HORIZON, 0.5);
          expect(Number.isFinite(value)).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('never returns negative radiance across the dome', () => {
      const channels = cookHosekWilkie(4, 0.15, 0.3);
      for (let theta = 0; theta < Math.PI / 2; theta += 0.2) {
        for (let gamma = 0; gamma <= Math.PI; gamma += 0.4) {
          for (const channel of channels) {
            expect(hosekWilkieRadiance(channel, theta, gamma)).toBeGreaterThanOrEqual(0);
          }
        }
      }
    });
  });

  describe('positive cases', () => {
    it('produces a blue-dominant zenith and a brighter, whiter horizon on a clear day', () => {
      const [r, g, b] = cookHosekWilkie(3, 0.15, Math.PI / 3);
      const zenith = [r, g, b].map((channel) => hosekWilkieRadiance(channel, ZENITH, Math.PI / 6));
      const horizon = [r, g, b].map((channel) => hosekWilkieRadiance(channel, HORIZON, Math.PI));
      expect(zenith[2]).toBeGreaterThan(zenith[0]); // blue over red at the zenith
      expect(horizon[2]).toBeGreaterThan(zenith[2]); // horizon brightening
      expect(horizon[0] / horizon[2]).toBeGreaterThan(zenith[0] / zenith[2]); // whiter at the horizon
    });

    it('turns the sunward horizon red at a low sun (the sunset the Preetham fit muted)', () => {
      const [r, , b] = cookHosekWilkie(3, 0.15, 0.05);
      const red = hosekWilkieRadiance(r, HORIZON, 0.03);
      const blue = hosekWilkieRadiance(b, HORIZON, 0.03);
      expect(red).toBeGreaterThan(blue * 3);
    });

    it('gives the same radiance from the cosines as from the angles — the LUT takes the cheap form', () => {
      const channels = cookHosekWilkie(3, 0.15, Math.PI / 4);
      for (const channel of channels) {
        for (const [theta, gamma] of [
          [0, 0],
          [Math.PI / 4, 0.05],
          [Math.PI / 3, Math.PI / 2],
          [Math.PI / 2, Math.PI],
        ]) {
          const fromAngles = hosekWilkieRadiance(channel, theta, gamma);
          const fromCos = hosekWilkieRadianceFromCos(channel, Math.max(0, Math.cos(theta)), Math.cos(gamma), gamma);
          expect(fromCos).toBe(fromAngles);
        }
      }
    });

    it('brightens the circumsolar region over the anti-solar sky', () => {
      const channels = cookHosekWilkie(3, 0.15, Math.PI / 4);
      for (const channel of channels) {
        const nearSun = hosekWilkieRadiance(channel, Math.PI / 4, 0.05);
        const awaySun = hosekWilkieRadiance(channel, Math.PI / 4, Math.PI / 2);
        expect(nearSun).toBeGreaterThan(awaySun);
      }
    });
  });
});
