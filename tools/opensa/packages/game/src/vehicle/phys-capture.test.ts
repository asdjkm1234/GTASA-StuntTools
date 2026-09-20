import { describe, expect, it } from 'vitest';

import type { TelemetryFrame, WheelFrame } from './vehicle-telemetry';

import { summarisePhysFrames, thinFrames } from './phys-capture';

const DT = 1 / 60;

const wheel = (contact = true, surface: null | number = null): WheelFrame => ({
  compression: 0.5,
  contact,
  forwardImpulse: 0,
  load: 3000,
  sideImpulse: 0,
  slipRatio: 0,
  surface,
});

const frame = (t: number, over: Partial<TelemetryFrame> = {}): TelemetryFrame => ({
  brake: 0,
  engineForce: 0,
  gear: 1,
  gLat: 0,
  gLong: 0,
  gVert: 0,
  handbrake: false,
  heading: 0,
  pitch: 0,
  position: [0, 0, 0],
  roll: 0,
  slipAngle: 0,
  slipRatio: 0,
  speed: 0,
  speedLateral: 0,
  steer: 0,
  t,
  throttle: 0,
  wheels: [wheel(), wheel()],
  yawRate: 0,
  ...over,
});

/** `count` frames one fixed step apart, each shaped by `at(index)`. */
const lap = (count: number, at: (index: number) => Partial<TelemetryFrame>): TelemetryFrame[] =>
  Array.from({ length: count }, (_, index) => frame(index * DT, at(index)));

