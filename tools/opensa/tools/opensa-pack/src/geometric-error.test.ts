import { describe, expect, it } from 'vitest';

import { promisedGeometricError } from './geometric-error';

describe('promisedGeometricError', () => {
  describe('negative cases', () => {
    it('is zero when the bake promised nothing (a 0 px cull keeps everything)', () => {
      expect(promisedGeometricError({ hdDrawDistance: 300, screenPixels: 0 })).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('turns the shipped bake config into 0.64 world units', () => {
      // lod.config.ts: 2 px at 300 u, judged on the bake's 1080p / 60° view → 2 × 0.3208 u/px.
      expect(promisedGeometricError({ hdDrawDistance: 300, screenPixels: 2 })).toBeCloseTo(0.6415, 4);
    });

    it('grows with the distance the promise was made at', () => {
      const near = promisedGeometricError({ hdDrawDistance: 300, screenPixels: 2 });
      const far = promisedGeometricError({ hdDrawDistance: 600, screenPixels: 2 });

      expect(far).toBeCloseTo(near * 2, 6);
    });

    it('reproduces the bake distance when read back through the same view — the rule is a consequence', () => {
      const promise = { hdDrawDistance: 300, screenPixels: 2 };
      const error = promisedGeometricError(promise);
      // The runtime asks: at what distance does this error still draw `screenPixels`? The bake's own ring.
      const unitsPerPixelAt = (distance: number): number => (2 * Math.tan(Math.PI / 6) * distance) / 1080;

      expect(error / unitsPerPixelAt(300)).toBeCloseTo(promise.screenPixels, 6);
    });
  });
});
