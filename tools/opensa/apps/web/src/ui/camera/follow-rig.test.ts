import { describe, expect, it } from 'vitest';

import { TEST_CAMERA_CONFIG } from './camera-test-config';
import { createFollowPoint, stepFollowPoint } from './follow-rig';

const CONFIG = TEST_CAMERA_CONFIG;

const DT = 1 / 60;

/** Walk the focus to `target` for `seconds` and report where the look point ended up. */
const follow = (
  state: ReturnType<typeof createFollowPoint>,
  target: [number, number, number],
  seconds: number,
  config = CONFIG,
): [number, number, number] => {
  let point: [number, number, number] = state.point ?? [0, 0, 0];
  for (let elapsed = 0; elapsed < seconds; elapsed += DT) {
    point = stepFollowPoint(state, target, config, DT, true);
  }

  return [point[0], point[1], point[2]];
};

describe('stepFollowPoint', () => {
  describe('negative cases', () => {
    it('lands ON the target with smoothing off (the free-fly eye)', () => {
      const state = createFollowPoint();

      expect(stepFollowPoint(state, [5, 2, -3], CONFIG, DT, false)).toEqual([5, 2, -3]);
    });

    it('seeds on the first frame instead of flying in from the origin', () => {
      const state = createFollowPoint();

      expect(stepFollowPoint(state, [100, 5, -100], CONFIG, DT, true)).toEqual([100, 5, -100]);
    });

    it('does not move at all inside the dead zone', () => {
      const state = createFollowPoint();
      stepFollowPoint(state, [0, 0, 0], CONFIG, DT, true);
      const drifted = follow(state, [0.05, 0, 0.05], 1); // 0.07 planar, under the 0.08 dead zone

      expect(drifted[0]).toBe(0);
      expect(drifted[2]).toBe(0);
    });

    it('snaps on a teleport instead of flying across the map', () => {
      const state = createFollowPoint();
      stepFollowPoint(state, [0, 0, 0], CONFIG, DT, true);
      const jumped = stepFollowPoint(state, [0, 0, 400], CONFIG, DT, true);

      expect(jumped).toEqual([0, 0, 400]);
      expect(state.velocityZ.velocity).toBe(0);
    });

    it('never overshoots a step in the focus (critical damping)', () => {
      const state = createFollowPoint();
      stepFollowPoint(state, [0, 0, 0], CONFIG, DT, true);
      let peak = 0;
      for (let elapsed = 0; elapsed < 3; elapsed += DT) {
        peak = Math.max(peak, stepFollowPoint(state, [0, 0, 5], CONFIG, DT, true)[2]);
      }

      expect(peak).toBeLessThanOrEqual(5 + 1e-9);
    });
  });

  describe('positive cases', () => {
    it('trails a moving focus, then catches up when it stops', () => {
      const state = createFollowPoint();
      stepFollowPoint(state, [0, 0, 0], CONFIG, DT, true);
      // A hard direction change: the focus jumps 3 m sideways and holds there.
      const midway = follow(state, [3, 0, 0], 0.06);
      expect(midway[0]).toBeGreaterThan(0);
      expect(midway[0]).toBeLessThan(3); // still visibly behind — that IS the weight

      // It settles INSIDE the dead zone, not exactly on the focus — 8 cm the player cannot see, and the
      // price of a frame that is rock-still while they stand around.
      const settled = follow(state, [3, 0, 0], 1.5);
      expect(3 - settled[0]).toBeLessThanOrEqual(CONFIG.deadZone * 1.5); // creeping down toward 0.08
    });

    it('follows height more slowly than the plane (stairs must not jolt the horizon)', () => {
      const state = createFollowPoint();
      stepFollowPoint(state, [0, 0, 0], CONFIG, DT, true);
      const moved = follow(state, [2, 2, 0], 0.12);

      expect(moved[1]).toBeLessThan(moved[0]); // same 2 m step, less of it covered vertically
    });

    it('never trails further than lagMaxDistance, however fast the focus runs', () => {
      const state = createFollowPoint();
      let point = stepFollowPoint(state, [0, 0, 0], CONFIG, DT, true);
      let focusZ = 0;
      for (let step = 0; step < 240; step += 1) {
        focusZ += 12 * DT; // a 12 m/s sprint, well past the ped's top speed
        point = stepFollowPoint(state, [0, 0, focusZ], CONFIG, DT, true);
        expect(focusZ - point[2]).toBeLessThanOrEqual(CONFIG.lagMaxDistance + 1e-9);
      }
    });

    it('lands in the same place at 1/120 and at 1/20 (rate independence)', () => {
      const fast = createFollowPoint();
      const slow = createFollowPoint();
      stepFollowPoint(fast, [0, 0, 0], CONFIG, 1 / 120, true);
      stepFollowPoint(slow, [0, 0, 0], CONFIG, 1 / 20, true);
      for (let elapsed = 0; elapsed < 0.5; elapsed += 1 / 120) {
        stepFollowPoint(fast, [0, 0, 4], CONFIG, 1 / 120, true);
      }
      for (let elapsed = 0; elapsed < 0.5; elapsed += 1 / 20) {
        stepFollowPoint(slow, [0, 0, 4], CONFIG, 1 / 20, true);
      }

      expect(Math.abs((fast.point?.[2] ?? 0) - (slow.point?.[2] ?? 0))).toBeLessThan(0.1);
    });

    it('acts on a real move even though a dead zone exists', () => {
      const state = createFollowPoint();
      stepFollowPoint(state, [0, 0, 0], CONFIG, DT, true);
      const settled = follow(state, [1, 0, 0], 2);

      expect(settled[0]).toBeGreaterThan(0.9); // the dead zone must not leave a permanent offset
    });
  });
});
