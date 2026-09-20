import { describe, expect, it } from 'vitest';

import { lodView, pixelsSubtended, subtendsAtLeast, unitsPerPixel } from './view';

// FOV 60° / 1080 px / 300 u → one pixel covers 2·tan(30°)·300/1080 ≈ 0.3207 world units.
const VIEW = lodView(300);

describe('view', () => {
  describe('negative cases', () => {
    it('a zero-radius object never subtends a pixel', () => {
      expect(subtendsAtLeast(VIEW, 0, 1)).toBe(false);
    });

    it('an object under the pixel threshold is rejected', () => {
      // Diameter 0.4 u ≈ 1.25 px at 300 u — below a 2 px threshold.
      expect(subtendsAtLeast(VIEW, 0.2, 2)).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('unitsPerPixel scales linearly with distance', () => {
      expect(unitsPerPixel(VIEW, 300)).toBeCloseTo(0.3207, 3);
      expect(unitsPerPixel(VIEW, 600)).toBeCloseTo(2 * unitsPerPixel(VIEW, 300), 10);
    });

    it('pixelsSubtended judges the diameter at the view minDistance by default', () => {
      // Radius 1.6 u → diameter 3.2 u ≈ 9.98 px at 300 u.
      expect(pixelsSubtended(VIEW, 1.6)).toBeCloseTo(9.98, 1);
    });

    it('an object at or over the pixel threshold is kept', () => {
      expect(subtendsAtLeast(VIEW, 0.35, 2)).toBe(true);
    });
  });
});
