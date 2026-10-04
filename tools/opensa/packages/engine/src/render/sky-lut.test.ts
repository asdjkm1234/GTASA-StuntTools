import { describe, expect, it } from 'vitest';

import { buildSkyLut, SKY_LUT_HEIGHT, SKY_LUT_WIDTH, type SkyLutInput, skyLutKey } from './sky-lut';

/** Noon, clear, prod exposure — the baseline every case perturbs. */
function baseInput(): SkyLutInput {
  return {
    cloudCover: 0,
    cloudDark: 0,
    exposure: 0.55,
    mood: 0.7,
    pbrNight: 0,
    skyHorizon: [0.42, 0.55, 0.72],
    skyTop: [0.12, 0.32, 0.65],
    sunElevation: 1,
  };
}

/** Raw f16 bit patterns of positive halves sort numerically — direct u16 compares are valid. */
function texel(lut: Uint16Array, row: number, col: number): [number, number, number] {
  const at = (row * SKY_LUT_WIDTH + col) * 4;

  return [lut[at], lut[at + 1], lut[at + 2]];
}

const MID_ROW = Math.floor(SKY_LUT_HEIGHT / 2);

describe('buildSkyLut', () => {
  describe('negative cases', () => {
    it('ignores the sun entirely once pbrNight hands the sky to the flat gradient', () => {
      const night = buildSkyLut({ ...baseInput(), pbrNight: 1, sunElevation: 0.1 });
      const nightOtherSun = buildSkyLut({ ...baseInput(), pbrNight: 1, sunElevation: 0.9 });
      expect(night).toEqual(nightOtherSun);
    });

    it('suppresses the Preetham dome under a full overcast deck', () => {
      // A LOW sun makes the dome strongly sun-asymmetric (warm toward the sun, cool away) — the deck must
      // collapse that asymmetry back toward the flat authored gradient.
      const clear = buildSkyLut({ ...baseInput(), sunElevation: 0.15 });
      const overcast = buildSkyLut({ ...baseInput(), cloudCover: 1, sunElevation: 0.15 });
      const clearGradientDelta = texel(clear, MID_ROW, 0)[0] - texel(clear, MID_ROW, SKY_LUT_WIDTH - 1)[0];
      const overcastGradientDelta = texel(overcast, MID_ROW, 0)[0] - texel(overcast, MID_ROW, SKY_LUT_WIDTH - 1)[0];
      expect(Math.abs(clearGradientDelta)).toBeGreaterThan(0);
      expect(Math.abs(overcastGradientDelta)).toBeLessThan(Math.abs(clearGradientDelta));
    });
  });

  describe('positive cases', () => {
    it('keeps the Preetham sunrise alive at a low sun (the dn-suppression regression)', () => {
      // The 074/09 field bug: blending by litFade dn killed the dawn. With pbrNight 0 (sun just up), the
      // dome must differ from the flat gradient it would collapse into at pbrNight 1.
      const dawn = buildSkyLut({ ...baseInput(), sunElevation: 0.05 });
      const flat = buildSkyLut({ ...baseInput(), pbrNight: 1, sunElevation: 0.05 });
      expect(dawn).not.toEqual(flat);
    });

    it('brightens the dome with exposure (the prod pbrExposure knob)', () => {
      const dim = buildSkyLut({ ...baseInput(), exposure: 0.25 });
      const bright = buildSkyLut({ ...baseInput(), exposure: 0.55 });
      const dimTexel = texel(dim, MID_ROW, Math.floor(SKY_LUT_WIDTH / 2));
      const brightTexel = texel(bright, MID_ROW, Math.floor(SKY_LUT_WIDTH / 2));
      expect(brightTexel[0]).toBeGreaterThan(dimTexel[0]);
      expect(brightTexel[2]).toBeGreaterThan(dimTexel[2]);
    });

    it('tracks pbrNight, exposure and the radiance model in the rebuild key', () => {
      const base = skyLutKey(baseInput());
      expect(skyLutKey({ ...baseInput(), pbrNight: 0.5 })).not.toBe(base);
      expect(skyLutKey({ ...baseInput(), exposure: 0.3 })).not.toBe(base);
      expect(skyLutKey({ ...baseInput(), model: 'preetham' })).not.toBe(base);
    });

    it('Hosek-Wilkie day dome: horizon brighter than zenith, warm toward a low sun (the flat-fill fix)', () => {
      // The exact Preetham failure the model replaces: zenith brighter than horizon and near-zero
      // sun-side variation read as a lifeless single-colour fill by day.
      const noon = buildSkyLut({ ...baseInput(), mood: 0 });
      const zenith = texel(noon, SKY_LUT_HEIGHT - 1, Math.floor(SKY_LUT_WIDTH / 2));
      const horizon = texel(noon, 3, Math.floor(SKY_LUT_WIDTH / 2));
      expect(horizon[2]).toBeGreaterThan(zenith[2]);

      const low = buildSkyLut({ ...baseInput(), mood: 0, sunElevation: 0.12 });
      const sunward = texel(low, 3, 0);
      const antiSun = texel(low, 3, SKY_LUT_WIDTH - 1);
      // Warm side: red gains on blue toward the sun (f16 positive halves compare numerically).
      expect(sunward[0]).toBeGreaterThan(antiSun[0]);
    });

    it('legacy Preetham path is untouched by the model switch (byte-identical A/B reference)', () => {
      const preetham = buildSkyLut({ ...baseInput(), model: 'preetham' });
      const hosek = buildSkyLut(baseInput());
      expect(preetham).not.toEqual(hosek);
      expect(buildSkyLut({ ...baseInput(), model: 'preetham' })).toEqual(preetham);
    });
  });
});
