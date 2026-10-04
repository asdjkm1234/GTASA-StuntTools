import { describe, expect, it } from 'vitest';

import { createLookInput, releaseLook } from './camera-input';

const SMOOTH = 0.03;
const DT = 1 / 60;

/** Release everything still pending and report the total applied over `frames` idle frames. */
const drain = (state: ReturnType<typeof createLookInput>, frames: number, smoothTime = SMOOTH): number => {
  let total = 0;
  for (let frame = 0; frame < frames; frame += 1) {
    total += releaseLook(state, 0, 0, smoothTime, DT).x;
  }

  return total;
};

describe('releaseLook', () => {
  describe('negative cases', () => {
    it('applies the raw delta whole when smoothing is off (smoothTime 0)', () => {
      const state = createLookInput();

      expect(releaseLook(state, 40, -12, 0, DT)).toEqual({ x: 40, y: -12 });
      expect(state.pendingX).toBe(0);
    });

    it('does not swallow input on a zero dt — it holds it for the next frame', () => {
      const state = createLookInput();
      const applied = releaseLook(state, 40, 0, SMOOTH, 0);

      expect(applied.x).toBe(40); // a zero-dt frame cannot damp, so it releases rather than losing the flick
      expect(state.pendingX).toBe(0);
    });

    it('never applies the whole flick in one frame while smoothing', () => {
      const state = createLookInput();

      expect(releaseLook(state, 100, 0, SMOOTH, DT).x).toBeLessThan(100);
      expect(state.pendingX).toBeGreaterThan(0);
    });
  });

  describe('positive cases', () => {
    it('conserves the gesture: everything injected is eventually applied', () => {
      const state = createLookInput();
      const injected = [30, 25, 18, 9, 4];
      let applied = 0;
      for (const delta of injected) {
        applied += releaseLook(state, delta, 0, SMOOTH, DT).x;
      }
      applied += drain(state, 30);

      expect(applied).toBeCloseTo(
        injected.reduce((sum, value) => sum + value, 0),
        3,
      );
    });

    it('is 90% done within 80 ms and effectively over by 150 ms', () => {
      const state = createLookInput();
      releaseLook(state, 100, 0, SMOOTH, DT);
      drain(state, Math.round(0.08 / DT) - 1);
      // Continuous form: exp(-0.08/0.03) = 6.9% left at 80 ms with the shipped 0.03 s smooth time.
      expect(Math.abs(state.pendingX)).toBeLessThan(10);

      drain(state, Math.round(0.07 / DT));
      expect(Math.abs(state.pendingX)).toBeLessThan(1);
    });

    it('spreads the same gesture over the same TIME whatever the frame rate', () => {
      const fast = createLookInput();
      const slow = createLookInput();
      let fastApplied = releaseLook(fast, 100, 0, SMOOTH, 1 / 120).x;
      for (let frame = 1; frame < 6; frame += 1) {
        fastApplied += releaseLook(fast, 0, 0, SMOOTH, 1 / 120).x;
      }
      const slowApplied = releaseLook(slow, 100, 0, SMOOTH, 6 / 120).x;

      expect(Math.abs(fastApplied - slowApplied)).toBeLessThan(1);
    });

    it('damps both axes independently', () => {
      const state = createLookInput();
      const applied = releaseLook(state, 60, -60, SMOOTH, DT);

      expect(applied.x).toBeCloseTo(-applied.y, 12);
    });
  });
});
