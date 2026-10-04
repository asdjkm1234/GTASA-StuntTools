import { describe, expect, it } from 'vitest';

import { normalizeSpriteAlpha } from './sprites';

/** width × height RGBA, filled from a per-pixel callback. */
function sprite(pixels: [number, number, number, number][]): Uint8Array {
  return new Uint8Array(pixels.flat());
}

describe('normalizeSpriteAlpha', () => {
  describe('negative cases', () => {
    it('leaves a genuinely alpha-shaped sprite alone (the smoke puffs DO have real alpha)', () => {
      const smoke = sprite([
        [255, 255, 255, 0],
        [255, 255, 255, 128],
      ]);

      normalizeSpriteAlpha(smoke);

      expect([...smoke]).toEqual([255, 255, 255, 0, 255, 255, 255, 128]);
    });
  });

  describe('positive cases', () => {
    it('derives the alpha from the luminance when the sprite is RGB-shaped on black', () => {
      // This is coronastar/coronamoon: the glow lives in RGB, the alpha channel is pinned at 255. Trusting
      // that alpha renders the moon as a featureless white disc and a street lamp as a white ball.
      const corona = sprite([
        [0, 0, 0, 255], // black background → transparent
        [255, 255, 255, 255], // the glow → opaque
      ]);

      normalizeSpriteAlpha(corona);

      expect(corona[3]).toBe(0);
      expect(corona[7]).toBe(255);
    });

    it('keeps the colour intact — only the alpha is synthesised', () => {
      const warm = sprite([[255, 128, 0, 255]]);

      normalizeSpriteAlpha(warm);

      expect([...warm.subarray(0, 3)]).toEqual([255, 128, 0]);
      expect(warm[3]).toBeGreaterThan(100); // luminance of a strong orange
      expect(warm[3]).toBeLessThan(200);
    });
  });
});
