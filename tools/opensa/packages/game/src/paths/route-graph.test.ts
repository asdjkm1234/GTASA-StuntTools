import { describe, expect, it } from 'vitest';

import type { PathNodeInput, RouteGraph } from './route-graph';

import { mulberry32 } from './rng';
import { buildRouteGraph, randomNode } from './route-graph';

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

describe('buildRouteGraph', () => {
  describe('negative cases', () => {
    it('drops a link whose target area was not loaded and counts it', () => {
      const graph = buildRouteGraph([
        { area: 0, boats: false, id: 0, links: [{ area: 9, node: 4 }], position: [0, 0, 0] },
      ]);

      expect(graph.nodes[0].links).toEqual([]);
      expect(graph.unresolvedLinks).toBe(1);
    });

    it('indexOf returns undefined for a node that is not in the graph', () => {
      const graph = graphOf([[0, 0]], [[]]);

      expect(graph.indexOf(0, 7)).toBeUndefined();
      expect(graph.indexOf(3, 0)).toBeUndefined();
    });

    it('nearest returns undefined when every node is beyond maxDistance', () => {
      const graph = graphOf(
        [
          [0, 0],
          [500, 0],
        ],
        [[1], [0]],
      );

      expect(graph.nearest(0, 1000, 100)).toBeUndefined();
    });
  });

  describe('positive cases', () => {
    it('resolves links to node indices, including across area files', () => {
      const graph = buildRouteGraph([
        { area: 0, boats: false, id: 0, links: [{ area: 1, node: 5 }], position: [0, 0, 0] },
        { area: 1, boats: false, id: 5, links: [{ area: 0, node: 0 }], position: [0, 20, 0] },
      ]);

      expect(graph.nodes[0].links).toEqual([1]);
      expect(graph.nodes[1].links).toEqual([0]);
      expect(graph.unresolvedLinks).toBe(0);
      expect(graph.oneWayLinks).toBe(0);
    });

    it('counts a link whose reverse edge is missing (the data may be one-way)', () => {
      const graph = graphOf(
        [
          [0, 0],
          [0, 20],
        ],
        [[1], []],
      );

      expect(graph.oneWayLinks).toBe(1);
    });

    it('nearest finds the closest node across grid cells', () => {
      const graph = graphOf(
        [
          [0, 0],
          [140, 0],
          [280, 0],
        ],
        [[1], [0, 2], [1]],
      );

      expect(graph.nearest(150, 5)).toBe(1);
      expect(graph.nearest(275, 0)).toBe(2);
    });

    it('randomNode honours the filter and repeats for the same seed', () => {
      const graph = graphOf(
        [
          [0, 0],
          [0, 20],
          [0, 40],
        ],
        [[1], [0, 2], [1]],
        [1],
      );
      const accept = (node: (typeof graph.nodes)[number]): boolean => !node.boats;
      const first = randomNode(graph, mulberry32(3), accept);

      expect(first).not.toBe(1);
      expect(randomNode(graph, mulberry32(3), accept)).toBe(first);
    });
  });
});
