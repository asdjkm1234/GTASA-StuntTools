import type { Route } from '@opensa/game/paths/route-builder';

import { describe, expect, it } from 'vitest';

import { createWalkCursor, walkWaypoints } from './walk';

/** A straight route heading +X, 2 m apart — the builder's own spacing. */
function straightRoute(points: number): Route {
  return {
    length: (points - 1) * 2,
    maxTurnDeg: 0,
    minCurveRadius: Infinity,
    nodes: [],
    points: Array.from({ length: points }, (_, index) => ({
      position: [index * 2, 0, 10] as [number, number, number],
      speed: 2,
    })),
    stop: 'target',
    turnsDeg: [],
  };
}

/** Ground everywhere, at the route's own height. */
const solid = (): number => 10;

describe('walkWaypoints', () => {
  describe('negative cases', () => {
    it('rejects the whole route when a probed waypoint has no ground under it', () => {
      const route = straightRoute(10);
      const overWater = (at: readonly [number, number, number]): null | number => (at[0] > 7 ? null : 10);

      const path = walkWaypoints(route, overWater, 1000);

      expect(path.points).toEqual([]); // not "the walkable prefix" — a partial path walks the ped off the quay
      expect(path.miss).toBe(4); // x = 8, the first point past the edge
    });

    it('does not judge waypoints outside the streamed collision — an unloaded world is not a verdict', () => {
      const route = straightRoute(40); // 78 m of route
      // Nothing answers past 20 m: exactly what an unstreamed far end looks like to the probe.
      const nearOnly = (at: readonly [number, number, number]): null | number => (at[0] <= 20 ? 10 : null);

      const path = walkWaypoints(route, nearOnly, 25); // ring 25 m → 20 m trusted

      expect(path.miss).toBeNull();
      expect(path.points).toHaveLength(40); // accepted, and the far end is walked on the controller's own ground
      expect(path.checked).toBe(11); // x = 0..20 at 2 m spacing
    });
  });

  describe('positive cases', () => {
    it('accepts a route with ground under all of it and keeps every waypoint in travel order', () => {
      const route = straightRoute(6);

      const path = walkWaypoints(route, solid, 1000);

      expect(path.miss).toBeNull();
      expect(path.checked).toBe(6);
      expect(path.points.map((point) => point[0])).toEqual([0, 2, 4, 6, 8, 10]);
    });

    it('probes from ABOVE the waypoint, so the surface it is standing on cannot answer for it', () => {
      const route = straightRoute(2);
      const from: number[] = [];

      walkWaypoints(
        route,
        (at) => {
          from.push(at[2]);

          return 10;
        },
        1000,
      );

      expect(from).toEqual([12, 12]); // the route's z + the lift, never the raw point
    });
  });
});

describe('createWalkCursor', () => {
  describe('negative cases', () => {
    it('never moves backwards when the route passes near an earlier stretch', () => {
      // A loop: out along +X and back over the same ground. Point 0 and point 8 are metres apart, so a
      // nearest-point search over the whole route would snap the cursor back to 0 on the return leg.
      const points = [
        { position: [0, 0, 0] as [number, number, number] },
        { position: [10, 0, 0] as [number, number, number] },
        { position: [20, 0, 0] as [number, number, number] },
        { position: [20, 4, 0] as [number, number, number] },
        { position: [10, 4, 0] as [number, number, number] },
        { position: [0, 4, 0] as [number, number, number] },
      ];
      const cursor = createWalkCursor(points);

      cursor([20, 0, 0]); // out
      const back = cursor([0, 4, 0]); // returned alongside the start

      expect(back).toBe(5); // the RETURN point, not point 0
    });
  });

  describe('positive cases', () => {
    it('follows the walker forward along the route', () => {
      const cursor = createWalkCursor(straightRoute(20).points);

      expect(cursor([0, 0, 0])).toBe(0);
      expect(cursor([6, 0, 0])).toBe(3);
      expect(cursor([14, 0, 0])).toBe(7);
    });

    it('holds its place while the walker stands still', () => {
      const cursor = createWalkCursor(straightRoute(20).points);
      cursor([8, 0, 0]);

      expect(cursor([8, 0, 0])).toBe(4);
      expect(cursor([8, 0, 0])).toBe(4);
    });
  });
});
