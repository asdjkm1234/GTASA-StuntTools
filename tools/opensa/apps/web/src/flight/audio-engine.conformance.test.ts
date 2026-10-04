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
 * - explosion frequency cycle {1.12, 1.0, 0.88}: todo-17 plan; collision ±2% variance:
 *   gta-reversed AECollisionAudioEntity::PlayOneShotCollisionSound.
 * - accelerate/decelerate crossfade: smoothstep over `throttle - brake`.
 * - attenuation / Doppler / reverb: the documented acoustic models in `audio-engine.ts`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { AudioBankManifest, AudioListener, EngineVoiceCue } from './audio-engine';
import type { FlightTrack } from './csv';

import {
  ATTENUATION_MAX_DISTANCE,
  ATTENUATION_REF_DISTANCE,
  buildAudioTimeline,
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
import { decodePcmWavSample } from './audio-sample-bank';
import { DEFAULT_AUDIO_MIX_TUNING, normalizeAudioMixTuning } from './audio-tuning';
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

  it('collision pitch variance stays inside the original +/-2% band', () => {
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
    it('interprets recorded plane brake as reverse thrust rather than the v9 car-load heuristic', () => {
      const recording = (model: number, brake: number): FlightTrack =>
        parseFlightCsv(
          [
            '# gtasa_flight_recorder,version=9',
            'local_timestamp,capture_elapsed_s,model,health,x,y,z,throttle,brake,transmission_gear_inferred,engine_load_inferred',
            `2026-01-01T00:00:00.000,0,${model},1000,0,0,100,0,${brake},2,${brake}`,
            `2026-01-01T00:00:00.040,0.04,${model},1000,0,0,100,0,${brake},2,${brake}`,
          ].join('\n'),
          `${model}-${brake}`,
        );
      for (const model of [520, 476]) {
        const thrust = buildAudioTimeline(recording(model, 0), SYNTHETIC_MANIFEST).frameAt(0);
        const neutral = buildAudioTimeline(recording(model, 0.5), SYNTHETIC_MANIFEST).frameAt(0);
        const idle = buildAudioTimeline(recording(model, 1), SYNTHETIC_MANIFEST).frameAt(0);
        expect([thrust.signals.load, neutral.signals.load, idle.signals.load]).toEqual([1, 0.5, 0]);
        expect(thrust.signals.source).toBe('derived');
        expect(thrust.engine?.accelerate.gain).toBeGreaterThan(neutral.engine?.accelerate.gain ?? 0);
        expect(neutral.engine?.accelerate.gain).toBeGreaterThan(idle.engine?.accelerate.gain ?? 0);
      }
    });

    it('uses the v9 Hydra W proxy for HARRIER_FRONT/REAR pitch and the Rustler player prop frequency path', () => {
      const source = SYNTHETIC_MANIFEST.samples.find((sample) => sample.category === 'engine accelerate');
      expect(source).toBeDefined();
      const manifest: AudioBankManifest = {
        ...SYNTHETIC_MANIFEST,
        samples: [
          ...SYNTHETIC_MANIFEST.samples.filter((sample) => !sample.category.startsWith('engine ')),
          { ...source!, category: 'engine turbine', file: 'jet-turbine.wav', layer: 'turbine', model: 520 },
          { ...source!, category: 'engine front', file: 'jet-front.wav', layer: 'front', model: 520 },
          { ...source!, category: 'engine rear', file: 'jet-rear.wav', layer: 'rear', model: 520 },
          { ...source!, category: 'engine accelerate', file: 'prop.wav', layer: 'accelerate', model: 476 },
        ],
      };
      const recording = (model: number, gear: number, load: number): FlightTrack =>
        parseFlightCsv(
          [
            '# gtasa_flight_recorder,version=9',
            'local_timestamp,capture_elapsed_s,model,health,x,y,z,throttle,brake,transmission_gear_inferred,engine_load_inferred',
            `2026-01-01T00:00:00.000,0,${model},1000,0,0,100,0,${1 - load},${gear},${1 - load}`,
            `2026-01-01T00:00:00.040,0.04,${model},1000,0,0,100,0,${1 - load},${gear},${1 - load}`,
          ].join('\n'),
          `${model}-${gear}-${load}`,
        );
      const jetMid = buildAudioTimeline(recording(520, 4, 0.5), manifest).frameAt(0).engine;
      expect(buildAudioTimeline(recording(520, 4, 0.5), manifest).frameAt(0).reverb.mix).toBe(0);
      expect(buildAudioTimeline(recording(476, 4, 0.5), manifest).frameAt(0).reverb.mix).toBeGreaterThan(0);
      const jetFull = buildAudioTimeline(recording(520, 6, 1), manifest).frameAt(0, {
        ...LISTENER,
        pos: [0, 20, 100],
      }).engine;
      const propFull = buildAudioTimeline(recording(476, 6, 1), manifest).frameAt(0).engine;
      expect(jetMid?.pitch).toBeCloseTo(1.05, 12);
      expect(jetFull?.pitch).toBeCloseTo(1.1, 12);
      expect(propFull?.pitch).toBeCloseTo(1.1, 12);
      expect(buildAudioTimeline(recording(476, 0, 1), manifest).frameAt(0).engine?.pitch).toBeCloseTo(1.1, 12);
      expect(buildAudioTimeline(recording(476, 6, 0.5), manifest).frameAt(0).engine?.pitch).toBeCloseTo(1, 12);
      expect(buildAudioTimeline(recording(476, 6, 0), manifest).frameAt(0).engine?.pitch).toBeCloseTo(0.95, 12);
      const transition = parseFlightCsv(
        [
          '# gtasa_flight_recorder,version=9',
          'local_timestamp,capture_elapsed_s,model,health,x,y,z,throttle,brake,transmission_gear_inferred,engine_load_inferred',
          '2026-01-01T00:00:00.000,0,476,1000,0,0,100,0,0,6,1',
          '2026-01-01T00:00:00.040,0.04,476,1000,0,0,100,0,1,6,1',
        ].join('\n'),
        'prop-frequency-transition',
      );
      expect(buildAudioTimeline(transition, manifest).frameAt(0.04).engine?.pitch).toBeCloseTo(1.0872, 4);
      const fullFront = jetFull?.layers.find((layer) => layer.role === 'front');
      const fullTurbine = jetFull?.layers.find((layer) => layer.role === 'turbine');
      expect((fullFront?.gain ?? 0) / (fullTurbine?.gain ?? 1)).toBeGreaterThan(0.5);
    });

    it('lets Hydra HARRIER_FRONT/REAR pitch respond to W while their levels rise gradually', () => {
      const source = SYNTHETIC_MANIFEST.samples[0];
      const manifest: AudioBankManifest = {
        ...SYNTHETIC_MANIFEST,
        samples: [
          { ...source, category: 'engine turbine', file: 'jet-turbine.wav', layer: 'turbine', model: 520 },
          { ...source, category: 'engine front', file: 'jet-front.wav', layer: 'front', model: 520 },
          { ...source, category: 'engine rear', file: 'jet-rear.wav', layer: 'rear', model: 520 },
        ],
      };
      const rows = Array.from({ length: 41 }, (_, index) => {
        const s = index / 10;
        const brake = index < 9 ? 0.5 : 0;

        return `2026-01-01T00:00:00.000,${s},520,1000,0,0,100,0,${brake}`;
      });
      const track = parseFlightCsv(
        [
          '# gtasa_flight_recorder,version=9',
          'local_timestamp,capture_elapsed_s,model,health,x,y,z,throttle,brake',
          ...rows,
        ].join('\n'),
        'hydra-front-rear-attack',
      );
      const timeline = buildAudioTimeline(track, manifest);
      const early = timeline.frameAt(1.3).engine;
      const late = timeline.frameAt(3.3).engine;
      const front = (engine: typeof early): EngineVoiceCue | undefined =>
        engine?.layers.find((layer) => layer.role === 'front');

      expect(early?.pitch).toBeGreaterThan(1.07);
      expect((front(late)?.gain ?? 0) / (front(early)?.gain ?? 1)).toBeGreaterThan(1.05);
    });

    it('gives Hydra cruise W, release and S distinct main-loop levels without changing the full-W baseline', () => {
      const source = SYNTHETIC_MANIFEST.samples[0];
      const manifest: AudioBankManifest = {
        ...SYNTHETIC_MANIFEST,
        samples: [
          { ...source, category: 'engine front', file: 'jet-front.wav', layer: 'front', model: 520 },
          { ...source, category: 'engine rear', file: 'jet-rear.wav', layer: 'rear', model: 520 },
        ],
      };
      const rows = Array.from({ length: 41 }, (_, index) => {
        const s = index / 10;
        const brake = index < 10 ? 0 : index < 25 ? 0.5 : 1;

        return `2026-01-01T00:00:00.000,${s},520,1000,${70 * s},0,100,0,${brake}`;
      });
      const track = parseFlightCsv(
        [
          '# gtasa_flight_recorder,version=9',
          'local_timestamp,capture_elapsed_s,model,health,x,y,z,throttle,brake',
          ...rows,
        ].join('\n'),
        'hydra-cruise-power',
      );
      const baseline = buildAudioTimeline(track, manifest);
      const flat = buildAudioTimeline(track, manifest, {
        tuning: normalizeAudioMixTuning({ powerDynamics: 0 }),
      });
      const gain = (timeline: ReturnType<typeof buildAudioTimeline>, s: number, role: string): number =>
        timeline.frameAt(s).engine?.layers.find((layer) => layer.role === role)?.gain ?? 0;

      for (const role of ['front', 'rear']) {
        const full = gain(baseline, 0.8, role);
        const released = gain(baseline, 2.3, role);
        const idle = gain(baseline, 3.9, role);
        expect(full).toBeGreaterThan(released);
        expect(released).toBeGreaterThan(idle);
        expect(20 * Math.log10(full / released)).toBeGreaterThan(0.6);
        expect(gain(flat, 0.8, role)).toBeCloseTo(full, 12);
        expect(gain(flat, 2.3, role)).toBeCloseTo(gain(flat, 3.9, role), 12);
      }
    });

    it('smooths the v9 Hydra W proxy and applies the original damaged-engine health bands', () => {
      const header =
        'local_timestamp,capture_elapsed_s,model,health,x,y,z,throttle,brake,transmission_gear_inferred,engine_load_inferred';
      const recording = (health: number): FlightTrack =>
        parseFlightCsv(
          [
            '# gtasa_flight_recorder,version=9',
            header,
            `2026-01-01T00:00:00.000,0,520,${health},0,0,100,1,0,6,1`,
            `2026-01-01T00:00:00.040,0.04,520,${health},0,0,100,0,0.5,0,0`,
            `2026-01-01T00:00:00.080,0.08,520,${health},0,0,100,0,0.5,0,0`,
          ].join('\n'),
          `health-${health}`,
        );
      const healthy = buildAudioTimeline(recording(1000), SYNTHETIC_MANIFEST);
      const damaged = buildAudioTimeline(recording(400), SYNTHETIC_MANIFEST);
      const first = healthy.frameAt(0).engine;
      const middle = healthy.frameAt(0.04).engine;
      expect(middle?.signals.normalizedSpeed).toBeLessThan(first?.signals.normalizedSpeed ?? 0);
      expect(middle?.signals.normalizedSpeed).toBeGreaterThan(0);
      expect(middle?.pitch).toBeLessThan(first?.pitch ?? 0);
      expect(middle?.pitch).toBeGreaterThan(1);
      expect(damaged.frameAt(0).engine?.pitch).toBeCloseTo((first?.pitch ?? 0) * 0.9, 12);
      expect(damaged.frameAt(0).engine?.accelerate.gain).toBeLessThan(first?.accelerate.gain ?? 0);
    });
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
    it('selects only baked CAR-surface files, never an unrelated bank member, with no-repeat', () => {
      const car = SYNTHETIC_MANIFEST.samples.find((sample) => sample.category === 'collision set');
      expect(car).toBeDefined();
      const manifest: AudioBankManifest = {
        ...SYNTHETIC_MANIFEST,
        samples: [
          ...SYNTHETIC_MANIFEST.samples.filter((sample) => sample.category !== 'collision set'),
          ...[20, 21, 22].map((soundIndex) => ({ ...car!, file: `collision-car-${soundIndex}.wav`, soundIndex })),
        ],
      };
      const track = makeTrack('car-collisions', [
        '# event,0.2,collision,inferred,30,0,0,100',
        '# event,0.4,collision,inferred,60,0,0,100',
        '# event,0.6,collision,inferred,15,0,0,100',
      ]);
      const events = buildAudioTimeline(track, manifest).events;
      expect(events).toHaveLength(3);
      for (const [index, event] of events.entries()) {
        expect(event.file).toBe(`collision-car-${event.soundIndex}.wav`);
        expect([20, 21, 22]).toContain(event.soundIndex);
        if (index > 0) expect(event.soundIndex).not.toBe(events[index - 1].soundIndex);
      }
      const timeline = buildAudioTimeline(track, manifest);
      expect(timeline.frameAt(0.4, LISTENER).events[0]?.cue.gain).toBeGreaterThan(
        timeline.frameAt(0.6, LISTENER).events[0]?.cue.gain ?? 0,
      );
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
    it('changes the relative near/far jet layer balance with camera distance', () => {
      const base = SYNTHETIC_MANIFEST.samples.find((sample) => sample.category === 'engine accelerate');
      expect(base).toBeDefined();
      const manifest: AudioBankManifest = {
        ...SYNTHETIC_MANIFEST,
        samples: [
          ...SYNTHETIC_MANIFEST.samples.filter((sample) => !sample.category.startsWith('engine ')),
          { ...base!, category: 'engine turbine', file: 'thrust.wav', layer: 'turbine', model: 520 },
          { ...base!, category: 'engine distance', file: 'distance.wav', layer: 'distance', model: 520 },
        ],
      };
      const timeline = buildAudioTimeline(makeTrack('jet-distance'), manifest);
      const near = timeline.frameAt(0, { ...LISTENER, pos: [0, 20, 100] }).engine;
      const far = timeline.frameAt(0, { ...LISTENER, pos: [0, 100, 100] }).engine;
      expect(timeline.frameAt(0).engine?.layers.find((layer) => layer.role === 'distance')?.gain).toBe(0);
      const ratio = (engine: typeof near): number =>
        (engine?.layers.find((layer) => layer.role === 'distance')?.gain ?? 0) /
        Math.max(1e-6, engine?.layers.find((layer) => layer.role === 'turbine')?.gain ?? 0);
      expect(ratio(far)).toBeGreaterThan(ratio(near));
    });

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
      // gta-reversed caps a 50 m/s closing radial speed at 35 m/s (speed of sound = 340 m/s).
      expect(dopplerFactor([50, 0, 0], [0, 0, 0], [1, 0, 0])).toBeCloseTo(340 / 305, 12);
      expect(dopplerFactor([50, 0, 0], [0, 0, 0], [1, 0, 0])).toBeGreaterThan(1);
      // source receding at 50 m/s
      expect(dopplerFactor([-50, 0, 0], [0, 0, 0], [1, 0, 0])).toBeCloseTo(340 / 375, 12);
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
      expect(collision[0]?.cue.soundIndex).toBe(0);
      expect(collision[0]?.cue.sample).toBe('collision');
      expect(timeline.frameAt(0.95, LISTENER).events[0]?.cue.soundIndex).toBe(0);
      expect(timeline.frameAt(0.95, LISTENER).events[0]?.cue.gain).toBeGreaterThan(collision[0]?.cue.gain ?? 0);

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
      'engine-front': 'engine front',
      'engine-near': 'engine near',
      'engine-prop-distance': 'engine prop distance',
      'engine-rear': 'engine rear',
      'engine-turbine': 'engine turbine',
      explosion: 'explosion set',
    });

    // Hydra IDs are the actual PlayAircraftSound calls in the model-520 branch of the local gta_sa.exe
    // ProcessGenericJet. Names are independently checked against gta-reversed SoundIDs.h. The exact gain
    // curves and pitch inputs remain inferred; Rustler's player path is unchanged.
    const hydraLayers = [
      { layer: 'front', mix: 0.7, soundIndex: 10, soundName: 'SND_GENRL_VEHICLE_GEN_HARRIER_FRONT' },
      { layer: 'rear', mix: 0.7, soundIndex: 11, soundName: 'SND_GENRL_VEHICLE_GEN_HARRIER_REAR' },
      { layer: 'turbine', mix: 1, soundIndex: 26, soundName: 'SND_GENRL_VEHICLE_GEN_THRUST' },
      { layer: 'distance', mix: 0.25, soundIndex: 14, soundName: 'SND_GENRL_VEHICLE_GEN_JET_DIST' },
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
    expect(manifest.samples.some((sample) => sample.model === 520 && [15, 29].includes(sample.soundIndex))).toBe(false);
    expect(specs.find((spec) => spec.role === 'front')?.headroomDb).toBe(9);
    expect(specs.find((spec) => spec.role === 'rear')?.headroomDb).toBe(9);
    expect(specs.some((spec) => spec.role === 'distance')).toBe(true);

    // gta-reversed ProcessDummyOrPlayerProp plays these four layers together, NOT FASTPROP_D for the player.
    const propLayers = engineLayerSpecsForModel(manifest, 476);
    expect(propLayers.map((layer) => layer.role)).toEqual(['front', 'rear', 'near', 'prop-distance']);
    expect(propLayers.every((layer) => layer.steps.length === 3)).toBe(true);
    expect(engineBankForModel(manifest, 476)).toBe('SND_BANK_GENRL_FASTPROP');
    const propSamples = manifest.samples.filter((sample) => sample.model === 476 && sample.step === 1);
    expect(propSamples.map((sample) => ({ bank: sample.globalBankId, sound: sample.soundIndex }))).toEqual([
      { bank: 53, sound: 0 },
      { bank: 53, sound: 1 },
      { bank: 138, sound: 17 },
      { bank: 138, sound: 16 },
    ]);
    expect(propSamples[0]).toMatchObject({
      bankName: 'SND_BANK_GENRL_FASTPROP',
      globalBankId: 53,
      kind: 'prop',
      slotId: 40,
      slotName: 'SND_BANK_SLOT_PLAYER_ENGINE_P',
    });
    expect(propSamples[0]?.provenance ?? '').toContain('ProcessDummyOrPlayerProp');
    expect(manifest.samples.some((sample) => sample.model === 476 && sample.globalBankId === 54)).toBe(false);

    // The original player path changes the rate of one front and one rear sample. Two baked copies of the
    // same loop playing together would create a slow phase beat at sustained power.
    const rustler = parseFlightCsv(
      [
        '# gtasa_flight_recorder,version=9',
        'local_timestamp,capture_elapsed_s,model,health,x,y,z,throttle,brake,transmission_gear_inferred,engine_load_inferred',
        '2026-01-01T00:00:00.000,0,476,1000,0,0,100,0,0,4,0',
        '2026-01-01T00:00:00.500,0.5,476,1000,0,10,100,0,0,4,0',
        '2026-01-01T00:00:01.000,1,476,1000,0,20,100,0,0,4,0',
      ].join('\n'),
      'rustler-full-power',
    );
    const fullPower = buildAudioTimeline(rustler, manifest).frameAt(0.5).engine;
    for (const role of ['front', 'rear']) {
      const voice = fullPower?.layers.find((layer) => layer.role === role);
      expect(voice?.layers).toHaveLength(1);
      expect(voice?.layers[0].file).toBe(`engine-476-${role}-1.wav`);
      const sample = propSamples.find((entry) => entry.layer === role);
      expect(sample).toBeDefined();
      const file = new URL(`../../../../map-pak/audio/${sample!.file}`, import.meta.url);
      const decoded = decodePcmWavSample(readFileSync(file), { loop: true, loopStartFrame: 0 });
      const window = Math.round(decoded.sampleRateHz * 0.02);
      const levels: number[] = [];
      for (let start = 0; start + window <= decoded.frames.length; start += window) {
        let power = 0;
        for (let index = start; index < start + window; index++) power += decoded.frames[index] ** 2;
        levels.push(Math.sqrt(power / window));
      }
      const medianLevel = [...levels].sort((a, b) => a - b)[Math.floor(levels.length / 2)];
      expect(20 * Math.log10(levels[0] / medianLevel), `${role} loop start volume dip`).toBeGreaterThan(-3);
    }

    const hydra = parseFlightCsv(
      [
        '# gtasa_flight_recorder,version=9',
        'local_timestamp,capture_elapsed_s,model,health,x,y,z,throttle,brake,transmission_gear_inferred,engine_load_inferred',
        '2026-01-01T00:00:00.000,0,520,1000,0,0,100,0,0,6,1',
        '2026-01-01T00:00:00.500,0.5,520,1000,0,10,100,0,0,6,1',
        '2026-01-01T00:00:01.000,1,520,1000,0,20,100,0,0,6,1',
      ].join('\n'),
      'hydra-full-power',
    );
    const jet = buildAudioTimeline(hydra, manifest);
    expect(jet.frameAt(0.5).engine?.layers.every((layer) => layer.layers.length <= 1)).toBe(true);
    expect(jet.frameAt(0.5).engine?.pitch).toBe(jet.frameAt(0.8).engine?.pitch);
    const tunedJet = buildAudioTimeline(hydra, manifest, {
      tuning: normalizeAudioMixTuning({
        ...DEFAULT_AUDIO_MIX_TUNING,
        front: 0.5,
        frontPitch: 1.1,
        jetDistance: 0.5,
        presence: 2.2,
        presenceHighHz: 600,
        presenceLowHz: 3500,
      }),
    }).frameAt(0.5).engine;
    const baselineJet = jet.frameAt(0.5).engine;
    const jetVoice = (role: string): EngineVoiceCue | undefined =>
      tunedJet?.layers.find((layer) => layer.role === role);
    const baselineFrontJet = baselineJet?.layers.find((layer) => layer.role === 'front');
    expect(jetVoice('distance')?.gain).toBeGreaterThan(0);
    expect(jetVoice('front')?.gain).toBeCloseTo((baselineFrontJet?.gain ?? 0) * 0.5, 5);
    expect(jetVoice('front')?.layers[0].playbackRate).toBeCloseTo(
      (baselineFrontJet?.layers[0].playbackRate ?? 0) * 1.1,
      5,
    );
    expect(jetVoice('turbine')).toMatchObject({ presenceGain: 2.2, presenceHighHz: 600, presenceLowHz: 3500 });

    const tunedProp = buildAudioTimeline(rustler, manifest, {
      tuning: normalizeAudioMixTuning({ ...DEFAULT_AUDIO_MIX_TUNING, front: 0.5, rearPitch: 1.08 }),
    }).frameAt(0.5).engine;
    const baselineFront = fullPower?.layers.find((layer) => layer.role === 'front');
    const baselineRear = fullPower?.layers.find((layer) => layer.role === 'rear');
    expect(tunedProp?.layers.find((layer) => layer.role === 'front')?.gain).toBeCloseTo(
      (baselineFront?.gain ?? 0) * 0.5,
      5,
    );
    expect(tunedProp?.layers.find((layer) => layer.role === 'rear')?.layers[0].playbackRate).toBeCloseTo(
      (baselineRear?.layers[0].playbackRate ?? 0) * 1.08,
      5,
    );

    const carSounds = manifest.samples.filter((sample) => sample.category === 'collision set');
    expect(carSounds.map((sample) => sample.soundIndex)).toEqual([20, 21, 22, 23, 24, 25, 26, 27, 28]);
    expect(new Set(carSounds.map((sample) => sample.file)).size).toBe(9);
    expect(carSounds.every((sample) => sample.globalBankId === 39 && sample.slotId === 2)).toBe(true);
    for (const sample of carSounds) {
      const file = new URL(`../../../../map-pak/audio/${sample.file}`, import.meta.url);
      expect(existsSync(file), `missing baked original sound ${sample.file}`).toBe(true);
      const decoded = decodePcmWavSample(readFileSync(file), { loop: false, loopStartFrame: 0 });
      expect(decoded.frames.length).toBe(sample.wavFrames);
      expect(decoded.frames.some((value) => Math.abs(value) > 0.001)).toBe(true);
    }
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
