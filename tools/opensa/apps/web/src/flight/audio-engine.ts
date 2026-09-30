/**
 * Replay audio engine core.
 *
 * Framework-agnostic and deterministic: it maps the recorded/derived signals of a {@link FlightTrack} to
 * `(sample, playbackRate, gain, pan)` commands over time. It touches no DOM, no Web Audio and no wall clock,
 * so the live renderer (todo 18) and the offline PCM renderer (todo 19) drive the SAME core and a seek or an
 * export reproduces the exact selection every time.
 *
 * Signal honesty (G3 = NO-GO, see `.omo/evidence/gate-G3-blocked.md`):
 * - Engine rev/RPM is BLOCKED. It is never read, derived or emitted. The normalized INFERRED engine-speed
 *   proxy drives jet layer gains/pitch; Rustler's pitch follows recorded orientation plus an inferred key
 *   offset, with the public player-prop frequency step rate. Hydra uses a modest 1.0–1.25x pitch sweep.
 * - Transmission gear and engine load are INFERRED (recorder-labelled). Collision impact is INFERRED and its
 *   surface material is MISSING (a measured material is never recorded). See {@link SIGNAL_PROVENANCE}.
 *
 * Documented mapping constants (sources):
 * - Each model plays its OWN GENRL engine bank (Hydra 520 -> `SND_BANK_GENRL_VEHICLE_GEN`; Rustler 476 ->
 *   `SND_BANK_GENRL_FASTPROP`). Hydra crossfades baked rate steps over its inferred speed proxy; Rustler
 *   varies one original sample per layer using the public player-prop orientation/acceleration formula
 *   where CSV data permits.
 *   Neither is a measured RPM.
 * - Engine bank selection reads `AudioManifestSample.model` (baked provenance). A manifest that declares
 *   per-model engines but has none for the track's model yields `engine: null` (reported, never a silent
 *   fallback to another model's bank). A legacy manifest without model tags keeps its single engine pair.
 * - Explosion frequency cycle `{1.12, 1.0, 0.88}` comes from the todo-17 plan; the collision pitch variance
 *   is ±2% as used by gta-reversed `AECollisionAudioEntity::PlayOneShotCollisionSound`.
 * - Distance/directional attenuation, Doppler and reverb are documented acoustic models (see each function).
 */
import type { AudioMixTuning } from './audio-tuning';
import type { FlightEvent, FlightRow, FlightTrack, SampledPose } from './csv';

import { sampleTrack } from './csv';
import { rotateVec, type Vec3 } from './math';

// ---------------------------------------------------------------------------------------------
// Sample categories and the baked GENRL manifest (todo 14 / G4)
// ---------------------------------------------------------------------------------------------

/** The cue categories the engine schedules. These are OpenSA cue names, not GENRL bank names. */
export const SAMPLE_CATEGORIES = [
  'engine-accelerate',
  'engine-decelerate',
  'engine-front',
  'engine-rear',
  'engine-near',
  'engine-prop-distance',
  'engine-turbine',
  'engine-distance',
  'collision',
  'explosion',
] as const;
export type SampleCategory = (typeof SAMPLE_CATEGORIES)[number];

/** The engine layer roles a baked sample can carry. The pair is retained for legacy manifests. */
export const ENGINE_LAYER_ROLES = [
  'front',
  'rear',
  'turbine',
  'distance',
  'near',
  'prop-distance',
  'accelerate',
  'decelerate',
] as const;
export type EngineLayerRole = (typeof ENGINE_LAYER_ROLES)[number];

/** The manifest `category` string each cue reads. Engine layer categories are the baked jet/prop layer roles. */
export const MANIFEST_CATEGORY: Record<SampleCategory, string> = {
  collision: 'collision set',
  'engine-accelerate': 'engine accelerate',
  'engine-decelerate': 'engine decelerate',
  'engine-distance': 'engine distance',
  'engine-front': 'engine front',
  'engine-near': 'engine near',
  'engine-prop-distance': 'engine prop distance',
  'engine-rear': 'engine rear',
  'engine-turbine': 'engine turbine',
  explosion: 'explosion set',
};

/** The cue category that carries each engine layer role. */
export const ENGINE_ROLE_SAMPLE: Record<EngineLayerRole, SampleCategory> = {
  accelerate: 'engine-accelerate',
  decelerate: 'engine-decelerate',
  distance: 'engine-distance',
  front: 'engine-front',
  near: 'engine-near',
  'prop-distance': 'engine-prop-distance',
  rear: 'engine-rear',
  turbine: 'engine-turbine',
};

export interface AudioBankManifest {
  readonly samples: readonly AudioManifestSample[];
  readonly source: string;
  readonly version: number;
}

/** One entry of `map-pak/audio/manifest.json` (baked by todo 14 from the G4-validated GENRL bank). */
export interface AudioManifestSample {
  readonly bankName: string;
  readonly category: string;
  readonly file: string;
  readonly globalBankId: number;
  readonly headroom: number;
  /** Engine samples: `jet` (Hydra turbine) or `prop` (Rustler propeller). */
  readonly kind?: string;
  /** Engine samples: the front/rear/turbine/distance or propeller layer role this step belongs to. */
  readonly layer?: string;
  /** Engine samples: tail->head crossfade the baker applied to make the loop seamless (`0` = none). */
  readonly loopCrossfadeFrames?: number;
  readonly loopStartFrame: number;
  /** Engine samples: the layer's relative mix (turbine is the unity reference). */
  readonly mix?: number;
  /** Engine samples: the model (520 Hydra / 476 Rustler) this bank serves. Absent on pre-v2 paks. */
  readonly model?: number;
  readonly packageBankIndex: number;
  readonly pcmBytes: number;
  /** Engine samples: why this bank is the right one for the model (baked provenance string). */
  readonly provenance?: string;
  /** Engine samples: the playback rate this step was baked at (1 = source pitch). */
  readonly rate?: number;
  readonly sampleRateHz: number;
  readonly setSoundCount: number;
  readonly slotId: number;
  readonly slotName: string;
  readonly soundIndex: number;
  /** Engine samples: the exact gta-reversed `SoundIDs.h` name of the decoded sound. */
  readonly soundName?: string;
  /** Engine samples: the rate-step index within the model's engine table (0-based). */
  readonly step?: number;
  readonly wavBytes: number;
  readonly wavFrames: number;
}

/** One baked layer of a model's engine: its role, relative mix and the rate-step table to crossfade. */
export interface EngineLayerSpec {
  /** GENRL SoundMeta headroom converted to dB. The original CAESound subtracts this from volume. */
  readonly headroomDb: number;
  readonly mix: number;
  readonly role: EngineLayerRole;
  readonly steps: readonly EngineStep[];
}

export interface ProvenanceRow {
  readonly provenance: SignalProvenance;
  readonly signal: string;
  readonly source: string;
  readonly validationMethod: string;
}

export type SignalProvenance = 'inferred' | 'measured' | 'missing';

/** The engine bank name a model's track plays, for the probe/UI; `''` when the manifest cannot serve it. */
export function engineBankForModel(manifest: AudioBankManifest, model: number): string {
  if (manifestHasModelEngines(manifest)) {
    const owned = manifest.samples.find((sample) => sample.model === model && sample.category.startsWith('engine '));

    return owned?.bankName ?? '';
  }

  return sampleForCategory(manifest, 'engine-accelerate')?.bankName ?? '';
}

/**
 * The engine LAYERS the replay mixes for a model. The jet has front/rear/turbine/distance roles; a player prop
 * uses front/rear/near/distant layers; a model-less legacy manifest keeps
 * its single pair. A manifest that declares per-model engines but none for this model yields `[]` — reported,
 * never a silent fallback to another model's bank.
 */
export function engineLayerSpecsForModel(manifest: AudioBankManifest, model: number): EngineLayerSpec[] {
  const owned = manifest.samples.filter((sample) => sample.model === model && sample.category.startsWith('engine '));
  const specs: EngineLayerSpec[] = [];
  for (const role of ENGINE_LAYER_ROLES) {
    const wanted = MANIFEST_CATEGORY[ENGINE_ROLE_SAMPLE[role]];
    const first = owned.find((sample) => sample.category === wanted);
    if (!first) {
      continue;
    }
    specs.push({
      headroomDb: first.headroom / 100,
      mix: typeof first.mix === 'number' ? first.mix : DEFAULT_ENGINE_LAYER_MIX[role],
      role,
      steps: owned
        .filter((sample) => sample.category === wanted)
        .map(stepFromSample)
        .sort((a, b) => a.step - b.step),
    });
  }
  if (specs.length > 0) {
    return specs;
  }
  // Prop / legacy: the accelerator/decelerator crossfade pair.
  const accelerate = engineStepsForModel(manifest, model, 'engine-accelerate');
  const decelerate = engineStepsForModel(manifest, model, 'engine-decelerate');
  if (accelerate.length > 0) {
    specs.push({ headroomDb: 0, mix: DEFAULT_ENGINE_LAYER_MIX.accelerate, role: 'accelerate', steps: accelerate });
  }
  if (decelerate.length > 0) {
    specs.push({ headroomDb: 0, mix: DEFAULT_ENGINE_LAYER_MIX.decelerate, role: 'decelerate', steps: decelerate });
  }

  return specs;
}

