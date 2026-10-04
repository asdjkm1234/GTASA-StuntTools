import { describe, expect, it } from 'vitest';

import type { Vec3 } from './rig/matrix';

import { judgeRide, rampWeights } from './seat-patch';

/** A track that holds one offset from `car` for `frames` frames. */
function riding(car: readonly Vec3[], offset: Vec3): Vec3[] {
  return car.map(([x, y, z]): Vec3 => [x + offset[0], y + offset[1], z + offset[2]]);
}

const DRIVING: Vec3[] = Array.from({ length: 200 }, (_, frame) => [0, frame * 0.1, 0]);
/** A parked car gets a handful of keyframes — the trap that hid RIOT_4B's greenwood. */
const PARKED: Vec3[] = Array.from({ length: 5 }, () => [3.15, -52.1, -0.3]);

describe('judgeRide', () => {
  describe('negative cases', () => {
    it('rejects a track too short to judge', () => {
      expect(judgeRide(riding(DRIVING, [0.5, 0.1, -0.1]).slice(0, 10), DRIVING.slice(0, 10))).toBeNull();
    });

    it('rejects an actor who never comes near the car', () => {
      expect(judgeRide(riding(DRIVING, [8, 0, 0]), DRIVING)).toBeNull();
    });

    it('rejects an actor who drifts rather than rides', () => {
      const drifting = DRIVING.map(([x, y, z], frame) => [x + 0.5, y + frame * 0.004, z] as Vec3);
      expect(judgeRide(drifting, DRIVING)).toBeNull();
    });

    it('rejects an actor inside the cabin for less than half the scene', () => {
      const half = DRIVING.map(([x, y, z], frame): Vec3 => (frame < 120 ? [x + 9, y, z] : [x + 0.5, y, z]));
      expect(judgeRide(half, DRIVING)).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('reports the mean offset of an actor riding the whole scene', () => {
      const ride = judgeRide(riding(DRIVING, [0.5, 0.1, -0.11]), DRIVING)!;
      expect(ride.percent).toBe(100);
      expect(ride.offset[0]).toBeCloseTo(0.5, 6);
      expect(ride.offset[2]).toBeCloseTo(-0.11, 6);
      expect(ride.spread).toBeLessThan(1e-6);
    });

    it('holds a PARKED car’s last keyframe instead of comparing only the overlap', () => {
      // The car states 5 frames, the actor 200. Comparing the overlap would judge 5 and skip the pair;
      // holding the static pose is what the engine does and what the census must do.
      const actor = Array.from({ length: 200 }, () => [3.15 - 0.51, -52.1 + 0.17, -0.3 - 0.11] as Vec3);
      const ride = judgeRide(actor, PARKED)!;
      expect(ride.frames).toBe(200);
      expect(ride.percent).toBe(100);
      expect(ride.offset[0]).toBeCloseTo(-0.51, 5);
      expect(ride.offset[2]).toBeCloseTo(-0.11, 5);
    });

    it('reports the partial share for an actor who gets in mid-scene', () => {
      // SMOKE2B's cssmoke shape: outside for a while, then seated. The patch pass uses this number to
      // leave him alone — lifting his whole track would float him on the way to the door.
      const actor = DRIVING.map(([x, y, z], frame): Vec3 => (frame < 40 ? [x + 9, y, z] : [x + 0.5, y, z]));
      const ride = judgeRide(actor, DRIVING)!;
      expect(ride.percent).toBeCloseTo(80, 5);
    });
  });
});

describe('rampWeights', () => {
  describe('negative cases', () => {
    it('lifts nothing when the actor is never in the cabin', () => {
      expect(rampWeights([false, false, false, false])).toEqual([0, 0, 0, 0]);
    });
  });

  describe('positive cases', () => {
    it('holds the full lift for an actor who never leaves', () => {
      expect(rampWeights([true, true, true])).toEqual([1, 1, 1]);
    });

    it('ramps DOWN across an exit run — SMOKE2B’s cssmoke leaves at frame 754 and never returns', () => {
      const weights = rampWeights([true, true, false, false, false, false]);
      expect(weights.slice(0, 2)).toEqual([1, 1]);
      // Monotone down to zero at the last frame: no pop at the boundary, no lift left when he is out.
      expect(weights[2]).toBeGreaterThan(weights[3]);
      expect(weights[5]).toBe(0);
    });

    it('ramps UP across an entry run', () => {
      const weights = rampWeights([false, false, false, true, true]);
      expect(weights[0]).toBeLessThan(weights[1]);
      expect(weights[2]).toBeCloseTo(1, 6);
      expect(weights.slice(3)).toEqual([1, 1]);
    });

    it('keeps the full lift through a lean-out bounded by cabin frames on both sides', () => {
      // He leaned out of the window and came back — he never stopped riding, and cutting the lift
      // there would pop him twice rather than once.
      expect(rampWeights([true, false, false, true])).toEqual([1, 1, 1, 1]);
    });
  });
});
