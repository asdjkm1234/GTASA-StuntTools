import { describe, expect, it } from 'vitest';

import type { VehicleHandling } from '../interfaces/world-adapter.interface';

import { buildGearbox, createDrivetrainState, dragDeceleration, driveAcceleration } from './drivetrain';
import { fakeHandling } from './vehicle-handling.fake';

/** A row with the fields this module reads made explicit — everything else comes from the shared fake. */
function row(overrides: Partial<VehicleHandling>): VehicleHandling {
  return fakeHandling(overrides);
}

/** The infernus as the shipped table authors it: 4WD, five gears, 240 km/h, 30 m/s², drag 1.5. */
const INFERNUS = row({ dragMult: 1.5, drive: '4', engineAccel: 30, engineInertia: 10, gears: 5, maxVelocity: 240 });

describe('drivetrain', () => {
  describe('negative cases', () => {
    it('pulls nothing below the reverse limit', () => {
      const box = buildGearbox(INFERNUS);
      const state = createDrivetrainState();

      const output = driveAcceleration(box, INFERNUS, state, {
        grounded: true,
        speed: box.reverseSpeed - 1,
        step: 1 / 60,
        throttle: -1,
      });

      expect(output.accel).toBe(0);
    });

    it('pulls nothing above the gear ceiling', () => {
      const box = buildGearbox(INFERNUS);
      const state = createDrivetrainState();

      const output = driveAcceleration(box, INFERNUS, state, {
        grounded: true,
        speed: box.maxSpeed + 1,
        step: 1 / 60,
        throttle: 1,
      });

      expect(output.accel).toBe(0);
    });

    it('never lets a draggy row reach the top speed its column claims', () => {
      // A 6.5 t truck authored at 170 km/h with drag 3: the balance point is what it actually does.
      const truck = row({ dragMult: 3, drive: 'R', engineAccel: 27, gears: 5, maxVelocity: 400 });

      const box = buildGearbox(truck);

      expect(box.flatTop * 3.6).toBeLessThan(400);
      expect(dragDeceleration(truck.dragMult, box.flatTop)).toBeLessThanOrEqual(truck.engineAccel / 6);
    });
  });

  describe('positive cases', () => {
    it('splits the speed range into bands that end at the gear ceiling', () => {
      const box = buildGearbox(INFERNUS);

      expect(box.gears).toHaveLength(6); // reverse + five
      expect(box.gears[5].maxSpeed).toBeCloseTo(box.maxSpeed, 5);
      expect(box.maxSpeed).toBeCloseTo(box.flatTop * 1.2, 5);
      for (let gear = 2; gear <= 5; gear++) {
        expect(box.gears[gear].maxSpeed).toBeGreaterThan(box.gears[gear - 1].maxSpeed);
        // Hysteresis: a gear is left upward later than the one above is left downward.
        expect(box.gears[gear].changeDown).toBeLessThan(box.gears[gear - 1].changeUp);
      }
    });

    it('pulls four times harder in first than in top gear', () => {
      const box = buildGearbox(INFERNUS);
      const first = driveAcceleration(
        box,
        INFERNUS,
        { bandFraction: 0, gear: 1, thrustFactor: 1 },
        {
          grounded: false, // no shift shaping, so the gear multiplier is what is being read
          speed: 1,
          step: 1 / 60,
          throttle: 1,
        },
      );
      const top = driveAcceleration(
        box,
        INFERNUS,
        { bandFraction: 0, gear: 5, thrustFactor: 1 },
        {
          grounded: false,
          speed: box.gears[5].maxSpeed - 1,
          step: 1 / 60,
          throttle: 1,
        },
      );

      expect(first.gear).toBe(1);
      expect(top.gear).toBe(5);
      expect(first.accel / top.accel).toBeCloseTo(4, 5);
    });

    it('reads the engine field as m/s² and splits it by drive type', () => {
      const rearDrive = row({ ...INFERNUS, drive: 'R' });
      const box = buildGearbox(rearDrive);

      const top = driveAcceleration(
        box,
        rearDrive,
        { bandFraction: 0, gear: 5, thrustFactor: 1 },
        {
          grounded: false,
          speed: box.gears[5].maxSpeed - 1,
          step: 1 / 60,
          throttle: 1,
        },
      );

      // Top gear multiplier is 1, so this is engineAccel × 0.4 ÷ 2 — the whole formula, visible.
      expect(top.accel).toBeCloseTo((30 * 0.4) / 2, 5);
    });

    it('shifts up through its bands as the car gains speed', () => {
      const box = buildGearbox(INFERNUS);
      const state = createDrivetrainState();
      const seen: number[] = [];

      for (const speed of [1, 15, 25, 35, 45, 60]) {
        const output = driveAcceleration(box, INFERNUS, state, { grounded: true, speed, step: 1 / 60, throttle: 1 });
        state.gear = output.gear;
        seen.push(output.gear);
      }

      expect(seen).toEqual([...seen].sort((a, b) => a - b)); // never shifts down while accelerating
      expect(seen[seen.length - 1]).toBeGreaterThan(seen[0]);
    });

    it('costs a beat of thrust when a shift lands', () => {
      const box = buildGearbox(INFERNUS);
      const state = createDrivetrainState();
      // Settle inside first gear, then step across the band edge in one go.
      let last = 0;
      for (let i = 0; i < 30; i++) {
        last = driveAcceleration(box, INFERNUS, state, { grounded: true, speed: 10, step: 1 / 60, throttle: 1 }).accel;
      }
      const crossing = driveAcceleration(box, INFERNUS, state, {
        grounded: true,
        speed: box.gears[1].changeUp + 0.5,
        step: 1 / 60,
        throttle: 1,
      });

      expect(crossing.gear).toBe(2);
      expect(crossing.accel).toBeLessThan(last);
    });

    it('pulls right up to the gear ceiling and nothing past it', () => {
      // The top gear's ceiling IS the gearbox ceiling, which is why the original's taper never bites: the
      // guard at the top of the function has already returned by the time a car could be inside the taper.
      const box = buildGearbox(INFERNUS);
      const pull = (speed: number): number =>
        driveAcceleration(
          box,
          INFERNUS,
          { bandFraction: 0, gear: 5, thrustFactor: 1 },
          {
            grounded: false,
            speed,
            step: 1 / 60,
            throttle: 1,
          },
        ).accel;

      expect(box.gears[5].maxSpeed).toBeCloseTo(box.maxSpeed, 5);
      expect(pull(box.maxSpeed - 0.1)).toBeGreaterThan(0);
      expect(pull(box.maxSpeed + 0.1)).toBe(0);
    });

    it('grows drag with the square of speed', () => {
      expect(dragDeceleration(2, 20)).toBeCloseTo(dragDeceleration(2, 10) * 4, 10);
      expect(dragDeceleration(2, 10)).toBeCloseTo((2 * 100) / 2000, 10);
    });
  });
});
