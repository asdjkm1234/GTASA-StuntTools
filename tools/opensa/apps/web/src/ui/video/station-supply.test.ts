import type { Route } from '@opensa/game/paths/route-builder';

import { mulberry32 } from '@opensa/game/paths/rng';
import { describe, expect, it } from 'vitest';

import type { StationSupplyDeps } from './station-supply';
import type { StationProbes } from './stations';

import { createStationSupply } from './station-supply';
import { STATION_LATERALS } from './stations';

/** A straight road along GTA +Y at z = 10, 2 m between vertices, target 12 m/s. */
const ROUTE = {
  length: 118,
  maxTurnDeg: 0,
  minCurveRadius: Infinity,
  nodes: [],
  points: Array.from({ length: 60 }, (_unused, at) => ({
    position: [100, 200 + at * 2, 10] as [number, number, number],
    speed: 12,
  })),
  stop: 'target',
  turnsDeg: [],
} satisfies Route;

/** A flat world with nothing in the way. */
const openWorld: StationProbes = { groundBelow: () => 10, pathClear: () => true };

/** The deps a test overrides — a car cruising at target speed, a tripod two seconds out. */
const deps = (over: Partial<StationSupplyDeps> = {}): StationSupplyDeps => ({
  carGta: () => [100, 200, 10],
  carSpeed: () => 12,
  cursor: () => 0,
  excludeBody: () => 77,
  probes: openWorld,
  random: mulberry32(5),
  route: ROUTE,
  toEngine: (gta) => [gta[0], gta[2], -gta[1]],
  upcoming: () => ({ index: 1, seconds: 6, startsIn: 2 }),
  ...over,
});

/** Step the supply until it stops spending, and hand back the frames it took. */
const runSurvey = (supply: ReturnType<typeof createStationSupply>, frames = 40): number => {
  for (let frame = 0; frame < frames; frame += 1) {
    supply.beginFrame();
    if (supply.step() === 0) {
      return frame;
    }
  }

  return frames;
};

