import { describe, expect, it } from 'vitest';

import { seatVehicleOnGround } from './vehicle-seating';

/** Half-extents of a typical car: 1 wide, 2 long (the pitch reach), 0.75 tall. */
const HALF: [number, number, number] = [1, 2, 0.75];

/** Fake physics: ground height from a function of (x, y), blocked spots from a predicate. */
function fakePhysics(
  groundAt: (x: number, y: number) => null | number,
  blockedAt: (x: number, y: number) => boolean = () => false,
): Parameters<typeof seatVehicleOnGround>[0] {
  return {
    groundBelow: (position) => groundAt(position[0], position[1]),
    overlapsBox: (position) => blockedAt(position[0], position[1]),
  };
}

describe('seatVehicleOnGround', () => {
  describe('negative cases', () => {
    it('throws (defers the spawn) when no ground exists at any candidate — the collision cell is not streamed yet', () => {
      const physics = fakePhysics(() => null);

      expect(() => seatVehicleOnGround(physics, [10, 20, 5], 0, HALF)).toThrow(/deferred/);
    });
  });

  describe('positive cases', () => {
    it('seats on flat ground: body base on the surface, no pitch', () => {
      const physics = fakePhysics(() => 4);
      const seat = seatVehicleOnGround(physics, [10, 20, 5], 0, HALF);

      expect(seat.position).toEqual([10, 20, 4 + HALF[2] + 0.1]);
      expect(seat.pitch).toBe(0);
    });

    it('pitches with the street: nose/tail probes along the heading set the slope angle', () => {
      // Heading 0 = facing +Y; ground rises 1 unit per unit of y → pitch = atan2(rise over 2·reach, 2·reach).
      const physics = fakePhysics((_x, y) => y - 20);
      const seat = seatVehicleOnGround(physics, [10, 20, 5], 0, HALF);

      // nose at y=22 → 2, tail at y=18 → −2: pitch = atan2(4, 4) = 45°, seated at the probe average.
      expect(seat.pitch).toBeCloseTo(Math.PI / 4, 5);
      expect(seat.position[2]).toBeCloseTo(0 + HALF[2] + 0.1, 5);
    });

    it('slides along the heading off a blocked spot (a lamp post the vertical rays cannot see)', () => {
      const physics = fakePhysics(
        () => 0,
        (_x, y) => y < 21, // the original spot (y=20) is blocked; +3 along +Y is clear
      );
      const seat = seatVehicleOnGround(physics, [10, 20, 5], 0, HALF);

      expect(seat.position[0]).toBeCloseTo(10, 5);
      expect(seat.position[1]).toBeCloseTo(23, 5);
    });

    it('falls back to the original (blocked) spot when every candidate is blocked — spawn beats no car', () => {
      const physics = fakePhysics(
        () => 0,
        () => true,
      );
      const seat = seatVehicleOnGround(physics, [10, 20, 5], 0, HALF);

      expect(seat.position[1]).toBeCloseTo(20, 5);
    });
  });
});