/** The model's engine rate-steps for one cue category, ascending by step. Empty when the manifest lacks them. */
export function engineStepsForModel(
  manifest: AudioBankManifest,
  model: number,
  category: Extract<SampleCategory, 'engine-accelerate' | 'engine-decelerate'>,
): readonly EngineStep[] {
  if (!manifestHasModelEngines(manifest)) {
    const single = sampleForCategory(manifest, category);

    return single ? [stepFromSample(single)] : [];
  }
  const wanted = MANIFEST_CATEGORY[category];

  return manifest.samples
    .filter((sample) => sample.category === wanted && sample.model === model)
    .map(stepFromSample)
    .sort((a, b) => a.step - b.step);
}

/** True when the manifest carries per-model engine samples. A v1 manifest has none and keeps its pair. */
export function manifestHasModelEngines(manifest: AudioBankManifest): boolean {
  return manifest.samples.some((sample) => typeof sample.model === 'number' && sample.category.startsWith('engine '));
}

/** Parse the baked audio manifest. Malformed input throws a message naming the field; it never returns NaN. */
export function parseAudioManifest(text: string): AudioBankManifest {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('audio manifest is not valid JSON');
  }
  const root = asRecord(raw, 'root');
  const samplesRaw = root.samples;
  if (!Array.isArray(samplesRaw)) {
    throw new Error('audio manifest root.samples must be an array');
  }
  const samples = samplesRaw.map((entry, index): AudioManifestSample => {
    const label = `samples[${index}]`;
    const sample = asRecord(entry, label);

    return {
      bankName: requireString(sample, 'bankName', label),
      category: requireString(sample, 'category', label),
      file: requireString(sample, 'file', label),
      globalBankId: requireFiniteNumber(sample, 'globalBankId', label),
      headroom: requireFiniteNumber(sample, 'headroom', label),
      loopStartFrame: sample.loopStartFrame === null ? 0 : requireFiniteNumber(sample, 'loopStartFrame', label),
      packageBankIndex: requireFiniteNumber(sample, 'packageBankIndex', label),
      pcmBytes: requireFiniteNumber(sample, 'pcmBytes', label),
      sampleRateHz: requireFiniteNumber(sample, 'sampleRateHz', label),
      setSoundCount: requireFiniteNumber(sample, 'setSoundCount', label),
      slotId: requireFiniteNumber(sample, 'slotId', label),
      slotName: requireString(sample, 'slotName', label),
      soundIndex: requireFiniteNumber(sample, 'soundIndex', label),
      wavBytes: requireFiniteNumber(sample, 'wavBytes', label),
      wavFrames: requireFiniteNumber(sample, 'wavFrames', label),
      ...optionalAugments(sample, label),
    };
  });

  return {
    samples,
    source: requireString(root, 'source', 'root'),
    version: requireFiniteNumber(root, 'version', 'root'),
  };
}

// ---------------------------------------------------------------------------------------------
// Signal provenance — the honesty table this module is written against
// ---------------------------------------------------------------------------------------------

/** The manifest entry for a cue category, or `null` when the pak did not bake it (documented default). */
export function sampleForCategory(manifest: AudioBankManifest, category: SampleCategory): AudioManifestSample | null {
  const wanted = MANIFEST_CATEGORY[category];

  return manifest.samples.find((sample) => sample.category === wanted) ?? null;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`audio manifest ${label} is not an object`);
  }

  return value as Record<string, unknown>;
}

/**
 * The optional per-model engine fields (v2 manifests). Absent keys are omitted, so a legacy v1 manifest
 * parses unchanged; a present-but-malformed field throws rather than producing NaN.
 */
function optionalAugments(record: Record<string, unknown>, label: string): Partial<AudioManifestSample> {
  const result: {
    kind?: string;
    layer?: string;
    loopCrossfadeFrames?: number;
    mix?: number;
    model?: number;
    provenance?: string;
    rate?: number;
    soundName?: string;
    step?: number;
  } = {};
  if (record.model !== undefined) result.model = requireFiniteNumber(record, 'model', label);
  if (record.kind !== undefined) result.kind = requireString(record, 'kind', label);
  if (record.layer !== undefined) result.layer = requireString(record, 'layer', label);
  if (record.mix !== undefined) result.mix = requireFiniteNumber(record, 'mix', label);
  if (record.step !== undefined) result.step = requireFiniteNumber(record, 'step', label);
  if (record.rate !== undefined) result.rate = requireFiniteNumber(record, 'rate', label);
  if (record.provenance !== undefined) result.provenance = requireString(record, 'provenance', label);
  if (record.soundName !== undefined) result.soundName = optionalString(record, 'soundName', label);
  if (record.loopCrossfadeFrames !== undefined) {
    result.loopCrossfadeFrames = requireFiniteNumber(record, 'loopCrossfadeFrames', label);
  }

  return result;
}

/** A string that MAY be empty: `soundName` is `''` for a bank with no named `SoundIDs.h` enum. */
function optionalString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new Error(`audio manifest ${label}.${key} must be a string`);
  }

  return value;
}

function requireFiniteNumber(record: Record<string, unknown>, key: string, label: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`audio manifest ${label}.${key} must be a finite number`);
  }

  return value;
}

function requireString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`audio manifest ${label}.${key} must be a non-empty string`);
  }

  return value;
}

function stepFromSample(sample: AudioManifestSample): EngineStep {
  return {
    file: sample.file,
    loopStartFrame: typeof sample.loopStartFrame === 'number' ? sample.loopStartFrame : 0,
    rate: typeof sample.rate === 'number' && sample.rate > 0 ? sample.rate : 1,
    step: typeof sample.step === 'number' ? Math.floor(sample.step) : 0,
  };
}

/**
 * Every input the engine reads, with where it comes from and how it is checked. An `inferred` row is NEVER
 * presented as `measured`; a `missing` row has no value and the engine uses the documented default.
 */
