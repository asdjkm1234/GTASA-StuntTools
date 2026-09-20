import { describe, expect, it } from 'vitest';

import { buildMipChain, downsample } from './mip';

describe('downsample', () => {
  describe('positive cases', () => {
    it('averages a 2×2 RGBA image to 1×1 in LINEAR space', () => {
      // four pixels: red, blue, green, white → each channel sees two 255s and two 0s. The mean is taken in
      // linear light (GPU mip semantics): lin2srgb((1+0+0+1)/4) = 188 — NOT the sRGB-byte mean 128, which
      // darkens mid-tones ~20 % (the "LOD greyer than HD" residue, lod-trees plan 012).
      const rgba = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 255, 255]);
      const out = downsample(rgba, 2, 2, 'linear');
      expect(out.width).toBe(1);
      expect(out.height).toBe(1);
      expect([...out.data]).toEqual([188, 188, 188, 255]);
    });

    it('weights RGB by alpha — transparent texels never bleach the visible colour', () => {
      // One DARK GREEN opaque leaf texel + three fully-transparent WHITE background texels.
      const rgba = new Uint8Array([
        20,
        90,
        20,
        255, // leaf
        255,
        255,
        255,
        0, // background
        255,
        255,
        255,
        0,
        255,
        255,
        255,
        0,
      ]);
      const out = downsample(rgba, 2, 2, 'linear');
      expect([...out.data.slice(0, 3)]).toEqual([20, 90, 20]); // colour = the leaf's, NOT washed to ~196
      expect(out.data[3]).toBe(64); // alpha still the plain average (255/4)
    });

    it('falls back to the plain (linear-space) average for a fully-transparent quad', () => {
      const rgba = new Uint8Array([10, 20, 30, 0, 30, 40, 50, 0, 50, 60, 70, 0, 70, 80, 90, 0]);
      const out = downsample(rgba, 2, 2, 'linear');
      expect([...out.data]).toEqual([46, 55, 65, 0]); // linear mean of each channel, alpha stays 0
    });

    it("averages raw bytes in 'gamma' mode — the real-SA (D3D9 gamma filtering) convention", () => {
      // Same red/blue/green/white quad as above: byte mean per channel = 128 (vs 188 in linear mode).
      const rgba = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 255, 255, 255, 255, 255]);
      const out = downsample(rgba, 2, 2, 'gamma');
      expect([...out.data]).toEqual([128, 128, 128, 255]);
    });

    it('halves each dimension (floored at 1)', () => {
      const out = downsample(new Uint8Array(8 * 1 * 4), 8, 1, 'linear');
      expect([out.width, out.height]).toEqual([4, 1]);
    });
  });
});

describe('buildMipChain', () => {
  describe('positive cases', () => {
    it('produces every level down to 1×1', () => {
      const levels = buildMipChain(new Uint8Array(4 * 4 * 4), 4, 4, 'linear');
      expect(levels.map((l) => [l.width, l.height])).toEqual([
        [4, 4],
        [2, 2],
        [1, 1],
      ]);
    });

    it('keeps the given buffer as the base level', () => {
      const base = new Uint8Array(2 * 2 * 4).fill(7);
      const levels = buildMipChain(base, 2, 2, 'linear');
      expect(levels[0].data).toBe(base);
      expect(levels).toHaveLength(2); // 2×2, 1×1
    });
  });
});
