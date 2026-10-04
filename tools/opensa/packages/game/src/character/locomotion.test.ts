import { describe, expect, it } from 'vitest';

import { angleDelta, approachAngle, scheduledTurnRate, yawFromPlanar } from './locomotion';

describe('locomotion heading math', () => {
  describe('negative cases', () => {
    it('approachAngle with a zero rate does not turn', () => {
      expect(approachAngle(1, 3, 0)).toBe(1);
    });

    it('approachAngle with a negative rate does not turn', () => {
      expect(approachAngle(1, 3, -0.5)).toBe(1);
    });

    it('scheduledTurnRate with a zero full speed stays finite (full-tier rate, no division blow-up)', () => {
      expect(scheduledTurnRate(5, 0, 720, 240)).toBeCloseTo((240 * Math.PI) / 180, 6);
    });
  });

  describe('positive cases', () => {
    it('angleDelta picks the shortest arc across the ±π seam', () => {
      // 170° → −170°: the short way is +20° through the seam, not −340° around.
      const from = (170 * Math.PI) / 180;
      const to = (-170 * Math.PI) / 180;
      expect(angleDelta(from, to)).toBeCloseTo((20 * Math.PI) / 180, 6);
    });

    it('angleDelta is signed toward the target', () => {
      expect(angleDelta(0, 1)).toBeCloseTo(1, 6);
      expect(angleDelta(1, 0)).toBeCloseTo(-1, 6);
    });

    it('approachAngle clamps a big turn to the rate', () => {
      expect(approachAngle(0, Math.PI / 2, 0.1)).toBeCloseTo(0.1, 6);
    });

    it('approachAngle snaps exactly to the target when within the rate', () => {
      expect(approachAngle(0.5, 0.55, 0.1)).toBe(0.55);
    });

    it('approachAngle turns through the ±π seam without unwinding', () => {
      // Just under +π turning toward just under −π: one small positive step wraps negative.
      const current = Math.PI - 0.05;
      const next = approachAngle(current, -Math.PI + 0.05, 0.06);
      expect(next).toBeLessThan(0); // wrapped, not swung the long way through 0
      expect(Math.abs(next)).toBeGreaterThan(Math.PI - 0.1);
    });

    it('scheduledTurnRate lerps from the idle rate to the full-tier rate', () => {
      const idle = scheduledTurnRate(0, 7, 720, 240);
      const half = scheduledTurnRate(3.5, 7, 720, 240);
      const full = scheduledTurnRate(7, 7, 720, 240);
      expect(idle).toBeCloseTo((720 * Math.PI) / 180, 6);
      expect(half).toBeCloseTo((480 * Math.PI) / 180, 6);
      expect(full).toBeCloseTo((240 * Math.PI) / 180, 6);
      expect(scheduledTurnRate(20, 7, 720, 240)).toBeCloseTo(full, 6); // clamped past the top tier
    });

    it('yawFromPlanar matches the renderer heading convention', () => {
      expect(yawFromPlanar(0, 1)).toBeCloseTo(0, 6); // +Y = north = yaw 0
      expect(yawFromPlanar(-1, 0)).toBeCloseTo(Math.PI / 2, 6);
      expect(Math.abs(yawFromPlanar(0, -1))).toBeCloseTo(Math.PI, 6);
    });
  });
});
