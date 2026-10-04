import { describe, expect, it } from 'vitest';

import { TEST_CAMERA_CONFIG as CONFIG } from './camera-test-config';
import { createLookAhead, stepLookAhead } from './look-ahead';

const DT = 1 / 60;

/** Travel at (vx, vz) for `seconds` and report the offset. */
const travel = (
  state: ReturnType<typeof createLookAhead>,
  vx: number,
  vz: number,
  seconds: number,
): { x: number; z: number } => {
  let offset = { x: state.x, z: state.z };
  for (let elapsed = 0; elapsed < seconds; elapsed += DT) {
    offset = stepLookAhead(state, vx, vz, CONFIG, DT);
  }

  return offset;
};

describe('stepLookAhead', () => {
  describe('negative cases', () => {
    it('stays at zero for a player who is not moving', () => {
      const state = createLookAhead();

      expect(travel(state, 0, 0, 1)).toEqual({ x: 0, z: 0 });
    });

    it('ignores drift under the move threshold', () => {
      const state = createLookAhead();
      const offset = travel(state, 0.3, 0, 1);

      expect(offset.x).toBe(0);
    });

    it('never leans further than the configured distance', () => {
      const state = createLookAhead();
      const offset = travel(state, 40, 0, 3); // absurd speed

      expect(Math.hypot(offset.x, offset.z)).toBeLessThanOrEqual(CONFIG.lookAheadDistance + 1e-9);
    });

    it('fades back to nothing when the player stops, without snapping', () => {
      const state = createLookAhead();
      travel(state, 7, 0, 2);
      const firstStop = stepLookAhead(state, 0, 0, CONFIG, DT);

      expect(firstStop.x).toBeGreaterThan(0.1); // still most of the way out — a fade, not a cut

      const settled = travel(state, 0, 0, 3);
      expect(Math.abs(settled.x)).toBeLessThan(0.01);
    });
  });

  describe('positive cases', () => {
    it('leans toward travel, scaled by speed', () => {
      const walk = createLookAhead();
      const run = createLookAhead();
      const walked = travel(walk, 2, 0, 3);
      const ran = travel(run, 7, 0, 3);

      expect(walked.x).toBeGreaterThan(0);
      expect(ran.x).toBeGreaterThan(walked.x);
      expect(ran.x).toBeCloseTo(CONFIG.lookAheadDistance, 2); // full shift at the run gait
    });

    it('follows a direction change through the damp rather than jumping', () => {
      const state = createLookAhead();
      travel(state, 7, 0, 3);
      const turned = stepLookAhead(state, 0, 7, CONFIG, DT);

      expect(turned.x).toBeGreaterThan(0.5); // still mostly pointing the old way one frame later
      expect(turned.z).toBeGreaterThan(0);

      const settled = travel(state, 0, 7, 3);
      expect(settled.z).toBeCloseTo(CONFIG.lookAheadDistance, 2);
      expect(Math.abs(settled.x)).toBeLessThan(0.01);
    });

    it('lands in the same place at 1/120 and at 1/20 (rate independence)', () => {
      const fast = createLookAhead();
      const slow = createLookAhead();
      for (let elapsed = 0; elapsed < 1; elapsed += 1 / 120) {
        stepLookAhead(fast, 7, 0, CONFIG, 1 / 120);
      }
      for (let elapsed = 0; elapsed < 1; elapsed += 1 / 20) {
        stepLookAhead(slow, 7, 0, CONFIG, 1 / 20);
      }

      expect(Math.abs(fast.x - slow.x)).toBeLessThan(0.02);
    });
  });
});
