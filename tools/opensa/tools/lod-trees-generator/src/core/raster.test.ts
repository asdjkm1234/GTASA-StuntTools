import { describe, expect, it } from 'vitest';

import type { DecodedTexture, Rgba } from './types';

import { createRaster, rasterizeTriangle, type RasterTri, resolveRaster, withMipChain } from './raster';

/** A triangle covering the whole 4×4 raster, uniform vertex colour. */
function fullTri(color: null | Rgba): RasterTri {
  return {
    colors: color ? [color, color, color] : null,
    pixels: [
      [-4, -4, 0],
      [12, -4, 0],
      [0, 12, 0],
    ],
    uvs: [
      [0, 0],
      [1, 0],
      [0, 1],
    ],
  };
}

/** A 1×1 texture of the given colour. */
function texture(rgba: Rgba): DecodedTexture {
  return { hasAlpha: rgba[3] < 255, height: 1, rgba: new Uint8Array(rgba), width: 1 };
}

/** A `size²` texture from a per-texel colour function. */
function textureOf(size: number, fn: (x: number, y: number) => Rgba): DecodedTexture {
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      rgba.set(fn(x, y), (y * size + x) * 4);
    }
  }

  return { hasAlpha: true, height: size, rgba, width: size };
}

describe('rasterizeTriangle normalized dual-convention blending (plan 012)', () => {
  describe('negative cases', () => {
    it('drops fragments below the alpha test', () => {
      const raster = createRaster(4, 4);
      rasterizeTriangle(raster, fullTri(null), texture([200, 200, 200, 60]), 0.5);

      expect(raster.color[3]).toBe(0); // nothing written
      expect(raster.colorLinear[3]).toBe(0);
    });

    it('keeps alpha a plain product in BOTH buffers (coverage is not gamma-encoded)', () => {
      const raster = createRaster(4, 4);
      rasterizeTriangle(raster, fullTri([255, 255, 255, 128]), texture([255, 255, 255, 255]), 0.1);

      expect(raster.color[3]).toBe(128);
      expect(raster.colorLinear[3]).toBe(128);
    });
  });

  describe('positive cases', () => {
    it('normalization identity: prelit equal to the day average leaves the texture untouched in BOTH conventions', () => {
      // THE plan-012 invariant: the mean lighting level rides the card VERTICES, so a vertex at exactly the
      // average contributes factor 1 — the atlas texel equals the source texel under any renderer pipeline.
      const raster = createRaster(4, 4);
      rasterizeTriangle(raster, fullTri([86, 86, 86, 255]), texture([97, 134, 51, 255]), 0.5, [86, 86, 86, 255]);

      expect([raster.color[0], raster.color[1], raster.color[2]]).toEqual([97, 134, 51]);
      expect([raster.colorLinear[0], raster.colorLinear[1], raster.colorLinear[2]]).toEqual([97, 134, 51]);
    });

    it('encodes the variation per convention: gamma = byte product, linear = linear-light product', () => {
      // Prelit at HALF the normalization average (factor 0.5) on a white texture:
      // real SA (gamma pipeline) shows byte products → 128; OpenSA (linear pipeline) needs lin2srgb(0.5) = 188.
      const raster = createRaster(4, 4);
      rasterizeTriangle(raster, fullTri([64, 64, 64, 255]), texture([255, 255, 255, 255]), 0.5, [128, 128, 128, 255]);

      expect(raster.color[0]).toBe(128);
      expect(raster.colorLinear[0]).toBe(188);
    });

    it('clamps above-average prelit instead of wrapping (gamma bytes cap at 255)', () => {
      const raster = createRaster(4, 4);
      rasterizeTriangle(
        raster,
        fullTri([255, 255, 255, 255]),
        texture([200, 200, 200, 255]),
        0.5,
        [128, 128, 128, 255],
      );

      expect(raster.color[0]).toBe(255); // 200 × 2 clamped
      expect(raster.colorLinear[0]).toBe(255);
    });

    it('defaults to the un-normalized product when no average is given (source without prelit)', () => {
      // The field case that exposed the bug: tex 97 × prelit 86 → 33 in gamma bytes, 57 in linear light.
      const raster = createRaster(4, 4);
      rasterizeTriangle(raster, fullTri([86, 86, 86, 255]), texture([97, 97, 97, 255]), 0.5);

      expect(raster.color[0]).toBe(33);
      expect(raster.colorLinear[0]).toBeGreaterThanOrEqual(56);
      expect(raster.colorLinear[0]).toBeLessThanOrEqual(58);
    });
  });
});

describe('supersampled bake (plan 013)', () => {
  describe('negative cases', () => {
    it('refuses a sub-sample count that is not a power of two (the resolve halves the grid)', () => {
      expect(() => createRaster(4, 4, 3)).toThrow(/power of two/);
    });

    it('does not thin the canopy: the cutout decision stays at the base texture resolution', () => {
      // Half-covered leaf stripes at 4× the atlas scale: every mip level averages alpha to ~128, which put
      // through the 0.5 test would drop the whole canopy. The mip supplies COLOUR only.
      const leaf = withMipChain(textureOf(16, (x) => (x % 8 < 4 ? [200, 220, 180, 255] : [0, 0, 0, 0])));
      const raster = createRaster(4, 4, 2);
      // The sub-sample grid is 8×8 here, so the covering triangle has to be stated in sub-sample space.
      rasterizeTriangle(
        raster,
        {
          colors: null,
          pixels: [
            [-1, -1, 0],
            [17, -1, 0],
            [-1, 17, 0],
          ],
          uvs: [
            [0, 0],
            [2, 0],
            [0, 2],
          ],
        },
        leaf,
        0.5,
      );
      const { color } = resolveRaster(raster);

      const mass = [...Array(16).keys()].reduce((sum, i) => sum + color[i * 4 + 3], 0) / (16 * 255);
      expect(mass).toBeGreaterThan(0.4);
    });
  });

  describe('positive cases', () => {
    it('resolves partial sub-sample coverage into partial alpha (an antialiased canopy edge)', () => {
      // Two triangles covering the sub-sample rect x ∈ [0, 3) of a 2×2 output raster at 2×2 sub-samples:
      // output texel (0,0) takes all four of its sub-samples, texel (1,0) exactly half of them.
      const raster = createRaster(2, 2, 2);
      const quad: [number, number, number][][] = [
        [
          [0, 0, 0],
          [3, 0, 0],
          [0, 4, 0],
        ],
        [
          [3, 0, 0],
          [3, 4, 0],
          [0, 4, 0],
        ],
      ];
      for (const pixels of quad) {
        rasterizeTriangle(
          raster,
          {
            colors: null,
            pixels: pixels as RasterTri['pixels'],
            uvs: [
              [0, 0],
              [1, 0],
              [0, 1],
            ],
          },
          texture([255, 255, 255, 255]),
          0.5,
        );
      }
      const { color } = resolveRaster(raster);

      expect(color[3]).toBe(255); // (0,0): 4 of 4 sub-samples
      expect(color[7]).toBe(128); // (1,0): 2 of 4
    });

    it('weights the mip chain by CUTOUT alpha, so sub-threshold texels do not darken the colour', () => {
      // Half the texels are bright leaf, half are dark with alpha below the cutout — never drawn, and so
      // never part of the colour either. A raw-alpha weighting would average them in.
      const leaf = withMipChain(textureOf(4, (x) => (x < 2 ? [200, 220, 180, 255] : [10, 10, 10, 100])));
      const level1 = leaf.mips?.[1];

      expect(level1?.data[1]).toBe(220);
    });
  });
});
