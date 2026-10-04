/**
 * Curated per-weather cloud look. The raw timecyc `cloudAlpha` is noisy and doesn't read as the
 * weather's name (EXTRASUNNY still ends up fairly cloudy), so the sky dome's clouds are driven by
 * these hand-tuned profiles keyed off the weather **name** instead. Sky v2 (074/06 row 4): each
 * weather family now carries a full identity — coverage, darkness, clump SCALE and a hue TINT —
 * so EXTRASUNNY reads emptier than SUNNY, CLOUDY is a dark broken deck, RAINY is a storm slate and
 * SMOG turns into big dirty clumps. Renderware-free; the sampler in the UI applies it.
 */
export interface CloudProfile {
  /** Base sky coverage, 0 (clear) → 1 (overcast). */
  coverage: number;
  /** Cloud heaviness, 0 (bright white) → 1 (dark, where the cover is thin reads as grey). */
  darkness: number;
  /** Clump size multiplier on the cumulus noise (>1 = smaller scattered puffs, <1 = big banks). */
  scale: number;
  /** Hue multiplier over the timecyc cloud palette (the engine normalizes luminance away — hue only). */
  tint: readonly [number, number, number];
}

const NEUTRAL: readonly [number, number, number] = [1, 1, 1];

/** Profile per weather family (the user's sky-v2 spec, 2026-07-17). */
const CLOUDY: CloudProfile = { coverage: 0.9, darkness: 0.55, scale: 0.75, tint: [0.94, 0.98, 1.06] };
const EXTRASUNNY: CloudProfile = { coverage: 0.05, darkness: 0, scale: 1.3, tint: NEUTRAL };
const FOGGY: CloudProfile = { coverage: 0.85, darkness: 0.3, scale: 1, tint: NEUTRAL };
const RAINY: CloudProfile = { coverage: 1, darkness: 0.92, scale: 0.7, tint: [0.85, 0.93, 1.12] };
const SUNNY: CloudProfile = { coverage: 0.14, darkness: 0.05, scale: 1, tint: NEUTRAL };
/** Fallback for anything not matched (e.g. a stray storm/sandstorm selection). */
const DEFAULT: CloudProfile = { coverage: 0.5, darkness: 0.3, scale: 1, tint: NEUTRAL };

/** SMOG variants: big dirty puff clumps in a warm haze on top of their base coverage. */
const SMOG_BUMP = { coverage: 0.12, darkness: 0.1 };
const SMOG_SCALE = 0.55;
const SMOG_TINT: readonly [number, number, number] = [1.08, 0.98, 0.78];

/**
 * Map a weather name (from `WEATHER_NAMES`) to its cloud look. `SUNNY` is a substring of
 * `EXTRASUNNY`, so EXTRASUNNY is matched first; SMOG variants clump and dirty their base.
 */
export function cloudProfile(weatherName: string): CloudProfile {
  const base = baseProfile(weatherName);
  if (!weatherName.includes('SMOG')) {
    return base;
  }

  return {
    coverage: Math.min(1, base.coverage + SMOG_BUMP.coverage),
    darkness: Math.min(1, base.darkness + SMOG_BUMP.darkness),
    scale: SMOG_SCALE,
    tint: SMOG_TINT,
  };
}

/** Blend two profiles by the eased weather-transition factor (prod-parity smooth weather changes). */
export function lerpCloudProfiles(a: CloudProfile, b: CloudProfile, t: number): CloudProfile {
  const lerp = (x: number, y: number): number => x + (y - x) * t;

  return {
    coverage: lerp(a.coverage, b.coverage),
    darkness: lerp(a.darkness, b.darkness),
    scale: lerp(a.scale, b.scale),
    tint: [lerp(a.tint[0], b.tint[0]), lerp(a.tint[1], b.tint[1]), lerp(a.tint[2], b.tint[2])],
  };
}

function baseProfile(weatherName: string): CloudProfile {
  if (weatherName.includes('CLOUDY')) {
    return CLOUDY;
  }
  if (weatherName.includes('RAINY')) {
    return RAINY;
  }
  if (weatherName.includes('FOGGY')) {
    return FOGGY;
  }
  if (weatherName.includes('EXTRASUNNY')) {
    return EXTRASUNNY;
  }
  if (weatherName.includes('SUNNY')) {
    return SUNNY;
  }

  return DEFAULT;
}
