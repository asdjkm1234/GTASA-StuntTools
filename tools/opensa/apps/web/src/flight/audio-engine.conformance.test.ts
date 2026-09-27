/**
 * Independent numeric conformance oracle for the replay audio core.
 *
 * It is deliberately NOT self-consistency: every expected value below is derived BY HAND from a documented
 * equation/constant and paired with its source, and compared against the implementation inside a stated
 * tolerance. The bank/slot expectations are the G4 evidence rows, hardcoded here rather than read back from
 * the manifest under test, so the test can disagree with the baker.
 *
 * No GTA sample bytes are used: the manifest is referenced for metadata only and the tracks are synthetic.
 *
 * Constant sources:
 * - engine pitch endpoints ENGINE_RATE_MIN/MAX and the linear ramp: this module's documented mapping (the G4
 *   engine loop is a single GENRL sample; the rate is applied to it). Rev/RPM is BLOCKED by G3.
 * - explosion frequency cycle {1.12, 1.0, 0.88} and the +/-6% one-shot variance: todo-17 plan (gta-reversed
 *   audio behaviour research).
 * - accelerate/decelerate crossfade: smoothstep over `throttle - brake`.
 * - attenuation / Doppler / reverb: the documented acoustic models in `audio-engine.ts`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { AudioBankManifest, AudioListener } from './audio-engine';
import type { FlightTrack } from './csv';

import {
  ATTENUATION_MAX_DISTANCE,
  ATTENUATION_REF_DISTANCE,
  buildAudioTimeline,
  collisionSoundIndex,
  crossfadeWeights,
  directionalGain,
  distanceAttenuation,
  dopplerFactor,
  ENGINE_RATE_MAX,
  ENGINE_RATE_MIN,
  engineBankForModel,
  engineLayerSpecsForModel,
  enginePitchRate,
  engineSpeedNormalized,
  engineStepsForModel,
  EXPLOSION_FREQUENCY_CYCLE,
  explosionRateForOrdinal,
  impactStrength,
  MANIFEST_CATEGORY,
  parseAudioManifest,
  PITCH_VARIANCE,
  sampleForCategory,
  seededPitchVariance,
  seedForEvent,
} from './audio-engine';
import { parseFlightCsv } from './csv';

/** Declared numeric tolerance for the fixed-vector traces (12 decimal places). */
const TOL = 1e-12;

const MANIFEST_PATH = new URL('../../../../map-pak/audio/manifest.json', import.meta.url);

/** A synthetic bank with the same shape/ids as the G4 mapping, but zero bytes (never a GTA sample). */
const SYNTHETIC_MANIFEST: AudioBankManifest = {
  samples: [
    {
      bankName: 'SND_BANK_GENRL_SINGLEPROP',
      category: 'engine accelerate',
      file: 'engine-accelerate.wav',
      globalBankId: 120,
      headroom: 0,
      loopStartFrame: 0,
      packageBankIndex: 113,
      pcmBytes: 0,
      sampleRateHz: 21950,
      setSoundCount: 2,
      slotId: 7,
      slotName: 'DUMMY_ENGINE_0',
      soundIndex: 0,
      wavBytes: 0,
      wavFrames: 32144,
    },
    {
      bankName: 'SND_BANK_GENRL_SINGLEPROP',
      category: 'engine decelerate',
      file: 'engine-decelerate.wav',
      globalBankId: 120,
      headroom: 0,
      loopStartFrame: 0,
      packageBankIndex: 113,
      pcmBytes: 0,
      sampleRateHz: 22050,
      setSoundCount: 2,
      slotId: 7,
      slotName: 'DUMMY_ENGINE_0',
      soundIndex: 1,
      wavBytes: 0,
      wavFrames: 32144,
    },
    {
      bankName: 'SND_BANK_GENRL_COLLISIONS',
      category: 'collision set',
      file: 'collision-set.wav',
      globalBankId: 39,
      headroom: 0,
      loopStartFrame: 0,
      packageBankIndex: 32,
      pcmBytes: 0,
      sampleRateHz: 16000,
      setSoundCount: 72,
      slotId: 2,
      slotName: 'COLLISIONS',
      soundIndex: 0,
      wavBytes: 0,
      wavFrames: 10612,
    },
    {
      bankName: 'SND_BANK_GENRL_EXPLOSIONS',
      category: 'explosion set',
      file: 'explosion-set.wav',
      globalBankId: 52,
      headroom: 0,
      loopStartFrame: 0,
      packageBankIndex: 45,
      pcmBytes: 0,
      sampleRateHz: 22050,
      setSoundCount: 5,
      slotId: 4,
      slotName: 'EXPLOSIONS',
      soundIndex: 0,
      wavBytes: 0,
      wavFrames: 36064,
    },
  ],
  source: 'synthetic (no GTA bytes)',
  version: 1,
};

