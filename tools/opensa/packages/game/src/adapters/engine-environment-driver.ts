/**
 * The ONE config→`Engine.environment` mapping for the own-engine hosts (plan 074/10 config-API parity):
 * the sun/moon arcs build DYNAMICALLY from the prod config's `night.litFade` window (exactly how the old
 * engine works — `sunElevationAt` is prod's own unit-tested arc), timecyc drives the colours when the pak
 * carries it (parametric fallback otherwise), and the prod graphics tunables (sky mood, cloud opacity,
 * moon brightness, godrays toggle, fog timecycScale, emissive boost) keep working after the flip.
 *
 * Renderer-agnostic: mutates the `Environment` object the engine exposes; no engine/three imports beyond
 * the Environment TYPE. Both hosts (the game's EngineCanvasHost and the engine lab) share this module.
 */
import type { Environment } from '@opensa/engine';

import { buildTimecyc, sampleTimecycBlend } from '@opensa/renderware/parsers/text/timecyc';
import { ensure24h, parseTimecyc, WEATHER_NAMES } from '@opensa/renderware/parsers/text/timecyc.parser';

import type { WeatherBlend } from '../weather/weather-transition';

import { cloudProfile, lerpCloudProfiles } from '../plugins/cloud-profile';
import { sunElevationAt } from '../plugins/sun-position';
import { timeBandGrade } from '../sky/time-bands';

/** The slice of the runtime Config this driver consumes (matches `game-runtime-config.ts` shapes). */
export interface EngineEnvConfig {
  fog: { timecycScale: number };
  graphics: {
    /** Bloom (074/09): intensity is the composite strength; threshold rides the plan-071 night profile
     *  (0.70 day → 0.38 deep night), scaled by `threshold / 0.7` exactly like prod's modern pipeline. */
    bloom: { enabled: boolean; intensity: number; threshold: number };
    clouds: { opacity: number };
    moon: { brightness: number };
    night: {
      emissiveBoost: number;
      litFade: { dawnEnd: number; dawnStart: number; duskEnd: number; duskStart: number };
      /** Night hemisphere-fill strength (prod `night.skylight`); scales the world moonlight term. */
      skylight: number;
    };
    sky: { mood: number; pbrExposure: number };
    sun: { godrays: boolean };
    /** Post tonemap (074/09): the engine renders ACES when enabled and mode is not 'none' (agx/neutral
     *  fall back to ACES — the engine ships the one curve prod is calibrated against). */
    toneMapping: boolean;
    toneMappingMode: string;
    /** Vehicle env-map reflections (plan 030): `preset: 'off'` = matte, intensity multiplies the DFF values. */
    vehicleReflection: { intensity: number; preset: string };
    /** SA prelit calibration (plan 038): day/night factors on the baked vertex light. The night value is
     *  what keeps the world READABLE after sunset (074/09 sky round 2 — the engine ran night at 0.4 vs
     *  prod's 0.7 and went pitch-black the moment the sun sank). */
    worldLight: { ambient: number; ambientFloor: number; dayBrightness: number; nightPrelitBrightness: number };
  };
}

/** Standalone defaults (the lab has no game config; values mirror `game-runtime-config.ts`). */
export const DEFAULT_ENGINE_ENV_CONFIG: EngineEnvConfig = {
  fog: { timecycScale: 1 },
  graphics: {
    bloom: { enabled: true, intensity: 0.7, threshold: 0.7 },
    clouds: { opacity: 0.85 },
    moon: { brightness: 1 },
    night: { emissiveBoost: 1.6, litFade: { dawnEnd: 7, dawnStart: 6, duskEnd: 20, duskStart: 19 }, skylight: 0.6 },
    sky: { mood: 0.7, pbrExposure: 0.55 },
    sun: { godrays: true },
    toneMapping: true,
    toneMappingMode: 'aces',
    vehicleReflection: { intensity: 0.25, preset: 'default' },
    worldLight: { ambient: 1, ambientFloor: 0.13, dayBrightness: 0.85, nightPrelitBrightness: 0.7 },
  },
};

