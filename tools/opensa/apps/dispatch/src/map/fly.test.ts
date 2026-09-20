import { describe, expect, it } from 'vitest';

import { planFlight } from './fly';

/**
 * Pins the path itself, not the feel of it. The failure this defends against is not an ugly animation: it is
 * a flight that ends somewhere other than where it was sent, or one whose duration is a number nobody can
 * predict — both of which look like a camera bug and are arithmetic.
 */
const HERE = { at: [0, 0] as const, span: 500 };

describe('planFlight', () => {
  describe('negative cases', () => {
    it('does not overshoot: past the duration the view is the destination, exactly', () => {
      const flight = planFlight(HERE, { at: [4000, -2000], span: 250 });
      const landed = flight.at(flight.durationMs * 4);

      expect(landed.at[0]).toBe(4000);
      expect(landed.at[1]).toBe(-2000);
      expect(landed.span).toBe(250);
    });

    it('does not cross the city at ground level, which is what makes a long jump unreadable', () => {
      const flight = planFlight(HERE, { at: [6000, 0], span: 500 });
      const middle = flight.at(flight.durationMs / 2);

      // The path pulls UP over the trip rather than dragging the view through everything between.
      expect(middle.span).toBeGreaterThan(HERE.span * 4);
    });

    it('does not spend time going nowhere: the same view twice is not a flight', () => {
      expect(planFlight(HERE, { ...HERE }).durationMs).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('starts where it was asked to start', () => {
      const flight = planFlight(HERE, { at: [3000, 1000], span: 900 });
      const first = flight.at(0);

      expect(first.at[0]).toBeCloseTo(0, 6);
      expect(first.at[1]).toBeCloseTo(0, 6);
      expect(first.span).toBeCloseTo(500, 6);
    });

    it('takes longer for a longer trip, because the duration is the path rather than a constant', () => {
      const near = planFlight(HERE, { at: [400, 0], span: 500 }).durationMs;
      const far = planFlight(HERE, { at: [6000, 0], span: 500 }).durationMs;

      expect(near).toBeGreaterThan(0);
      expect(far).toBeGreaterThan(near);
      // And it is not linear in distance: 15x the ground distance is nothing like 15x the time, which is
      // the property that makes a cross-city jump watchable instead of a wait.
      expect(far).toBeLessThan(near * 15);
    });

    it('moves the centre forward the whole way, never backwards', () => {
      const flight = planFlight(HERE, { at: [4000, 0], span: 500 });
      let previous = -1;
      for (let step = 0; step <= 20; step += 1) {
        const x = flight.at((flight.durationMs * step) / 20).at[0];
        expect(x).toBeGreaterThanOrEqual(previous);
        previous = x;
      }

      expect(previous).toBe(4000);
    });

    it('zooms in place when the destination is the same point, and lands on the span asked for', () => {
      const flight = planFlight(HERE, { at: [0, 0], span: 125 });
      const middle = flight.at(flight.durationMs / 2);

      expect(flight.durationMs).toBeGreaterThan(0);
      expect(middle.at).toEqual([0, 0]);
      // Geometric: half way through a 4x zoom is 2x, not "half the metres".
      expect(middle.span).toBeCloseTo(250, 3);
      expect(flight.at(flight.durationMs).span).toBe(125);
    });
  });
});
