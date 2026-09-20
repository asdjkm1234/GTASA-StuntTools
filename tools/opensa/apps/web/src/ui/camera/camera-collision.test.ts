import { describe, expect, it } from 'vitest';

import {
  type CameraProbe,
  createCollisionState,
  type GroundProbe,
  gtaFromEngine,
  guardFloor,
  resolveCollision,
} from './camera-collision';
import { TEST_CAMERA_CONFIG as CONFIG } from './camera-test-config';

const LOOK: [number, number, number] = [0, 2, 0]; // engine look point (head height)
const BEHIND: [number, number, number] = [0, 0, -1]; // eye direction: straight back along −Z
const DT = 1 / 60;

/** A probe that always reports the same free distance (null = clear); `dynamic` marks a moving hit. */
const fixed =
  (dist: null | number, dynamic = false): CameraProbe =>
  () =>
    dist === null ? null : { dist, dynamic };

describe('gtaFromEngine', () => {
  describe('positive cases', () => {
    it('maps engine (x, y, z) to GTA (x, −z, y)', () => {
      expect(gtaFromEngine([1, 2, 3])).toEqual([1, -3, 2]);
    });
  });
});

describe('resolveCollision', () => {
  describe('negative cases', () => {
    it('passes the distance through untouched when there is no probe', () => {
      const state = createCollisionState(7);

      expect(resolveCollision(state, LOOK, BEHIND, 7, CONFIG, null, DT)).toBe(7);
    });

    it('passes through when the radius disables collision', () => {
      const state = createCollisionState(7);

      expect(resolveCollision(state, LOOK, BEHIND, 7, { ...CONFIG, collisionRadius: 0 }, fixed(2), DT)).toBe(7);
    });

    it('never extends the distance past the desired zoom (a far wall is not a pull-out)', () => {
      const state = createCollisionState(7);

      expect(resolveCollision(state, LOOK, BEHIND, 7, CONFIG, fixed(20), DT)).toBe(7);
    });

    it('follows a FALLING desired distance directly — the end of an eased window has nothing to snap', () => {
      // The seat-entry jump (09 field round 1): desired glides 7 → 4.4 through the zoom damp with the
      // eased window on and a CLEAR cast. The old pull-in branch treated the fall as an occluder, lagged
      // the glide on the eased path, and the window's end completed the leftover difference as a slam.
      const state = createCollisionState(7);
      let desired = 7;
      let shown = 7;
      for (let frame = 0; frame < 60; frame += 1) {
        desired = 4.4 + (desired - 4.4) * Math.exp(-8 / 60); // the zoom channel's own λ=8 glide
        shown = resolveCollision(state, LOOK, BEHIND, desired, CONFIG, fixed(null), DT, true);
        expect(Math.abs(shown - desired)).toBeLessThan(1e-6); // tracks the glide, never lags it
      }

      const after = resolveCollision(state, LOOK, BEHIND, desired, CONFIG, fixed(null), DT, false);

      expect(Math.abs(after - shown)).toBeLessThan(0.05); // the window ends: no leftover, no snap
    });
  });

  describe('negative cases — a moving body is not a wall (plan 080/09 §4.2)', () => {
    it('does not snap for a DYNAMIC hit — a passer-by crossing the line eases, never yanks', () => {
      const state = createCollisionState(7);

      const first = resolveCollision(state, LOOK, BEHIND, 7, CONFIG, fixed(3, true), DT);

      expect(first).toBeLessThan(7); // it does respond…
      expect(first).toBeGreaterThan(6); // …but as a glide, not the one-frame yank that read as a jump
    });

    it('still converges onto a dynamic occluder that stays — parked traffic ends up respected', () => {
      const state = createCollisionState(7);
      let value = 7;
      for (let frame = 0; frame < 300; frame += 1) {
        value = resolveCollision(state, LOOK, BEHIND, 7, CONFIG, fixed(3, true), DT);
      }

      expect(value).toBeCloseTo(3, 2);
    });
  });

  describe('positive cases', () => {
    it('snaps IN immediately when a wall is closer than the desired distance', () => {
      const state = createCollisionState(7);

      expect(resolveCollision(state, LOOK, BEHIND, 7, CONFIG, fixed(3), DT)).toBeCloseTo(3, 6);
    });

    it('never comes closer than the near-plane floor (a very close wall clips the ped, not skybox)', () => {
      const state = createCollisionState(7);

      // A wall 0.2 m behind would put the near plane inside geometry; it holds at the 0.5 near-plane floor.
      expect(resolveCollision(state, LOOK, BEHIND, 7, CONFIG, fixed(0.2), DT)).toBeCloseTo(0.5, 6);
    });

    it('eases back out when the wall clears', () => {
      const state = createCollisionState(3); // pulled in to 3
      const first = resolveCollision(state, LOOK, BEHIND, 7, CONFIG, fixed(null), DT);
      expect(first).toBeGreaterThan(3);
      expect(first).toBeLessThan(7); // still gliding out

      let value = first;
      for (let frame = 0; frame < 300; frame += 1) {
        value = resolveCollision(state, LOOK, BEHIND, 7, CONFIG, fixed(null), DT);
      }
      expect(value).toBeCloseTo(7, 2);
    });

    it('takes the MIN across the primary and the two whiskers when whiskers are on', () => {
      const state = createCollisionState(7);
      let call = 0;
      const probe: CameraProbe = () => {
        call += 1;

        return call === 1 ? null : { dist: 2.5, dynamic: false }; // primary clear, whiskers hit at 2.5
      };

      expect(
        resolveCollision(state, LOOK, BEHIND, 7, { ...CONFIG, collisionWhiskerAngle: 0.26 }, probe, DT),
      ).toBeCloseTo(2.5, 6);
    });

    it('casts from the look point in GTA space, along −forward', () => {
      const seen: { dir: readonly number[]; from: readonly number[] }[] = [];
      const probe: CameraProbe = (from, dir) => {
        seen.push({ dir: [...dir], from: [...from] });

        return null;
      };
      resolveCollision(createCollisionState(7), LOOK, BEHIND, 7, CONFIG, probe, DT);

      expect(seen[0].from).toEqual(gtaFromEngine(LOOK)); // [0, 0, 2]
      expect(seen[0].dir).toEqual(gtaFromEngine(BEHIND)); // [0, 1, 0]
    });
  });
});

describe('guardFloor', () => {
  const ground =
    (z: null | number): GroundProbe =>
    () =>
      z;

  describe('negative cases', () => {
    it('returns the eye unchanged with no probe', () => {
      expect(guardFloor([1, 5, 3], null)).toEqual([1, 5, 3]);
    });

    it('leaves an eye well above the ground alone', () => {
      expect(guardFloor([0, 5, 0], ground(0))).toEqual([0, 5, 0]);
    });

    it('leaves the eye alone when there is no ground below it', () => {
      expect(guardFloor([0, 1, 0], ground(null))).toEqual([0, 1, 0]);
    });
  });

  describe('positive cases', () => {
    it('lifts an eye that sank below the ground to a margin above it', () => {
      // engine Y is GTA Z: ground at 4, eye at 3.9 → lifted to 4 + 0.3 margin.
      expect(guardFloor([2, 3.9, -1], ground(4))[1]).toBeCloseTo(4.3, 6);
    });

    it('keeps x and z while lifting only the height', () => {
      const lifted = guardFloor([2, 0, -1], ground(4));

      expect(lifted[0]).toBe(2);
      expect(lifted[2]).toBe(-1);
    });
  });
});