describe('createStationSupply', () => {
  describe('negative cases', () => {
    it('does nothing while the plan holds no tripod at all', () => {
      const supply = createStationSupply(deps({ upcoming: () => null }));

      expect(supply.step()).toBe(0);
      expect(supply.take()).toBeNull();
      expect(supply.ledger().casts).toBe(0);
    });

    it('does not survey a tripod that is still several shots away', () => {
      const supply = createStationSupply(deps({ upcoming: () => ({ index: 3, seconds: 6, startsIn: 30 }) }));

      expect(supply.step()).toBe(0);
      expect(supply.ledger().casts).toBe(0);
    });

    it('does not predict from a car that is still pulling away', () => {
      // 3 m/s against a 12 m/s target: that speed describes the launch, not the road ahead.
      const supply = createStationSupply(deps({ carSpeed: () => 3 }));

      expect(supply.step()).toBe(0);
      expect(supply.ledger().casts).toBe(0);
    });

    it('spends no more than the per-frame budget, whatever the world costs', () => {
      const supply = createStationSupply(deps({ probes: { groundBelow: () => null, pathClear: () => true } }));
      for (let frame = 0; frame < 10; frame += 1) {
        supply.beginFrame();
        supply.step();

        expect(supply.frameCasts()).toBeLessThanOrEqual(3);
      }
    });

    it('surveys a slot ONCE — a verdict is not re-asked while the same shot is still coming', () => {
      const supply = createStationSupply(deps());
      runSurvey(supply);
      const spent = supply.ledger().casts;

      supply.beginFrame();

      expect(supply.step()).toBe(0);
      expect(supply.ledger().casts).toBe(spent);
    });

    it('hands out nothing when every candidate was rejected', () => {
      const supply = createStationSupply(deps({ probes: { groundBelow: () => 10, pathClear: () => false } }));
      runSurvey(supply);

      expect(supply.take()).toBeNull();
      expect(supply.ledger().empty).toBe(1);
      expect(supply.ledger().filled).toBe(0);
    });

    it('hands a station out only ONCE — taking it consumes it', () => {
      const supply = createStationSupply(deps());
      runSurvey(supply);

      expect(supply.take()).not.toBeNull();
      expect(supply.take()).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('surveys a tripod that starts NOW, even with the car parked (a scene opening on one)', () => {
      // Behind the black overlay there is no preceding shot to amortise over, and no speed to predict from.
      const supply = createStationSupply(
        deps({ carSpeed: () => 0, upcoming: () => ({ index: 0, seconds: 6, startsIn: 0 }) }),
      );
      runSurvey(supply);

      expect(supply.ledger().filled).toBe(1);
      expect(supply.take()).not.toBeNull();
    });

    it('hands the director an ENGINE-space eye off a GTA station', () => {
      const supply = createStationSupply(deps());
      runSurvey(supply);
      const eye = supply.take();

      // toEngine(x, y, z) = (x, z, −y): the road runs along +Y, so the eye's engine Z is negative and its
      // X sits one of the table's offsets away from the line — which one is the seed's business.
      expect(STATION_LATERALS.map(String)).toContain(String(Math.abs((eye?.[0] ?? 100) - 100)));
      expect(eye?.[1]).toBeGreaterThan(10); // ground plus the drawn height class
      expect(eye?.[2]).toBeLessThan(-200);
    });

    it('yields the rest of the frame budget to a plant that already spent it (096/09)', () => {
      const supply = createStationSupply(deps());
      supply.beginFrame();
      // Three sightline probes is what a planted shot's occlusion check costs on the frame it starts. The
      // survey must take what is LEFT, not its own full allowance, or the frame goes over 080's ≤ 5 rule.
      supply.sightline([0, 1, 0], [0, 1, -10]);
      supply.sightline([0, 1, 0], [0, 1, -10]);
      supply.sightline([0, 1, 0], [0, 1, -10]);

      expect(supply.step()).toBe(0);
      expect(supply.frameCasts()).toBe(3);
      expect(supply.ledger().castsMax).toBeLessThanOrEqual(3);
    });

    it('reports what the survey cost and how far off its prediction was', () => {
      const supply = createStationSupply(deps({ carGta: () => [100, 215, 10] }));
      runSurvey(supply);
      supply.take();
      const ledger = supply.ledger();

      expect(ledger.casts).toBe(6); // one ground snap plus five window samples
      expect(ledger.castsMax).toBeLessThanOrEqual(3);
      expect(ledger.latencyMax).toBeGreaterThan(0);
      // The car sat 15 m short of where the window was predicted to start (2 s at 12 m/s = 24 m).
      expect(ledger.predictionErrorMax).toBeCloseTo(9, 0);
    });

    it('probes the live sightline in GTA space, excluding the car it is aimed at', () => {
      const seen: { exclude: number | undefined; from: readonly number[]; to: readonly number[] }[] = [];
      const supply = createStationSupply(
        deps({
          probes: {
            groundBelow: () => 10,
            pathClear: (from, to, exclude) => {
              seen.push({ exclude, from, to });

              return true;
            },
          },
        }),
      );

      expect(supply.sightline([12, 3, -220], [10, 1, -210])).toBe(true);
      expect(seen[0].exclude).toBe(77);
      expect(seen[0].from).toEqual([12, 220, 3]); // gtaFromEngine: (x, −z, y)
      expect(supply.frameCasts()).toBe(1); // a sightline is on the same budget as the survey
    });

    it('re-arms for the same slot on a later lap of the shot list', () => {
      let startsIn = 2;
      const supply = createStationSupply(deps({ upcoming: () => ({ index: 1, seconds: 6, startsIn }) }));
      runSurvey(supply);
      supply.take();

      // The slot has gone by and is coming round again: it must be surveyed afresh, not treated as done.
      startsIn = 25;
      supply.beginFrame();
      supply.step();
      startsIn = 2;
      runSurvey(supply);

      expect(supply.ledger().filled).toBe(2);
    });
  });
});
