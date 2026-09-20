import { describe, expect, it } from 'vitest';

import { createMotion, MOTION_CAP, type MotionInput, type MotionState, stepMotion } from './camera-motion';
import { TEST_CAMERA_CONFIG } from './camera-test-config';

const CONFIG = TEST_CAMERA_CONFIG;
const DT = 1 / 60;
const RUN = CONFIG.lookAheadFullSpeed;

const input = (over: Partial<MotionInput> = {}): MotionInput => ({
  airborne: false,
  dt: DT,
  impact: 0,
  landing: 0,
  mode: 'foot',
  speed: 0,
  ...over,
});

/** Run `frames` steps and report the largest |vertical| seen — the amplitude, whatever the phase. */
const peakVertical = (state: MotionState, over: Partial<MotionInput>, frames: number, config = CONFIG): number => {
  let peak = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    peak = Math.max(peak, Math.abs(stepMotion(state, input(over), config).vertical));
  }

  return peak;
};

describe('stepMotion', () => {
  describe('negative cases', () => {
    it('does nothing at all when reducedMotion is set — the comfort switch is absolute', () => {
      const state = createMotion();
      const config = { ...CONFIG, reducedMotion: true };
      // A sprint, a hard landing and a crash in the same frame.
      const offset = stepMotion(state, input({ impact: 1e6, landing: 20, speed: RUN }), config);

      expect(offset).toEqual({ fov: 0, lateral: 0, vertical: 0, verticalTarget: 0 });
      expect(peakVertical(state, { speed: RUN }, 120, config)).toBe(0);
    });

    it('freezes the bob when the player stands still — the phase is distance, not wall time', () => {
      const state = createMotion();
      peakVertical(state, { speed: RUN }, 120); // get it going
      const phase = state.bobPhase;

      peakVertical(state, { speed: 0 }, 120);

      expect(state.bobPhase).toBe(phase); // no distance travelled, no phase advanced
      expect(state.bobLevel).toBeLessThan(0.01); // and the amplitude faded out
    });

    it('does not bob in a car — the suspension already provides the life', () => {
      const state = createMotion();

      expect(peakVertical(state, { mode: 'vehicle', speed: 30 }, 240)).toBe(0);
    });

    it('does not bob in the air — a jump arc is already motion', () => {
      const state = createMotion();
      peakVertical(state, { speed: RUN }, 120);

      // The amplitude FADES rather than cutting, so the check is what is left once the leap is under way.
      peakVertical(state, { airborne: true, speed: RUN }, 120);
      expect(peakVertical(state, { airborne: true, speed: RUN }, 60)).toBeLessThan(0.005);
    });

    it('never widens the lens for a sprint in a car or in the air-viewer', () => {
      const state = createMotion();

      expect(stepMotion(state, input({ mode: 'vehicle', speed: 40 }), CONFIG).fov).toBe(0);
      expect(stepMotion(state, input({ mode: 'fly', speed: 40 }), CONFIG).fov).toBe(0);
    });

    it('holds every effect inside the cap when they all fire at once', () => {
      const state = createMotion();
      // A crash landing at a sprint: bob at full amplitude, the deepest dip, the hardest shake.
      const wild = { ...CONFIG, bobAmplitude: 1, landingDipScale: 1, shakeScale: 1 };
      let peak = 0;
      stepMotion(state, input({ impact: 1e7, landing: 100, speed: RUN }), wild);
      for (let frame = 0; frame < 240; frame += 1) {
        const offset = stepMotion(state, input({ speed: RUN }), wild);
        peak = Math.max(peak, Math.hypot(offset.lateral, offset.vertical));
      }

      expect(peak).toBeLessThanOrEqual(MOTION_CAP + 1e-9);
    });
  });

  describe('positive cases', () => {
    it('bobs at the run gait, and only a fraction of it at a walk', () => {
      const run = peakVertical(createMotion(), { speed: RUN }, 300);
      const walk = peakVertical(createMotion(), { speed: RUN / 3 }, 300);

      expect(run).toBeGreaterThan(0);
      expect(run).toBeLessThanOrEqual(CONFIG.bobAmplitude + 1e-9);
      expect(walk).toBeGreaterThan(0);
      expect(walk).toBeLessThan(run / 2);
    });

    it('crosses walk → run without a jump: the amplitude eases, the phase never restarts', () => {
      const state = createMotion();
      peakVertical(state, { speed: RUN / 3 }, 120);
      const before = { level: state.bobLevel, phase: state.bobPhase };

      const first = stepMotion(state, input({ speed: RUN }), CONFIG);

      expect(state.bobPhase).toBeGreaterThan(before.phase); // advanced, not reset
      expect(state.bobLevel - before.level).toBeLessThan(0.15); // eased, not stepped
      expect(Math.abs(first.vertical)).toBeLessThanOrEqual(CONFIG.bobAmplitude);
    });

    it('moves the eye and the look point together while bobbing — the aim must not wander', () => {
      const state = createMotion();
      let offset = stepMotion(state, input({ speed: RUN }), CONFIG);
      for (let frame = 0; frame < 30; frame += 1) {
        offset = stepMotion(state, input({ speed: RUN }), CONFIG);
      }

      expect(offset.verticalTarget).toBeCloseTo(offset.vertical, 12);
    });

    it('dips on a landing and recovers, deeper for a harder fall', () => {
      const soft = createMotion();
      const hard = createMotion();
      const softDip = stepMotion(soft, input({ landing: CONFIG.landingDipFullSpeed / 3 }), CONFIG).vertical;
      const hardDip = stepMotion(hard, input({ landing: CONFIG.landingDipFullSpeed }), CONFIG).vertical;

      expect(softDip).toBeLessThan(0); // down
      expect(hardDip).toBeLessThan(softDip);
      expect(Math.abs(hardDip)).toBeCloseTo(CONFIG.landingDipScale, 6);

      // ...and it is a ONE-SHOT: a second of standing still and the frame is all but level again. Stated as
      // a FRACTION of the dip, so a deeper one cannot fail this for the wrong reason.
      for (let frame = 0; frame < 60; frame += 1) {
        stepMotion(hard, input(), CONFIG);
      }
      expect(Math.abs(stepMotion(hard, input(), CONFIG).vertical)).toBeLessThan(Math.abs(hardDip) * 0.05);
    });

    it('pitches the frame on a dip — the look point dips half as far', () => {
      const state = createMotion();
      const offset = stepMotion(state, input({ landing: CONFIG.landingDipFullSpeed }), CONFIG);

      expect(offset.verticalTarget).toBeCloseTo(offset.vertical / 2, 12);
    });

    it('caps the dip however far the player fell', () => {
      const state = createMotion();
      const offset = stepMotion(state, input({ landing: 1000 }), { ...CONFIG, landingDipScale: 10 });

      expect(Math.abs(offset.vertical)).toBeLessThanOrEqual(MOTION_CAP);
    });

    it('shakes on an impact and decays to nothing, deterministically for a given seed', () => {
      const replay = (): number[] => {
        const state = createMotion();
        const samples: number[] = [];
        stepMotion(state, input({ impact: CONFIG.shakeImpactForce }), CONFIG);
        for (let frame = 0; frame < 60; frame += 1) {
          samples.push(stepMotion(state, input(), CONFIG).lateral);
        }

        return samples;
      };

      const first = replay();
      expect(replay()).toEqual(first); // no Math.random anywhere in the layer
      expect(Math.max(...first.map(Math.abs))).toBeGreaterThan(0);
      expect(Math.abs(first[first.length - 1])).toBeLessThan(Math.max(...first.map(Math.abs)) / 4);
    });

    it('scales the shake with the hit, and caps a monstrous one', () => {
      const light = createMotion();
      const heavy = createMotion();
      stepMotion(light, input({ impact: CONFIG.shakeImpactForce / 4 }), CONFIG);
      stepMotion(heavy, input({ impact: CONFIG.shakeImpactForce * 100 }), CONFIG);

      expect(light.shakeAmplitude).toBeLessThan(heavy.shakeAmplitude);
      expect(heavy.shakeAmplitude).toBeLessThanOrEqual(CONFIG.shakeScale);
    });

    it('lets a stronger hit take over a shake already running, WITHOUT restarting the noise clock', () => {
      const state = createMotion();
      stepMotion(state, input({ impact: CONFIG.shakeImpactForce / 5 }), CONFIG);
      const weak = state.shakeAmplitude;
      const seed = state.shakeSeed;

      stepMotion(state, input({ impact: CONFIG.shakeImpactForce }), CONFIG);

      expect(state.shakeAmplitude).toBeGreaterThan(weak);
      // The clock and the seed survive: a crash is a BURST of contacts, and restarting either on every one
      // of them pinned the noise near its t=0 sample — a hard hit then shook LESS than a light tap.
      expect(state.shakeSeed).toBe(seed);
      expect(state.shakeTime).toBeGreaterThan(0);
    });

    it('actually jitters through a sustained crash instead of holding one offset', () => {
      const burst = createMotion();
      const single = createMotion();
      const samples = (state: MotionState, sustained: boolean): number[] => {
        const out: number[] = [];
        for (let frame = 0; frame < 20; frame += 1) {
          out.push(
            stepMotion(state, input({ impact: sustained || frame === 0 ? CONFIG.shakeImpactForce : 0 }), CONFIG)
              .lateral,
          );
        }

        return out;
      };
      const spread = (values: number[]): number => Math.max(...values) - Math.min(...values);

      // A multi-frame crash must move at least as much as a one-frame tap of the same strength.
      expect(spread(samples(burst, true))).toBeGreaterThan(spread(samples(single, false)) / 2);
      expect(spread(samples(burst, true))).toBeGreaterThan(0.01);
    });

    it('kicks the FOV as a run tips into a sprint, and not before', () => {
      const state = createMotion();

      expect(stepMotion(state, input({ speed: RUN }), CONFIG).fov).toBe(0);
      const sprint = stepMotion(state, input({ speed: RUN * 1.5 }), CONFIG).fov;
      expect(sprint).toBeCloseTo(CONFIG.sprintFovKick, 9);
      expect(stepMotion(state, input({ speed: RUN * 1.15 }), CONFIG).fov).toBeLessThan(sprint);
    });

    it('keeps its accumulators bounded over a long session — nothing drifts', () => {
      const state = createMotion();
      // An hour of sprinting, plus a crash every minute.
      for (let frame = 0; frame < 60 * 60 * 60; frame += 1) {
        stepMotion(state, input({ impact: frame % 3600 === 0 ? CONFIG.shakeImpactForce : 0, speed: 10 }), CONFIG);
      }

      expect(Math.abs(state.bobPhase)).toBeLessThanOrEqual(Math.PI * 2);
      expect(state.shakeTime).toBeLessThan(60); // the clock only runs while a shake is alive
      expect(Number.isFinite(state.dip)).toBe(true);
      expect(state.shakeAmplitude).toBeLessThanOrEqual(CONFIG.shakeScale);
    });

    it('is rate independent: the same walk bobs the same at 1/120 as at 1/30', () => {
      const fast = createMotion();
      const slow = createMotion();
      for (let frame = 0; frame < 240; frame += 1) {
        stepMotion(fast, input({ dt: 1 / 120, speed: RUN }), CONFIG);
      }
      for (let frame = 0; frame < 60; frame += 1) {
        stepMotion(slow, input({ dt: 1 / 30, speed: RUN }), CONFIG);
      }

      // Same distance travelled → same phase, and both envelopes have long since settled.
      expect(fast.bobPhase).toBeCloseTo(slow.bobPhase, 9);
      expect(fast.bobLevel).toBeCloseTo(slow.bobLevel, 3);
    });
  });
});
