import { describe, expect, it } from 'vitest';

import {
  classifyAlpha,
  coverage,
  dilateEdges,
  downsample,
  effectiveAlphaClass,
  isAlphaMask,
  premultiply,
  preserveCoverage,
  processAlphaTexture,
  resampleToPow2,
  sharpenAlpha,
} from './alpha';

/** A sheet of one alpha value — a uniform film, the shape a translucent surface takes. */
function flatAlpha(alpha: number): Uint8Array {
  const rgba = new Uint8Array(256 * 4);
  for (let texel = 0; texel < 256; texel += 1) {
    rgba.set([120, 120, 120, alpha], texel * 4);
  }

  return rgba;
}

/** 4×4 RGBA8: three columns opaque green, one transparent BLACK — the boundary straddles a mip texel
 *  (the alpha-edge disease in miniature). */
function leafPatch(): Uint8Array {
  const rgba = new Uint8Array(4 * 4 * 4);
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      const at = (y * 4 + x) * 4;
      if (x < 3) {
        rgba.set([40, 200, 40, 255], at);
      } else {
        rgba.set([0, 0, 0, 0], at); // black transparent texels — the fringe source
      }
    }
  }

  return rgba;
}

describe('alpha pipeline', () => {
  describe('negative cases', () => {
    it('does not classify an opaque texture as cutout even when the flag lies', () => {
      const rgba = new Uint8Array(16 * 4).fill(255);

      expect(classifyAlpha(rgba, true)).toBe('opaque');
    });

    it('classifies soft gradients as softBlend, not cutout', () => {
      const rgba = new Uint8Array(64 * 4);
      for (let texel = 0; texel < 64; texel += 1) {
        rgba.set([100, 100, 100, texel * 4], texel * 4); // smooth alpha ramp
      }

      expect(classifyAlpha(rgba, true)).toBe('softBlend');
    });

    it('preserveCoverage is a no-op for a zero target', () => {
      const rgba = leafPatch();
      const before = [...rgba];
      preserveCoverage(rgba, 128, 0);

      expect([...rgba]).toEqual(before);
    });

    it('effectiveAlphaClass never upgrades opaque/cutout or an unrequested softBlend', () => {
      expect(effectiveAlphaClass('opaque', true)).toBe('opaque');
      expect(effectiveAlphaClass('cutout', true)).toBe('cutout');
      expect(effectiveAlphaClass('softBlend', false)).toBe('softBlend');
      expect(effectiveAlphaClass('softBlend', false, false)).toBe('softBlend');
    });

    it('isAlphaMask rejects a uniform translucent film — it is one-sided (a51_glass)', () => {
      expect(isAlphaMask(flatAlpha(190))).toBe(false);
      expect(isAlphaMask(flatAlpha(40))).toBe(false);
    });

    it('isAlphaMask rejects a ramp — its texels LIVE on the test (a shadow gradient)', () => {
      const rgba = new Uint8Array(256 * 4);
      for (let texel = 0; texel < 256; texel += 1) {
        rgba.set([80, 80, 80, texel], texel * 4);
      }

      expect(isAlphaMask(rgba)).toBe(false);
    });

    it('isAlphaMask rejects a soft blob on a transparent field (des_fanshadow)', () => {
      // Mostly clear, and what is drawn never rises past the reference — alpha-testing it yields a blank.
      const rgba = new Uint8Array(256 * 4);
      for (let texel = 0; texel < 256; texel += 1) {
        rgba.set([0, 0, 0, texel < 200 ? 0 : 60], texel * 4);
      }

      expect(isAlphaMask(rgba)).toBe(false);
    });

    it('sharpenAlpha leaves fully transparent and fully opaque texels untouched', () => {
      const rgba = new Uint8Array([10, 10, 10, 0, 20, 20, 20, 255]);
      sharpenAlpha(rgba);

      expect(rgba[3]).toBe(0);
      expect(rgba[7]).toBe(255);
    });

    it('processAlphaTexture keeps mid alpha raw when sharpen is off', () => {
      const rgba = new Uint8Array(4 * 4 * 4);
      for (let texel = 0; texel < 16; texel += 1) {
        rgba.set([100, 160, 100, 150], texel * 4);
      }
      const [base] = processAlphaTexture(rgba, 4, 4, 'cutout', 128, 1);

      expect(base[3]).toBe(150);
    });
  });

  describe('positive cases', () => {
    it('effectiveAlphaClass upgrades softBlend to cutout for vegetation callers (trees-through-trees fix)', () => {
      expect(effectiveAlphaClass('softBlend', true)).toBe('cutout');
    });

    it('effectiveAlphaClass upgrades a MASK with no caller preference at all (plan 092)', () => {
      expect(effectiveAlphaClass('softBlend', false, true)).toBe('cutout');
    });

    it('isAlphaMask reads a mask whose HOLES never reach zero (Upt_Fence_Mesh)', () => {
      // Chain-link authored at alpha 10 / 200: every texel is "mid" to classifyAlpha, so it lands softBlend
      // and draws in the blend pass — while the game alpha-TESTS it and it needs to write depth.
      const rgba = new Uint8Array(256 * 4);
      for (let texel = 0; texel < 256; texel += 1) {
        rgba.set([90, 90, 90, texel % 4 === 0 ? 10 : 200], texel * 4);
      }

      expect(classifyAlpha(rgba, true)).toBe('softBlend');
      expect(isAlphaMask(rgba)).toBe(true);
    });

    it('isAlphaMask allows an antialiased edge up to a tenth of the sheet', () => {
      // 16×16, left seven columns clear, one column ON the reference, the rest solid: a mask with an edge.
      const rgba = new Uint8Array(16 * 16 * 4);
      for (let y = 0; y < 16; y += 1) {
        for (let x = 0; x < 16; x += 1) {
          rgba.set([120, 120, 120, x < 7 ? 0 : x === 7 ? 128 : 255], (y * 16 + x) * 4);
        }
      }

      expect(isAlphaMask(rgba)).toBe(true);
    });

    it('classifies a hard-edged leaf texture as cutout', () => {
      expect(classifyAlpha(leafPatch(), true)).toBe('cutout');
    });

    it('dilation floods transparent texels with the nearest opaque RGB (no black left)', () => {
      const rgba = leafPatch();
      dilateEdges(rgba, 4, 4);

      // Every texel now carries leaf RGB; alpha untouched.
      for (let texel = 0; texel < 16; texel += 1) {
        expect(rgba[texel * 4 + 1]).toBe(200);
      }
      expect(rgba[3 * 4 + 3]).toBe(0); // transparency preserved
    });

    it('premultiplied downsample keeps edges un-darkened (THE fringe fix)', () => {
      const rgba = leafPatch();
      dilateEdges(rgba, 4, 4);
      premultiply(rgba);
      const mip = downsample(rgba, 4, 4);

      // The edge texel averages opaque(green×1) with transparent(0 premult): rgb stays proportional to
      // alpha — un-premultiplying yields the ORIGINAL green, not a darkened one.
      const edgeAlpha = mip[(0 * 2 + 1) * 4 + 3];
      const edgeGreen = mip[(0 * 2 + 1) * 4 + 1];
      expect(edgeAlpha).toBeGreaterThan(0);
      expect(edgeAlpha).toBeLessThan(255);
      expect(Math.round((edgeGreen / edgeAlpha) * 255)).toBeGreaterThanOrEqual(199);
    });

    it('coverage preservation keeps the cutout ratio across mips', () => {
      const rgba = leafPatch();
      dilateEdges(rgba, 4, 4);
      premultiply(rgba);
      const target = coverage(rgba, 128);
      const mip = downsample(rgba, 4, 4);
      preserveCoverage(mip, 128, target);

      expect(coverage(mip, 128)).toBeGreaterThanOrEqual(target - 0.26);
    });

    it('processAlphaTexture emits the full requested chain', () => {
      const mips = processAlphaTexture(leafPatch(), 4, 4, 'cutout', 128, 3);

      expect(mips).toHaveLength(3);
      expect(mips[1]).toHaveLength(2 * 2 * 4);
      expect(mips[2]).toHaveLength(1 * 1 * 4);
    });

    it('sharpenAlpha pushes broad semi-transparency toward the alpha-test look (hipoly canopy fix)', () => {
      // Interior α = 150 (the "whole crown at half coverage" A2C stipple source) → near-opaque.
      const rgba = new Uint8Array([0, 128, 0, 150, 0, 128, 0, 110, 0, 128, 0, 132]);
      sharpenAlpha(rgba);

      expect(rgba[3]).toBe(255); // 150 → solid
      expect(rgba[7]).toBe(0); // 110 → cut
      expect(rgba[11]).toBe(160); // 132 stays inside the AA band (128 ± 128/gain)
    });

    it('processAlphaTexture with sharpen premultiplies by the REMAPPED alpha (colour stays consistent)', () => {
      const rgba = new Uint8Array(4 * 4 * 4);
      for (let texel = 0; texel < 16; texel += 1) {
        rgba.set([100, 160, 100, 150], texel * 4); // uniform semi-transparent green
      }
      const [base] = processAlphaTexture(rgba, 4, 4, 'cutout', 128, 1, true);

      expect(base[3]).toBe(255); // sharpened before premultiply…
      expect(base[1]).toBe(160); // …so RGB is multiplied by 1.0, not 0.59
    });

    it('resampleToPow2 fixes 62×62-style sizes (the WebGPU BC alignment killer)', () => {
      const rgba = new Uint8Array(62 * 62 * 4).fill(128);
      const sized = resampleToPow2(rgba, 62, 62);

      expect(sized.width).toBe(64);
      expect(sized.height).toBe(64);
      expect(sized.rgba[0]).toBe(128);
    });
  });
});
