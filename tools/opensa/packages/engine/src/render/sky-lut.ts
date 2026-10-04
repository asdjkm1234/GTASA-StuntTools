/**
 * PBR sky LUT builder (plan 074/06 row 4): the physical dome evaluated on the CPU into a small
 * (azimuth-from-sun × elevation) texture that BOTH the sky pass and the world fog sample — the 068
 * fog-into-sky invariant holds by construction, and the per-fragment cost is one texture tap.
 *
 * The DEFAULT radiance model is Hosek-Wilkie (the day-sky fix: Preetham's fit ran zenith-brighter-than-
 * horizon with near-zero sun-side variation — the field "flat lifeless fill"). HW values are stored
 * LINEAR HDR in the rgba16float texels and compressed by ACES like everything else — no Reinhard
 * pre-squash. The legacy Preetham path (ported from the since-deleted prod `sky-params.ts`, Reinhard-
 * compressed as prod did) stays selectable for A/B while the day-sky verdict is out. timecyc `skyTop`
 * stays the colourist via the mood tint in both models.
 */
import { cookHosekWilkie, hosekWilkieRadianceFromCos } from './hosek-wilkie';

export interface SkyLutInput {
  /** Cloud cover 0 (clear) → 1 (overcast) — drives haze AND hands the sky back to the authored gradient
   *  (prod: under a full deck the atmosphere is invisible; Preetham degenerates into a milky Mie wash). */
  cloudCover: number;
  /** Cloud heaviness 0–1 (storm/fog weathers). */
  cloudDark: number;
  /** Exposure on the Preetham dome (prod `sky.pbrExposure`, default 0.55). The old hardcoded 0.25 was a
   *  pre-ACES constant — it read as a dark, lifeless navy once the tonemap landed (074/09 field round). */
  exposure: number;
  /** Radiance model — Hosek-Wilkie when omitted; 'preetham' = the legacy prod-twin dome (A/B). */
  model?: 'hosek' | 'preetham';
  /** How strongly the timecyc palette tints the physical sky (0 = pure Preetham, 1 = full SA mood). */
  mood: number;
  /**
   * Sun-BELOW-HORIZON factor 0..1 (prod's `uPbrNight`): blends the physical dome back to the flat timecyc
   * gradient only once the sun has sunk — neither model has a night sky. MUST NOT be the litFade darkness
   * (`dn`): that ramps DURING golden hour and suppressed the Preetham sunrise/sunset entirely (the exact
   * bug prod fixed — "using the night factor here killed the Preetham sunset"; 074/09 sky field round).
   */
  pbrNight: number;
  /** LINEAR horizon colour (the night-gradient blend partner). */
  skyHorizon: readonly [number, number, number];
  /** LINEAR sky-top tint source (the environment's `skyTop`). */
  skyTop: readonly [number, number, number];
  /** Sun elevation factor 0..1. */
  sunElevation: number;
}

export const SKY_LUT_WIDTH = 96; // azimuthal angle from the sun, 0..π
export const SKY_LUT_HEIGHT = 48; // elevation, −0.05..1

const TOTAL_RAYLEIGH = [5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5] as const;
const MIE_K = [1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14] as const;
const SUN_EE = 1000;
const SUN_CUTOFF = Math.PI / 1.95;
const SUN_STEEPNESS = 1.5;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Ground albedo fed to Hosek-Wilkie — a fixed mid-grey; SA's mixed city/country ground. */
const HW_ALBEDO = 0.15;
/** Master scale from HW's expected-radiance units into the engine's pre-ACES linear range, calibrated so
 *  a clear-noon zenith with `exposure` 0.55 lands ≈0.4 and the bright horizon ≈1.0–1.2 (ACES rolls it). */
const HW_RADIANCE_SCALE = 0.07;