const EMPTY_MANIFEST: AudioBankManifest = { samples: [], source: 'synthetic (no samples)', version: 1 };

/** A static, in-front-of-everything listener so direction/Doppler are known constants. */
const LISTENER: AudioListener = { forward: [0, 1, 0], pos: [0, 0, 0], up: [0, 0, 1], velocity: [0, 0, 0] };

/** Synthetic v9 recording. No game bytes: columns only. */
function makeTrack(name: string, eventLines: readonly string[] = []): FlightTrack {
  const header =
    'local_timestamp,capture_elapsed_s,model,health,x,y,z,throttle,brake,transmission_gear_inferred,engine_load_inferred';
  const text = [
    '# gtasa_flight_recorder,version=9,sample_hz=25',
    header,
    '2026-01-01T00:00:00.000,0,520,100,0,0,100,1,0,3,1',
    '2026-01-01T00:00:00.040,0.04,520,100,0,0,100,1,0,3,1',
    '2026-01-01T00:00:01.000,1.0,520,100,0,0,100,1,0,3,1',
    ...eventLines,
  ].join('\n');

  return parseFlightCsv(text, name);
}

const EVENTS = [
  '# event,0.5,explosion,0,0,100',
  '# event,0.7,explosion,0,0,100',
  '# event,0.8,explosion,0,0,100',
  '# event,0.9,collision,inferred,30,0,0,100',
  '# event,0.95,collision,inferred,50,0,0,100',
] as const;

