import type { Route } from '@opensa/game/paths/route-builder';

import { mulberry32 } from '@opensa/game/paths/rng';
import { describe, expect, it } from 'vitest';

import {
  AERIAL_PRESETS,
  clearFlight,
  createFlight,
  FLY_MAX_EXTENT,
  FLY_PASS_SECONDS,
  FLY_PASSES,
  planFlight,
  stepFlight,
} from './fly';

/** A straight route heading +X at the builder's own 2 m spacing, `metres` long. */
function straightRoute(metres: number): Route {
  const points = Math.floor(metres / 2) + 1;

  return {
    length: metres,
    maxTurnDeg: 0,
    minCurveRadius: Infinity,
    nodes: [],
    points: Array.from({ length: points }, (_, index) => ({
      position: [index * 2, 0, 5] as [number, number, number],
      speed: 12,
    })),
    stop: 'target',
    turnsDeg: [],
  };
}

const ANCHOR = [0, 0, 5] as const;
const clear = (): boolean => true;
const blocked = (): boolean => false;

describe('planFlight', () => {
  describe('negative cases', () => {
    it('never plans a pass beyond the streaming cap, however long the route is', () => {
      // 2 km of road offered; the ring is what decides, not the route.
      const passes = planFlight(straightRoute(2000), mulberry32(7), ANCHOR);

      const furthest = Math.max(
        ...passes.flatMap((pass) => pass.path.map((frame) => Math.hypot(frame.pos[0], frame.pos[1]))),
      );
      expect(furthest).toBeLessThanOrEqual(FLY_MAX_EXTENT);
    });

    it('does not spend two of five passes on the same shape', () => {
      const names = planFlight(straightRoute(600), mulberry32(3), ANCHOR).map((pass) => pass.preset.name);

      expect(new Set(names).size).toBe(names.length);
    });

    it('keeps every pass inside the height band a flight is authored for', () => {
      const passes = planFlight(straightRoute(600), mulberry32(11), ANCHOR);
      // Ground sits at z = 5, so the eye's height above it is what the band applies to.
      const heights = passes.flatMap((pass) => pass.path.map((frame) => frame.pos[2] - 5));

      expect(Math.min(...heights)).toBeGreaterThanOrEqual(15);
      expect(Math.max(...heights)).toBeLessThanOrEqual(40);
    });
  });

  describe('positive cases', () => {
    it('deals five passes, and the same seed deals the same five', () => {
      const first = planFlight(straightRoute(600), mulberry32(42), ANCHOR);
      const again = planFlight(straightRoute(600), mulberry32(42), ANCHOR);

      expect(first).toHaveLength(FLY_PASSES);
      expect(first.map((pass) => pass.preset.name)).toEqual(again.map((pass) => pass.preset.name));
      expect(first[0].path).toEqual(again[0].path);
    });

    it('looks AHEAD along the route rather than at the point under the eye', () => {
      const passes = planFlight(straightRoute(600), mulberry32(5), ANCHOR);
      const level = passes.find((pass) => pass.preset.lateral === 0) ?? passes[0];

      // The look point leads the eye down the line the pass is flying.
      expect(level.path[0].look[0]).toBeGreaterThan(level.path[0].pos[0]);
    });
  });
});