describe('summarisePhysFrames', () => {
  describe('negative cases', () => {
    it('summarises an empty capture to zeros instead of throwing', () => {
      const summary = summarisePhysFrames([]);

      expect(summary.frames).toBe(0);
      expect(summary.brake).toBeNull();
      expect(summary.topSpeedKmh).toBe(0);
    });

    it('reports no braking run when the lap braked but never stopped inside the capture', () => {
      const summary = summarisePhysFrames(lap(60, () => ({ brake: 5000, speed: 20 })));

      expect(summary.brake).toBeNull();
      expect(summary.pitchUnderBrakeDeg).toBe(0); // it DID brake, so the pitch number still exists
    });

    it('reports no time-to-100 for a car that never gets there', () => {
      expect(summarisePhysFrames(lap(120, () => ({ speed: 10 }))).timeTo100S).toBeNull();
    });

    it('reports no flip while the car stays on its wheels', () => {
      expect(summarisePhysFrames(lap(60, () => ({ roll: Math.PI / 4 }))).flip).toBeNull();
    });

    it('reports no flight for a lap that never left the ground', () => {
      expect(summarisePhysFrames(lap(60, () => ({ speed: 20 }))).air).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('reports the DIVE as the mean pitch while decelerating, where the peak reads the wrong sign', () => {
      // The instant the brake goes on the nose has not come down yet, so the PEAK nose-up is positive on a
      // car that then dives 2° — the field verdict "the nose lifts" was partly this metric. The mean over
      // the frames that are actually slowing answers the question that was being asked.
      const frames = [
        ...lap(6, () => ({ brake: 8000, gLong: -1.5, pitch: 0.03, speed: 20 })), // brake bites, nose still up
        ...lap(60, () => ({ brake: 8000, gLong: -1.5, pitch: -0.03, speed: 10 })).map((f) => ({
          ...f,
          t: f.t + 0.1,
        })),
      ];
      const summary = summarisePhysFrames(frames);

      expect(summary.pitchUnderBrakeDeg).toBeCloseTo(1.72, 1); // the peak says NOSE UP
      expect(summary.diveDeg).toBeLessThan(-1); // the mean says it dived
    });

    it('reports no dive for a lap that never braked hard', () => {
      expect(summarisePhysFrames(lap(60, () => ({ speed: 20 }))).diveDeg).toBeNull();
    });

    it('keeps the peak nose-up angle reached while the brakes were on, not the lap maximum', () => {
      const frames = [
        ...lap(30, () => ({ pitch: 0.5 })), // a big nose-up BEFORE the brakes: a crest, not the complaint
        ...lap(30, () => ({ brake: 8000, pitch: 0.1, speed: 20 })).map((f) => ({ ...f, t: f.t + 0.5 })),
      ];

      expect(summarisePhysFrames(frames).pitchUnderBrakeDeg).toBeCloseTo(5.73, 1);
      expect(summarisePhysFrames(frames).pitchDeg.max).toBeCloseTo(28.65, 1);
    });

    it('measures a braking run from its first braked frame to the stop', () => {
      // 2 s rolling at 20 m/s, then 60 frames of braking that end stopped.
      const frames = [
        ...lap(120, () => ({ speed: 20 })),
        ...lap(60, (index) => ({ brake: 8000, speed: index < 59 ? 20 : 0 })).map((f) => ({ ...f, t: f.t + 2 })),
      ];
      const { brake } = summarisePhysFrames(frames);

      expect(brake?.fromKmh).toBeCloseTo(72, 0);
      expect(brake?.seconds).toBeCloseTo(0.98, 1);
      expect(brake?.distanceM).toBeCloseTo(19.7, 0);
    });

    it('counts air time from the frames with no wheel in contact', () => {
      const frames = lap(120, (index) => ({ wheels: index >= 30 && index < 90 ? [wheel(false)] : [wheel()] }));

      expect(summarisePhysFrames(frames).airborneS).toBeCloseTo(1, 1);
    });

    it('separates one real flight from a lap that merely skipped, and says what the nose did (081/06 §1)', () => {
      // A dozen 2-frame hops, then one half-second flight in which the nose comes up 10°. The TOTAL air of
      // the hops is the larger number — which is why the total cannot answer whether the driver ever flew.
      const hops = lap(60, (index) => ({ wheels: index % 5 < 2 ? [wheel(false)] : [wheel()] }));
      const flight = lap(30, (index) => ({
        pitch: (index / 29) * 0.1745,
        wheels: index < 29 ? [wheel(false)] : [wheel()],
      })).map((f) => ({ ...f, t: f.t + 1 }));
      const summary = summarisePhysFrames([...hops, ...flight]);

      expect(summary.air?.seconds).toBeCloseTo(0.47, 1);
      expect(summary.air?.pitchDeg).toBeCloseTo(9.7, 0);
      expect(summary.airborneS).toBeGreaterThan(summary.air?.seconds ?? 0);
    });

    it('integrates the whole rotation, not the shortest way round', () => {
      // A full turn and a bit: 2.5 rad/s for 3 s = 7.5 rad ≈ 430°, which a shortest-angle diff would call 70.
      const frames = lap(180, () => ({ yawRate: 2.5 }));

      expect(summarisePhysFrames(frames).turnedDeg).toBeCloseTo(427, -1);
    });

    it('flags the first flip with the speed it happened at', () => {
      const frames = lap(120, (index) => ({ roll: index < 60 ? 0.2 : Math.PI / 2, speed: 15 }));
      const { flip } = summarisePhysFrames(frames);

      expect(flip?.atS).toBeCloseTo(1, 1);
      expect(flip?.atKmh).toBeCloseTo(54, 0);
    });
  });
});

describe('summarisePhysFrames surfaces', () => {
  describe('negative cases', () => {
    it('reports no surfaces at all when nothing under the wheels was identified', () => {
      expect(summarisePhysFrames(lap(10, () => ({}))).surfaces).toEqual({});
    });

    it('counts only the samples that KNOW their surface, so airborne frames do not dilute the shares', () => {
      const grounded = frame(0, { wheels: [wheel(true, 1), wheel(true, 1)] });
      const airborne = frame(DT, { wheels: [wheel(false), wheel(false)] });

      expect(summarisePhysFrames([grounded, airborne]).surfaces).toEqual({ 1: 1 });
    });
  });

  describe('positive cases', () => {
    it('shares the lap out per WHEEL sample — two wheels on grass IS half the car off the road', () => {
      const straddling = frame(0, { wheels: [wheel(true, 1), wheel(true, 27)] });

      expect(
        summarisePhysFrames([straddling, frame(DT, { wheels: [wheel(true, 1), wheel(true, 27)] })]).surfaces,
      ).toEqual({ 1: 0.5, 27: 0.5 });
    });

    it('orders the shares by how much of the lap each surface took', () => {
      const frames = [
        frame(0, { wheels: [wheel(true, 1), wheel(true, 1)] }),
        frame(DT, { wheels: [wheel(true, 1), wheel(true, 33)] }),
      ];

      expect(Object.keys(summarisePhysFrames(frames).surfaces)).toEqual(['1', '33']);
    });
  });
});

describe('thinFrames', () => {
  describe('negative cases', () => {
    it('returns a two-frame capture untouched — there is nothing to thin', () => {
      const frames = lap(2, () => ({}));

      expect(thinFrames(frames, 10)).toEqual(frames);
    });
  });

  describe('positive cases', () => {
    it('thins to about the asked rate and always keeps the last frame', () => {
      const frames = lap(601, () => ({})); // 10 s at 60 Hz
      const thinned = thinFrames(frames, 20);

      expect(thinned.length).toBeGreaterThan(190);
      expect(thinned.length).toBeLessThan(210);
      expect(thinned[thinned.length - 1]).toBe(frames[frames.length - 1]);
    });
  });
});

/** A lap that steers: `count` frames, with a step of `steer` rad held between `from` and `to` seconds, and a
 *  yaw rate that answers it as a first-order lag with time constant `tau`. */
const stepLap = (steer: number, from: number, to: number, tau: number, settled: number): TelemetryFrame[] =>
  lap(900, (index) => {
    const t = index * DT;
    const held = t >= from && t < to;
    const since = t - from;

    return {
      speed: 20,
      steer: held ? steer : 0,
      yawRate: held ? settled * (1 - Math.exp(-since / tau)) : 0,
    };
  });

describe('summarisePhysFrames step response', () => {
  describe('negative cases', () => {
    it('reports no step for a lap that never turned the wheel', () => {
      expect(summarisePhysFrames(lap(600, () => ({ speed: 20 }))).step).toBeNull();
    });

    it('reports no step for a flick too short to have settled', () => {
      expect(summarisePhysFrames(stepLap(0.2, 2, 2.8, 0.3, 0.5)).step).toBeNull();
    });

    it('reports a hold that broke away as NOT settled — its other fields describe a crash', () => {
      // Yaw peaks, then collapses to nothing: a spin, a stop or a roll inside the hold.
      const frames = lap(900, (index) => {
        const t = index * DT;
        const held = t >= 2 && t < 9;

        return { speed: 20, steer: held ? 0.2 : 0, yawRate: held && t < 3 ? 1.2 : 0.001 };
      });

      expect(summarisePhysFrames(frames).step?.settled).toBe(false);
    });

    it('gives an instant car a rise time at the floor — the complaint made measurable', () => {
      // tau tiny: the yaw is at its settled value within a frame or two, which is "it just changes vector".
      const step = summarisePhysFrames(stepLap(0.2, 2, 8, 0.001, 0.5)).step;

      expect(step?.yawRiseS).toBeLessThan(0.05);
    });
  });

  describe('positive cases', () => {
    it('measures the rise to 90 % of the settled yaw', () => {
      // A first-order lag reaches 90 % at t = tau × ln(10) ≈ 2.30 tau; tau 0.1 s → ~0.23 s, inside the
      // steady window so the settled value it is measured against is the real plateau.
      const step = summarisePhysFrames(stepLap(0.2, 2, 9, 0.1, 0.5)).step;

      expect(step?.settled).toBe(true);
      expect(step?.yawRiseS).toBeCloseTo(0.23, 1);
      expect(step?.yawSettledDegS).toBeCloseTo(0.5 * (180 / Math.PI), 0);
      expect(step?.atS).toBeCloseTo(2, 1);
      expect(step?.speedAtStepKmh).toBeCloseTo(72, 0);
    });

    it('reports no overshoot for a response that only approaches its settled value', () => {
      const step = summarisePhysFrames(stepLap(0.2, 2, 9, 0.1, 0.5)).step;

      expect(step?.yawOvershoot).toBeLessThanOrEqual(1.01);
    });

    it('UNDER-reports the rise of a car slower than the steady window, and says so by not settling', () => {
      // The window is 0.3-1.0 s after the step because a held corner leaves a two-lane street in about two
      // seconds. A car whose own transient is that long has not plateaued inside it, so the median it is
      // compared against is low and the spread check catches it. Measuring such a car properly needs an
      // open-ground scene — recorded as owed in the 081/01 ledger.
      const step = summarisePhysFrames(stepLap(0.2, 2, 9, 0.6, 0.5)).step;

      expect(step?.settled).toBe(false);
      expect(step?.yawRiseS).toBeLessThan(0.6 * Math.log(10)); // the true 90 % time is 1.38 s
    });

    it('takes the FIRST step of a lap that steers both ways', () => {
      const frames = lap(900, (index) => {
        const t = index * DT;

        return { speed: 20, steer: t >= 2 && t < 8 ? 0.2 : t >= 10 ? -0.2 : 0, yawRate: 0.4 };
      });

      expect(summarisePhysFrames(frames).step?.atS).toBeCloseTo(2, 1);
    });
  });
});
