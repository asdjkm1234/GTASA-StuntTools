/**
 * Time-band grading + night profiles (plan 071 §3): the look drifts through dawn → day → dusk → night, and
 * every driver is the SUN'S ELEVATION, never the wall clock — a sunset must read right whenever it happens
 * (custom timecycs, sped-up clocks, mods). Pure and continuous: no band boundary may pop.
 */

export interface TimeBandGrade {
  /** Bloom luminance threshold: lower at night so lamps/neon bloom, higher by day so the sky doesn't. */
  bloomThreshold: number;
  /** How "golden" the band is (0 day/night, 1 at the horizon sun) — drives warm cloud rims and sun tint. */
  golden: number;
  /** Moon contribution 0 (day) → 1 (deep, clear night). */
  moon: number;
  /** 0 = day, 1 = deep night (the shared night factor these curves agree on). */
  night: number;
}

export interface TimeBandInput {
  /** Cloud cover 0 (clear) → 1 (overcast) — overcast flattens contrast and dims the moon. */
  overcast: number;
  /** Sine of the sun's elevation: 1 zenith, 0 horizon, negative below (night). */
  sunSin: number;
}

/** Elevation where the sun stops being "golden" (≈ 12°). */
const GOLDEN_END = 0.21;
/** Elevation below which it is fully night (≈ −6°, civil twilight). */
const NIGHT_FULL = -0.105;
/** Elevation above which it is fully day (≈ 5°). */
const NIGHT_NONE = 0.09;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = clamp01((x - edge0) / (edge1 - edge0));

  return t * t * (3 - 2 * t);
};

/** Bloom threshold by band: 0.70 in full day, 0.38 at deep night (neon/lamps bloom, dark walls don't). */
const BLOOM_DAY = 0.7;
const BLOOM_NIGHT = 0.38;

export function timeBandGrade({ overcast, sunSin }: TimeBandInput): TimeBandGrade {
  const night = 1 - smoothstep(NIGHT_FULL, NIGHT_NONE, sunSin);
  // Golden hour peaks AT the horizon and dies both upward (day) and downward (night has no sun).
  const golden = sunSin <= 0 ? clamp01(1 + sunSin / 0.12) : 1 - smoothstep(0, GOLDEN_END, sunSin);
  const cover = clamp01(overcast);

  return {
    bloomThreshold: BLOOM_DAY + (BLOOM_NIGHT - BLOOM_DAY) * night,
    golden: golden * (1 - cover * 0.6),
    // A clear night has a moon; heavy cloud swallows it (the same fade the moon sprite uses).
    moon: night * (1 - cover * 0.85),
    night,
  };
}