export const SIGNAL_PROVENANCE: readonly ProvenanceRow[] = [
  {
    provenance: 'measured',
    signal: 'aircraft position (x/y/z)',
    source: 'CSV columns x,y,z (v6+)',
    validationMethod: 'csv.ts numeric column read; csv.test.ts parses the fixture and rejects truncated rows',
  },
  {
    provenance: 'measured',
    signal: 'aircraft velocity (vx/vy/vz)',
    source: 'CSV columns vx,vy,vz',
    validationMethod: 'csv.ts numeric column read; used for Doppler only, never for pitch',
  },
  {
    provenance: 'measured',
    signal: 'throttle / brake',
    source: 'CSV columns throttle,brake',
    validationMethod: 'csv.ts numeric column read; feeds the accelerate/decelerate crossfade and the load fallback',
  },
  {
    provenance: 'inferred',
    signal: 'transmission gear',
    source:
      'CSV column transmission_gear_inferred [0,6] (transmission_gear_source=inferred); pre-v9 has no column and the gear is inferred from measured-position airspeed',
    validationMethod:
      'task-15 validator asserts integer min/max in [0,6] and source==inferred across all rows; the pre-v9 path is labelled source=derived',
  },
  {
    provenance: 'inferred',
    signal: 'engine load',
    source:
      'For 520/476, infer power from the measured brake column as 1-brake: W=0, neutral=0.5, S=1 in the real v9 captures while throttle stays zero. The v9 engine_load_inferred column applies an unsuitable max(throttle,brake) car heuristic and is not used for plane audio.',
    validationMethod:
      'QPC-aligned v9 Hydra and Rustler first-person WAV throttle-step comparison; always reported as inferred',
  },
  {
    provenance: 'missing',
    signal: 'engine rev / RPM',
    source: 'BLOCKED by G3 (gate-G3-blocked.md); no column is emitted and none is derived',
    validationMethod:
      'task-15 raw header/column search reports no rev/RPM column; jet pitch uses an inferred proxy and prop pitch uses recorded orientation plus inferred controls',
  },
  {
    provenance: 'inferred',
    signal: 'engine bank / layers / playback rate',
    source:
      'map-pak/audio/manifest.json per-model engines: Hydra 520 is a LAYERED turbine in SND_BANK_GENRL_VEHICLE_GEN ' +
      '(HARRIER_FRONT 10 + HARRIER_REAR 11 + THRUST 26 + JET_DIST 14 from the local 0x4FF900 call sites); Rustler 476 keeps ' +
      'FASTPROP sounds 0/1 as front/rear plus VEHICLE_GEN PROP_NEAR/PROP_DIST. The baked rate-steps remain ' +
      'in the manifest; both models vary one original loop per layer. Hydra gains and pitch remain inferred. ' +
      'Rustler pitch follows recorded orientation plus an inferred ' +
      'W/released/S control offset and an approximated game-tick smoothing rate',
    validationMethod:
      'audio conformance test asserts the model-tagged bank/slot/sound ids against the gta-reversed tables; a ' +
      'model with no baked engines yields engine:null, never another model bank',
  },
  {
    provenance: 'inferred',
    signal: 'collision impact',
    source: '# event,<s>,collision,inferred,<impact>,... (peak-hold health-delta plus accel-spike proxy)',
    validationMethod: 'csv.ts parseEventLine requires the surface token to be `inferred` and impact finite >= 0',
  },
  {
    provenance: 'missing',
    signal: 'collision surface material',
    source: 'never recorded; the token is always `inferred`',
    validationMethod:
      'csv.ts parseEventLine rejects any surface token other than `inferred`, so a measured material can never reach the engine',
  },
  {
    provenance: 'measured',
    signal: 'explosion time and position',
    source: '# event,<s>,explosion,<x>,<y>,<z>',
    validationMethod: 'csv.ts parseEventLine; csv.test.ts asserts exactly one explosion on the Hydra fixture',
  },
  {
    provenance: 'measured',
    signal: 'listener pose (position/forward/up/velocity)',
    source: 'supplied by the caller (replay camera, todo 18); defaults to the aircraft pose at the sampled time',
    validationMethod: 'not a recording signal; defaults keep the core usable without a camera and are finite-guarded',
  },
];

// ---------------------------------------------------------------------------------------------
// Mapping constants
// ---------------------------------------------------------------------------------------------

/**
 * Engine-loop target playbackRate band, reached at the derived idle / full-power ends of the proxy. The floor
 * is SOURCE PITCH (1.0): a cruising jet must never be pitched down into a low drone (the reported bug was a
 * permanent 0.55 floor on a pre-v9 recording with no gear/load columns). Inferred tuning.
 */
export const ENGINE_RATE_MIN = 1;
/** Legacy engine-loop target maximum; Hydra and Rustler now use their own pitch paths. */
export const ENGINE_RATE_MAX = 1.6;
/** The original jet path adds 0.1 pitch for acceleration; W is inferred from the captured brake column. */
const JET_FRONT_REAR_POWER_RATE = 0.1;
/** Residual pitch effect fitted to the first-person recording, not measured game RPM. */
const JET_FRONT_REAR_AIRSPEED_RATE = 0.03;
/** Optional diagnostic THRUST filter copy; corrected front/rear samples provide the default broadband body. */
export const JET_THRUST_PRESENCE_GAIN = 0;
export const JET_THRUST_PRESENCE_HIGH_HZ = 400;
export const JET_THRUST_PRESENCE_LOW_HZ = 4000;
/** The recorder's inferred gear ceiling (`transmission_gear_inferred` is bounded [0,6]). */
export const MAX_GEAR = 6;
/** Derived engine-loop gain at zero load (before attenuation). Inferred tuning; raised so idle is audible. */
export const ENGINE_GAIN_MIN = 0.5;
/** Derived engine-loop gain at full load (before attenuation). Inferred tuning. */
export const ENGINE_GAIN_MAX = 0.9;
/**
 * Airspeed (m/s) mapped to normalized full engine speed on the pre-v9 path (no gear/load columns). Inferred
 * tuning: a measured-position speed proxy for a cruising jet, NOT a tachometer.
 */
export const ENGINE_SPEED_REFERENCE_MPS = 120;
/** Per-sample position-delta speed is clamped here so a QuickHome teleport cannot spike the engine note. */
export const ENGINE_SPEED_MAX_MPS = 250;
/** Default relative mix of each engine layer when the manifest carries none (turbine is the unity reference). */
export const DEFAULT_ENGINE_LAYER_MIX: Record<EngineLayerRole, number> = {
  accelerate: 1,
  decelerate: 1,
  distance: 0.25,
  front: 1,
  near: 0.3,
  'prop-distance': 0.2,
  rear: 1,
  turbine: 1,
};
/** gta-reversed PlayAircraftSound: THRUST=4.5, JET_DISTANT=50, NEAR=1, FRONT/REAR=4. */
const AIRCRAFT_ROLLOFF: Record<EngineLayerRole, number> = {
  accelerate: 4,
  decelerate: 4,
  distance: 50,
  front: 4,
  near: 1,
  'prop-distance': 6,
  rear: 4,
  turbine: 4.5,
};
/** Bounds on a single engine step's residual playbackRate (target / baked step rate), before speed scaling. */
export const ENGINE_LAYER_RATE_MIN = 0.25;
export const ENGINE_LAYER_RATE_MAX = 8;
/** Inferred collision impact (m/s^2) mapped to full strength; a mapping reference, not a game constant. */
export const COLLISION_IMPACT_REFERENCE = 60;
/** Collision one-shot gain at full strength, before attenuation. */
export const COLLISION_GAIN = 0.9;
/** Explosion one-shot gain, before attenuation. */
export const EXPLOSION_GAIN = 1;
/** Documented explosion playback-rate cycle, applied by explosion ordinal in this exact order. */
export const EXPLOSION_FREQUENCY_CYCLE = [1.12, 1, 0.88] as const;
/** Bounded collision one-shot pitch jitter from gta-reversed PlayOneShotCollisionSound (±2%). */
export const PITCH_VARIANCE = 0.02;
/** gta-reversed CAEAudioEnvironment::GetDopplerRelativeFrequency uses 340 m/s and limits radial speed to 35. */
export const SPEED_OF_SOUND = 340;
const MAX_DOPPLER_RADIAL_MPS = 35;
/** Doppler factor is clamped to this band so an extreme closing speed cannot make a non-finite rate. */
export const DOPPLER_MIN = 0.5;
export const DOPPLER_MAX = 2;
/** Distance at or below which attenuation is 1. */
export const ATTENUATION_REF_DISTANCE = 15;
/** Distance at or beyond which attenuation is 0. */
export const ATTENUATION_MAX_DISTANCE = 1500;
/** Gain of a source directly behind the listener (1 in front), 1 >= back >= 0. */
export const DIRECTIONAL_BACK_GAIN = 0.6;
/** Default frame/step width used to decide which events a sample frame triggers. */
export const AUDIO_EVENT_WINDOW = 1 / 60;
/** Altitude at or above which the air is treated as open (less reverb). */
export const REVERB_OPEN_AIR_ALTITUDE = 200;

// ---------------------------------------------------------------------------------------------
// Vector helpers (engine space, no DOM)
// ---------------------------------------------------------------------------------------------

export interface AudioListener {
  readonly forward: Vec3;
  readonly pos: Vec3;
  readonly up: Vec3;
  readonly velocity: Vec3;
}

export interface CrossfadeWeights {
  readonly accelerate: number;
  readonly decelerate: number;
}

export interface EngineSignals {
  /** Inferred transmission gear, clamped [0,6]. */
  readonly gear: number;
  /** Inferred engine load, clamped [0,1]. */
  readonly load: number;
  /** Inferred 0..1 engine-speed proxy from gear+load. NOT rev/RPM. */
  readonly normalizedSpeed: number;
  /** Always `null`: rev/RPM is BLOCKED by G3 and is never derived or emitted. */
  readonly rev: null;
  /** Inferred Rustler rotor inertia from position-derived airspeed, not a measured m_fPropSpeed. */
  readonly rotorAirspeed: number;
  /**
   * How gear/load were obtained: `recorded` reads the v9 inferred columns, `derived` reads the measured-
   * position speed proxy (pre-v9 recordings have no gear/load columns). Both are INFERRED, never measured.
   */
  readonly source: 'derived' | 'recorded';
  /** Measured-position airspeed (m/s), clamped; the pre-v9 load/speed input and the VTOL gate. Inferred proxy. */
  readonly speed: number;
}

