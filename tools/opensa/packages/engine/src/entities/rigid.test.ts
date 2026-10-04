import { describe, expect, it } from 'vitest';

import type { RigidPartInit } from './rigid';

import { quatMultiply, RigidEntity } from './rigid';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

/** Apply a column-major mat4 (subarray of `matrices`) to a point. */
function apply(matrices: Float32Array, part: number, point: [number, number, number]): number[] {
  const m = matrices.subarray(part * 16, part * 16 + 16);

  return [
    m[0] * point[0] + m[4] * point[1] + m[8] * point[2] + m[12],
    m[1] * point[0] + m[5] * point[1] + m[9] * point[2] + m[13],
    m[2] * point[0] + m[6] * point[1] + m[10] * point[2] + m[14],
  ];
}

function parts(): RigidPartInit[] {
  return [
    { localRotation: [0, 0, 0, 1], localTranslation: [0, 0, 0], name: 'chassis' },
    { localRotation: [0, 0, 0, 1], localTranslation: [1, 2, 3], name: 'wheel_lf_dummy' },
    // Right-side wheel: 180° about Z (the extractor's no-mirror convention).
    { localRotation: [0, 0, 1, 0], localTranslation: [-1, 2, 3], name: 'wheel_rf_dummy' },
  ];
}

describe('RigidEntity', () => {
  describe('negative cases', () => {
    it('partIndex returns -1 for an unknown part name', () => {
      expect(new RigidEntity(parts()).partIndex('nope')).toBe(-1);
    });

    it('flatten with identity root and locals yields identity matrices (plus translations)', () => {
      const entity = new RigidEntity(parts());

      entity.flatten();

      for (let component = 0; component < 16; component += 1) {
        expect(entity.matrices[component]).toBeCloseTo(IDENTITY[component], 6);
      }
      expect([...entity.matrices.subarray(16 + 12, 16 + 15)]).toEqual([1, 2, 3]);
    });
  });

  describe('positive cases', () => {
    it('root translation carries every part', () => {
      const entity = new RigidEntity(parts());
      entity.setRoot([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1]);

      entity.flatten();

      expect(apply(entity.matrices, 0, [0, 0, 0])).toEqual([10, 20, 30]);
      expect(apply(entity.matrices, 1, [0, 0, 0])).toEqual([11, 22, 33]);
    });

    it('a spin quaternion composes AFTER the local rotation (right wheel spins mirrored)', () => {
      const entity = new RigidEntity(parts());
      // Spin 90° about local X.
      const half = Math.SQRT1_2;
      entity.setPartRotation(1, [half, 0, 0, half]);
      entity.setPartRotation(2, [half, 0, 0, half]);

      entity.flatten();

      // Left wheel: local identity ⊗ spin → +Y maps to +Z (right-handed X spin).
      const left = apply(entity.matrices, 1, [0, 1, 0]);
      expect(left[0]).toBeCloseTo(1, 5);
      expect(left[1]).toBeCloseTo(2, 5);
      expect(left[2]).toBeCloseTo(4, 5); // 3 + 1
      // Right wheel (180° about Z FIRST): the same local point lands at the same +Z offset, but as an
      // operator the spin is conjugated by the flip — the WORLD spin axis becomes −X, i.e. the right
      // wheel rolls mirrored, exactly what real wheels need.
      const right = apply(entity.matrices, 2, [0, 1, 0]);
      expect(right[0]).toBeCloseTo(-1, 5);
      expect(right[1]).toBeCloseTo(2, 5);
      expect(right[2]).toBeCloseTo(4, 5); // 3 + 1 — the flip does not change Z
    });

    it('a door swings about its hinge pivot, carrying the mesh offset (B5 doors)', () => {
      // Hinge dummy at x=1 (the pivot); the door mesh sits 1 unit further out (offset). A 90° swing about Z
      // must carry the mesh origin AROUND the hinge — to (1, 1, 0) — not spin it in place at (2, 0, 0).
      const half = Math.SQRT1_2;
      const offset = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1]; // T(1,0,0) relative to the hinge
      const entity = new RigidEntity([
        { localRotation: [0, 0, 0, 1], localTranslation: [1, 0, 0], name: 'door_lf', offset },
      ]);
      entity.setPartRotation(0, [0, 0, half, half]);

      entity.flatten();

      const origin = apply(entity.matrices, 0, [0, 0, 0]);
      expect(origin[0]).toBeCloseTo(1, 5);
      expect(origin[1]).toBeCloseTo(1, 5);
      expect(origin[2]).toBeCloseTo(0, 5);
    });

    it('the swing runs in the HINGE frame axes — a 180° hinge opens the far-side door the other world way', () => {
      // The right-side door's hinge frame is turned 180° about Z (SA's mirrored convention). Prod composes
      // pivot.quaternion = closed ⊗ swing, so the SAME swing quaternion sends this door the opposite world
      // direction — outward, on its own side. A world-axis rotation about the hinge POINT would send both
      // doors the same way, which is wrong on exactly half the car.
      const half = Math.SQRT1_2;
      const offset = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1];
      const left = new RigidEntity([
        { localRotation: [0, 0, 0, 1], localTranslation: [0, 0, 0], name: 'door_lf', offset },
      ]);
      const right = new RigidEntity([
        { localRotation: [0, 0, 1, 0], localTranslation: [0, 0, 0], name: 'door_rf', offset }, // 180° about Z
      ]);
      left.setPartRotation(0, [0, 0, half, half]);
      right.setPartRotation(0, [0, 0, half, half]);

      left.flatten();
      right.flatten();

      // Left door's tip swings to +Y; the mirrored hinge sends the right door's tip to −Y.
      expect(apply(left.matrices, 0, [0, 0, 0])[1]).toBeCloseTo(1, 5);
      expect(apply(right.matrices, 0, [0, 0, 0])[1]).toBeCloseTo(-1, 5);
    });

    it('an animation translation slides the part in its parent frame (081/06 suspension travel)', () => {
      const entity = new RigidEntity([{ localRotation: [0, 0, 0, 1], localTranslation: [1, 2, 3], name: 'wheel_lf' }]);
      entity.setPartTranslation(0, [0, 0, -0.12]);

      entity.flatten();

      expect(apply(entity.matrices, 0, [0, 0, 0])[2]).toBeCloseTo(2.88, 5); // 3 − 0.12, x/y untouched
      expect(apply(entity.matrices, 0, [0, 0, 0])[0]).toBeCloseTo(1, 5);
    });

    it('a uniform scale sizes the part without moving it (B5 wheelScale)', () => {
      const entity = new RigidEntity([
        { localRotation: [0, 0, 0, 1], localTranslation: [1, 2, 3], name: 'wheel', scale: 2 },
      ]);

      entity.flatten();

      expect(apply(entity.matrices, 0, [0, 0, 0])).toEqual([1, 2, 3]); // origin pinned
      expect(apply(entity.matrices, 0, [1, 0, 0])).toEqual([3, 2, 3]); // rim doubled out
    });

    it('a detached part ignores the root and carries its own world matrix (B5 debris)', () => {
      const entity = new RigidEntity(parts());
      entity.setRoot([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1]);
      entity.setPartWorldMatrix(1, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 7, 8, 9, 1]);

      entity.flatten();

      expect(apply(entity.matrices, 1, [0, 0, 0])).toEqual([7, 8, 9]); // debris in world space
      expect(apply(entity.matrices, 0, [0, 0, 0])).toEqual([10, 20, 30]); // the car still follows the root

      entity.setPartWorldMatrix(1, null);
      entity.flatten();

      expect(apply(entity.matrices, 1, [0, 0, 0])).toEqual([11, 22, 33]); // re-attached
    });

    it('quatMultiply matches the Hamilton product (unit axes)', () => {
      const out = new Float32Array(4);
      const half = Math.SQRT1_2;

      // 90° about Z then 90° about X (applied right-to-left) — a known composite.
      quatMultiply(out, [0, 0, half, half], [half, 0, 0, half]);

      expect(out[3]).toBeCloseTo(0.5, 5);
      expect(out[0]).toBeCloseTo(0.5, 5);
      expect(out[1]).toBeCloseTo(0.5, 5);
      expect(out[2]).toBeCloseTo(0.5, 5);
    });
  });
});
