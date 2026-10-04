import { describe, expect, it } from 'vitest';

import type { Placement } from './boundary';
import type { PlacedBox } from './world-cover';

import { buildCoverQuery, toWorld, worldBox } from './world-cover';

const box = (modelName: string, min: [number, number, number], max: [number, number, number]): PlacedBox => ({
  max,
  min,
  modelName,
});

const at = (x: number, y: number, z: number): Placement => ({ position: [x, y, z], rotation: [0, 0, 0, 1] });

describe('buildCoverQuery', () => {
  describe('negative cases', () => {
    it('reports nothing covered when there are no boxes', () => {
      const query = buildCoverQuery([], 2);

      expect(query.boxCount).toBe(0);
      expect(query.covered([0, 0, 0], 'road')).toBe(false);
    });

    it('never lets a model occlude ITSELF — a skirt under its own plate is one mesh"s business', () => {
      const query = buildCoverQuery([box('road', [-10, -10, 0], [10, 10, 20])], 2);

      expect(query.covered([0, 0, 0], 'road')).toBe(false);
      expect(query.covered([0, 0, 0], 'building')).toBe(true);
    });

    it('leaves a road under a HIGH bridge visible — reach is what separates a lid from scenery', () => {
      const bridge = box('bridge', [-10, -10, 12], [10, 10, 14]);
      const query = buildCoverQuery([bridge], 2);

      expect(query.covered([0, 0, 0], 'road')).toBe(false);
    });

    it('ignores a box that sits entirely BELOW the point', () => {
      const query = buildCoverQuery([box('basement', [-10, -10, -20], [10, 10, -1])], 2);

      expect(query.covered([0, 0, 0], 'road')).toBe(false);
    });

    it('ignores a box the point lies outside in XY', () => {
      const query = buildCoverQuery([box('building', [50, 50, 0], [60, 60, 20])], 2);

      expect(query.covered([0, 0, 0], 'road')).toBe(false);
    });

    it('does not index a map-sized shell, which would occlude everything', () => {
      const shell = box('sky', [-6000, -6000, -1], [6000, 6000, 1000]);
      const query = buildCoverQuery([shell], 2);

      expect(query.covered([0, 0, 0], 'road')).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('reports a building STANDING on the point', () => {
      const query = buildCoverQuery([box('building', [-10, -10, 0], [10, 10, 30])], 2);

      expect(query.covered([0, 0, 0], 'skirt')).toBe(true);
    });

    it('counts a box whose floor sits within reach above the point', () => {
      const query = buildCoverQuery([box('building', [-10, -10, 1.5], [10, 10, 30])], 2);

      expect(query.covered([0, 0, 0], 'skirt')).toBe(true);
    });

    it('spans buckets so a box far larger than the grid pitch still answers', () => {
      const query = buildCoverQuery([box('mall', [-200, -200, 0], [200, 200, 40])], 2);

      expect(query.covered([150, -180, 0], 'skirt')).toBe(true);
    });
  });
});

describe('worldBox', () => {
  describe('negative cases', () => {
    it('answers null for a geometry with no vertices', () => {
      expect(worldBox(new Float32Array(), at(0, 0, 0), 'empty')).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('translates the local bounds by the placement', () => {
      const positions = new Float32Array([-1, -2, -3, 4, 5, 6]);

      expect(worldBox(positions, at(10, 20, 30), 'm')).toEqual({
        max: [14, 25, 36],
        min: [9, 18, 27],
        modelName: 'm',
      });
    });

    it('applies the ROTATION, not just the translation — a turned piece covers different ground', () => {
      // A quarter turn about Z maps (1, 0, 0) to (0, 1, 0).
      const quarterTurn: Placement = { position: [0, 0, 0], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] };
      const [x, y, z] = toWorld(quarterTurn, 1, 0, 0);

      expect(x).toBeCloseTo(0, 6);
      expect(y).toBeCloseTo(1, 6);
      expect(z).toBeCloseTo(0, 6);
    });
  });
});