/** One baked engine rate-step: the file to play and the anchor rate it was baked at (`1` = source pitch). */
export interface EngineStep {
  readonly file: string;
  /** Frame the baked loop resumes from (`0` = the whole buffer is already seamless). */
  readonly loopStartFrame: number;
  readonly rate: number;
  readonly step: number;
}

export interface ReverbParameters {
  readonly damping: number;
  readonly decaySeconds: number;
  readonly mix: number;
  readonly zone: ReverbZone;
}

export type ReverbZone = 'enclosed' | 'open-air' | 'urban';

/**
 * Crossfade the engine's accelerate and decelerate loops from throttle-vs-brake. `trend = throttle - brake`
 * maps to `u = (trend + 1) / 2`; `accelerate = smoothstep(u)`, `decelerate = 1 - accelerate`. The weights are
 * continuous (C1) and always sum to 1, and they meet at 0.5/0.5 for equal throttle and brake.
 */
export function crossfadeWeights(throttle: number, brake: number): CrossfadeWeights {
  const trend = clamp(finiteOr(throttle, 0), 0, 1) - clamp(finiteOr(brake, 0), 0, 1);
  const accelerate = smoothstep(clamp((trend + 1) / 2, 0, 1));

  return { accelerate, decelerate: 1 - accelerate };
}

// ---------------------------------------------------------------------------------------------
// Engine signals and pitch
// ---------------------------------------------------------------------------------------------

/** Recorder-labelled load fallback for pre-v9 rows: `clamp(max(abs(throttle), abs(brake)), 0, 1)`. */
export function deriveEngineLoad(row: Pick<FlightRow, 'brake' | 'throttle'>): number {
  return clamp(Math.max(Math.abs(finiteOr(row.throttle, 0)), Math.abs(finiteOr(row.brake, 0))), 0, 1);
}

/** Front/back weighting: 1 in front (`dot = 1`), `DIRECTIONAL_BACK_GAIN` directly behind (`dot = -1`). */
export function directionalGain(dotForward: number, backGain = DIRECTIONAL_BACK_GAIN): number {
  const t = (clamp(finiteOr(dotForward, 0), -1, 1) + 1) / 2;

  return clamp(backGain, 0, 1) + (1 - clamp(backGain, 0, 1)) * t;
}

/** Linear inverse-distance rolloff: 1 at/below the reference, 0 at/beyond the max, monotonic between. */
export function distanceAttenuation(
  distance: number,
  reference = ATTENUATION_REF_DISTANCE,
  maximum = ATTENUATION_MAX_DISTANCE,
): number {
  if (!Number.isFinite(distance)) {
    return 0;
  }
  if (distance <= reference) {
    return 1;
  }
  if (distance >= maximum || maximum <= reference) {
    return 0;
  }

  return clamp(1 - (distance - reference) / (maximum - reference), 0, 1);
}

/**
 * Doppler factor for `dirToListener` (unit, source -> listener). `closing = (sourceVel - listenerVel) . dir`;
 * closing > 0 (approaching) gives a factor > 1, closing < 0 (receding) gives < 1, and rest gives exactly 1.
 * GTA caps the radial component to 35 m/s before applying the speed-of-sound denominator.
 */
export function dopplerFactor(sourceVelocity: Vec3, listenerVelocity: Vec3, dirToListener: Vec3): number {
  const closing = dot(sub(sourceVelocity, listenerVelocity), normalize(dirToListener));
  const denominator = SPEED_OF_SOUND - clamp(closing, -MAX_DOPPLER_RADIAL_MPS, MAX_DOPPLER_RADIAL_MPS);
  const factor = SPEED_OF_SOUND / denominator;
  if (!Number.isFinite(factor)) {
    return 1;
  }

  return clamp(factor, DOPPLER_MIN, DOPPLER_MAX);
}

/** Linear playbackRate ramp over the proxy. Strictly monotonic on `[0,1]`. */
export function enginePitchRate(normalizedSpeed: number): number {
  return ENGINE_RATE_MIN + (ENGINE_RATE_MAX - ENGINE_RATE_MIN) * clamp(finiteOr(normalizedSpeed, 0), 0, 1);
}

// ---------------------------------------------------------------------------------------------
// Accelerate/decelerate crossfade
// ---------------------------------------------------------------------------------------------

/** Inferred engine-speed proxy: `clamp((gear + load) / (MAX_GEAR + 1), 0, 1)`, monotonically increasing. */
export function engineSpeedNormalized(gear: number, load: number): number {
  return clamp((clamp(finiteOr(gear, 0), 0, MAX_GEAR) + clamp(finiteOr(load, 0), 0, 1)) / (MAX_GEAR + 1), 0, 1);
}

/** The exact documented explosion frequency cycle, indexed by explosion ordinal. */
export function explosionRateForOrdinal(ordinal: number): number {
  const index =
    ((Math.floor(finiteOr(ordinal, 0)) % EXPLOSION_FREQUENCY_CYCLE.length) + EXPLOSION_FREQUENCY_CYCLE.length) %
    EXPLOSION_FREQUENCY_CYCLE.length;

  return EXPLOSION_FREQUENCY_CYCLE[index];
}

/** FNV-1a 32-bit hash — deterministic and platform-independent (no Math.random). */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  return hash >>> 0;
}

// ---------------------------------------------------------------------------------------------
// Deterministic randomness
// ---------------------------------------------------------------------------------------------

/** Inferred impact -> strength in `[0,1]`; a missing impact yields the documented default 0. */
export function impactStrength(impact: null | number | undefined): number {
  return clamp(finiteOr(impact, 0) / COLLISION_IMPACT_REFERENCE, 0, 1);
}

/** Stereo pan in `[-1,1]` from the direction (listener -> source) against the listener's right axis. */
export function panForDirection(direction: Vec3, listener: AudioListener): number {
  const right = normalize(cross(listener.forward, listener.up));

  return clamp(dot(normalize(direction), right), -1, 1);
}

/** Bounded one-shot pitch jitter `1 +/- PITCH_VARIANCE`, deterministic in the seed. */
export function seededPitchVariance(seed: number): number {
  return 1 + (seededUnit(seed) * 2 - 1) * PITCH_VARIANCE;
}

/** Seed-based member selection with the same no-repeat rule; used for the explosion set. */
export function seededSetIndex(seed: number, previousIndex: number, count: number): number {
  const safeCount = Math.max(1, Math.floor(finiteOr(count, 1)));
  if (safeCount <= 1) {
    return 0;
  }
  const base = (seed >>> 0) % safeCount;

  return base === previousIndex ? (base + 1) % safeCount : base;
}

// ---------------------------------------------------------------------------------------------
// Collision / explosion selection
// ---------------------------------------------------------------------------------------------

