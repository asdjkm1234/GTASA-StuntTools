import { describe, expect, it } from 'vitest';

import { DEFAULT_FADE_SECONDS, LocomotionMixer } from './locomotion-mixer';

const IDLE = 0;
const WALK = 1;
const RUN = 2;
/** idle 4 s, walk 1 s, run 0.5 s — distinct so the phase carry is visible in toTime. */
const DURATIONS = [4, 1, 0.5];
const CYCLIC = new Set([RUN, WALK]);
const DT = 1 / 60;

function mixer(): LocomotionMixer {
  return new LocomotionMixer(DURATIONS, CYCLIC, IDLE);
}

describe('LocomotionMixer', () => {
  describe('negative cases', () => {
    it('an unchanged clip never fades — single pose, advancing clock', () => {
      const m = mixer();

      const first = m.update(IDLE, DT);
      const second = m.update(IDLE, DT);

      expect(first.pose).toEqual({ clip: IDLE, kind: 'single', time: DT });
      expect(second.pose).toEqual({ clip: IDLE, kind: 'single', time: 2 * DT });
      expect(first.captureHold).toBe(false);
    });

    it('a zero-duration (unresolved) gait clip cannot phase-carry — the fade starts at 0, no NaN', () => {
      const m = new LocomotionMixer([4, 0, 0.5], CYCLIC, WALK);
      m.update(WALK, 0.75);

      const { pose } = m.update(RUN, DT);

      expect(pose.kind).toBe('blend');
      if (pose.kind === 'blend') {
        expect(pose.toTime).toBeCloseTo(DT, 6); // started at 0, advanced one frame
        expect(Number.isFinite(pose.toTime)).toBe(true);
      }
    });

    it('an idle→walk switch does NOT carry phase (idle is not a gait)', () => {
      const m = mixer();
      m.update(IDLE, 3); // deep into the idle cycle

      const { pose } = m.update(WALK, DT);

      expect(pose.kind).toBe('blend');
      if (pose.kind === 'blend') {
        expect(pose.toTime).toBeCloseTo(DT, 6);
      }
    });
  });

  describe('positive cases', () => {
    it('a switch crossfades: alpha ramps while BOTH clocks advance', () => {
      const m = mixer();
      m.update(IDLE, 0.5);

      const first = m.update(WALK, DT);
      const second = m.update(WALK, DT);

      expect(first.pose.kind).toBe('blend');
      if (first.pose.kind === 'blend' && second.pose.kind === 'blend') {
        expect(first.pose.from).toBe(IDLE);
        expect(first.pose.to).toBe(WALK);
        expect(first.pose.alpha).toBeCloseTo(DT / DEFAULT_FADE_SECONDS, 6);
        expect(second.pose.alpha).toBeCloseTo((2 * DT) / DEFAULT_FADE_SECONDS, 6);
        expect(second.pose.fromTime).toBeCloseTo(0.5 + 2 * DT, 6); // the outgoing cycle keeps walking
        expect(second.pose.toTime).toBeCloseTo(2 * DT, 6);
      }
      expect(first.captureHold).toBe(false); // a clean (uninterrupted) fade needs no hold
    });

    it('the fade completes after DEFAULT_FADE_SECONDS and returns to a single pose', () => {
      const m = mixer();
      m.update(IDLE, 0.5);
      m.update(WALK, DT);

      const done = m.update(WALK, DEFAULT_FADE_SECONDS); // overshoots the remaining fade

      expect(done.pose.kind).toBe('single');
    });

    it('walk→run carries the normalized phase so the legs stay in step', () => {
      const m = mixer();
      m.update(WALK, DT); // fade idle→walk under way
      m.update(WALK, DEFAULT_FADE_SECONDS); // fade done
      m.update(WALK, 0.75 - DEFAULT_FADE_SECONDS - DT); // walk clock at exactly 0.75 → phase 0.75

      const { pose } = m.update(RUN, DT);

      expect(pose.kind).toBe('blend');
      if (pose.kind === 'blend') {
        // phase 0.75 of walk (1 s) → 0.75 × run duration (0.5 s) = 0.375, plus this frame's dt.
        expect(pose.toTime).toBeCloseTo(0.375 + DT, 6);
      }
    });

    it('a mid-fade re-switch retargets from the held on-screen pose (captureHold fires once)', () => {
      const m = mixer();
      m.update(IDLE, 0.5);
      m.update(WALK, DT); // idle→walk fade begins

      const interrupted = m.update(RUN, DT); // re-switch while fading
      const after = m.update(RUN, DT);

      expect(interrupted.captureHold).toBe(true);
      expect(interrupted.pose.kind).toBe('hold');
      if (interrupted.pose.kind === 'hold') {
        expect(interrupted.pose.to).toBe(RUN);
      }
      expect(after.captureHold).toBe(false); // the hold is frozen once, not chased every frame
      expect(after.pose.kind).toBe('hold');
    });

    it('scales each clip clock by its own playback rate (088/03 cycle-speed sync)', () => {
      // walk plays at 2×, everything else at 1× — the from/to clocks must diverge under a fade.
      const rateOf = (clip: number): number => (clip === WALK ? 2 : 1);
      const m = new LocomotionMixer(DURATIONS, CYCLIC, WALK, { rateOf });
      m.update(WALK, 0.1); // walk clock: 0.2

      const { pose } = m.update(IDLE, 0.1); // fade walk→idle begins

      expect(pose.kind).toBe('blend');
      if (pose.kind === 'blend') {
        expect(pose.fromTime).toBeCloseTo(0.2 + 0.2, 6); // outgoing walk still at 2×
        expect(pose.toTime).toBeCloseTo(0.1, 6); // idle at 1×
        expect(pose.alpha).toBeCloseTo(0.1 / DEFAULT_FADE_SECONDS, 6); // the alpha clock is WALL time
      }
    });

    it('a one-shot clip parks on its last frame instead of wrapping (088/04)', () => {
      const m = new LocomotionMixer(DURATIONS, CYCLIC, RUN, { oneShot: new Set([RUN]) });

      const { pose } = m.update(RUN, 2); // way past the 0.5 s run duration

      expect(pose.kind).toBe('single');
      if (pose.kind === 'single') {
        expect(pose.time).toBeLessThan(0.5); // held a hair BEFORE the duration — exactly at it, the
        expect(pose.time).toBeGreaterThan(0.49); // sampler's wrap would rewind to frame 0
      }
    });

    it('restartFromHold fades the scripted pose into locomotion (the car-exit handback)', () => {
      const m = mixer();
      m.update(WALK, 1); // some prior locomotion state

      m.restartFromHold(IDLE);
      const frame = m.update(IDLE, DT);

      expect(frame.captureHold).toBe(true);
      expect(frame.pose.kind).toBe('hold');
      if (frame.pose.kind === 'hold') {
        expect(frame.pose.to).toBe(IDLE);
        expect(frame.pose.toTime).toBeCloseTo(DT, 6); // locomotion restarts from the top
      }
    });
  });
});