describe('clearFlight', () => {
  describe('negative cases', () => {
    it('rejects a pass that never clears rather than flying it at "nearly clear"', () => {
      const passes = planFlight(straightRoute(600), mulberry32(9), ANCHOR);

      const flight = clearFlight(passes, blocked);

      expect(flight.passes).toEqual([]);
      expect(flight.casts).toBeGreaterThan(0);
    });

    it('lifts the WHOLE pass, never one blocked segment — a local bulge is the discrete dodge', () => {
      // A LEVEL pass, so one ceiling describes the whole line — on a descent the keyframes sit at different
      // heights and the test would be measuring the preset's profile instead of the lift.
      const passes = planFlight(straightRoute(600), mulberry32(13), ANCHOR).filter(
        (pass) => pass.preset.fromHeight === pass.preset.toHeight && pass.preset.lateral === 0,
      );
      const ceiling = passes[0].path[0].pos[2] + 5; // clear only once the pass is above this
      const aboveOnly = (from: readonly [number, number, number]): boolean => from[2] > ceiling;

      const flown = clearFlight(passes, aboveOnly).passes;

      expect(flown).toHaveLength(passes.length);
      expect(flown[0].lifted).toBe(10);
      // Every keyframe moved by the same amount: the profile the preset authored is intact.
      const rises = flown[0].path.map((frame, index) => frame.pos[2] - passes[0].path[index].pos[2]);
      expect(new Set(rises)).toEqual(new Set([10]));
    });
  });

  describe('positive cases', () => {
    it('leaves a clear pass exactly where it was planned', () => {
      const passes = planFlight(straightRoute(600), mulberry32(21), ANCHOR);

      const flown = clearFlight(passes, clear).passes;

      expect(flown).toHaveLength(FLY_PASSES);
      expect(flown.map((pass) => pass.lifted)).toEqual(flown.map(() => 0));
      expect(flown[0].path).toEqual(passes[0].path);
    });
  });
});

describe('stepFlight', () => {
  const flightOf = (seed: number): ReturnType<typeof createFlight> =>
    createFlight(clearFlight(planFlight(straightRoute(600), mulberry32(seed), ANCHOR), clear).passes);

  describe('negative cases', () => {
    it('answers a blocked probe with an EASED climb, never a step', () => {
      const flight = flightOf(4);
      // Blocked from the first probe onward: the guard asks for its full lift immediately.
      const heights: number[] = [];
      for (let frame = 0; frame < 90; frame += 1) {
        const at = stepFlight(flight, 1 / 60, blocked);
        if (at) {
          heights.push(at.eye[2]);
        }
      }

      const steps = heights.slice(1).map((height, index) => height - heights[index]);
      expect(flight.guardHits).toBeGreaterThan(0);
      // 8 m/s at 60 Hz is ~0.13 m a frame; nothing may jump by the 10 m the guard asked for.
      expect(Math.max(...steps)).toBeLessThan(1);
    });

    it('does not carry one pass climb into the next — a cut is a new camera', () => {
      const flight = flightOf(6);
      for (let frame = 0; frame < FLY_PASS_SECONDS * 60; frame += 1) {
        stepFlight(flight, 1 / 60, blocked);
      }

      expect(flight.index).toBe(1);
      expect(flight.lift).toBe(0);
      expect(flight.liftTarget).toBe(0);
    });

    it('returns nothing once the last pass has run out', () => {
      const flight = flightOf(8);
      for (let frame = 0; frame < FLY_PASSES * FLY_PASS_SECONDS * 60 + 10; frame += 1) {
        stepFlight(flight, 1 / 60, clear);
      }

      expect(flight.done).toBe(true);
      expect(stepFlight(flight, 1 / 60, clear)).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('declares a cut on the first frame of every pass, and on no other frame', () => {
      const flight = flightOf(2);
      let cuts = 0;
      for (let frame = 0; frame < FLY_PASSES * FLY_PASS_SECONDS * 60; frame += 1) {
        if (stepFlight(flight, 1 / 60, clear)?.cut) {
          cuts += 1;
        }
      }

      expect(cuts).toBe(FLY_PASSES);
    });

    it('probes the world about once a second, not once a frame', () => {
      const flight = flightOf(10);
      for (let frame = 0; frame < 5 * 60; frame += 1) {
        stepFlight(flight, 1 / 60, clear);
      }

      expect(flight.guardProbes).toBeLessThanOrEqual(6);
      expect(flight.guardProbes).toBeGreaterThanOrEqual(4);
    });
  });
});

describe('AERIAL_PRESETS', () => {
  describe('positive cases', () => {
    it('offers exactly one shape per pass slot, each named once', () => {
      expect(AERIAL_PRESETS).toHaveLength(FLY_PASSES);
      expect(new Set(AERIAL_PRESETS.map((preset) => preset.name)).size).toBe(AERIAL_PRESETS.length);
    });
  });
});
