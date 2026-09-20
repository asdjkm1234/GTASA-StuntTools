import { describe, expect, it } from 'vitest';

import type { ColModel } from '../parsers/binary/col-types';

import { colLines, meshEdgeLines } from './col-lines';

const emptyCol = (overrides: Partial<ColModel> = {}): ColModel =>
  ({
    bounds: { center: [0, 0, 0], max: [0, 0, 0], min: [0, 0, 0], radius: 0 },
    boxes: [],
    faces: [],
    name: 'test',
    spheres: [],
    vertices: new Float32Array(),
    ...overrides,
  }) as unknown as ColModel;

describe('colLines', () => {
  describe('negative cases', () => {
    it('returns no segments for a collision model with no geometry', () => {
      expect(colLines(emptyCol())).toHaveLength(0);
    });
  });

  describe('positive cases', () => {
    it('emits three segments per collision face', () => {
      const lines = colLines(
        emptyCol({
          faces: [{ a: 0, b: 1, c: 2 }] as ColModel['faces'],
          vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        }),
      );

      // 3 edges × 2 endpoints × 3 floats
      expect(lines).toHaveLength(18);
      expect([...lines.slice(0, 6)]).toEqual([0, 0, 0, 1, 0, 0]);
    });

    it('emits the twelve edges of a box', () => {
      const lines = colLines(emptyCol({ boxes: [{ max: [1, 1, 1], min: [0, 0, 0] }] as ColModel['boxes'] }));

      expect(lines).toHaveLength(12 * 2 * 3);
    });

    it('emits three great-circle rings per sphere', () => {
      const lines = colLines(emptyCol({ spheres: [{ center: [0, 0, 0], radius: 2 }] as ColModel['spheres'] }));

      // 3 axes × 12 segments × 2 endpoints × 3 floats
      expect(lines).toHaveLength(3 * 12 * 2 * 3);
    });
  });
});

describe('meshEdgeLines', () => {
  describe('negative cases', () => {
    it('returns nothing for an empty index buffer', () => {
      expect(meshEdgeLines(new Float32Array([0, 0, 0]), [])).toHaveLength(0);
    });

    it('ignores a trailing partial triangle rather than reading past the end', () => {
      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);

      expect(meshEdgeLines(positions, [0, 1, 2, 0, 1])).toHaveLength(3 * 2 * 3);
    });
  });

  describe('positive cases', () => {
    it('emits three edges for one triangle', () => {
      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);

      expect(meshEdgeLines(positions, [0, 1, 2])).toHaveLength(3 * 2 * 3);
    });

    it('draws a shared edge once across two triangles', () => {
      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);

      // Two triangles sharing edge 1-2: 6 distinct edges, not 6 + 2 duplicates.
      expect(meshEdgeLines(positions, [0, 1, 2, 1, 3, 2])).toHaveLength(5 * 2 * 3);
    });
  });
});
