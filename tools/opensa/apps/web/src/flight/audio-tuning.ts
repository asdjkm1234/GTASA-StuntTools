/** User-adjustable inferred engine mix. Values of 1 preserve the current mix; near jet layers default to 0. */
export interface AudioMixTuning {
  readonly front: number;
  readonly frontPitch: number;
  readonly jetDistance: number;
  readonly jetDistancePitch: number;
  readonly master: number;
  readonly near: number;
  readonly nearPitch: number;
  readonly pitch: number;
  readonly powerDynamics: number;
  readonly presence: number;
  readonly presenceHighHz: number;
  readonly presenceLowHz: number;
  readonly propDistance: number;
  readonly propDistancePitch: number;
  readonly rear: number;
  readonly rearPitch: number;
  readonly turbine: number;
  readonly turbinePitch: number;
}

export const DEFAULT_AUDIO_MIX_TUNING: AudioMixTuning = {
  front: 1,
  frontPitch: 1,
  jetDistance: 0,
  jetDistancePitch: 1,
  master: 1,
  near: 1,
  nearPitch: 1,
  pitch: 1,
  powerDynamics: 1,
  presence: 0,
  presenceHighHz: 400,
  presenceLowHz: 4000,
  propDistance: 1,
  propDistancePitch: 1,
  rear: 1,
  rearPitch: 1,
  turbine: 1,
  turbinePitch: 1,
};

export const AUDIO_MIX_TUNING_LIMITS: { readonly [K in keyof AudioMixTuning]: readonly [number, number] } = {
  front: [0, 2],
  frontPitch: [0.8, 1.2],
  jetDistance: [0, 1],
  jetDistancePitch: [0.8, 1.2],
  master: [0, 2],
  near: [0, 2],
  nearPitch: [0.8, 1.2],
  pitch: [0.8, 1.2],
  powerDynamics: [0, 2],
  presence: [0, 3],
  presenceHighHz: [200, 1200],
  presenceLowHz: [2000, 8000],
  propDistance: [0, 2],
  propDistancePitch: [0.8, 1.2],
  rear: [0, 2],
  rearPitch: [0.8, 1.2],
  turbine: [0, 2],
  turbinePitch: [0.8, 1.2],
};

/** Reject malformed or out-of-range stored/exported values at the boundary. */
export function normalizeAudioMixTuning(input: unknown): AudioMixTuning {
  const values = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const result = { ...DEFAULT_AUDIO_MIX_TUNING };
  for (const key of Object.keys(DEFAULT_AUDIO_MIX_TUNING) as (keyof AudioMixTuning)[]) {
    const value = values[key];
    const [minimum, maximum] = AUDIO_MIX_TUNING_LIMITS[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      result[key] = Math.max(minimum, Math.min(maximum, value));
    }
  }

  return result;
}
