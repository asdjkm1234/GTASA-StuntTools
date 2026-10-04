import { describe, expect, it } from 'vitest';

import type { VehicleWheelReading } from '../physics/physics-world';

import {
  computeFrame,
  planarMotion,
  TelemetryRing,
  type VehicleSample,
  VehicleTelemetry,
  wheelCornerLabels,
} from './vehicle-telemetry';

const DT = 1 / 60;
const RADIUS = 0.3;

/** Rotation about `axis` by `angle`, as the body quaternion `[x, y, z, w]`. */
const quat = (axis: 'x' | 'y' | 'z', angle: number): [number, number, number, number] => {
  const half = Math.sin(angle / 2);
  const w = Math.cos(angle / 2);

  return [axis === 'x' ? half : 0, axis === 'y' ? half : 0, axis === 'z' ? half : 0, w];
};

const wheel = (over: Partial<VehicleWheelReading> = {}): VehicleWheelReading => ({
  contact: true,
  forwardImpulse: 0,
  maxTravel: 0.25,
  radius: RADIUS,
  restLength: 0.15,
  rotation: 0,
  sideImpulse: 0,
  suspensionForce: 3000,
  suspensionLength: 0.15,
  ...over,
});

const sample = (over: Partial<VehicleSample> = {}): VehicleSample => ({
  brake: 0,
  engineForce: 0,
  gear: 1,
  handbrake: false,
  linvel: [0, 0, 0],
  orientation: [0, 0, 0, 1], // level, facing +Y
  position: [0, 0, 0],
  steer: 0,
  throttle: 0,
  wheels: [wheel(), wheel()],
  ...over,
});

/** A wheel rolling at exactly the ground speed — no slip either way. */
const rolling = (groundSpeed: number, previousRotation = 0): VehicleWheelReading =>
  wheel({ rotation: previousRotation + (groundSpeed / RADIUS) * DT });

describe('computeFrame', () => {
  describe('negative cases', () => {
    it('reports no rates on the first step — one sample cannot show a rate', () => {
      const frame = computeFrame(sample({ linvel: [0, 20, 0] }), null, DT, 0);

      expect(frame.gLong).toBe(0);
      expect(frame.yawRate).toBe(0);
      expect(frame.slipRatio).toBe(0);
      expect(frame.speed).toBeCloseTo(20, 12); // the instantaneous channels still read
    });

    it('holds the slip channels at zero below the speed floor (noise, not slip)', () => {
      const previous = sample({ linvel: [0.1, 0.1, 0] });
      const frame = computeFrame(sample({ linvel: [0.2, 0.1, 0] }), previous, DT, DT);

      expect(frame.slipAngle).toBe(0);
      expect(frame.slipRatio).toBe(0);
    });

    it('reads no slip from a wheel that is off the ground', () => {
      const airborne = wheel({ contact: false, rotation: 40 }); // spinning freely
      const previous = sample({ linvel: [0, 20, 0], wheels: [airborne] });
      const frame = computeFrame(
        sample({ linvel: [0, 20, 0], wheels: [wheel({ contact: false, rotation: 41 })] }),
        previous,
        DT,
        DT,
      );

      expect(frame.wheels[0].slipRatio).toBe(0);
      expect(frame.slipRatio).toBe(0); // no wheel in contact → nothing to average
    });

    it('clamps compression to the travel range when the spring is past its stops', () => {
      const frame = computeFrame(
        sample({ wheels: [wheel({ suspensionLength: 0.4 }), wheel({ suspensionLength: -0.2 })] }),
        null,
        DT,
        0,
      );

      expect(frame.wheels[0].compression).toBe(0); // hanging past rest
      expect(frame.wheels[1].compression).toBe(1); // bottomed out
    });
  });

  describe('positive cases', () => {
    it('splits the velocity into the car own axes', () => {
      // Level, facing +Y, travelling forward and to its right.
      const frame = computeFrame(sample({ linvel: [3, 20, 0] }), null, DT, 0);

      expect(frame.speed).toBeCloseTo(20, 12);
      expect(frame.speedLateral).toBeCloseTo(3, 12);
      expect(frame.pitch).toBeCloseTo(0, 12);
      expect(frame.roll).toBeCloseTo(0, 12);
    });

    it('reads pitch positive NOSE UP — the sign the braking complaint is measured by', () => {
      const noseUp = computeFrame(sample({ orientation: quat('x', 0.2) }), null, DT, 0);
      const noseDown = computeFrame(sample({ orientation: quat('x', -0.2) }), null, DT, 0);

      expect(noseUp.pitch).toBeCloseTo(0.2, 9);
      expect(noseDown.pitch).toBeCloseTo(-0.2, 9);
    });

    it('reads roll positive with the RIGHT side down', () => {
      const frame = computeFrame(sample({ orientation: quat('y', 0.3) }), null, DT, 0);

      expect(frame.roll).toBeCloseTo(0.3, 9);
    });

    it('signs the slip angle by which way the car points against its travel', () => {
      // Travelling forward + right while pointing straight ahead: the car points LEFT of its path.
      const frame = computeFrame(sample({ linvel: [4, 20, 0] }), null, DT, 0);

      expect(frame.slipAngle).toBeCloseTo(Math.atan2(4, 20), 12);
      expect(frame.slipAngle).toBeGreaterThan(0);
    });

    it('measures the yaw rate across the ±π seam without a full lap', () => {
      // Heading just under +π to just over it: a small step, not a 2π one.
      const before = sample({ orientation: quat('z', Math.PI - 0.01) });
      const after = sample({ orientation: quat('z', -Math.PI + 0.01) });
      const frame = computeFrame(after, before, DT, DT);

      expect(Math.abs(frame.yawRate)).toBeLessThan(0.03 / DT);
    });

    it('projects acceleration into the body frame, in g', () => {
      const previous = sample({ linvel: [0, 20, 0] });
      // Braking: velocity drops by 1 m/s over one step ≈ 60 m/s² ≈ 6.1 g backwards.
      const frame = computeFrame(sample({ linvel: [0, 19, 0] }), previous, DT, DT);

      expect(frame.gLong).toBeCloseTo(-1 / DT / 9.81, 9);
      expect(frame.gLat).toBeCloseTo(0, 12);
    });

    it('turns suspension length into a compression fraction of travel', () => {
      const frame = computeFrame(sample({ wheels: [wheel({ suspensionLength: 0.05 })] }), null, DT, 0);

      expect(frame.wheels[0].compression).toBeCloseTo(0.4, 12); // (0.15 − 0.05) / 0.25
      expect(frame.wheels[0].load).toBe(3000);
    });

    it('reads zero longitudinal slip from a wheel rolling at the ground speed', () => {
      const previous = sample({ linvel: [0, 20, 0], wheels: [wheel()] });
      const frame = computeFrame(sample({ linvel: [0, 20, 0], wheels: [rolling(20)] }), previous, DT, DT);

      expect(frame.wheels[0].slipRatio).toBeCloseTo(0, 9);
    });

    it('signs longitudinal slip: wheelspin positive, a locked wheel negative', () => {
      const previous = sample({ linvel: [0, 20, 0], wheels: [wheel(), wheel()] });
      const frame = computeFrame(
        sample({
          linvel: [0, 20, 0],
          // Left wheel turning at 30 m/s of surface speed, right wheel fully locked.
          wheels: [rolling(30), wheel({ rotation: 0 })],
        }),
        previous,
        DT,
        DT,
      );

      expect(frame.wheels[0].slipRatio).toBeCloseTo(0.5, 6); // (30 − 20) / 20
      expect(frame.wheels[1].slipRatio).toBeCloseTo(-1, 9); // locked: surface speed 0
      expect(frame.slipRatio).toBeCloseTo(-0.25, 6); // mean over the wheels in contact
    });
  });
});

