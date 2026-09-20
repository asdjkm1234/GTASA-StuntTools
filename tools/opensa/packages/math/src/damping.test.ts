import { describe, expect, it } from 'vitest';

import { angleDelta, damp, dampAngle, smoothDamp, smoothDampAngle } from './damping';

/** Run a smoother for `seconds` in fixed steps and report where it landed. */
const run = (step: (dt: number) => void, seconds: number, dt: number): void => {
  for (let elapsed = 0; elapsed < seconds - 1e-9; elapsed += dt) {
    step(dt);
  }
};

describe('damp', () => {
  describe('negative cases', () => {
    it('does not move on a zero or negative dt', () => {
      expect(damp(1, 10, 5, 0)).toBe(1);
      expect(damp(1, 10, 5, -0.016)).toBe(1);
    });

    it('never moves at a non-positive lambda (an infinite half-life)', () => {
      expect(damp(1, 10, 0, 0.5)).toBe(1);
      expect(damp(1, 10, -3, 0.5)).toBe(1);
    });

    it('stays finite when an infinite lambda meets a zero dt', () => {
      expect(damp(1, 10, Number.POSITIVE_INFINITY, 0)).toBe(1);
    });
  });

  describe('positive cases', () => {
    it('halves the error every ln2/lambda seconds', () => {
      const lambda = Math.LN2 / 0.1; // half-life 0.1 s

      expect(damp(0, 1, lambda, 0.1)).toBeCloseTo(0.5, 12);
      expect(damp(0, 1, lambda, 0.2)).toBeCloseTo(0.75, 12);
    });

    it('snaps at an infinite lambda (the legacy-parity setting)', () => {
      expect(damp(1, 10, Number.POSITIVE_INFINITY, 1 / 60)).toBe(10);
    });

    it('lands within 1e-3 whether stepped at 1/60, 1/10 or 1 s', () => {
      let fast = 0;
      let slow = 0;
      run((dt) => (fast = damp(fast, 10, 3, dt)), 1, 1 / 60);
      run((dt) => (slow = damp(slow, 10, 3, dt)), 1, 1 / 10);
      const single = damp(0, 10, 3, 1);

      expect(Math.abs(fast - slow)).toBeLessThan(1e-3);
      expect(Math.abs(fast - single)).toBeLessThan(1e-3);
    });
  });
});

describe('angleDelta', () => {
  describe('positive cases', () => {
    it('takes the short way over the +pi seam', () => {
      expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 12);
    });

    it('takes the short way over the -pi seam', () => {
      expect(angleDelta(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(-0.2, 12);
    });
  });
});

describe('dampAngle', () => {
  describe('positive cases', () => {
    it('crosses the seam forwards instead of unwinding a full lap', () => {
      const moved = dampAngle(Math.PI - 0.1, -Math.PI + 0.1, Math.LN2 / 0.1, 0.1);

      expect(moved).toBeCloseTo(Math.PI, 12); // half of the 0.2 rad hop, landing ON the seam
    });

    it('crosses the seam backwards too', () => {
      const moved = dampAngle(-Math.PI + 0.1, Math.PI - 0.1, Math.LN2 / 0.1, 0.1);

      expect(moved).toBeCloseTo(-Math.PI, 12);
    });
  });
});

describe('smoothDamp', () => {
  describe('negative cases', () => {
    it('does not move on a zero dt', () => {
      const ref = { velocity: 5 };

      expect(smoothDamp(2, 10, ref, 0.3, Number.POSITIVE_INFINITY, 0)).toBe(2);
      expect(ref.velocity).toBe(5);
    });

    it('never overshoots the target (critical damping)', () => {
      const ref = { velocity: 0 };
      let value = 0;
      let peak = 0;
      run(
        (dt) => {
          value = smoothDamp(value, 1, ref, 0.2, Number.POSITIVE_INFINITY, dt);
          peak = Math.max(peak, value);
        },
        2,
        1 / 60,
      );

      expect(peak).toBeLessThanOrEqual(1);
      expect(value).toBeCloseTo(1, 6);
    });
  });

  describe('positive cases', () => {
    it('eases in: the first step moves less than a plain exponential would', () => {
      const ref = { velocity: 0 };
      const spring = smoothDamp(0, 1, ref, 0.3, Number.POSITIVE_INFINITY, 1 / 60);

      expect(spring).toBeLessThan(damp(0, 1, 2 / 0.3, 1 / 60));
      expect(ref.velocity).toBeGreaterThan(0);
    });

    it('covers most of the distance in one smoothTime and settles within three', () => {
      const ref = { velocity: 0 };
      let value = 0;
      // A critically damped spring is at 1 − 3e⁻² ≈ 0.594 after one smoothTime — that is the shape, not a
      // "done by then" promise; the settle assertion below is what "reached" means.
      run((dt) => (value = smoothDamp(value, 1, ref, 0.5, Number.POSITIVE_INFINITY, dt)), 0.5, 1 / 60);

      expect(value).toBeGreaterThan(0.55);
      expect(value).toBeLessThan(0.65);

      run((dt) => (value = smoothDamp(value, 1, ref, 0.5, Number.POSITIVE_INFINITY, dt)), 1, 1 / 60);

      expect(value).toBeGreaterThan(0.98);
    });

    it('engages the maxSpeed clamp', () => {
      const capped = { velocity: 0 };
      const free = { velocity: 0 };
      let cappedValue = 0;
      let freeValue = 0;
      run(
        (dt) => {
          cappedValue = smoothDamp(cappedValue, 100, capped, 0.5, 10, dt);
          freeValue = smoothDamp(freeValue, 100, free, 0.5, Number.POSITIVE_INFINITY, dt);
        },
        0.25,
        1 / 60,
      );

      expect(cappedValue).toBeLessThan(freeValue);
      expect(cappedValue).toBeLessThanOrEqual(10 * 0.25 + 1e-6); // never faster than maxSpeed
    });

    it('agrees within 2% between a 1/60 and a 1/10 step (the documented approximation)', () => {
      const fastRef = { velocity: 0 };
      const slowRef = { velocity: 0 };
      let fast = 0;
      let slow = 0;
      run((dt) => (fast = smoothDamp(fast, 10, fastRef, 0.4, Number.POSITIVE_INFINITY, dt)), 0.5, 1 / 60);
      run((dt) => (slow = smoothDamp(slow, 10, slowRef, 0.4, Number.POSITIVE_INFINITY, dt)), 0.5, 1 / 10);

      expect(Math.abs(fast - slow)).toBeLessThan(0.2);
    });
  });
});

describe('smoothDampAngle', () => {
  describe('positive cases', () => {
    it('springs across the seam the short way', () => {
      const ref = { velocity: 0 };
      let angle = Math.PI - 0.1;
      run((dt) => (angle = smoothDampAngle(angle, -Math.PI + 0.1, ref, 0.2, Number.POSITIVE_INFINITY, dt)), 1, 1 / 60);

      expect(Math.abs(angleDelta(angle, -Math.PI + 0.1))).toBeLessThan(1e-3);
      expect(angle).toBeGreaterThan(Math.PI - 0.1); // moved FORWARD over +pi, never back through 0
    });
  });
});
