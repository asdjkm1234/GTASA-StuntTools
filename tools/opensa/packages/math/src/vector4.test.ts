import { describe, expect, it } from 'vitest';

import { Matrix4 } from './matrix4';
import { Vector4 } from './vector4';

/**
 * `Vector4` is mostly a shader-uniform carrier here, so the cases that matter are the ones that
 * silently corrupt a uniform: the **w defaults to 1** (not 0, unlike every other component),
 * `applyMatrix4` actually using w for the translation row, and degenerate normalize.
 */
describe('Vector4', () => {
  describe('negative cases', () => {
    it('normalizes a zero vector to zero instead of NaN', () => {
      expect(new Vector4(0, 0, 0, 0).normalize()).toMatchObject({ w: 0, x: 0, y: 0, z: 0 });
    });

    it('divides by zero to Infinity rather than throwing', () => {
      expect(new Vector4(1, -1, 0, 2).divideScalar(0)).toMatchObject({ w: Infinity, x: Infinity, y: -Infinity });
    });

    it('reports unequal when only w differs — the component most easily forgotten', () => {
      expect(new Vector4(1, 2, 3, 1).equals({ w: 0, x: 1, y: 2, z: 3 })).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('defaults w to 1 while the other components default to 0', () => {
      expect(new Vector4()).toMatchObject({ w: 1, x: 0, y: 0, z: 0 });
    });

    it('setScalar overwrites w too', () => {
      expect(new Vector4().setScalar(4)).toMatchObject({ w: 4, x: 4, y: 4, z: 4 });
    });

    it('adds and subtracts all four components', () => {
      expect(new Vector4(1, 2, 3, 4).add({ w: 40, x: 10, y: 20, z: 30 })).toMatchObject({
        w: 44,
        x: 11,
        y: 22,
        z: 33,
      });
      expect(new Vector4(1, 2, 3, 4).sub({ w: 4, x: 1, y: 2, z: 3 })).toMatchObject({ w: 0, x: 0, y: 0, z: 0 });
    });

    it('scales all four components', () => {
      expect(new Vector4(1, -2, 3, -4).multiplyScalar(0.5)).toMatchObject({ w: -2, x: 0.5, y: -1, z: 1.5 });
      expect(new Vector4(2, 4, 6, 8).divideScalar(2)).toMatchObject({ w: 4, x: 1, y: 2, z: 3 });
    });

    it('measures length and squared length across all four components', () => {
      expect(new Vector4(1, 1, 1, 1).lengthSq()).toBe(4);
      expect(new Vector4(1, 1, 1, 1).length()).toBe(2);
    });

    it('normalizes to unit length', () => {
      expect(new Vector4(0, 0, 0, -3).normalize()).toMatchObject({ w: -1, x: 0, y: 0, z: 0 });
    });

    it('dots to zero for perpendicular vectors, including the w axis', () => {
      expect(new Vector4(1, 0, 0, 0).dot({ w: 1, x: 0, y: 0, z: 0 })).toBe(0);
      expect(new Vector4(1, 2, 3, 4).dot({ w: 4, x: 1, y: 2, z: 3 })).toBe(30);
    });

    it('applies a translation matrix ONLY when w is 1 — the point-vs-direction distinction', () => {
      const translate = new Matrix4().makeTranslation(10, 20, 30);
      expect(new Vector4(1, 2, 3, 1).applyMatrix4(translate)).toMatchObject({ w: 1, x: 11, y: 22, z: 33 });
      // w = 0 marks a direction: it must survive translation unmoved.
      expect(new Vector4(1, 2, 3, 0).applyMatrix4(translate)).toMatchObject({ w: 0, x: 1, y: 2, z: 3 });
    });

    it('applies a scale matrix to xyz and leaves w alone', () => {
      const scaled = new Vector4(1, 2, 3, 1).applyMatrix4(new Matrix4().makeScale(2, 3, 4));
      expect(scaled).toMatchObject({ w: 1, x: 2, y: 6, z: 12 });
    });

    it('lerps between endpoints, inclusive', () => {
      expect(new Vector4(0, 0, 0, 0).lerp({ w: 4, x: 1, y: 2, z: 3 }, 0.5)).toMatchObject({
        w: 2,
        x: 0.5,
        y: 1,
        z: 1.5,
      });
    });

    it('clones and copies without aliasing', () => {
      const source = new Vector4(1, 2, 3, 4);
      const clone = source.clone();
      clone.setScalar(0);
      expect(source).toMatchObject({ w: 4, x: 1, y: 2, z: 3 });
      expect(new Vector4().copy(source)).toMatchObject({ w: 4, x: 1, y: 2, z: 3 });
    });

    it('round-trips through an array at an offset', () => {
      const array = [0, 0, 0, 0, 0, 0];
      new Vector4(1, 2, 3, 4).toArray(array, 2);
      expect(array).toEqual([0, 0, 1, 2, 3, 4]);
      expect(new Vector4().fromArray(array, 2)).toMatchObject({ w: 4, x: 1, y: 2, z: 3 });
    });

    it('returns itself from mutators so calls chain', () => {
      const vector = new Vector4(1, 1, 1, 1);
      expect(vector.add({ w: 1, x: 1, y: 1, z: 1 }).multiplyScalar(3)).toBe(vector);
      expect(vector).toMatchObject({ w: 6, x: 6, y: 6, z: 6 });
    });
  });
});