describe('planarMotion', () => {
  // The shared channel: a capture reads it through `computeFrame`, and the CAMERA reads it every rendered
  // frame for drift framing (`EngineVehicles.drivenMotion`). One implementation is what stops the two from
  // disagreeing about which way a slide points.
  describe('negative cases', () => {
    it('reports no slip below the speed floor — an atan2 near the origin is noise, not a slide', () => {
      expect(planarMotion([0, 0, 0, 1], [0.2, 0.1, 0]).slipAngle).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('splits a velocity into the car own axes and signs the slip toward its right', () => {
      const motion = planarMotion([0, 0, 0, 1], [4, 20, 0]); // level, facing +Y, drifting to its right

      expect(motion.heading).toBeCloseTo(0, 12);
      expect(motion.speed).toBeCloseTo(20, 12);
      expect(motion.speedLateral).toBeCloseTo(4, 12);
      expect(motion.slipAngle).toBeCloseTo(Math.atan2(4, 20), 12);
    });

    it('agrees with the frame a capture records — the camera and a capture cannot diverge', () => {
      const sampleAt = sample({ linvel: [4, 20, 0] });
      const frame = computeFrame(sampleAt, null, DT, 0);
      const motion = planarMotion(sampleAt.orientation, sampleAt.linvel);

      expect(motion.slipAngle).toBe(frame.slipAngle);
      expect(motion.speed).toBe(frame.speed);
      expect(motion.heading).toBe(frame.heading);
    });
  });
});

describe('TelemetryRing', () => {
  const frameAt = (t: number): ReturnType<typeof computeFrame> => computeFrame(sample(), null, DT, t);

  describe('negative cases', () => {
    it('has no latest frame before the first push', () => {
      expect(new TelemetryRing(4).latest()).toBeNull();
      expect(new TelemetryRing(4).frames()).toEqual([]);
    });

    it('never grows past its capacity, however long the capture runs', () => {
      const ring = new TelemetryRing(3);
      for (let i = 0; i < 100; i += 1) {
        ring.push(frameAt(i));
      }

      expect(ring.size).toBe(3);
    });
  });

  describe('positive cases', () => {
    it('keeps the newest frames in order, oldest first', () => {
      const ring = new TelemetryRing(3);
      for (let i = 0; i < 5; i += 1) {
        ring.push(frameAt(i));
      }

      expect(ring.frames().map((frame) => frame.t)).toEqual([2, 3, 4]);
      expect(ring.latest()?.t).toBe(4);
    });

    it('reads back in order while still filling', () => {
      const ring = new TelemetryRing(4);
      ring.push(frameAt(0));
      ring.push(frameAt(1));

      expect(ring.frames().map((frame) => frame.t)).toEqual([0, 1]);
      expect(ring.latest()?.t).toBe(1);
    });
  });
});

describe('VehicleTelemetry', () => {
  describe('negative cases', () => {
    it('does nothing at all while disabled — no frame, no history', () => {
      const telemetry = new VehicleTelemetry(10);

      expect(telemetry.step(sample({ linvel: [0, 20, 0] }), DT)).toBeNull();
      expect(telemetry.frames()).toEqual([]);
      expect(telemetry.latest()).toBeNull();
    });

    it('forgets the previous sample on reset, so the next step shows no rates', () => {
      const telemetry = new VehicleTelemetry(10);
      telemetry.enabled = true;
      telemetry.step(sample({ linvel: [0, 20, 0] }), DT);
      telemetry.reset();

      const frame = telemetry.step(sample({ linvel: [0, 10, 0] }), DT);

      expect(frame?.gLong).toBe(0); // no previous to differentiate against
      expect(frame?.t).toBeCloseTo(DT, 12); // and the clock restarted
      expect(telemetry.frames()).toHaveLength(1);
    });
  });

  describe('positive cases', () => {
    it('stamps each frame with the elapsed capture time', () => {
      const telemetry = new VehicleTelemetry(10);
      telemetry.enabled = true;

      telemetry.step(sample(), DT);
      telemetry.step(sample(), DT);

      expect(telemetry.frames().map((frame) => frame.t)).toEqual([DT, DT * 2]);
    });

    it('differentiates against the previous step once it has one', () => {
      const telemetry = new VehicleTelemetry(10);
      telemetry.enabled = true;

      telemetry.step(sample({ linvel: [0, 20, 0] }), DT);
      const frame = telemetry.step(sample({ linvel: [0, 21, 0] }), DT);

      expect(frame?.gLong).toBeCloseTo(1 / DT / 9.81, 9);
    });

    it('keeps each frame where the car WAS, even though the caller reuses one position array', () => {
      const telemetry = new VehicleTelemetry(10);
      telemetry.enabled = true;
      const live: [number, number, number] = [2272, 1193, 9.6]; // the array the vehicle system overwrites

      telemetry.step(sample({ position: live }), DT);
      live[1] = 1293;
      telemetry.step(sample({ position: live }), DT);

      expect(telemetry.frames().map((frame) => frame.position[1])).toEqual([1193, 1293]);
    });
  });
});

describe('wheelCornerLabels', () => {
  describe('negative cases', () => {
    it('gives a straddled hub no side to report (a bike is front and rear, not left and right)', () => {
      const labels = wheelCornerLabels([
        { connection: [0, 0.8, 0.3], front: true, radius: 0.3 },
        { connection: [0, -0.8, 0.3], front: false, radius: 0.3 },
      ]);

      expect(labels).toEqual(['F', 'R']);
    });
  });

  describe('positive cases', () => {
    it('names each corner from the front flag and the hub side (the driver sits at -X)', () => {
      const labels = wheelCornerLabels([
        { connection: [-0.8, 1.2, 0.3], front: true, radius: 0.3 },
        { connection: [0.8, 1.2, 0.3], front: true, radius: 0.3 },
        { connection: [-0.8, -1.2, 0.3], front: false, radius: 0.3 },
        { connection: [0.8, -1.2, 0.3], front: false, radius: 0.3 },
      ]);

      expect(labels).toEqual(['FL', 'FR', 'RL', 'RR']);
    });
  });
});

describe('VehicleTelemetry aliasing', () => {
  describe('negative cases', () => {
    it('does not lose the rate channels when the caller reuses its arrays', () => {
      // `EnterableVehicle.orientation` and its linvel are long-lived arrays the physics system overwrites in
      // place; a sampler that kept the REFERENCE compared each step against itself and reported every
      // orientation-derived rate as 0 (found by a real capture: a u-turn with turnedDeg 0.00).
      const telemetry = new VehicleTelemetry(10);
      telemetry.enabled = true;
      const orientation: [number, number, number, number] = [0, 0, 0, 1];
      const linvel: [number, number, number] = [0, 10, 0];
      const reused = sample({ linvel, orientation });

      telemetry.step(reused, DT);
      const turned = quat('z', 0.1);
      orientation[0] = turned[0];
      orientation[1] = turned[1];
      orientation[2] = turned[2];
      orientation[3] = turned[3];
      linvel[1] = 12;
      const frame = telemetry.step(reused, DT);

      expect(frame?.yawRate).not.toBe(0);
      expect(frame?.gLong).not.toBe(0);
    });
  });
});
