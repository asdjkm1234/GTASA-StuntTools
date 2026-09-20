import { describe, expect, it } from 'vitest';

import { Matrix4 } from './matrix4';
import { Quaternion } from './quaternion';
import { Vector3 } from './vector3';

/**
 * `Vector3` is the workhorse of the whole codebase, and the [three parity suite](three-parity.test.ts)
 * already pins the hard transform semantics against captured three@0.185.1 values. This file covers
 * the rest of the surface, concentrating on the operations whose failure mode is silent: the
 * PERSPECTIVE DIVIDE inside `applyMatrix4`, component-wise divide by zero, and the matrix
 * decomposition accessors that read raw element offsets.
 */
describe('Vector3', () => {
  describe('negative cases', () => {
    it('divides component-wise by zero to Infinity rather than throwing', () => {
      const divided = new Vector3(1, -2, 0).divide({ x: 0, y: 0, z: 0 });
      expect(divided.x).toBe(Infinity);
      expect(divided.y).toBe(-Infinity);
      expect(Number.isNaN(divided.z)).toBe(true); // 0 / 0
    });

    it('setLength on a zero vector yields zero, not NaN', () => {
      expect(new Vector3(0, 0, 0).setLength(5)).toMatchObject({ x: 0, y: 0, z: 0 });
    });

    it('reports unequal for a difference in any single component', () => {
      expect(new Vector3(1, 2, 3).equals({ x: 1, y: 2, z: 3.0000001 })).toBe(false);
      expect(new Vector3(1, 2, 3).equals({ x: 1, y: 2, z: 3 })).toBe(true);
    });

    it('applyMatrix4 divides by w — a projection matrix does NOT act like an affine one', () => {
      // The perspective row makes w = z; a caller expecting a plain affine transform gets
      // silently scaled coordinates instead of a wrong-looking crash.
      const perspective = new Matrix4();
      perspective.elements[11] = 1; // w = z
      perspective.elements[15] = 0;
      expect(new Vector3(4, 8, 2).applyMatrix4(perspective)).toMatchObject({ x: 2, y: 4, z: 1 });
    });
  });

  describe('positive cases', () => {
    it('adds, subtracts and scales, in place and into a target', () => {
      expect(new Vector3(1, 2, 3).add({ x: 1, y: 1, z: 1 })).toMatchObject({ x: 2, y: 3, z: 4 });
      expect(new Vector3(1, 2, 3).addScalar(10)).toMatchObject({ x: 11, y: 12, z: 13 });
      expect(new Vector3(1, 2, 3).addScaledVector({ x: 0, y: 0, z: 1 }, 5)).toMatchObject({ x: 1, y: 2, z: 8 });
      expect(new Vector3(1, 2, 3).sub({ x: 1, y: 1, z: 1 })).toMatchObject({ x: 0, y: 1, z: 2 });
      expect(new Vector3(1, 2, 3).negate()).toMatchObject({ x: -1, y: -2, z: -3 });
      expect(new Vector3(1, 2, 3).multiply({ x: 2, y: 3, z: 4 })).toMatchObject({ x: 2, y: 6, z: 12 });
      expect(new Vector3().setScalar(7)).toMatchObject({ x: 7, y: 7, z: 7 });
    });

    it('clamps component-wise between two bounds', () => {
      const clamped = new Vector3(-5, 0.5, 99).clamp({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
      expect(clamped).toMatchObject({ x: 0, y: 0.5, z: 1 });
    });

    it('floors and rounds component-wise, including negatives', () => {
      expect(new Vector3(1.7, -1.2, 2.5).floor()).toMatchObject({ x: 1, y: -2, z: 2 });
      expect(new Vector3(1.4, -1.5, 2.5).round()).toMatchObject({ x: 1, y: -1, z: 3 }); // JS rounds half UP
    });

    it('lerps in place and between two other vectors', () => {
      expect(new Vector3(0, 0, 0).lerp({ x: 10, y: 0, z: 0 }, 0.25)).toMatchObject({ x: 2.5, y: 0, z: 0 });
      expect(new Vector3().lerpVectors({ x: 0, y: 0, z: 0 }, { x: 4, y: 8, z: 12 }, 0.5)).toMatchObject({
        x: 2,
        y: 4,
        z: 6,
      });
    });

    it('sets a vector to a given length, preserving direction', () => {
      const stretched = new Vector3(0, 3, 4).setLength(10);
      expect(stretched.length()).toBeCloseTo(10, 12);
      expect(stretched.x).toBe(0);
      expect(stretched.y).toBeCloseTo(6, 12); // normalize-then-scale, so not bit-exact
      expect(stretched.z).toBeCloseTo(8, 12);
    });

    it('reads a column, the position and the scale out of a transform', () => {
      const rotation = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
      const transform = new Matrix4().compose(new Vector3(7, 8, 9), rotation, new Vector3(2, 3, 4));

      expect(new Vector3().setFromMatrixPosition(transform)).toMatchObject({ x: 7, y: 8, z: 9 });

      const scale = new Vector3().setFromMatrixScale(transform);
      expect(scale.x).toBeCloseTo(2, 12);
      expect(scale.y).toBeCloseTo(3, 12);
      expect(scale.z).toBeCloseTo(4, 12);

      // Column 3 is the translation column — the same numbers setFromMatrixPosition reads.
      expect(new Vector3().setFromMatrixColumn(transform, 3)).toMatchObject({ x: 7, y: 8, z: 9 });
    });

    it('round-trips through an array at an offset', () => {
      const array = [0, 0, 0, 0, 0];
      new Vector3(1, 2, 3).toArray(array, 2);
      expect(array).toEqual([0, 0, 1, 2, 3]);
      expect(new Vector3().fromArray(array, 2)).toMatchObject({ x: 1, y: 2, z: 3 });
    });

    it('returns itself from mutators so calls chain', () => {
      const vector = new Vector3(1, 1, 1);
      expect(vector.addScalar(1).multiplyScalar(2).negate()).toBe(vector);
      expect(vector).toMatchObject({ x: -4, y: -4, z: -4 });
    });
  });
});