/** The default LOD-ring radius when a host opts into the fog-masked streaming scheme (plan 074/21). */
export const DEFAULT_DRAW_DISTANCE = 1200;
/** Streaming-latency margin between the fog cut and the LOD ring: `fogCap = drawDistance − this`.
 *  The ring's cell-RECT test makes the margin pure latency budget (no geometry slack needed). */
export const FOG_RING_MARGIN = 100;

export interface EngineEnvironmentDriver {
  apply(hour: number): void;
}

export interface EngineEnvironmentOptions {
  config?: EngineEnvConfig;
  /** The fog ⊂ LOD-ring invariant (plan 074/21): hard ceiling on the fog cut, `drawDistance −
   *  FOG_RING_MARGIN`. Weather may pull fog CLOSER (authored farClip), never past this. Omit = uncapped. */
  fogCap?: number;
  /** Extra multiplier on the timecyc fog distances (the lab's high camera needs `?fogscale=`). */
  fogScale?: number;
  /** Raw timecyc text, whichever of the three source names supplied it (plan 104/01) — the row count
   *  decides whether it is expanded, so the caller does not say. Colours go parametric when absent. */
  timecyc?: { text: string };
  /** SA weather id 0..19 (cloud profile + timecyc column). */
  weather?: number;
  /** Live weather blend getter (prod parity — the host's WeatherTransition): when present, every apply
   *  samples timecyc AND the cloud profile blended from→to by the eased `t`. Omit for a static weather. */
  weatherBlend?: () => WeatherBlend;
}

// Floor at 0: SA authors NEGATIVE timecyc colours (RAINY_COUNTRYSIDE 21:00 lowClouds = −15,−36,−45) and a
// fractional power of a negative is NaN in JS — one NaN texel in the frame UBO poisons every WGSL mix()
// it touches (even at factor 0) and rendered short-fog nights pure black. Prod survives the same data only
// because three's piecewise sRGB curve maps negatives through its linear segment.
const lin = (value: number): number => (Math.max(0, value) / 255) ** 2.2;
const lin3 = (rgb: readonly number[]): [number, number, number] => [lin(rgb[0]), lin(rgb[1]), lin(rgb[2])];

/** Component-wise multiply (the weather cloud TINT over the timecyc palette). */
const mul3 = (a: readonly number[], b: readonly number[]): [number, number, number] => [
  a[0] * b[0],
  a[1] * b[1],
  a[2] * b[2],
];
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const scale3 = (rgb: readonly [number, number, number], k: number): [number, number, number] => [
  rgb[0] * k,
  rgb[1] * k,
  rgb[2] * k,
];

