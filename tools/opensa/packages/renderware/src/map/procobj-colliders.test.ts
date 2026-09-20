import { Vector3 } from '@opensa/math';
import { describe, expect, it } from 'vitest';

import type { CollisionIndex } from '../collision';
import type { ColModel } from '../parsers/binary/col-types';
import type { ProcObjBatch, ProcObjPlacement } from './procobj-scatter';

import { procObjColliders } from './procobj-colliders';

function placement(partial: Partial<ProcObjPlacement> = {}): ProcObjPlacement {
  return {
    align: false,
    lottery: 0.5,
    normal: [0, 0, 1],
    position: [10, 20, 5],
    rotation: 0,
    scale: 1,
    scaleZ: 1,
    ...partial,
  };
}

function rockCol(): ColModel {
  return {
    bounds: { center: [0, 0, 0], max: [1, 1, 1], min: [-1, -1, -1], radius: 2 },
    boxes: [],
    faces: [{ a: 0, b: 1, c: 2, light: 0, material: 0 }],
    modelId: 0,
    name: 'p_rubble05col',
    spheres: [],
    version: 2,
    vertices: new Float32Array(9),
  };
}

const index: CollisionIndex = new Map([['p_rubble05col', rockCol()]]);

describe('procObjColliders', () => {
  describe('negative cases', () => {
    it('skips models without a COL (grass/flowers stay walk-through)', () => {
      const batch: ProcObjBatch = {
        category: 'grass',
        model: 'veg_procgrasspatch',
        placements: [placement()],
        surface: 'p_grass_short',
      };
      expect(procObjColliders(index, [batch])).toEqual([]);
    });

    it('collides nothing for a batch the budget kept nothing of (a disabled category)', () => {
      const batch: ProcObjBatch = {
        category: 'rocks',
        model: 'p_rubble05col',
        placements: [placement(), placement()],
        surface: 'p_mountain',
      };
      expect(procObjColliders(index, [batch], { keep: [0] })).toEqual([]);
    });

    it('collides nothing for a batch the budget has no count for', () => {
      const batch: ProcObjBatch = {
        category: 'rocks',
        model: 'p_rubble05col',
        placements: [placement()],
        surface: 'p_mountain',
      };
      expect(procObjColliders(index, [batch], { keep: [] })).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('collides every placement at the render pose when no budget is given', () => {
      const batch: ProcObjBatch = {
        category: 'rocks',
        model: 'p_rubble05col',
        placements: [placement({ lottery: 0.2, position: [10, 20, 5] }), placement({ lottery: 1.2 })],
        surface: 'p_mountain',
      };
      const colliders = procObjColliders(index, [batch]);
      expect(colliders).toHaveLength(1);
      expect(colliders[0].name).toBe('p_rubble05col');
      expect(colliders[0].col).toBe(index.get('p_rubble05col'));
      expect(colliders[0].transforms).toHaveLength(2);
      const position = new Vector3().setFromMatrixPosition(colliders[0].transforms[0]);
      expect([position.x, position.y, position.z]).toEqual([10, 20, 5]);
    });

    it('collides exactly the budget’s keep count, lowest lottery first (= the rendered set)', () => {
      const batch: ProcObjBatch = {
        category: 'rocks',
        model: 'p_rubble05col',
        placements: [
          placement({ lottery: 0.2, position: [1, 0, 0] }),
          placement({ lottery: 0.8, position: [2, 0, 0] }),
          placement({ lottery: 2.4, position: [3, 0, 0] }),
        ],
        surface: 'p_mountain',
      };
      const colliders = procObjColliders(index, [batch], { keep: [1] });
      expect(colliders[0].transforms).toHaveLength(1); // the other two are beyond the budget → no body
      const x = new Vector3().setFromMatrixPosition(colliders[0].transforms[0]).x;
      expect(x).toBe(1); // the lowest-lottery (rendered) placement survives
      expect(procObjColliders(index, [batch], { keep: [3] })[0].transforms).toHaveLength(3);
    });

    it('reads the keep count by batch position, skipping models without a COL', () => {
      const grass: ProcObjBatch = {
        category: 'grass',
        model: 'veg_procgrasspatch',
        placements: [placement(), placement()],
        surface: 'p_grass_short',
      };
      const rocks: ProcObjBatch = {
        category: 'rocks',
        model: 'p_rubble05col',
        placements: [placement(), placement(), placement()],
        surface: 'p_mountain',
      };
      const colliders = procObjColliders(index, [grass, rocks], { keep: [2, 3] });
      expect(colliders).toHaveLength(1);
      expect(colliders[0].transforms).toHaveLength(3); // the rock batch's own count, not the grass one's
    });
  });
});
