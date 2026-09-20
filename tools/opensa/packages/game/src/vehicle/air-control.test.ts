import { describe, expect, it } from 'vitest';

import { airAttitudeDelta, type AirControlInput, carBasis } from './air-control';

/** The car sitting level and facing +Y — then each torque falls on one world axis and is readable by eye. */
const LEVEL = {
  forward: [0, 1, 0] as [number, number, number],
  right: [1, 0, 0] as [number, number, number],
  up: [0, 0, 1] as [number, number, number],
};
/** SA's `0.0007 / (1/50)²` — the angular acceleration one unit of stick buys a car under 3000 turn mass. */
const AUTHORITY = 1.75;
const STEP = 1 / 60;

function input(overrides: Partial<AirControlInput> = {}): AirControlInput {
  return {
    accelerating: false,
    angular: [0, 0, 0],
    basis: LEVEL,
    handbrake: false,
    pitch: 0,
    scale: 1,
    steer: 0,
    step: STEP,
    turnMass: 2000,
    ...overrides,
  };
}

describe('airAttitudeDelta', () => {
  describe('negative cases', () => {
    it('returns null when the driver asks for nothing', () => {
      expect(airAttitudeDelta(input())).toBeNull();
    });

    it('returns null with the dial turned off', () => {
      expect(airAttitudeDelta(input({ pitch: 1, scale: 0 }))).toBeNull();
    });

    it('refuses to fight a tumble that is already faster than the original allows', () => {
      // Pitching nose-down at 2 rad/s (about the car's right axis) — past SA's 0.02 game-unit gate.
      expect(airAttitudeDelta(input({ angular: [-2, 0, 0], pitch: 1 }))).toBeNull();
    });

    it('does not roll while the throttle is held', () => {
      expect(airAttitudeDelta(input({ accelerating: true, steer: 1 }))).toBeNull();
    });

    it('does not roll while the handbrake is up — the stick yaws instead', () => {
      const delta = airAttitudeDelta(input({ handbrake: true, steer: 1 }));

      expect(delta?.[1]).toBe(0); // nothing about the car's forward axis
    });
  });

  describe('positive cases', () => {
    it('noses the car up on throttle, at the original strength', () => {
      const delta = airAttitudeDelta(input({ pitch: 1 }));

      expect(delta?.[0]).toBeCloseTo(AUTHORITY * STEP, 6); // about the car's right axis = nose up
      expect(delta?.[1]).toBe(0);
      expect(delta?.[2]).toBe(0);
    });

    it('noses down on the brake', () => {
      expect(airAttitudeDelta(input({ pitch: -1 }))?.[0]).toBeCloseTo(-AUTHORITY * STEP, 6);
    });

    it('rolls toward the steering when the driver is off the throttle', () => {
      const delta = airAttitudeDelta(input({ steer: 1 }));

      expect(delta?.[1]).toBeCloseTo(AUTHORITY * STEP, 6); // about the car's forward axis = roll right
      expect(delta?.[0]).toBe(0);
    });

    it('yaws with the handbrake up', () => {
      const delta = airAttitudeDelta(input({ handbrake: true, steer: 1 }));

      expect(delta?.[2]).toBeCloseTo(-AUTHORITY * STEP, 6); // steering right yaws the nose right
    });

    it('gives a heavy car proportionally less authority', () => {
      const light = airAttitudeDelta(input({ pitch: 1, turnMass: 3000 }))?.[0] ?? 0;
      const truck = airAttitudeDelta(input({ pitch: 1, turnMass: 12000 }))?.[0] ?? 0;

      expect(truck).toBeCloseTo(light / 4, 6); // min(1, 3000 / turnMass)
    });

    it('gives every car under the reference turn mass the same authority', () => {
      const small = airAttitudeDelta(input({ pitch: 1, turnMass: 800 }))?.[0] ?? 0;
      const large = airAttitudeDelta(input({ pitch: 1, turnMass: 3000 }))?.[0] ?? 0;

      expect(small).toBeCloseTo(large, 6);
    });

    it('scales with the field dial', () => {
      const half = airAttitudeDelta(input({ pitch: 1, scale: 0.5 }))?.[0] ?? 0;

      expect(half).toBeCloseTo((AUTHORITY * STEP) / 2, 6);
    });

    it('turns the car about ITS OWN axes, not the world ones', () => {
      // The car points along −X (a quarter turn left): its right axis is now +Y, so a nose-up pitches there.
      const turned = {
        forward: [-1, 0, 0] as [number, number, number],
        right: [0, 1, 0] as [number, number, number],
        up: [0, 0, 1] as [number, number, number],
      };
      const delta = airAttitudeDelta(input({ basis: turned, pitch: 1 }));

      expect(delta?.[1]).toBeCloseTo(AUTHORITY * STEP, 6);
      expect(delta?.[0]).toBeCloseTo(0, 6);
    });

    it('pitches and rolls in the same step', () => {
      const delta = airAttitudeDelta(input({ pitch: 1, steer: -1 }));

      expect(delta?.[0]).toBeCloseTo(AUTHORITY * STEP, 6);
      expect(delta?.[1]).toBeCloseTo(-AUTHORITY * STEP, 6);
    });
  });
});

describe('carBasis', () => {
  describe('positive cases', () => {
    it('reads a level car facing +Y off an identity rotation', () => {
      const basis = carBasis([0, 0, 0, 1]);

      expect(basis.right).toEqual([1, 0, 0]);
      expect(basis.forward).toEqual([0, 1, 0]);
      expect(basis.up).toEqual([0, 0, 1]);
    });

    it('follows a quarter turn to the left about Z', () => {
      const half = Math.SQRT1_2;
      const basis = carBasis([0, 0, half, half]); // +90° about Z

      expect(basis.forward[0]).toBeCloseTo(-1, 6);
      expect(basis.forward[1]).toBeCloseTo(0, 6);
      expect(basis.right[1]).toBeCloseTo(1, 6);
      expect(basis.up[2]).toBeCloseTo(1, 6);
    });

    it('reads a car rolled onto its side', () => {
      const half = Math.SQRT1_2;
      const basis = carBasis([0, half, 0, half]); // +90° about the car's own forward axis

      expect(basis.forward[1]).toBeCloseTo(1, 6); // a roll leaves the nose where it was
      expect(basis.up[0]).toBeCloseTo(1, 6); // its up now points to the world's +X
      expect(basis.right[2]).toBeCloseTo(-1, 6);
    });
  });
});