/** Build the driver; re-create it on weather change (the profile and timecyc column are per-weather). */
export function createEngineEnvironmentDriver(
  environment: Environment,
  options: EngineEnvironmentOptions = {},
): EngineEnvironmentDriver {
  const config = options.config ?? DEFAULT_ENGINE_ENV_CONFIG;
  const weather = options.weather ?? 0;
  const timecyc = options.timecyc ? buildTimecyc(ensure24h(parseTimecyc(options.timecyc.text))) : null;

  return {
    apply(hour: number): void {
      // Config values are read HERE, every frame — the F2 debugger mutates the live config (and REPLACES
      // nested objects like `night.litFade` wholesale), so anything hoisted out of `apply` silently freezes
      // at its boot value. That was exactly the litFade/fog-scale bug found by the plan-074/22 smoke pass.
      const litFade = config.graphics.night.litFade;
      const fogScale = (options.fogScale ?? 1) * config.fog.timecycScale;
      // Weather blend (prod parity): the host's WeatherTransition eases from→to over
      // weatherTransitionSeconds; without a blend getter the driver sits on the static weather.
      const blend = options.weatherBlend?.() ?? { from: weather, t: 1, to: weather };
      const clouds = lerpCloudProfiles(
        cloudProfile(WEATHER_NAMES[blend.from] ?? ''),
        cloudProfile(WEATHER_NAMES[blend.to] ?? ''),
        blend.t,
      );
      const sun = sunArc(hour, litFade.dawnStart, litFade.duskEnd);
      const dn = darkness(hour, litFade);
      environment.hour = hour;
      environment.dn = dn;
      environment.sunDir = sun.dir;
      environment.sunElevation = clamp01(sun.elevationRatio);
      // The disc keeps its colour while sinking below the sea horizon (074/06 round 4), dies fully sunk.
      const dayGate = clamp01((sun.dir[1] + 0.05) * 5);
      environment.sunDirect = clamp01(sun.elevationRatio) * 0.9;
      // Night indirect = prod's worldLight.nightPrelitBrightness (0.7): the baked night vertex colours ARE
      // the night look — running them at 0.4 went pitch-black right after sunset (074/09 sky round 2).
      const worldLight = config.graphics.worldLight;
      environment.sunIndirect = worldLight.dayBrightness * (1 - dn) + worldLight.nightPrelitBrightness * dn;
      environment.skyMood = config.graphics.sky.mood;
      environment.skyExposure = config.graphics.sky.pbrExposure;
      environment.emissiveBoost = config.graphics.night.emissiveBoost;
      environment.cloudCover = clouds.coverage;
      environment.cloudDark = clouds.darkness;
      environment.cloudScale = clouds.scale;
      environment.cloudAlpha = config.graphics.clouds.opacity;
      environment.godrayStrength = config.graphics.sun.godrays ? 1 : 0;
      environment.tonemap = config.graphics.toneMapping && config.graphics.toneMappingMode !== 'none' ? 1 : 0;
      // Bloom night profile (074/09 ← plan 071): sunDir.y IS the sine of the elevation (below the horizon
      // the arc parks it at −1 → full night); overcast dims like prod's shadow-derived cover.
      const bloom = config.graphics.bloom;
      const band = timeBandGrade({ overcast: clouds.coverage, sunSin: sun.dir[1] });
      environment.bloomIntensity = bloom.enabled ? bloom.intensity : 0;
      environment.bloomThreshold = band.bloomThreshold * (bloom.threshold / 0.7);
      // Vehicle reflections (B5r → 074/16): the prod knob multiplies the DFF's per-material coefficients.
      // CALIBRATION: prod's default intensity is 0.25 in three's envMapIntensity units; the engine shader's
      // neutral is 1.0 — map 0.25 ↔ 1.0 (×4). Without this the whole clearcoat term ran at a quarter
      // strength in the game and the field read "no reflections" (2026-07-16 bench round).
      const reflection = config.graphics.vehicleReflection;
      environment.reflectionStrength = reflection.preset === 'off' ? 0 : reflection.intensity * 4;
      if (timecyc) {
        const sample = sampleTimecycBlend(timecyc, blend.from, blend.to, hour, blend.t);
        // World ambient floor (plan 093): the timecyc `Amb` column IS SA's additive building-ambient
        // term (ps2BuildingVS `Color.rgb += ambient*surfAmb`) — hour/weather-authored, so the floor
        // breathes with the clock on its own. `worldLight.ambient` is the calibration scale.
        environment.ambientColor = scale3(lin3(sample.amb), worldLight.ambient);
        environment.sunColor = scale3(lin3(sample.dir), dayGate);
        environment.sunCoreColor = scale3(lin3(sample.sunCore), dayGate);
        environment.sunCoronaColor = scale3(lin3(sample.sunCorona), dayGate);
        environment.sunSize = sample.sunSize;
        environment.skyTop = lin3(sample.skyTop);
        environment.skyHorizon = lin3(sample.skyBot);
        // Authored fog mood, unfloored (074/21): the old `max(…, 1200)` floor flattened every weather —
        // FOGGY_SF's 250 u farClip was stretched to 1200, and clear-LA's 800 pushed past the 1000 LOD ring,
        // which is exactly why streaming pops were visible. Prod runs the raw farClip; so do we now.
        //
        // The START may be NEGATIVE and is passed through as authored (104/04). In SA the pair goes straight
        // to D3D9 linear fog — `D3DRS_FOGSTART = FogSt`, `D3DRS_FOGEND = FarClp`, no clamp on the way — so a
        // negative start is a haze that is already partly opaque where the player stands, which is how a
        // weather says "no clear near zone" (`docs/gta-sa-original/timecyc-fog.md`). Our own exp² curve
        // reads it the same way: the shader's `max(dist − fogStart, 0)` clamps the DISTANCE, never the
        // start. The `Math.max(0, …)` that used to be here threw the mood away before the shader saw it —
        // and not only Dante's: it flattened stock's own near haze on 112 of its 504 rows, which is why
        // FOGGY_SF never looked foggy from the ground.
        environment.fogStartDistance = sample.fogStart * fogScale;
        environment.fogCutDistance = sample.farClip * fogScale;
        // Water v1 (074/06 row 12): timecyc WaterRGBA — deep tint + opacity per hour/weather.
        environment.waterColor = lin3(sample.water);
        environment.waterAlpha = sample.water[3] / 255;
        // timecyc cloud palette (074/09 sky round 2): the authored per-hour colours turn the WHOLE deck
        // pink at dawn/dusk — prod's applyClouds reads exactly these columns. The weather TINT (sky v2)
        // shifts the hue only — the engine's cloudPalette() normalizes luminance away.
        environment.cloudTopColor = mul3(lin3(sample.lowClouds), clouds.tint);
        environment.cloudBottomColor = mul3(lin3(sample.bottomClouds), clouds.tint);
      } else {
        // Parametric fallback (old paks without timecyc): warm-shifting disc, fixed day/night gradients.
        const warm = clamp01(1 - sun.elevationRatio);
        environment.ambientColor = scale3(mix3([0.074, 0.084, 0.098], [0.012, 0.014, 0.02], dn), worldLight.ambient);
        environment.sunColor = [dayGate, (0.96 - warm * 0.15) * dayGate, (0.88 - warm * 0.3) * dayGate];
        environment.sunCoreColor = [dayGate, (0.95 - warm * 0.25) * dayGate, (0.68 - warm * 0.4) * dayGate];
        environment.sunCoronaColor = [dayGate, (0.8 - warm * 0.25) * dayGate, (0.4 - warm * 0.3) * dayGate];
        environment.skyTop = mix3([0.12, 0.32, 0.65], [0.002, 0.004, 0.012], dn);
        environment.skyHorizon = mix3([0.42, 0.55, 0.72], [0.01, 0.012, 0.03], dn);
        environment.cloudTopColor = mul3(mix3([0.78, 0.8, 0.85], [0.06, 0.07, 0.1], dn), clouds.tint);
        environment.cloudBottomColor = mul3(mix3([0.45, 0.48, 0.55], [0.03, 0.035, 0.05], dn), clouds.tint);
      }
      // The DELIBERATE day floor under the timecyc term (`docs/hacks/world-ambient-floor.md`): vanilla SA
      // authors daytime `Amb` at ~zero (EXTRASUNNY_LA noon = 11,0,0 — verified against the 2004 PS2
      // timecycp and a third-party original), so real SA renders black-prelit walls BLACK at noon and the
      // formula alone cannot lift the 024 Family B holes. `max()` keeps the timecyc's authority whenever it
      // authors MORE than the floor (nights, fog weathers), and `× (1 − dn)` retires the floor at night so
      // authored darkness survives. 0 = strict SA parity.
      const floor = worldLight.ambientFloor * (1 - dn);
      environment.ambientColor = [
        Math.max(environment.ambientColor[0], floor),
        Math.max(environment.ambientColor[1], floor),
        Math.max(environment.ambientColor[2], floor),
      ];
      // The fog ⊂ LOD-ring invariant (074/21): whatever the weather authored, the cut never crosses the
      // streaming ring's margin — everything past the cap is loaded-but-fogged, so pops are impossible.
      // Start is kept under the (possibly clamped) cut so the exp² ramp never degenerates. A NEGATIVE
      // authored start passes through untouched — this is a ceiling, not a floor (104/04).
      if (options.fogCap !== undefined) {
        environment.fogCutDistance = Math.min(environment.fogCutDistance, options.fogCap);
        environment.fogStartDistance = Math.min(environment.fogStartDistance, environment.fogCutDistance * 0.8);
      }
      applyMoon(environment, hour, band.moon, litFade, config.graphics);
    },
  };
}

