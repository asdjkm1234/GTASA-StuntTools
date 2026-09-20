import type { ModelSource } from '@opensa/lod-common/model-source';
import type { RWClump } from '@opensa/renderware/parsers/binary/types';

import { lodView } from '@opensa/lod-common/view';
import { describe, expect, it } from 'vitest';

import type { Cell } from '../../core/types';

import { cullTinyInstances } from './cull';

function cell(models: string[]): Cell {
  return {
    cx: 0,
    cy: 0,
    instances: models.map((model) => ({ model, position: [0, 0, 0], rotation: [0, 0, 0, 1], txd: '' })),
  };
}

/** A single-atomic clump whose farthest vertex sits `radius` from the origin, carrying `triangles` faces. */
function clumpOfRadius(radius: number, triangles = 0): RWClump {
  return {
    atomics: [{ frameIndex: 0, geometryIndex: 0 }],
    frames: [{ position: [0, 0, 0], rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] }],
    geometries: [
      { positions: Float32Array.of(radius, 0, 0), triangles: new Array(triangles).fill({ a: 0, b: 0, c: 0 }) },
    ],
  } as unknown as RWClump;
}

/** ModelSource stub: model name → bounding radius + optional triangle count (absent → load failure / null). */
function sourceOf(models: Record<string, number | { radius: number; tris: number }>): ModelSource {
  return {
    load: (model): null | RWClump => {
      const spec = models[model];
      if (spec === undefined) {
        return null;
      }

      return typeof spec === 'number' ? clumpOfRadius(spec) : clumpOfRadius(spec.radius, spec.tris);
    },
  };
}

// At 300 u / FOV 60 / 1080 px one pixel ≈ 0.32 u → a 2 px threshold cuts diameters under ~0.64 u.
const VIEW = lodView(300);

describe('cullTinyInstances', () => {
  describe('negative cases', () => {
    it('keeps an instance whose model fails to load (merge handles it)', () => {
      const result = cullTinyInstances([cell(['ghost'])], sourceOf({}), VIEW, 2);

      expect(result.cells[0].instances).toHaveLength(1);
      expect(result.culledInstances).toBe(0);
    });

    it('keeps instances at or over the pixel threshold', () => {
      const result = cullTinyInstances([cell(['house'])], sourceOf({ house: 10 }), VIEW, 2);

      expect(result.cells[0].instances).toHaveLength(1);
      expect(result.culledModels).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('drops sub-pixel instances and counts them', () => {
      const result = cullTinyInstances([cell(['house', 'bin', 'bin'])], sourceOf({ bin: 0.2, house: 10 }), VIEW, 2);

      expect(result.cells[0].instances.map((instance) => instance.model)).toEqual(['house']);
      expect(result.culledInstances).toBe(2);
      expect(result.culledModels).toBe(1);
    });

    it('drops a cell whose instances were all culled', () => {
      const result = cullTinyInstances([cell(['bin'])], sourceOf({ bin: 0.2 }), VIEW, 2);

      expect(result.cells).toHaveLength(0);
      expect(result.culledInstances).toBe(1);
    });
  });
});
