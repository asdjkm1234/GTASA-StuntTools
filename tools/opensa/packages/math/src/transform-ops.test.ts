import { describe, expect, it } from 'vitest';

import { Matrix4 } from './matrix4';
import { Quaternion } from './quaternion';
import { Vector3 } from './vector3';

/**
 * The `Matrix4` / `Quaternion` surface the [three parity suite](three-parity.test.ts) does NOT reach:
 * order-sensitive composition (`multiply` vs `premultiply` — the classic silent bug, since both
 * compile and only one is right), in-place mutators, and array round-trips. Order is asserted by
 * applying the result to a point, not by comparing elements, so a test failure says what went wrong
 * geometrically.
 */
const ROTATE_Z_90 = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);

const applied = (m: Matrix4, point: Vector3): { x: number; y: number; z: number } => {
  const out = point.clone().applyMatrix4(m);

  return { x: Number(out.x.toFixed(10)), y: Number(out.y.toFixed(10)), z: Number(out.z.toFixed(10)) };
};

describe('Matrix4 composition', () => {
  describe('negative cases', () => {
    it('multiply and premultiply give DIFFERENT results — order is not incidental', () => {
      const rotate = new Matrix4().makeRotationFromQuaternion(ROTATE_Z_90);
      const translate = new Matrix4().makeTranslation(10, 0, 0);
      const point = new Vector3(1, 0, 0);

      // rotate.multiply(translate) = rotate ∘ translate: translate the point FIRST.
      expect(applied(rotate.clone().multiply(translate), point)).toEqual({ x: 0, y: 11, z: 0 });
      // rotate.premultiply(translate) = translate ∘ rotate: rotate FIRST, then shift along x.
      expect(applied(rotate.clone().premultiply(translate), point)).toEqual({ x: 10, y: 1, z: 0 });
    });

    it('reports unequal when a single element differs', () => {
      const a = new Matrix4();
      const b = new Matrix4();
      b.elements[7] = 0.0000001;
      expect(a.equals(b)).toBe(false);
      expect(a.equals(new Matrix4())).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('identity() resets a dirtied matrix and leaves points untouched', () => {
      const dirty = new Matrix4().makeScale(5, 5, 5).identity();
      expect(applied(dirty, new Vector3(1, 2, 3))).toEqual({ x: 1, y: 2, z: 3 });
    });

    it('scale() post-scales in place — the scale applies BEFORE the existing transform', () => {
      const scaledThenMoved = new Matrix4().makeTranslation(10, 0, 0).scale(new Vector3(2, 2, 2));
      expect(applied(scaledThenMoved, new Vector3(1, 0, 0))).toEqual({ x: 12, y: 0, z: 0 });
    });

    it('setPosition overwrites the translation column, keeping the rotation', () => {
      const placed = new Matrix4().makeRotationFromQuaternion(ROTATE_Z_90).setPosition(5, 6, 7);
      expect(applied(placed, new Vector3(1, 0, 0))).toEqual({ x: 5, y: 7, z: 7 });
      expect(applied(placed, new Vector3(0, 0, 0))).toEqual({ x: 5, y: 6, z: 7 });
    });

    it('setPosition accepts a vector as well as three numbers', () => {
      const byVector = new Matrix4().setPosition(new Vector3(1, 2, 3));
      const byNumbers = new Matrix4().setPosition(1, 2, 3);
      expect(byVector.equals(byNumbers)).toBe(true);
    });

    it('makeTranslation accepts a vector as well as three numbers', () => {
      expect(new Matrix4().makeTranslation(new Vector3(1, 2, 3)).equals(new Matrix4().makeTranslation(1, 2, 3))).toBe(
        true,
      );
    });

    it('round-trips through an array at an offset', () => {
      const source = new Matrix4().compose(new Vector3(1, 2, 3), ROTATE_Z_90, new Vector3(2, 2, 2));
      const array = source.toArray([], 4);
      expect(array).toHaveLength(20);
      expect(new Matrix4().fromArray(array, 4).equals(source)).toBe(true);
    });
  });
});

describe('Quaternion composition', () => {
  describe('negative cases', () => {
    it('multiply and premultiply give DIFFERENT rotations for non-commuting axes', () => {
      const aboutZ = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
      const aboutX = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
      const point = new Vector3(0, 1, 0);

      const post = point.clone().applyQuaternion(aboutZ.clone().multiply(aboutX));
      const pre = point.clone().applyQuaternion(aboutZ.clone().premultiply(aboutX));
      expect(post.equals(pre)).toBe(false);
    });

    it('reports unequal when only w differs', () => {
      expect(new Quaternion(0, 0, 0, 1).equals({ w: -1, x: 0, y: 0, z: 0 })).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('identity() resets to the no-rotation quaternion', () => {
      expect(new Quaternion(0.5, 0.5, 0.5, 0.5).identity()).toMatchObject({ w: 1, x: 0, y: 0, z: 0 });
    });

    it('conjugate and invert both undo a unit rotation', () => {
      const point = new Vector3(1, 2, 3);
      const there = point.clone().applyQuaternion(ROTATE_Z_90);
      const back = there.applyQuaternion(ROTATE_Z_90.clone().invert());
      expect(back.x).toBeCloseTo(1, 12);
      expect(back.y).toBeCloseTo(2, 12);
      expect(back.z).toBeCloseTo(3, 12);
      // invert IS conjugate for unit quaternions — the only kind this codebase builds.
      expect(ROTATE_Z_90.clone().invert().equals(ROTATE_Z_90.clone().conjugate())).toBe(true);
    });

    it('slerpQuaternions lands on each endpoint and halfway between', () => {
      const start = new Quaternion().identity();
      const half = new Quaternion().slerpQuaternions(start, ROTATE_Z_90, 0.5);
      const turned = new Vector3(1, 0, 0).applyQuaternion(half);

      expect(turned.x).toBeCloseTo(Math.SQRT1_2, 10); // 45°, half of the quarter turn
      expect(turned.y).toBeCloseTo(Math.SQRT1_2, 10);
      expect(new Quaternion().slerpQuaternions(start, ROTATE_Z_90, 0).equals(start)).toBe(true);
      expect(new Quaternion().slerpQuaternions(start, ROTATE_Z_90, 1).equals(ROTATE_Z_90)).toBe(true);
    });

    it('round-trips through an array at an offset', () => {
      const array = ROTATE_Z_90.toArray([], 2);
      expect(array).toHaveLength(6);
      expect(new Quaternion().fromArray(array, 2).equals(ROTATE_Z_90)).toBe(true);
    });
  });
});