/** Build the LUT texels (rgba16float, row-major, SKY_LUT_WIDTH × SKY_LUT_HEIGHT). */
export function buildSkyLut(input: SkyLutInput): Uint16Array {
  const { betaM, betaR, sunE, tint, turbidity } = params(input);
  const out = new Uint16Array(SKY_LUT_WIDTH * SKY_LUT_HEIGHT * 4);
  const sunElevation = clamp01(input.sunElevation);
  const sunY = Math.max(0.02, sunElevation);
  const sunXz = Math.sqrt(Math.max(0, 1 - sunY * sunY));
  const g = 0.8;
  const g2 = g * g;
  const sunFresnel = clamp01((1 - sunY) ** 5);
  const base = [0, 0.0003, 0.00075];
  // Hosek-Wilkie state (the default model): cooked once per rebuild; the model is undefined below the
  // horizon, so the sun elevation clamps to 0 there and pbrNight hands the dome to the timecyc gradient.
  const hosek = input.model === 'preetham' ? null : cookHosekWilkie(turbidity, HW_ALBEDO, Math.asin(sunElevation));

  let at = 0;
  for (let row = 0; row < SKY_LUT_HEIGHT; row += 1) {
    // Elevation axis: −0.05 (just under the horizon — fog looks slightly down) … 1 (zenith).
    const elevation = -0.05 + (row / (SKY_LUT_HEIGHT - 1)) * 1.05;
    const y = elevation;
    const xz = Math.sqrt(Math.max(0.0001, 1 - y * y));
    const zenith = Math.acos(Math.min(1, Math.max(0, y)));
    // `cos(zenith)` by construction — the row's own clamped elevation. The radiance form below takes it
    // directly rather than making every channel undo the `acos` with a `cos` (201/4-03).
    const cosZenith = Math.min(1, Math.max(0, y));
    const denom = Math.cos(zenith) + 0.15 * (93.885 - (zenith * 180) / Math.PI) ** -1.253;
    const sR = 8400 / Math.max(1, denom);
    const sM = 1250 / Math.max(1, denom);
    for (let col = 0; col < SKY_LUT_WIDTH; col += 1) {
      // Azimuthal angle between the view and the sun (the dome is symmetric around the sun's azimuth).
      const azimuth = (col / (SKY_LUT_WIDTH - 1)) * Math.PI;
      const cosTheta = xz * Math.cos(azimuth) * sunXz + y * sunY;
      const cosGamma = Math.min(1, Math.max(-1, cosTheta));
      const gamma = Math.acos(cosGamma);
      const gradientT = clamp01(Math.max(0, elevation)) ** 0.55;
      for (let channel = 0; channel < 3; channel += 1) {
        let dome: number;
        if (hosek) {
          // LINEAR HDR — ACES is the compressor; a Reinhard pre-squash here is exactly what flattened
          // the Preetham day into a fill (double compression).
          dome =
            hosekWilkieRadianceFromCos(hosek[channel], cosZenith, cosGamma, gamma) *
            HW_RADIANCE_SCALE *
            input.exposure *
            tint[channel];
        } else {
          const rPhase = 0.0596831 * (1 + cosTheta * cosTheta);
          const mPhase = (0.0795775 * (1 - g2)) / (1 - 2 * g * cosTheta + g2) ** 1.5;
          const fex = Math.exp(-(betaR[channel] * sR + betaM[channel] * sM));
          const scatter = (betaR[channel] * rPhase + betaM[channel] * mPhase) / (betaR[channel] + betaM[channel]);
          let lin = Math.max(0, sunE * scatter * (1 - fex)) ** 1.5;
          lin *= 1 + (Math.max(0, sunE * scatter * fex) ** 0.5 - 1) * sunFresnel;
          const value = ((lin + 0.1 * fex) * 0.04 + base[channel]) * input.exposure * tint[channel];
          dome = value / (1 + value); // Reinhard, matching the prod dome
        }
        // Timecyc gradient blend — PROD-EXACT (skyBase): the gradient takes over at NIGHT (pbrNight — sun
        // below the horizon; neither model has a night sky) and under OVERCAST (the deck hides the
        // atmosphere; a pure physical dome fights it as a milky Mie wash). By a clear day the sky IS the
        // physical dome + the mood TINT — the old extra `mood × 0.6` gradient mix was a pre-ACES hack
        // that flattened the dome into a fill.
        const gradient = input.skyHorizon[channel] + (input.skyTop[channel] - input.skyHorizon[channel]) * gradientT;
        const gradientW = Math.max(clamp01(input.pbrNight), clamp01(input.cloudCover) * 0.85);
        out[at + channel] = f32ToF16(dome + (gradient - dome) * gradientW);
      }
      out[at + 3] = F16_ONE;
      at += 4;
    }
  }

  return out;
}