/** mulberry32 — a small deterministic PRNG returning `[0,1)`. */
export function seededUnit(seed: number): number {
  let state = seed >>> 0;
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Selection seed for one event: `(recording id, event id)`, so seek and export pick identically. */
export function seedForEvent(recordingId: string, eventId: string): number {
  return hashSeed(`${recordingId}\u0000${eventId}`);
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

// ---------------------------------------------------------------------------------------------
// Spatialisation
// ---------------------------------------------------------------------------------------------

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function engineSignals(row: FlightRow, speed: number): EngineSignals {
  const safeSpeed = clamp(finiteOr(speed, 0), 0, ENGINE_SPEED_MAX_MPS);
  // The plane's recorded m_BrakePedal is a reverse-power control on the user's install:
  // W -> 0, released -> 0.5, S -> 1, while m_GasPedal stays zero. Keep the raw CSV untouched.
  // This is an inferred AUDIO control, not a measured engine load or a verified game struct offset.
  const planePower = clamp(Math.max(finiteOr(row.throttle, 0), 1 - finiteOr(row.brake, 0.5)), 0, 1);
  if (row.model === 520 || row.model === 476) {
    const gear = clamp(
      finiteOr(row.transmissionGearInferred, Math.round((safeSpeed / ENGINE_SPEED_REFERENCE_MPS) * MAX_GEAR)),
      0,
      MAX_GEAR,
    );

    return {
      gear,
      load: planePower,
      normalizedSpeed: engineSpeedNormalized(gear, planePower),
      rev: null,
      rotorAirspeed: safeSpeed,
      source: 'derived',
      speed: safeSpeed,
    };
  }
  const gearColumn = row.transmissionGearInferred;
  const loadColumn = row.engineLoadInferred;
  if (gearColumn !== null || loadColumn !== null) {
    const gear = clamp(finiteOr(gearColumn, 0), 0, MAX_GEAR);
    const load = clamp(finiteOr(loadColumn, deriveEngineLoad(row)), 0, 1);

    return {
      gear,
      load,
      normalizedSpeed: engineSpeedNormalized(gear, load),
      rev: null,
      rotorAirspeed: safeSpeed,
      source: 'recorded',
      speed: safeSpeed,
    };
  }
  // Pre-v9: no gear/load columns exist. Derive an INFERRED proxy from the measured-position speed plus the
  // recorded throttle/brake, instead of defaulting both to 0 (which pinned the pitch at the old 0.55 floor).
  const speedProxy = clamp(safeSpeed / ENGINE_SPEED_REFERENCE_MPS, 0, 1);
  const load = clamp(Math.max(speedProxy, deriveEngineLoad(row)), 0, 1);
  const gear = clamp(Math.round(speedProxy * MAX_GEAR), 0, MAX_GEAR);

  return {
    gear,
    load,
    normalizedSpeed: engineSpeedNormalized(gear, load),
    rev: null,
    rotorAirspeed: safeSpeed,
    source: 'derived',
    speed: safeSpeed,
  };
}

/** A finite number, or the caller's documented default when the signal is absent/non-finite. */
function finiteOr(value: null | number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function length(v: Vec3): number {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalize(v: Vec3): Vec3 {
  const n = length(v);
  if (n < 1e-9) {
    return [0, 0, 0];
  }

  return [v[0] / n, v[1] / n, v[2] / n];
}

// ---------------------------------------------------------------------------------------------
// Reverb / zone
// ---------------------------------------------------------------------------------------------

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

const REVERB_TABLE: Record<ReverbZone, Omit<ReverbParameters, 'zone'>> = {
  enclosed: { damping: 0.3, decaySeconds: 1.8, mix: 0.6 },
  'open-air': { damping: 0.8, decaySeconds: 0.5, mix: 0.1 },
  urban: { damping: 0.5, decaySeconds: 1.1, mix: 0.35 },
};

/** One `(sample, playbackRate, gain, pan)` command. `gain` and `playbackRate` are finite and non-negative. */
export interface AudioCue {
  /** The manifest file this cue resolves to; `''` when the manifest has no such sample (documented silence). */
  readonly file: string;
  readonly gain: number;
  readonly pan: number;
  readonly playbackRate: number;
  readonly sample: SampleCategory;
  readonly soundIndex: number;
}

export interface AudioEngineOptions {
  /** Seconds per sample frame; events in `[s, s + window)` trigger. Default {@link AUDIO_EVENT_WINDOW}. */
  readonly eventWindow?: number;
  /** Optional user mix; absent preserves the current inferred baseline. */
  readonly tuning?: AudioMixTuning;
}

export interface AudioFrame {
  readonly engine: EngineCue | null;
  readonly events: readonly EventCue[];
  readonly reverb: ReverbParameters;
  readonly s: number;
  readonly signals: EngineSignals;
}

// ---------------------------------------------------------------------------------------------
// Cues, frames and the timeline
// ---------------------------------------------------------------------------------------------

export interface AudioTimeline {
  readonly duration: number;
  /** True when at least one engine voice could be resolved for the track's model. */
  readonly engineAvailable: boolean;
  /** The engine bank name the track's model plays (`''` when the manifest cannot serve the model). */
  readonly engineBank: string;
  /** The model the timeline's engine bank was selected for (from the track's rows). */
  readonly engineModel: number;
  readonly events: readonly TimelineEvent[];
  readonly frameAt: (s: number, listener?: AudioListener) => AudioFrame;
  readonly recordingId: string;
}

export interface EngineCue {
  /** Back-compat alias of the `accelerate` layer when one exists, else the first layer. */
  readonly accelerate: EngineVoiceCue;
  /** Back-compat alias of the `decelerate` layer when one exists, else the second layer. */
  readonly decelerate: EngineVoiceCue;
  /** The bank name selected for the model (baked provenance), or `''`. */
  readonly engineBank: string;
  /** Every layer actually mixed for this model (jet: front/rear/turbine/distance; prop: front/rear/near/distant). */
  readonly layers: readonly EngineVoiceCue[];
  readonly pitch: number;
  readonly playbackRate: number;
  readonly signals: EngineSignals;
}

/** One baked rate-step layer of an engine voice: which file to play and how strongly it is mixed in. */
export interface EngineLayerCue {
  readonly file: string;
  readonly playbackRate: number;
  readonly weight: number;
}

/**
 * One engine layer (a jet's front/rear/turbine/distance, or a prop's front/rear/near/distant). `playbackRate` is
 * the layer's effective rate (for stats and back-compat); `layers` is the rate-step table actually mixed — the
 * two neighbours of the target rate.
 */
export interface EngineVoiceCue {
  readonly gain: number;
  readonly layers: readonly EngineLayerCue[];
  readonly pan: number;
  readonly playbackRate: number;
  /** Gain of the 400–4000 Hz copy of Hydra THRUST; 0 for every other voice. Inferred EQ, not a new sample. */
  readonly presenceGain?: number;
  readonly presenceHighHz?: number;
  readonly presenceLowHz?: number;
  readonly role: string;
  readonly sample: SampleCategory;
}

export interface EventCue {
  readonly cue: AudioCue;
  readonly eventId: string;
  readonly kind: 'collision' | 'explosion';
}

/** A recorded event with its deterministic selection resolved once at `buildAudioTimeline` time. */
export interface TimelineEvent {
  readonly file: string;
  readonly id: string;
  readonly impact: null | number;
  readonly kind: 'collision' | 'explosion';
  readonly ordinal: number;
  readonly pos: Vec3;
  readonly s: number;
  readonly seed: number;
  readonly soundIndex: number;
  readonly strength: null | number;
  readonly variance: number;
}

/** Everything the frame loop needs to build the engine cue, resolved once per timeline (no per-frame filter). */
interface EngineContext {
  readonly engineBank: string;
  readonly engineModel: number;
  readonly layerSpecs: readonly EngineLayerSpec[];
}

/**
 * Build a deterministic timeline for one recording. The timeline holds no global state: building it twice
 * for the same track yields identical events, and building another track never changes this one.
 */
export function buildAudioTimeline(
  track: FlightTrack,
  manifest: AudioBankManifest,
  options: AudioEngineOptions = {},
): AudioTimeline {
  const eventWindow =
    Number.isFinite(options.eventWindow) && (options.eventWindow ?? 0) > 0
      ? (options.eventWindow as number)
      : AUDIO_EVENT_WINDOW;
  const events = resolveEvents(track, manifest);
  const engineModel = finiteOr(track.model, 0);
  const layerSpecs = engineLayerSpecsForModel(manifest, engineModel);
  const engineContext: EngineContext = {
    engineBank: engineBankForModel(manifest, engineModel),
    engineModel,
    layerSpecs,
  };
  const engineAvailable = layerSpecs.length > 0;
  const rowSpeeds = derivedRowSpeeds(track);
  const engineSpeeds = smoothedEngineSpeeds(track, rowSpeeds);
  const jetPowers = engineModel === 520 ? smoothedJetPowers(track, 0.12, 0.25) : null;
  const jetFrontRearLevels = engineModel === 520 ? smoothedJetPowers(track, 0.8, 1) : null;
  const jetThrustPowers = engineModel === 520 ? smoothedJetPowers(track, 0.6, 0.6) : null;
  const rotorSpeeds = engineModel === 476 ? inferRotorAirspeed(track, rowSpeeds) : rowSpeeds;
  const propFrequencies = engineModel === 476 ? smoothedPropFrequencies(track, rowSpeeds) : null;
  const propDropouts = engineModel === 476 ? inferPropDropouts(track, rowSpeeds) : [];

  const frameAt = (s: number, listener?: AudioListener): AudioFrame => {
    const pose = sampleTrack(track, s);
    const speed = speedAt(track, rowSpeeds, s);
    const rawSignals = engineSignals(pose.row, speed);
    const signals: EngineSignals = {
      ...rawSignals,
      normalizedSpeed: speedAt(track, engineSpeeds, s),
      rotorAirspeed: speedAt(track, rotorSpeeds, s),
    };
    const active = listener ?? listenerFromPose(pose);
    const triggered: EventCue[] = [];
    for (const event of events) {
      if (event.s >= s && event.s < s + eventWindow) {
        triggered.push(eventCue(event, active));
      }
    }

    return {
      engine: engineAvailable
        ? engineCue(
            pose.row,
            signals,
            active,
            engineContext,
            propDropoutGain(propDropouts, s),
            propFrequencies ? speedAt(track, propFrequencies, s) : 1,
            jetPowers ? speedAt(track, jetPowers, s) : signals.load,
            jetFrontRearLevels ? speedAt(track, jetFrontRearLevels, s) : signals.load,
            jetThrustPowers ? speedAt(track, jetThrustPowers, s) : signals.load,
            options.tuning,
          )
        : null,
      events: triggered,
      // The first-person Hydra reference does not justify an added outdoor tail; the modeled 10% send
      // made its sustained engine sound reverberant. Keep the prop path unchanged.
      reverb: engineModel === 520 ? { ...reverbForZone('open-air'), mix: 0 } : reverbForZone('open-air'),
      s,
      signals,
    };
  };

  return {
    duration: track.duration,
    engineAvailable,
    engineBank: engineContext.engineBank,
    engineModel,
    events,
    frameAt,
    recordingId: track.name,
  };
}

export function reverbForPosition(pos: Vec3): ReverbParameters {
  return reverbForZone(zoneForPosition(pos));
}

export function reverbForZone(zone: ReverbZone): ReverbParameters {
  return { zone, ...REVERB_TABLE[zone] };
}

/** Altitude-only zone default; an `enclosed` zone is supplied by the caller when a hangar/interior is known. */
export function zoneForPosition(pos: Vec3): ReverbZone {
  return finiteOr(pos[2], 0) >= REVERB_OPEN_AIR_ALTITUDE ? 'open-air' : 'urban';
}

/** Relative per-layer response from gta-reversed SoundAttenuationTable.h, normalized at a 20m chase view. */
function aircraftLayerDistance(distance: number, role: EngineLayerRole): number {
  const rolloff = AIRCRAFT_ROLLOFF[role];
  const attenuationDb = (scaled: number): number => {
    const anchors = [
      [5, 0],
      [10, -14.57],
      [20, -30.82],
      [40, -49.1],
      [80, -69.79],
      [128, -84.29],
    ];
    if (scaled <= 5) {
      return 0;
    }
    if (scaled >= 128) {
      return -100;
    }
    for (let i = 1; i < anchors.length; i += 1) {
      const [end, endDb] = anchors[i];
      if (scaled < end) {
        const [start, startDb] = anchors[i - 1];

        return startDb + (endDb - startDb) * ((scaled - start) / (end - start));
      }
    }

    return -100;
  };

  return clamp(10 ** ((attenuationDb(distance / rolloff) - attenuationDb(20 / rolloff)) / 20), 0, 1.5);
}

/**
 * Per-row measured-position airspeed (m/s, central difference, clamped against teleport spikes). This is the
 * signal the pre-v9 derived engine path reads: the recorder's `vx/vy/vz` columns are unusable on some v8
 * recordings (they read ~0 while the aircraft crosses the map), but position is always measured.
 */
function derivedRowSpeeds(track: FlightTrack): Float64Array {
  const rows = track.rows;
  const speeds = new Float64Array(rows.length);
  for (let index = 0; index < rows.length; index += 1) {
    const previous = rows[Math.max(0, index - 1)];
    const next = rows[Math.min(rows.length - 1, index + 1)];
    const dt = Math.max(1e-3, next.s - previous.s);
    const distance = Math.hypot(
      next.pos[0] - previous.pos[0],
      next.pos[1] - previous.pos[1],
      next.pos[2] - previous.pos[2],
    );
    speeds[index] = clamp(distance / dt, 0, ENGINE_SPEED_MAX_MPS);
  }

  return speeds;
}

function emptyEngineVoice(pan: number, playbackRate: number): EngineVoiceCue {
  return { gain: 0, layers: [], pan, playbackRate, role: 'none', sample: 'engine-accelerate' };
}

function engineCue(
  row: FlightRow,
  signals: EngineSignals,
  listener: AudioListener,
  context: EngineContext,
  propDropout: number,
  propFrequency: number,
  jetPower: number,
  jetFrontRearLevel: number,
  jetThrustPower: number,
  tuning?: AudioMixTuning,
): EngineCue {
  const health = finiteOr(row.health, 1000);
  // gta-reversed ProcessPropOrJetStall: these bands are shared by player prop and jet entry points.
  const damage =
    health >= 650
      ? { frequency: 1, volume: 1 }
      : health >= 460
        ? { frequency: 0.95, volume: 10 ** (-6 / 20) }
        : health >= 390
          ? { frequency: 0.9, volume: 10 ** (-9 / 20) }
          : health >= 250
            ? { frequency: 0.85, volume: 10 ** (-12 / 20) }
            : { frequency: 0.8, volume: 10 ** (-18 / 20) };
  // The local game code varies HARRIER_FRONT/REAR pitch. W contributes +0.1 there; the recorded brake
  // column and airspeed correction here are inferred proxies because the true audio inputs were not recorded.
  const jetPitch =
    1 + JET_FRONT_REAR_POWER_RATE * jetPower + JET_FRONT_REAR_AIRSPEED_RATE * clamp(signals.speed / 100, 0, 1);
  const pitch =
    (context.engineModel === 520
      ? jetPitch
      : context.engineModel === 476
        ? propFrequency
        : enginePitchRate(signals.normalizedSpeed)) * damage.frequency;
  const weights =
    row.model === 520 || row.model === 476
      ? crossfadeWeights(signals.load, 1 - signals.load)
      : crossfadeWeights(row.throttle, row.brake);
  const toListener = sub(listener.pos, row.pos);
  const distance = length(toListener);
  const radial = dopplerFactor(row.velocity, listener.velocity, normalize(toListener));
  const playbackRate = clamp(pitch * radial, ENGINE_RATE_MIN * DOPPLER_MIN, ENGINE_RATE_MAX * DOPPLER_MAX);
  // gta-reversed player props derive their loop level from actual prop speed, which remains high in flight;
  // the recording lacks m_fPropSpeed, so let airspeed hold the inferred rotor up instead of hard-switching
  // full-volume banks on every W/S edge. Low-speed controls still respond immediately.
  const propAirspeed = clamp(signals.rotorAirspeed / 40, 0, 1);
  const propSpeed = clamp(0.5 + 0.5 * propAirspeed + 0.1 * (signals.load - 0.5) * (1 - propAirspeed), 0, 1);
  const propFactor = propSpeed <= 0.15 ? propSpeed * 2 : 0.3 + (propSpeed - 0.15) * (0.7 / 0.85);
  const effectiveLoad =
    context.engineModel === 476
      ? 0.5 + (signals.load - 0.5) * (1 - clamp(signals.rotorAirspeed / 30, 0, 1))
      : signals.load;
  // Keep the accepted full-W jet level. Previously the >=40 m/s main-loop gain was the same for W,
  // released and S, making high-speed throttle almost inaudible. Infer a bounded gain reduction for
  // released/S, using the already-smoothed jet power at speed to avoid abrupt loop-level steps.
  const jetCruiseBlend = smoothstep(clamp((signals.speed - 25) / 35, 0, 1));
  const jetGainPower = effectiveLoad * (1 - jetCruiseBlend) + jetPower * jetCruiseBlend;
  const jetGainDepth = 0.4 * (1 - clamp(signals.speed / 40, 0, 1)) + 0.45 * jetCruiseBlend;
  const gainLoad =
    context.engineModel === 520
      ? 0.75 + (jetGainPower - 1) * jetGainDepth * (tuning?.powerDynamics ?? 1)
      : effectiveLoad;
  const loadGain = ENGINE_GAIN_MIN + (ENGINE_GAIN_MAX - ENGINE_GAIN_MIN) * gainLoad;
  const directionDot = distance > 1e-6 ? dot(normalize(sub(row.pos, listener.pos)), normalize(listener.forward)) : 1;
  const spatial = distanceAttenuation(distance) * directionalGain(directionDot);
  const pan = panForDirection(sub(row.pos, listener.pos), listener);
  const base = clamp(loadGain * spatial * damage.volume * propDropout, 0, 1);
  // The reference's 123 Hz THRUST ridge grows about 4 dB during the first sustained W run, even though
  // the note stays fixed. This measured-position airspeed correction is an inferred amplitude proxy.
  const jetTurbineGain =
    0.225 *
    10 ** ((-28 * (1 - jetThrustPower)) / 20) *
    (1 + 0.7 * clamp(signals.speed / 75, 0, 1) * smoothstep(clamp((jetThrustPower - 0.5) * 2, 0, 1)));
  // The original front/rear levels change with flight state. Their exact formula and audio tick are absent
  // from the recording, so use a bounded slow ramp instead of the disproven WHINE-only envelope.
  const jetFrontRearEnvelope =
    (1 - 0.3 * (1 - jetFrontRearLevel) * (1 - clamp(signals.speed / 40, 0, 1))) *
    (0.55 + 0.45 * clamp(signals.speed / 35, 0, 1));
  const cameraPov =
    distance > 1e-6 ? (dot(normalize(sub(row.pos, listener.pos)), normalize(row.forward)) + 1) / 2 : 0.5;
  const pitchScale = tuning?.pitch ?? 1;
  const layers = context.layerSpecs.map(
    (spec): EngineVoiceCue => ({
      gain: clamp(
        base *
          spec.mix *
          engineLayerWeight(spec.role, weights, propFactor, cameraPov, distance, context.engineModel, tuning) *
          (tuning?.master ?? 1) *
          tuningLayerGain(spec.role, tuning) *
          (context.engineModel === 520 ? 10 ** (-spec.headroomDb / 20) : 1) *
          (context.engineModel === 520 && spec.role === 'turbine'
            ? jetTurbineGain
            : context.engineModel === 520 && (spec.role === 'front' || spec.role === 'rear')
              ? jetFrontRearEnvelope
              : 1) *
          aircraftLayerDistance(distance, spec.role),
        0,
        1,
      ),
      layers: engineLayers(
        spec.steps,
        spec.role === 'near' || spec.role === 'prop-distance'
          ? 1
          : context.engineModel === 520 && spec.role !== 'front' && spec.role !== 'rear'
            ? damage.frequency
            : pitch,
        radial,
        context.engineModel === 476 || context.engineModel === 520,
      ).map((layer) => ({
        ...layer,
        playbackRate: layer.playbackRate * pitchScale * tuningLayerPitch(spec.role, tuning),
      })),
      pan,
      playbackRate: playbackRate * pitchScale,
      presenceGain:
        context.engineModel === 520 && spec.role === 'turbine' ? (tuning?.presence ?? JET_THRUST_PRESENCE_GAIN) : 0,
      presenceHighHz: tuning?.presenceHighHz ?? JET_THRUST_PRESENCE_HIGH_HZ,
      presenceLowHz: tuning?.presenceLowHz ?? JET_THRUST_PRESENCE_LOW_HZ,
      role: spec.role,
      sample: ENGINE_ROLE_SAMPLE[spec.role],
    }),
  );
  const accelerate = layers.find((layer) => layer.role === 'accelerate') ?? layers[0];
  const decelerate = layers.find((layer) => layer.role === 'decelerate') ?? layers[1] ?? layers[0];
  const fallback = emptyEngineVoice(pan, playbackRate * pitchScale);

  return {
    accelerate: accelerate ?? fallback,
    decelerate: decelerate ?? fallback,
    engineBank: context.engineBank,
    layers,
    pitch: pitch * pitchScale,
    playbackRate: playbackRate * pitchScale,
    signals,
  };
}

/**
 * Aircraft select one original rate-1 loop and vary its playback rate. Crossfading two resamples of the
 * same short loop introduces phase beating; legacy manifests still use the baked rate-step crossfade.
 */
function engineLayers(
  steps: readonly EngineStep[],
  targetRate: number,
  radial: number,
  singleSource = false,
): EngineLayerCue[] {
  if (steps.length === 0) {
    return [];
  }
  const layerRate = (step: EngineStep): number =>
    clamp((targetRate / step.rate) * radial, ENGINE_LAYER_RATE_MIN, ENGINE_LAYER_RATE_MAX);
  // The original player prop varies the frequency of ONE front and ONE rear sample. Crossfading multiple
  // resamples of that same loop makes phase beats and exposes its repetition at sustained full power.
  if (singleSource) {
    const originalRate = steps.find((step) => step.rate === 1) ?? steps[0];

    return [{ file: originalRate.file, playbackRate: layerRate(originalRate), weight: 1 }];
  }
  if (steps.length === 1) {
    return [{ file: steps[0].file, playbackRate: layerRate(steps[0]), weight: 1 }];
  }
  let lower = 0;
  while (lower < steps.length - 2 && (steps[lower + 1]?.rate ?? 0) <= targetRate) {
    lower += 1;
  }
  const first = steps[lower] ?? steps[0];
  const second = steps[lower + 1] ?? steps[steps.length - 1];
  const span = second.rate - first.rate;
  const t = span > 0 ? clamp((targetRate - first.rate) / span, 0, 1) : 0;

  return [
    { file: first.file, playbackRate: layerRate(first), weight: 1 - t },
    { file: second.file, playbackRate: layerRate(second), weight: t },
  ];
}

/**
 * The per-layer mix multiplier (INFERRED tuning, never a measured level). Hydra front/rear use their own
 * control envelope; Rustler keeps its existing prop-speed and listener-position response.
 */
function engineLayerWeight(
  role: EngineLayerRole,
  weights: CrossfadeWeights,
  propFactor: number,
  cameraPov: number,
  distance: number,
  engineModel: number,
  tuning?: AudioMixTuning,
): number {
  switch (role) {
    case 'accelerate':
      return weights.accelerate;
    case 'decelerate':
      return weights.decelerate;
    case 'distance':
      // The v9 reference stays in first person: the distant jet loop has no clear self-listener ridge.
      return Math.max(smoothstep(clamp((distance - 4) / 16, 0, 1)), tuning?.jetDistance ?? 0);
    case 'front':
      return engineModel === 520 ? 1 : propFactor * (1 - 0.25 * cameraPov);
    case 'near':
      return propFactor;
    case 'prop-distance':
      return distance > 48 ? propFactor : 0;
    case 'rear':
      return engineModel === 520 ? 1 : propFactor * (0.5 + 0.5 * cameraPov);
    case 'turbine':
      return 1;
  }
}

function eventCue(event: TimelineEvent, listener: AudioListener): EventCue {
  const toSource = sub(event.pos, listener.pos);
  const distance = length(toSource);
  const direction = normalize(toSource);
  const directionDot = distance > 1e-6 ? dot(direction, normalize(listener.forward)) : 1;
  const spatial = distanceAttenuation(distance) * directionalGain(directionDot);
  const pan = panForDirection(direction, listener);
  const radial = dopplerFactor([0, 0, 0], listener.velocity, normalize(sub(listener.pos, event.pos)));
  if (event.kind === 'explosion') {
    return {
      cue: {
        file: event.file,
        gain: clamp(EXPLOSION_GAIN * spatial, 0, 1),
        pan,
        playbackRate: clamp(explosionRateForOrdinal(event.ordinal) * radial, DOPPLER_MIN, DOPPLER_MAX),
        sample: 'explosion',
        soundIndex: event.soundIndex,
      },
      eventId: event.id,
      kind: 'explosion',
    };
  }

  return {
    cue: {
      file: event.file,
      gain: clamp(COLLISION_GAIN * (0.25 + 0.75 * (event.strength ?? 0)) * spatial, 0, 1),
      pan,
      playbackRate: clamp(event.variance * radial, DOPPLER_MIN, DOPPLER_MAX),
      sample: 'collision',
      soundIndex: event.soundIndex,
    },
    eventId: event.id,
    kind: 'collision',
  };
}

/** Inferred low-speed rotor dropouts; anchored to the two measured 120/130ms gaps at 34.49–34.79s in the
 * user's Rustler QPC-aligned WAV. Actual m_fPropSpeed is not recorded, so this is not a measured stall flag. */
function inferPropDropouts(track: FlightTrack, speeds: Float64Array): number[] {
  const starts: number[] = [];
  const threshold = 21.5;
  for (let i = 1; i < speeds.length; i++) {
    const a = speeds[i - 1];
    const b = speeds[i];
    if (
      a <= threshold ||
      b > threshold ||
      b >= a ||
      track.rows[i].health < 650 ||
      track.rows[i].brake < 0.4 ||
      track.rows[i].brake > 0.6
    )
      continue;
    if (starts.length && track.rows[i].s - starts[starts.length - 1] < 4) continue;
    let flewFast = false;
    for (let j = i - 1; j >= 0 && track.rows[i].s - track.rows[j].s < 5; j--) {
      if (speeds[j] > 30) {
        flewFast = true;
        break;
      }
    }
    if (!flewFast) continue;
    starts.push(track.rows[i - 1].s + (track.rows[i].s - track.rows[i - 1].s) * ((a - threshold) / (a - b)) + 0.06);
  }

  return starts;
}

/** The original prop engine reads m_fPropSpeed, absent from CSV. Keep windmilling after the aircraft slows;
 * a 10s release approximates the measured 34–37s Rustler landing response without affecting take-off. */
function inferRotorAirspeed(track: FlightTrack, speeds: Float64Array): Float64Array {
  const result = new Float64Array(speeds.length);
  for (let index = 0; index < speeds.length; index++) {
    const previous = index > 0 ? result[index - 1] : 0;
    const dt = index > 0 ? clamp(track.rows[index].s - track.rows[index - 1].s, 0, 0.2) : 0;
    result[index] = Math.max(speeds[index], previous * Math.exp(-dt / 10));
  }

  return result;
}

function listenerFromPose(pose: SampledPose): AudioListener {
  return {
    forward: rotateVec(pose.orientation, [0, 1, 0]),
    pos: pose.pos,
    up: rotateVec(pose.orientation, [0, 0, 1]),
    velocity: pose.velocity,
  };
}

function propDropoutGain(starts: readonly number[], s: number): number {
  for (const start of starts) {
    for (const [offset, duration, depth] of [
      [0, 0.12, 0.75],
      [0.13, 0.13, 0.75],
    ]) {
      const phase = s - start - offset;
      if (phase < 0 || phase >= duration) continue;
      const envelope = Math.min(1, phase / 0.01, (duration - phase) / 0.01);

      return 1 - depth * envelope;
    }
  }

  return 1;
}

/** Resolve every event's selection once, seeded by `(recording id, event id)`. No cross-recording state. */
function resolveEvents(track: FlightTrack, manifest: AudioBankManifest): TimelineEvent[] {
  const sorted: readonly FlightEvent[] = [...track.events].sort((a, b) => a.s - b.s);
  const collisionSamples = manifest.samples.filter((sample) => sample.category === MANIFEST_CATEGORY.collision);
  const explosionCount = setCountFor(manifest, 'explosion');
  const explosionFile = sampleForCategory(manifest, 'explosion')?.file ?? '';
  let previousCollision = -1;
  let previousExplosion = -1;
  let collisionOrdinal = 0;
  let explosionOrdinal = 0;

  return sorted.map((event, index): TimelineEvent => {
    const id = `${event.kind}#${index}`;
    const seed = seedForEvent(track.name, id);
    if (event.kind === 'collision') {
      const strength = impactStrength(event.impact);
      // A GENRL bank has many unrelated materials. Choose only actual CAR-surface files in the manifest;
      // the v9 event has no measured contact surface, so it must not claim one from its impact magnitude.
      const choice = collisionSamples.length > 0 ? seededSetIndex(seed, previousCollision, collisionSamples.length) : 0;
      previousCollision = choice;
      const selected = collisionSamples[choice];

      return {
        file: selected?.file ?? '',
        id,
        impact: typeof event.impact === 'number' && Number.isFinite(event.impact) ? event.impact : null,
        kind: 'collision',
        ordinal: collisionOrdinal++,
        pos: event.pos,
        s: event.s,
        seed,
        soundIndex: selected?.soundIndex ?? 0,
        strength,
        variance: seededPitchVariance(seed),
      };
    }
    const soundIndex = seededSetIndex(seed, previousExplosion, explosionCount);
    previousExplosion = soundIndex;

    return {
      file: explosionFile,
      id,
      impact: null,
      kind: 'explosion',
      ordinal: explosionOrdinal++,
      pos: event.pos,
      s: event.s,
      seed,
      soundIndex,
      strength: null,
      variance: 1,
    };
  });
}

function setCountFor(manifest: AudioBankManifest, category: SampleCategory): number {
  const sample = sampleForCategory(manifest, category);

  return sample ? Math.max(1, Math.floor(sample.setSoundCount)) : 1;
}

/** Deterministic spool inertia at the recorder's sample times; faster rise than fall, independent of render FPS. */
function smoothedEngineSpeeds(track: FlightTrack, speeds: Float64Array): Float64Array {
  const result = new Float64Array(track.rows.length);
  for (let index = 0; index < track.rows.length; index += 1) {
    const row = track.rows[index];
    const target = engineSignals(row, speeds[index] ?? 0).normalizedSpeed;
    if (index === 0) {
      result[index] = target;
      continue;
    }
    const previous = result[index - 1];
    const dt = clamp(row.s - track.rows[index - 1].s, 0, 0.2);
    const timeConstant = target > previous ? 0.18 : 0.45;
    result[index] = previous + (target - previous) * (1 - Math.exp(-dt / timeConstant));
  }

  return result;
}

/** Inferred Hydra spool control from the v9 W/released/S proxy; no engine RPM is recorded. */
function smoothedJetPowers(track: FlightTrack, riseSeconds: number, fallSeconds: number): Float64Array {
  const result = new Float64Array(track.rows.length);
  for (let index = 0; index < track.rows.length; index += 1) {
    const row = track.rows[index];
    const target = engineSignals(row, 0).load;
    if (index === 0) {
      result[index] = target;
      continue;
    }
    const previous = result[index - 1];
    const dt = clamp(row.s - track.rows[index - 1].s, 0, 0.2);
    const timeConstant = target > previous ? riseSeconds : fallSeconds;
    result[index] = previous + (target - previous) * (1 - Math.exp(-dt / timeConstant));
  }

  return result;
}

/**
 * Rustler player prop frequency from the public ProcessDummyOrPlayerProp / CalculatePlanePropFreq path.
 * Orientation is recorded; the W/released/S mapping and 60 Hz step conversion are inferred because pad
 * inputs and the game's actual audio tick are absent from the CSV.
 */
function smoothedPropFrequencies(track: FlightTrack, speeds: Float64Array): Float64Array {
  const result = new Float64Array(track.rows.length);
  for (let index = 0; index < track.rows.length; index += 1) {
    const row = track.rows[index];
    const load = engineSignals(row, speeds[index] ?? 0).load;
    const control = load > 0.75 ? 0.1 : load < 0.25 ? -0.05 : 0;
    const target = clamp(1 + Math.abs(row.right[2]) * 0.1 - row.forward[2] * 0.15 + control, 0.75, 1.3);
    if (index === 0) {
      result[index] = target;
      continue;
    }
    const previous = result[index - 1];
    const dt = clamp(row.s - track.rows[index - 1].s, 0, 0.2);
    result[index] = previous + clamp(target - previous, -dt * (60 / 187.5), dt * (60 / 187.5));
  }

  return result;
}

/** Linear interpolation of the per-row speeds at time `s` (same bracket search `sampleTrack` uses). */
function speedAt(track: FlightTrack, speeds: Float64Array, s: number): number {
  const rows = track.rows;
  const clamped = Math.min(Math.max(0, s), track.duration);
  if (clamped <= 0) {
    return speeds[0] ?? 0;
  }
  const last = rows.length - 1;
  if (clamped >= track.duration) {
    return speeds[last] ?? 0;
  }
  let lo = 0;
  let hi = last;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if ((rows[mid]?.s ?? 0) <= clamped) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const a = rows[lo];
  const b = rows[hi];
  const t = (clamped - (a?.s ?? 0)) / Math.max(1e-6, (b?.s ?? 0) - (a?.s ?? 0));
  const start = speeds[lo] ?? 0;
  const end = speeds[hi] ?? 0;

  return start + (end - start) * t;
}

/** Model-specific layer multipliers; the near jet candidate layers use their own zero-default controls. */
function tuningLayerGain(role: EngineLayerRole, tuning?: AudioMixTuning): number {
  if (!tuning) return 1;
  switch (role) {
    case 'front':
      return tuning.front;
    case 'near':
      return tuning.near;
    case 'prop-distance':
      return tuning.propDistance;
    case 'rear':
      return tuning.rear;
    case 'turbine':
      return tuning.turbine;
    default:
      return 1;
  }
}

function tuningLayerPitch(role: EngineLayerRole, tuning?: AudioMixTuning): number {
  if (!tuning) return 1;
  switch (role) {
    case 'distance':
      return tuning.jetDistancePitch;
    case 'front':
      return tuning.frontPitch;
    case 'near':
      return tuning.nearPitch;
    case 'prop-distance':
      return tuning.propDistancePitch;
    case 'rear':
      return tuning.rearPitch;
    case 'turbine':
      return tuning.turbinePitch;
    default:
      return 1;
  }
}
