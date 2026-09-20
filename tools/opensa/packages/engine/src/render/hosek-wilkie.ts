/**
 * Hosek-Wilkie analytic sky radiance (074/06 row 4): the day-sky replacement for the Preetham fit inside
 * the sky LUT builder. Exact port of the reference `ArHosekSkyModel.c` RGB path (3-clause BSD, Lukas Hosek
 * & Alexander Wilkie 2012-2013): per-channel A..I params from a quintic Bezier over solar elevation,
 * bilinear over turbidity/albedo, then F(theta, gamma) × expected radiance. Valid for the sun at or above
 * the horizon — the caller clamps elevation and hands the night to the timecyc gradient (pbrNight).
 */
import { HW_CONFIG_DATA, HW_RADIANCE_DATA } from './hosek-wilkie-data';

/** One channel's cooked state: the 9 distribution params + the expected-value radiance scale. */
export interface HwChannel {
  params: Float64Array;
  radiance: number;
}

const HALF_PI = Math.PI / 2;

/**
 * Cook the per-channel configurations for a sun state. `turbidity` 1..10, `albedo` 0..1,
 * `solarElevation` in radians (clamped to ≥ 0 — the model is undefined below the horizon).
 */
export function cookHosekWilkie(turbidity: number, albedo: number, solarElevation: number): HwChannel[] {
  const t = Math.min(10, Math.max(1, turbidity));
  const a = Math.min(1, Math.max(0, albedo));
  const elevation = Math.max(0, solarElevation);

  return [0, 1, 2].map((channel) => ({
    params: cookConfiguration(HW_CONFIG_DATA[channel], t, a, elevation),
    radiance: cookRadiance(HW_RADIANCE_DATA[channel], t, a, elevation),
  }));
}

/**
 * Radiance distribution F(theta, gamma) — theta = view zenith angle, gamma = view-sun angle — times the
 * channel's expected radiance. Reference `ArHosekSkyModel_GetRadianceInternal`.
 */
export function hosekWilkieRadiance(channel: HwChannel, theta: number, gamma: number): number {
  return hosekWilkieRadianceFromCos(channel, Math.max(0, Math.cos(theta)), Math.cos(gamma), gamma);
}

/**
 * The same distribution for a caller that ALREADY HAS the cosines.
 *
 * The LUT builder does: it derives both angles with `acos` from cosines it computed, and the form above
 * immediately undoes that with `cos` — three times per texel, once per channel, for 4 608 texels
 * (201/4-03). `gamma` itself is still needed: `exp(p[4] * gamma)` is a function of the ANGLE, and its
 * coefficient is per-channel, so that one cannot be hoisted.
 *
 * @param cosTheta `max(0, cos(theta))` — the caller applies the same clamp the angle form does
 * @param cosGamma `cos(gamma)`
 * @param gamma the view-sun angle in radians
 */
export function hosekWilkieRadianceFromCos(
  channel: HwChannel,
  cosTheta: number,
  cosGamma: number,
  gamma: number,
): number {
  const p = channel.params;
  const expM = Math.exp(p[4] * gamma);
  const rayM = cosGamma * cosGamma;
  const mieM = (1 + rayM) / (1 + p[8] * p[8] - 2 * p[8] * cosGamma) ** 1.5;
  const zenith = Math.sqrt(cosTheta);

  const value =
    (1 + p[0] * Math.exp(p[1] / (cosTheta + 0.01))) * (p[2] + p[3] * expM + p[5] * rayM + p[6] * mieM + p[7] * zenith);

  return Math.max(0, value * channel.radiance);
}

/** Quintic Bezier over the 6 solar-elevation control points, `stride` values per point. */
function bezier(dataset: Float64Array, at: number, stride: number, index: number, t: number): number {
  const u = 1 - t;

  return (
    u ** 5 * dataset[at + index] +
    5 * u ** 4 * t * dataset[at + stride + index] +
    10 * u ** 3 * t ** 2 * dataset[at + stride * 2 + index] +
    10 * u ** 2 * t ** 3 * dataset[at + stride * 3 + index] +
    5 * u * t ** 4 * dataset[at + stride * 4 + index] +
    t ** 5 * dataset[at + stride * 5 + index]
  );
}

/** Reference `ArHosekSkyModel_CookConfiguration`: bilinear albedo/turbidity mix of Bezier-interpolated params. */
function cookConfiguration(
  dataset: Float64Array,
  turbidity: number,
  albedo: number,
  solarElevation: number,
): Float64Array {
  const intTurbidity = Math.floor(turbidity);
  const turbidityRem = turbidity - intTurbidity;
  const t = (solarElevation / HALF_PI) ** (1 / 3);
  const config = new Float64Array(9);

  // Dataset layout: [albedo 0 | albedo 1] × 10 turbidities × 6 control points × 9 params.
  const block = (albedoIndex: number, turbidityIndex: number): number => 9 * 6 * (10 * albedoIndex + turbidityIndex);
  for (let i = 0; i < 9; i += 1) {
    let value =
      (1 - albedo) * (1 - turbidityRem) * bezier(dataset, block(0, intTurbidity - 1), 9, i, t) +
      albedo * (1 - turbidityRem) * bezier(dataset, block(1, intTurbidity - 1), 9, i, t);
    if (intTurbidity < 10) {
      value +=
        (1 - albedo) * turbidityRem * bezier(dataset, block(0, intTurbidity), 9, i, t) +
        albedo * turbidityRem * bezier(dataset, block(1, intTurbidity), 9, i, t);
    }
    config[i] = value;
  }

  return config;
}

/** Reference `ArHosekSkyModel_CookRadianceConfiguration`: the expected-value scale for a channel. */
function cookRadiance(dataset: Float64Array, turbidity: number, albedo: number, solarElevation: number): number {
  const intTurbidity = Math.floor(turbidity);
  const turbidityRem = turbidity - intTurbidity;
  const t = (solarElevation / HALF_PI) ** (1 / 3);

  const block = (albedoIndex: number, turbidityIndex: number): number => 6 * (10 * albedoIndex + turbidityIndex);
  let value =
    (1 - albedo) * (1 - turbidityRem) * bezier(dataset, block(0, intTurbidity - 1), 1, 0, t) +
    albedo * (1 - turbidityRem) * bezier(dataset, block(1, intTurbidity - 1), 1, 0, t);
  if (intTurbidity < 10) {
    value +=
      (1 - albedo) * turbidityRem * bezier(dataset, block(0, intTurbidity), 1, 0, t) +
      albedo * turbidityRem * bezier(dataset, block(1, intTurbidity), 1, 0, t);
  }

  return value;
}