/** Cheap change-detection key: rebuild only when an input moved visibly. */
export function skyLutKey(input: SkyLutInput): string {
  const q = (value: number, steps: number): number => Math.round(value * steps);

  return [
    input.model ?? 'hosek',
    q(input.sunElevation, 200),
    q(input.pbrNight, 100),
    q(input.exposure, 100),
    q(input.cloudCover, 50),
    q(input.cloudDark, 50),
    q(input.mood, 50),
    q(input.skyTop[0], 100),
    q(input.skyTop[1], 100),
    q(input.skyTop[2], 100),
    q(input.skyHorizon[0], 100),
    q(input.skyHorizon[1], 100),
    q(input.skyHorizon[2], 100),
  ].join(',');
}

/** The one scratch pair the conversion below reinterprets through. It is module-level because this runs
 *  four times per texel — 18 432 calls per build — and a `new Float32Array(1)` per call was measured as
 *  most of the cost (201/4-03: 13.3 → 1.9 ms in node, and 75.8 ms of the phone's first frame). */
const F16_ONE = 0x3c00; // f32ToF16(1), which the alpha channel writes 4 608 times per build
const F32_SCRATCH = new Float32Array(1);
const U32_SCRATCH = new Uint32Array(F32_SCRATCH.buffer);

function f32ToF16(value: number): number {
  // Round-to-nearest float32 → float16 (positive-range inputs; HW texels are linear HDR, may exceed 1).
  F32_SCRATCH[0] = value;
  const x = U32_SCRATCH[0];
  const sign = (x >> 16) & 0x8000;
  const exponent = ((x >> 23) & 0xff) - 127 + 15;
  const mantissa = x & 0x7fffff;
  if (exponent <= 0) {
    return sign;
  }
  if (exponent >= 31) {
    return sign | 0x7bff;
  }

  return sign | (exponent << 10) | (mantissa >> 13);
}

function params(input: SkyLutInput): {
  betaM: readonly [number, number, number];
  betaR: readonly [number, number, number];
  sunE: number;
  tint: readonly [number, number, number];
  turbidity: number;
} {
  const cover = clamp01(input.cloudCover);
  const dark = clamp01(input.cloudDark);
  const elevation = clamp01(input.sunElevation);

  // Haze: clear SA day ≈ 2.2; overcast/foggy weathers push toward a milky 10+ sky.
  const turbidity = 2.2 + cover * 6 + dark * 4;
  // More Rayleigh near the horizon sun → redder dawns/dusks.
  const rayleigh = 2 + (1 - elevation) * 1.5;
  const mieCoefficient = 0.005 + cover * 0.006;

  const betaR = TOTAL_RAYLEIGH.map((value) => value * rayleigh) as unknown as [number, number, number];
  const mieC = 0.2 * turbidity * 10e-18;
  const betaM = MIE_K.map((value) => 0.434 * mieC * value * mieCoefficient) as unknown as [number, number, number];

  const zenithAngle = Math.acos(elevation);
  const sunE = SUN_EE * Math.max(0, 1 - Math.exp(-((SUN_CUTOFF - zenithAngle) / SUN_STEEPNESS)));

  // SA mood tint from the LINEAR skyTop, normalized so it recolours without darkening.
  const maxComponent = Math.max(input.skyTop[0], input.skyTop[1], input.skyTop[2], 0.001);
  const tint = input.skyTop.map((value) => 1 + (value / maxComponent - 1) * clamp01(input.mood)) as unknown as [
    number,
    number,
    number,
  ];

  return { betaM, betaR, sunE, tint, turbidity };
}