describe('audio engine conformance oracle (negative cases first)', () => {
  it('engine load with a non-finite throttle/brake is the documented default 0, never NaN', () => {
    const load = impactStrength(Number.NaN);
    expect(load).toBe(0);
    expect(Number.isNaN(enginePitchRate(Number.NaN))).toBe(false);
    expect(enginePitchRate(Number.NaN)).toBe(ENGINE_RATE_MIN);
    expect(engineSpeedNormalized(Number.NaN, Number.NaN)).toBe(0);
  });

  it('collision impact missing/negative/non-finite maps to strength 0', () => {
    expect(impactStrength(null)).toBe(0);
    expect(impactStrength(undefined)).toBe(0);
    expect(impactStrength(Number.NaN)).toBe(0);
    expect(impactStrength(-5)).toBe(0);
  });

  it('distance attenuation of a non-finite distance yields the documented default 0', () => {
    expect(distanceAttenuation(Number.NaN)).toBe(0);
    expect(distanceAttenuation(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('collision selection of a degenerate set never throws or returns an out-of-range index', () => {
    expect(collisionSoundIndex(0.5, -1, 1)).toBe(0);
    expect(collisionSoundIndex(0.5, -1, 0)).toBe(0);
    expect(collisionSoundIndex(Number.NaN, -1, 72)).toBe(0);
  });

  it('a manifest without a category yields null, and a timeline built from it still gives finite cues', () => {
    expect(sampleForCategory(EMPTY_MANIFEST, 'collision')).toBeNull();
    const frame = buildAudioTimeline(makeTrack('empty', EVENTS), EMPTY_MANIFEST).frameAt(0.9, LISTENER);
    expect(frame.engine).toBeNull();
    expect(frame.events.length).toBeGreaterThan(0);
    for (const event of frame.events) {
      expect(Number.isFinite(event.cue.gain)).toBe(true);
      expect(Number.isFinite(event.cue.playbackRate)).toBe(true);
      expect(event.cue.soundIndex).toBe(0);
    }
  });

  it('parseAudioManifest rejects invalid JSON and malformed entries instead of returning NaN', () => {
    expect(() => parseAudioManifest('not json')).toThrow(/not valid JSON/);
    expect(() => parseAudioManifest('{"source":"x"}')).toThrow(/samples must be an array/);
    expect(() => parseAudioManifest('{"version":1,"source":"x","samples":[{"category":"collision set"}]}')).toThrow();
    expect(() =>
      parseAudioManifest(
        '{"version":1,"source":"x","samples":[{"bankName":"b","category":"c","file":"f","globalBankId":1,"headroom":0,"loopStartFrame":0,"packageBankIndex":1,"pcmBytes":0,"sampleRateHz":1,"setSoundCount":1,"slotId":1,"slotName":"s","soundIndex":0,"wavBytes":0,"wavFrames":Number.NaN}]}',
      ),
    ).toThrow();
  });

  it('one-shot pitch variance stays inside the documented +/-6% band', () => {
    for (let seed = 0; seed < 512; seed += 1) {
      const variance = seededPitchVariance(seed);
      expect(variance).toBeGreaterThanOrEqual(1 - PITCH_VARIANCE);
      expect(variance).toBeLessThanOrEqual(1 + PITCH_VARIANCE);
    }
  });

  it('a perturbed constant outside tolerance is detectable (the oracle is sensitive)', () => {
    const expected = ENGINE_RATE_MIN + (ENGINE_RATE_MAX - ENGINE_RATE_MIN) * (4 / 7);
    expect(enginePitchRate(engineSpeedNormalized(3, 1))).toBeCloseTo(expected, 12);
    expect(Math.abs(expected + 0.001 - expected)).toBeGreaterThan(TOL);
  });
});

describe('audio engine conformance oracle (positive cases)', () => {
  describe('engine pitch', () => {
    it('playbackRate is strictly monotonically increasing with the derived engine-speed proxy (rev BLOCKED)', () => {
      let previous = enginePitchRate(engineSpeedNormalized(0, 0));
      for (let step = 1; step <= 1000; step += 1) {
        const rate = enginePitchRate(step / 1000);
        expect(rate).toBeGreaterThan(previous);
        previous = rate;
      }
    });

    it('matches the hand-computed fixed vectors within tolerance', () => {
      expect(enginePitchRate(engineSpeedNormalized(0, 0))).toBeCloseTo(ENGINE_RATE_MIN, 12);
      // (3 + 1) / 7 = 4/7 -> MIN + (MAX - MIN) * 4/7
      expect(enginePitchRate(engineSpeedNormalized(3, 1))).toBeCloseTo(
        ENGINE_RATE_MIN + (ENGINE_RATE_MAX - ENGINE_RATE_MIN) * (4 / 7),
        12,
      );
      expect(enginePitchRate(engineSpeedNormalized(6, 1))).toBeCloseTo(ENGINE_RATE_MAX, 12);
    });
  });

  describe('accelerate/decelerate crossfade', () => {
    it('hits the documented endpoints and meets at 0.5', () => {
      expect(crossfadeWeights(1, 0).accelerate).toBeCloseTo(1, 12);
      expect(crossfadeWeights(1, 0).decelerate).toBeCloseTo(0, 12);
      expect(crossfadeWeights(0, 1).accelerate).toBeCloseTo(0, 12);
      expect(crossfadeWeights(0, 1).decelerate).toBeCloseTo(1, 12);
      expect(crossfadeWeights(0.5, 0.5).accelerate).toBeCloseTo(0.5, 12);
    });

    it('is continuous: weights sum to 1 and never jump by more than the smoothstep bound', () => {
      const steps = 200;
      let previous = crossfadeWeights(-1, 1).accelerate;
      for (let index = 1; index <= steps; index += 1) {
        const trend = -1 + (2 * index) / steps;
        const weights = crossfadeWeights(Math.max(trend, 0), Math.max(-trend, 0));
        expect(weights.accelerate + weights.decelerate).toBeCloseTo(1, 12);
        expect(Math.abs(weights.accelerate - previous)).toBeLessThan(0.02);
        previous = weights.accelerate;
      }
    });
  });

  describe('collision selection by inferred strength', () => {
    it('selects a higher set member for a higher strength', () => {
      expect(collisionSoundIndex(0, -1, 72)).toBe(0);
      expect(collisionSoundIndex(0.1, -1, 72)).toBe(7);
      expect(collisionSoundIndex(0.5, -1, 72)).toBe(35);
      expect(collisionSoundIndex(1, -1, 72)).toBe(71);
    });

    it('is monotonically non-decreasing across the strength range', () => {
      let previous = -1;
      for (let step = 0; step <= 100; step += 1) {
        const index = collisionSoundIndex(step / 100, -1, 72);
        expect(index).toBeGreaterThanOrEqual(previous);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(72);
        previous = index;
      }
    });

    it('does not repeat the previous member while an alternative exists', () => {
      expect(collisionSoundIndex(0.1, 7, 72)).toBe(8);
      expect(collisionSoundIndex(1, 71, 72)).toBe(0);
    });
  });

  describe('explosion frequency cycle', () => {
    it('is exactly {1.12, 1.0, 0.88} in order and then repeats', () => {
      expect(Array.from({ length: 6 }, (_, index) => explosionRateForOrdinal(index))).toEqual([
        1.12, 1, 0.88, 1.12, 1, 0.88,
      ]);
      expect(EXPLOSION_FREQUENCY_CYCLE).toEqual([1.12, 1, 0.88]);
      expect(explosionRateForOrdinal(0)).toBe(1.12);
      expect(explosionRateForOrdinal(1)).toBe(1);
      expect(explosionRateForOrdinal(2)).toBe(0.88);
    });
  });

  describe('deterministic selection', () => {
    it('derives the same seed for the same (recording id, event id) and differs across them', () => {
      expect(seedForEvent('rec', 'explosion#0')).toBe(seedForEvent('rec', 'explosion#0'));
      expect(seedForEvent('rec', 'explosion#0')).not.toBe(seedForEvent('rec', 'explosion#1'));
      expect(seedForEvent('rec-a', 'explosion#0')).not.toBe(seedForEvent('rec-b', 'explosion#0'));
    });

    it('produces identical event selections for two builds of the same recording', () => {
      const track = makeTrack('rec-A', EVENTS);
      const first = buildAudioTimeline(track, SYNTHETIC_MANIFEST, { eventWindow: 0.04 });
      const second = buildAudioTimeline(track, SYNTHETIC_MANIFEST, { eventWindow: 0.04 });

      expect(JSON.stringify(second.events)).toBe(JSON.stringify(first.events));
      expect(second.events.map((event) => event.seed)).toEqual(first.events.map((event) => event.seed));
    });

    it('keeps no selection state across recordings (building another track does not change this one)', () => {
      const trackA = makeTrack('rec-A', EVENTS);
      const trackB = makeTrack('rec-B', EVENTS);
      const firstA = buildAudioTimeline(trackA, SYNTHETIC_MANIFEST, { eventWindow: 0.04 });
      buildAudioTimeline(trackB, SYNTHETIC_MANIFEST, { eventWindow: 0.04 });
      const secondA = buildAudioTimeline(trackA, SYNTHETIC_MANIFEST, { eventWindow: 0.04 });

      expect(JSON.stringify(secondA.events)).toBe(JSON.stringify(firstA.events));
    });
  });

  describe('spatialisation', () => {
    it('attenuates monotonically with distance and hits the documented bounds', () => {
      expect(distanceAttenuation(0)).toBe(1);
      expect(distanceAttenuation(ATTENUATION_REF_DISTANCE)).toBe(1);
      expect(distanceAttenuation(ATTENUATION_MAX_DISTANCE)).toBe(0);
      expect(distanceAttenuation(ATTENUATION_MAX_DISTANCE + 1)).toBe(0);
      // 1 - (1000 - 15) / (1500 - 15)
      expect(distanceAttenuation(1000)).toBeCloseTo(1 - 985 / 1485, 12);

      let previous = distanceAttenuation(ATTENUATION_REF_DISTANCE);
      for (let distance = ATTENUATION_REF_DISTANCE + 10; distance <= ATTENUATION_MAX_DISTANCE; distance += 10) {
        const gain = distanceAttenuation(distance);
        expect(gain).toBeLessThan(previous);
        previous = gain;
      }
    });

    it('gives a front source more gain than a rear source', () => {
      expect(directionalGain(1)).toBeCloseTo(1, 12);
      expect(directionalGain(-1)).toBeCloseTo(0.6, 12);
      expect(directionalGain(1)).toBeGreaterThan(directionalGain(-1));
    });

    it('has the correct Doppler sign on approach vs recede and unity at rest', () => {
      expect(dopplerFactor([0, 0, 0], [0, 0, 0], [1, 0, 0])).toBe(1);
      // source closing at 50 m/s along the source->listener axis
      expect(dopplerFactor([50, 0, 0], [0, 0, 0], [1, 0, 0])).toBeCloseTo(343 / 293, 12);
      expect(dopplerFactor([50, 0, 0], [0, 0, 0], [1, 0, 0])).toBeGreaterThan(1);
      // source receding at 50 m/s
      expect(dopplerFactor([-50, 0, 0], [0, 0, 0], [1, 0, 0])).toBeCloseTo(343 / 393, 12);
      expect(dopplerFactor([-50, 0, 0], [0, 0, 0], [1, 0, 0])).toBeLessThan(1);
    });
  });

  describe('timeline frames', () => {
    it('maps the v9 inferred signals and never emits a rev/RPM value', () => {
      const frame = buildAudioTimeline(makeTrack('rec-A', EVENTS), SYNTHETIC_MANIFEST, { eventWindow: 0.04 }).frameAt(
        0,
      );
      expect(frame.signals.rev).toBeNull();
      expect(frame.signals.gear).toBe(3);
      expect(frame.signals.load).toBe(1);
      expect(frame.signals.normalizedSpeed).toBeCloseTo(4 / 7, 12);
      expect(frame.engine).not.toBeNull();
      // throttle 1 / brake 0 -> accelerate loop only
      expect(frame.engine?.decelerate.gain).toBe(0);
      expect(frame.engine?.accelerate.gain).toBeGreaterThan(0);
      expect(frame.engine?.accelerate.sample).toBe('engine-accelerate');
      expect(frame.engine?.decelerate.sample).toBe('engine-decelerate');
    });

    it('triggers each event in exactly its own frame with its deterministic selection', () => {
      const timeline = buildAudioTimeline(makeTrack('rec-A', EVENTS), SYNTHETIC_MANIFEST, { eventWindow: 0.04 });

      const first = timeline.frameAt(0.5, LISTENER).events;
      expect(first).toHaveLength(1);
      expect(first[0]?.kind).toBe('explosion');
      expect(first[0]?.cue.playbackRate).toBeCloseTo(1.12, 12);

      expect(timeline.frameAt(0.7, LISTENER).events[0]?.cue.playbackRate).toBeCloseTo(1, 12);
      expect(timeline.frameAt(0.8, LISTENER).events[0]?.cue.playbackRate).toBeCloseTo(0.88, 12);

      const collision = timeline.frameAt(0.9, LISTENER).events;
      expect(collision).toHaveLength(1);
      expect(collision[0]?.kind).toBe('collision');
      expect(collision[0]?.cue.soundIndex).toBe(35);
      expect(collision[0]?.cue.sample).toBe('collision');
      // strength 50/60 -> floor(0.8333.. * 71) = 59, distinct from the previous 35
      expect(timeline.frameAt(0.95, LISTENER).events[0]?.cue.soundIndex).toBe(59);

      expect(timeline.frameAt(0.2, LISTENER).events).toHaveLength(0);
    });
  });
});

describe('baked GENRL manifest mapping (per-model engine banks)', () => {
  it('maps each model to its exact engine bank with >=3 rate steps and a declared provenance', () => {
    expect(existsSync(MANIFEST_PATH), `${MANIFEST_PATH.toString()} is missing - bake the map first (AGENTS.md)`).toBe(
      true,
    );
    const manifest = parseAudioManifest(readFileSync(MANIFEST_PATH, 'utf8'));

    // Cue category -> manifest category string is an independent contract (now including the jet layers).
    expect(MANIFEST_CATEGORY).toEqual({
      collision: 'collision set',
      'engine-accelerate': 'engine accelerate',
      'engine-decelerate': 'engine decelerate',
      'engine-distance': 'engine distance',
      'engine-lift': 'engine lift',
      'engine-turbine': 'engine turbine',
      'engine-whine': 'engine whine',
      explosion: 'explosion set',
    });

    // Expected engines are transcribed from gta-reversed (eSoundBank.h + VehicleAudioSettings.h + SoundIDs.h),
    // NOT read from the manifest: the Hydra 520 is the AE_AIRCRAFT_PLANE jet, whose layered turbine lives in
    // SND_BANK_GENRL_VEHICLE_GEN; the Rustler 476 uses the FASTPROP accelerator + FASTPROP_D decelerator bank.
    // ProcessGenericJet is not reversed, so the jet LAYER ROLES are INFERRED (recorded as such in provenance).
    const hydraLayers = [
      { layer: 'turbine', mix: 1, soundIndex: 26, soundName: 'SND_GENRL_VEHICLE_GEN_THRUST' },
      { layer: 'whine', mix: 0.35, soundIndex: 29, soundName: 'SND_GENRL_VEHICLE_GEN_WHINE' },
      { layer: 'distance', mix: 0.25, soundIndex: 14, soundName: 'SND_GENRL_VEHICLE_GEN_JET_DIST' },
      { layer: 'lift', mix: 0.4, soundIndex: 15, soundName: 'SND_GENRL_VEHICLE_GEN_LIFT_LOOP' },
    ] as const;
    const specs = engineLayerSpecsForModel(manifest, 520);

    expect(specs.map((spec) => spec.role)).toEqual(hydraLayers.map((entry) => entry.layer));
    expect(engineBankForModel(manifest, 520)).toBe('SND_BANK_GENRL_VEHICLE_GEN');
    for (const expected of hydraLayers) {
      const spec = specs.find((candidate) => candidate.role === expected.layer);
      expect(spec, `Hydra layer ${expected.layer}`).toBeDefined();
      expect(spec?.mix).toBeCloseTo(expected.mix, 12);
      expect(spec?.steps.length ?? 0, `Hydra layer ${expected.layer} rate steps`).toBeGreaterThanOrEqual(3);
      const sample = manifest.samples.find(
        (candidate) => candidate.model === 520 && candidate.layer === expected.layer,
      );
      expect(sample).toMatchObject({
        bankName: 'SND_BANK_GENRL_VEHICLE_GEN',
        globalBankId: 138,
        kind: 'jet',
        slotId: 19,
        slotName: 'SND_BANK_SLOT_VEHICLE_GEN',
        soundIndex: expected.soundIndex,
        soundName: expected.soundName,
      });
      expect(sample?.provenance ?? '').toContain('gta-reversed');
      expect(sample?.provenance ?? '').toContain('INFERRED');
      for (const step of spec?.steps ?? []) {
        expect(step.rate).toBeGreaterThan(0);
        expect(Number.isFinite(step.rate)).toBe(true);
      }
    }
    // The old drone layers must NOT be the primary turbine: THRUST and WHINE are the ones the replay plays.
    expect(specs.some((spec) => spec.role === 'distance')).toBe(true);

    // The Rustler keeps the propeller accelerator/decelerator pair, each with >=3 rate steps.
    const accelerateSteps = engineStepsForModel(manifest, 476, 'engine-accelerate');
    const decelerateSteps = engineStepsForModel(manifest, 476, 'engine-decelerate');
    expect(accelerateSteps.length, 'model 476 accelerate steps').toBeGreaterThanOrEqual(3);
    expect(decelerateSteps.length, 'model 476 decelerate steps').toBeGreaterThanOrEqual(3);
    expect(engineBankForModel(manifest, 476)).toBe('SND_BANK_GENRL_FASTPROP');
    const accelerate = manifest.samples.find(
      (sample) => sample.model === 476 && sample.category === 'engine accelerate',
    );
    expect(accelerate).toMatchObject({
      bankName: 'SND_BANK_GENRL_FASTPROP',
      globalBankId: 53,
      kind: 'prop',
      slotId: 40,
      slotName: 'SND_BANK_SLOT_PLAYER_ENGINE_P',
    });
    expect(accelerate?.provenance ?? '').toContain('gta-reversed');

    // The Rustler decelerates from the separate `_D` bank, not the accelerator bank.
    expect(
      manifest.samples.find((sample) => sample.model === 476 && sample.category === 'engine decelerate'),
    ).toMatchObject({ bankName: 'SND_BANK_GENRL_FASTPROP_D', globalBankId: 54 });

    // Collision and explosion keep their G4 rows.
    expect(sampleForCategory(manifest, 'collision')).toMatchObject({
      bankName: 'SND_BANK_GENRL_COLLISIONS',
      file: 'collision-set.wav',
      globalBankId: 39,
      packageBankIndex: 32,
      sampleRateHz: 16000,
      setSoundCount: 72,
      slotId: 2,
      slotName: 'COLLISIONS',
      soundIndex: 0,
      wavFrames: 10612,
    });
    expect(sampleForCategory(manifest, 'explosion')).toMatchObject({
      bankName: 'SND_BANK_GENRL_EXPLOSIONS',
      file: 'explosion-set.wav',
      globalBankId: 52,
      packageBankIndex: 45,
      sampleRateHz: 22050,
      setSoundCount: 5,
      slotId: 4,
      slotName: 'EXPLOSIONS',
      soundIndex: 0,
      wavFrames: 36064,
    });
  });
});
