import { describe, expect, it } from 'vitest';

import { dilateTransparent } from './dilate';

/** A `size²` RGBA image, transparent black everywhere except one covered texel of the given colour. */
function image(size: number, at: [number, number], color: [number, number, number]): Uint8Array {
  const rgba = new Uint8Array(size * size * 4);
  const index = (at[1] * size + at[0]) * 4;
  rgba.set([...color, 255], index);

  return rgba;
}

describe('dilateTransparent', () => {
  describe('negative cases', () => {
    it('leaves a fully transparent tile untouched (nothing to bleed from)', () => {
      const rgba = new Uint8Array(4 * 4 * 4);
      dilateTransparent(rgba, 4, 4, 4);

      expect([...rgba]).toEqual([...new Uint8Array(4 * 4 * 4)]);
    });

    it('never touches alpha — the dilated texels stay invisible', () => {
      const rgba = image(4, [1, 1], [80, 140, 60]);
      dilateTransparent(rgba, 4, 4, 4);

      for (let i = 0; i < 16; i += 1) {
        expect(rgba[i * 4 + 3]).toBe(i === 5 ? 255 : 0);
      }
    });

    it('stops after `rings` steps instead of flooding the tile', () => {
      const rgba = image(8, [0, 0], [80, 140, 60]);
      dilateTransparent(rgba, 8, 8, 2);

      expect(rgba[(0 * 8 + 2) * 4 + 1]).toBe(140); // 2 rings out: filled
      expect(rgba[(0 * 8 + 3) * 4 + 1]).toBe(0); // 3 rings out: still background
    });
  });

  describe('positive cases', () => {
    it('bleeds the covered colour into its transparent neighbours', () => {
      const rgba = image(4, [1, 1], [80, 140, 60]);
      dilateTransparent(rgba, 4, 4, 1);

      for (const [x, y] of [
        [0, 0],
        [1, 0],
        [2, 2],
        [0, 1],
      ]) {
        const o = (y * 4 + x) * 4;
        expect([rgba[o], rgba[o + 1], rgba[o + 2]]).toEqual([80, 140, 60]);
      }
    });

    it('averages the covered neighbours it does have', () => {
      const rgba = new Uint8Array(3 * 3 * 4);
      rgba.set([100, 100, 100, 255], (0 * 3 + 0) * 4);
      rgba.set([200, 200, 200, 255], (0 * 3 + 2) * 4);
      dilateTransparent(rgba, 3, 3, 1);

      const middle = (0 * 3 + 1) * 4;
      expect(rgba[middle]).toBe(150);
    });
  });
});