/** Moon arc over the dynamic night window (duskEnd → dawnStart): rises in the east, peaks mid-window,
 *  sets in the west; starts below the sea horizon so the shader's horizon clip shows a real moonrise.
 *  The LIGHT is decoupled from the arc (074/09 night round): prod's moonlight (plan 071 §4) rides the
 *  sun-based night band — full within ~an hour after sunset — while the engine's used to wait for the moon
 *  DISC to climb (zero until ~20:30, full only by ~22:00), leaving early night visibly darker than prod. */
function applyMoon(
  environment: Environment,
  hour: number,
  bandMoon: number,
  litFade: EngineEnvConfig['graphics']['night']['litFade'],
  graphics: EngineEnvConfig['graphics'],
): void {
  const windowHours = 24 - litFade.duskEnd + litFade.dawnStart;
  const rawT = ((hour - litFade.duskEnd + 24) % 24) / windowHours;
  // Outside the window rawT runs 1 → 24/windowHours across the day. Park the (sunken) moon at the NEAREST
  // endpoint — morning keeps the set azimuth, afternoon pre-positions at the rise azimuth — so crossing
  // duskEnd doesn't TELEPORT it across the sky (field: the night glow hemisphere jumped at 19:59→20:00,
  // visible since the moonlight became band-gated). The side switch happens midday, where moonColor is black.
  const t = rawT <= 1 ? rawT : rawT > 1 + (24 / windowHours - 1) / 2 ? 0 : 1;
  const arc = Math.sin(t * Math.PI);
  const elevation = -0.08 + arc * 0.7;
  environment.moonDir = [Math.cos(t * Math.PI) * 0.85, elevation, -0.4];
  // Prod's world moonlight, verbatim (canvas-host plan 071 §4): cool (0.34, 0.44, 0.72) × band.moon ×
  // moon.brightness × night.skylight × 0.5 — the night hemisphere fill enters the world through this term.
  const gate = bandMoon * graphics.moon.brightness * graphics.night.skylight * 0.5;
  environment.moonColor = [0.34 * gate, 0.44 * gate, 0.72 * gate];
}

