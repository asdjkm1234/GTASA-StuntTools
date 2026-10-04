import { describe, expect, it } from 'vitest';

import type { PathNodeInput, RouteGraph } from './route-graph';

import { mulberry32 } from './rng';
import { walkRoute } from './route-builder';
import { buildRouteGraph } from './route-graph';

/** A synthetic area-0 network: `points` in order, `links[i]` naming the node indices node `i` links to. */
function graphOf(
  points: readonly [number, number][],
  links: readonly number[][],
  boats: readonly number[] = [],
): RouteGraph {
  const input: PathNodeInput[] = points.map((point, index) => ({
    area: 0,
    boats: boats.includes(index),
    id: index,
    links: (links[index] ?? []).map((node) => ({ area: 0, node })),
    position: [point[0], point[1], 0],
  }));

  return buildRouteGraph(input);
}

/** A straight road north: `count` nodes 20 m apart, linked both ways. */
function straightRoad(count: number): RouteGraph {
  const points: [number, number][] = Array.from({ length: count }, (_, index) => [0, index * 20]);
  const links = points.map((_, index) => [index - 1, index + 1].filter((n) => n >= 0 && n < count));

  return graphOf(points, links);
}

describe('walkRoute', () => {
  describe('negative cases', () => {
    it('returns null when the start node is a water node', () => {
      const graph = graphOf(
        [
          [0, 0],
          [0, 20],
        ],
        [[1], [0]],
        [0],
      );

      expect(walkRoute(graph, 0, mulberry32(1), { targetLength: 100 })).toBeNull();
    });

    it('returns null when the start node is outside the region', () => {
      const graph = straightRoad(5);

      expect(walkRoute(graph, 0, mulberry32(1), { inRegion: () => false, targetLength: 100 })).toBeNull();
    });

    it('returns null when the start node has no usable link', () => {
      const graph = graphOf([[0, 0]], [[]]);

      expect(walkRoute(graph, 0, mulberry32(1), { targetLength: 100 })).toBeNull();
    });

    it('stops at the region border instead of crossing it (D15)', () => {
      const graph = straightRoad(10);
      const route = walkRoute(graph, 0, mulberry32(1), { inRegion: (_x, y) => y <= 40, targetLength: 500 })!;

      expect(route.stop).toBe('region');
      expect(route.nodes).toEqual([0, 1, 2]);
    });

    it('spends the accumulated-turn budget: legal single turns that pile up are refused', () => {
      // Eight 20° turns 5 m apart — every one is under the 35° ceiling, together they are a hairpin.
      const points: [number, number][] = [[0, 0]];
      let heading = Math.PI / 2;
      for (let step = 0; step < 8; step += 1) {
        const [x, y] = points[points.length - 1];
        points.push([x + Math.cos(heading) * 5, y + Math.sin(heading) * 5]);
        heading -= (20 * Math.PI) / 180;
      }
      const links = points.map((_, index) => [index - 1, index + 1].filter((n) => n >= 0 && n < points.length));
      const graph = graphOf(points, links);
      const route = walkRoute(graph, 0, mulberry32(1), {
        maxTurnDeg: 35,
        maxWindowTurnDeg: 45,
        targetLength: 500,
        turnWindow: 25,
      })!;

      expect(route.stop).toBe('too-tight');
      // Two 20° turns fit the 45° budget; the third does not.
      expect(route.nodes.length).toBe(4);
    });

    it('cuts the route where the DRIVEN line leaves the region, even with every node inside', () => {
      // The road runs due north along x = 0; the region ends at x = 2 , so the 2.5 m lane offset leaves it.
      const graph = straightRoad(10);
      const route = walkRoute(graph, 0, mulberry32(1), {
        inRegion: (x) => x <= 2,
        laneOffset: 2.5,
        targetLength: 200,
      });

      expect(route).toBeNull();
    });

    it('rejects a junction turn above the ceiling', () => {
      // 0 → 1 heads north, then the only continuation is a 90° right turn.
      const graph = graphOf(
        [
          [0, 0],
          [0, 20],
          [20, 20],
        ],
        [[1], [0, 2], [1]],
      );
      const route = walkRoute(graph, 0, mulberry32(1), { maxTurnDeg: 35, targetLength: 500 })!;

      // Road was there and the ceiling refused it — that reads differently from the graph running out.
      expect(route.stop).toBe('too-tight');
      expect(route.nodes).toEqual([0, 1]);
    });

    it('at a branch, refuses the dead-end arm even though it is the straighter one (lookahead)', () => {
      // From node 1: node 2 is dead straight but leads nowhere; node 3 turns 27° and carries on.
      const graph = graphOf(
        [
          [0, 0],
          [0, 20],
          [0, 40],
          [10, 40],
          [20, 60],
        ],
        [[1], [0, 2, 3], [1], [1, 4], [3]],
      );
      const route = walkRoute(graph, 0, mulberry32(1), { targetLength: 500 })!;

      expect(route.nodes).toEqual([0, 1, 3, 4]);
    });

    it('takes a dead-end hop anyway when it is the only road left, and blames the right thing', () => {
      const graph = graphOf(
        [
          [0, 0],
          [0, 20],
          [0, 40],
        ],
        [[1], [0, 2], [1]],
      );
      const route = walkRoute(graph, 0, mulberry32(1), { targetLength: 500 })!;

      expect(route.nodes).toEqual([0, 1, 2]);
      expect(route.stop).toBe('dead-end');
    });

    it('never revisits a node, so a ring road does not loop forever', () => {
      const graph = graphOf(
        [
          [0, 0],
          [0, 60],
          [60, 60],
          [60, 0],
        ],
        [
          [1, 3],
          [0, 2],
          [1, 3],
          [2, 0],
        ],
      );
      const route = walkRoute(graph, 0, mulberry32(2), { maxTurnDeg: 95, targetLength: 10000 })!;

      expect(new Set(route.nodes).size).toBe(route.nodes.length);
      expect(route.nodes.length).toBeLessThanOrEqual(4);
    });
  });

  describe('positive cases', () => {
    it('walks a straight road up to the target length and reports why it stopped', () => {
      const graph = straightRoad(20);
      const route = walkRoute(graph, 0, mulberry32(5), { targetLength: 200 })!;

      expect(route.stop).toBe('target');
      expect(route.length).toBeGreaterThanOrEqual(200);
      expect(route.maxTurnDeg).toBe(0);
      expect(route.minCurveRadius).toBe(Infinity);
    });

    it('is reproducible: the same seed walks the same branchy graph identically', () => {
      const graph = graphOf(
        [
          [0, 0],
          [0, 30],
          [10, 60],
          [-10, 60],
          [15, 90],
          [-15, 90],
        ],
        [[1], [0, 2, 3], [1, 4], [1, 5], [2], [3]],
      );
      const first = walkRoute(graph, 0, mulberry32(11), { maxTurnDeg: 35, targetLength: 60 })!;
      const second = walkRoute(graph, 0, mulberry32(11), { maxTurnDeg: 35, targetLength: 60 })!;

      expect(second.nodes).toEqual(first.nodes);
      expect(second.points).toEqual(first.points);
    });

    it('offsets the driven line to the RIGHT of travel (nodes mark the road centre)', () => {
      const graph = straightRoad(10);
      const route = walkRoute(graph, 0, mulberry32(5), { laneOffset: 2.5, targetLength: 100 })!;

      // Driving north, right is +X.
      for (const point of route.points) {
        expect(point.position[0]).toBeCloseTo(2.5, 5);
      }
    });

    it('holds cruise speed on a straight and slows for a corner within the lateral-g budget', () => {
      const straight = walkRoute(straightRoad(10), 0, mulberry32(5), { cruiseSpeed: 12, targetLength: 100 })!;

      expect(Math.min(...straight.points.map((point) => point.speed))).toBeCloseTo(12, 5);

      // A 30° kink every 30 m — the smoothed corners must cost speed.
      const graph = graphOf(
        [
          [0, 0],
          [0, 30],
          [15, 56],
          [30, 82],
          [45, 108],
        ],
        [[1], [0, 2], [1, 3], [2, 4], [3]],
      );
      const cornered = walkRoute(graph, 0, mulberry32(5), { cruiseSpeed: 12, latAccelMax: 2.5, targetLength: 90 })!;
      const slowest = Math.min(...cornered.points.map((point) => point.speed));

      expect(cornered.maxTurnDeg).toBeGreaterThan(20);
      expect(slowest).toBeLessThan(12);
      // Every target speed stays inside the stated lateral budget for its own corner.
      expect(slowest).toBeCloseTo(Math.sqrt(2.5 * cornered.minCurveRadius), 5);
    });

    it('reports one turn per interior centreline node', () => {
      const graph = straightRoad(6);
      const route = walkRoute(graph, 0, mulberry32(5), { targetLength: 100 })!;

      expect(route.turnsDeg.length).toBe(route.nodes.length - 2);
    });
  });
});