/** litFade darkness: 0 by day, ramps duskStart→duskEnd, 1 at night, ramps back dawnStart→dawnEnd. */
function darkness(hour: number, litFade: EngineEnvConfig['graphics']['night']['litFade']): number {
  if (hour >= litFade.duskEnd || hour < litFade.dawnStart) {
    return 1;
  }
  if (hour >= litFade.duskStart) {
    return (hour - litFade.duskStart) / Math.max(0.01, litFade.duskEnd - litFade.duskStart);
  }
  if (hour < litFade.dawnEnd) {
    return 1 - (hour - litFade.dawnStart) / Math.max(0.01, litFade.dawnEnd - litFade.dawnStart);
  }

  return 0;
}

function mix3(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  t: number,
): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/** Prod's `sunElevationAt` arc over the litFade window, EXTENDED past the edges so the disc sinks
 *  smoothly below the sea horizon (074/06 round 4) instead of vanishing at the window boundary. */
function sunArc(
  hour: number,
  sunrise: number,
  sunset: number,
): { dir: [number, number, number]; elevationRatio: number } {
  // Hours past the window during which the disc is still sinking/climbing. Sized so the sink reaches its
  // −0.25 floor BEFORE the park to [0, −1, 0]: every sunDir.y consumer band (pbrNight night glow ends at
  // −0.22, timeBandGrade at −0.105, dayGate at −0.05) is already saturated there, so the park is invisible —
  // at 0.75 the disc parked from y ≈ −0.16 and the night sky glow visibly stepped 0.8 → 1.0 (field).
  const margin = 1.15;
  if (hour <= sunrise - margin || hour >= sunset + margin) {
    return { dir: [0, -1, 0], elevationRatio: -1 };
  }
  const inside = sunElevationAt(Math.min(Math.max(hour, sunrise + 0.001), sunset - 0.001), sunrise, sunset);
  const t = (hour - sunrise) / (sunset - sunrise);
  // Outside the window the sine goes negative: keep the azimuth clamped, let the height sink to −0.25.
  const sinkY = Math.max(-0.25, Math.sin(t * Math.PI) * Math.sin((80 * Math.PI) / 180));
  const dir: [number, number, number] =
    t > 0 && t < 1 ? [inside.dir[0], inside.dir[1], inside.dir[2]] : [inside.dir[0], sinkY, inside.dir[2]];

  return { dir, elevationRatio: Math.sin(Math.min(1, Math.max(0, t)) * Math.PI) };
}
