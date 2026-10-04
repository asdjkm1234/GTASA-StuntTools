import { describe, expect, it } from 'vitest';

import { Box3 } from './box3';
import { clamp, degToRad, euclideanModulo, lerp, radToDeg } from './math-utils';
import { Matrix4 } from './matrix4';
import { Quaternion } from './quaternion';
import { Sphere } from './sphere';
import fixtures from './three-fixtures.json';
import { Vector3 } from './vector3';

/**
 * The safety net for plan 074/13: every value here was captured from three@0.185.1 itself
 * (by the since-deleted `capture-three-fixtures.ts`) BEFORE the dependency was dropped in phase 7.
 * If one of these fails, our replacement disagrees with the library the whole codebase was written
 * against. The fixtures cannot be regenerated — three is gone; they are the record.
 */

const PRECISION = 8;

const AXIS = new Vector3(0.26726124, 0.53452248, 0.80178373);
const ANGLE = 0.9773843811168246;
const POSITION = new Vector3(12.5, -3.25, 7.125);
const SCALE = new Vector3(2, 0.5, -1.5);
const SAMPLE = new Vector3(1, -2, 0.5);

const rotation = new Quaternion().setFromAxisAngle(AXIS, ANGLE);
const composed = new Matrix4().compose(POSITION, rotation, SCALE);

const expectVector = (actual: Vector3, expected: readonly number[]): void => {
  expect(actual.x).toBeCloseTo(expected[0], PRECISION);
  expect(actual.y).toBeCloseTo(expected[1], PRECISION);
  expect(actual.z).toBeCloseTo(expected[2], PRECISION);
};

const expectQuaternion = (actual: Quaternion, expected: readonly number[]): void => {
  expect(actual.x).toBeCloseTo(expected[0], PRECISION);
  expect(actual.y).toBeCloseTo(expected[1], PRECISION);
  expect(actual.z).toBeCloseTo(expected[2], PRECISION);
  expect(actual.w).toBeCloseTo(expected[3], PRECISION);
};

const expectMatrix = (actual: Matrix4, expected: readonly number[]): void => {
  for (let i = 0; i < 16; i += 1) {
    expect(actual.elements[i]).toBeCloseTo(expected[i], PRECISION);
  }
};

describe('three parity', () => {
  describe('negative cases', () => {
    it('inverts a singular matrix to zeros instead of NaN, as three does', () => {
      const singular = new Matrix4().makeScale(0, 0, 0).invert();
      expect(singular.elements.every((value) => value === 0)).toBe(true);
    });

    it('normalizes a zero vector to zero instead of NaN', () => {
      expectVector(new Vector3(0, 0, 0).normalize(), [0, 0, 0]);
    });

    it('normalizes a zero quaternion to identity instead of NaN', () => {
      expectQuaternion(new Quaternion(0, 0, 0, 0).normalize(), [0, 0, 0, 1]);
    });

    it('reports an empty box as empty and gives it a zero centre, not NaN', () => {
      const empty = new Box3();
      expect(empty.isEmpty()).toBe(true);
      expectVector(empty.getCenter(new Vector3()), [0, 0, 0]);
      expectVector(empty.getSize(new Vector3()), [0, 0, 0]);
    });

    it('rotates opposite unit vectors through a perpendicular axis', () => {
      expectQuaternion(
        new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(0, -1, 0)),
        fixtures.quaternion.fromUnitVectorsOpposite,
      );
    });
  });

  describe('positive cases', () => {
    it('matches three for Vector3 rotation and transform', () => {
      expectVector(SAMPLE.clone().applyQuaternion(rotation), fixtures.vector3.appliedQuaternion);
      expectVector(SAMPLE.clone().applyAxisAngle(AXIS, ANGLE), fixtures.vector3.appliedAxisAngle);
      expectVector(SAMPLE.clone().applyMatrix4(composed), fixtures.vector3.appliedMatrix4);
      expectVector(new Vector3(1, 2, 3).transformDirection(composed), fixtures.vector3.transformDirection);
      expectVector(new Vector3(1, 2, 3).normalize(), fixtures.vector3.normalized);
      expectVector(new Vector3(1, 2, 3).cross(new Vector3(-4, 5, 6)), fixtures.vector3.cross);
      expectVector(new Vector3().setFromMatrixScale(composed), fixtures.vector3.fromMatrixScale);
      expect(new Vector3(1, 2, 3).angleTo(new Vector3(-4, 5, 6))).toBeCloseTo(fixtures.vector3.angleTo, PRECISION);
    });

    it('matches three for Quaternion construction and blending', () => {
      expectQuaternion(rotation, fixtures.quaternion.fromAxisAngle);
      expectQuaternion(new Quaternion().setFromRotationMatrix(composed), fixtures.quaternion.fromRotationMatrix);
      expectQuaternion(
        new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(1, 0, 0)),
        fixtures.quaternion.fromUnitVectors,
      );
      expectQuaternion(
        rotation.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.5)),
        fixtures.quaternion.multiplied,
      );
      expectQuaternion(rotation.clone().slerp(new Quaternion(), 0.5), fixtures.quaternion.slerpHalf);
      expect(rotation.angleTo(new Quaternion())).toBeCloseTo(fixtures.quaternion.angleTo, PRECISION);
    });

    it('matches three for Matrix4 composition and inversion', () => {
      expectMatrix(composed, fixtures.matrix4.composed);
      expectMatrix(composed.clone().invert(), fixtures.matrix4.inverted);
      expectMatrix(composed.clone().transpose(), fixtures.matrix4.transposed);
      expectMatrix(new Matrix4().extractRotation(composed), fixtures.matrix4.extractRotation);
      expectMatrix(composed.clone().multiply(new Matrix4().makeTranslation(1, 2, 3)), fixtures.matrix4.multiplied);
      expectMatrix(
        new Matrix4().lookAt(new Vector3(3, 4, 5), new Vector3(0, 0, 0), new Vector3(0, 1, 0)),
        fixtures.matrix4.lookAt,
      );
      expect(composed.determinant()).toBeCloseTo(fixtures.matrix4.determinant, PRECISION);
    });

    it('attributes a mirrored axis to X on decompose, exactly as three does', () => {
      const position = new Vector3();
      const quaternion = new Quaternion();
      const scale = new Vector3();
      composed.clone().decompose(position, quaternion, scale);

      expectVector(position, fixtures.matrix4.decomposed.position);
      expectVector(scale, fixtures.matrix4.decomposed.scale);
      expectQuaternion(quaternion, fixtures.matrix4.decomposed.quaternion);
      // The input scale was (2, 0.5, -1.5) — three moves the negation onto X.
      expect(scale.x).toBeLessThan(0);
      expect(scale.z).toBeGreaterThan(0);
    });

    it('matches three for Box3 queries', () => {
      const box = new Box3(new Vector3(-1, -2, -3), new Vector3(4, 5, 6));
      expectVector(box.getCenter(new Vector3()), fixtures.box3.center);
      expectVector(box.getSize(new Vector3()), fixtures.box3.size);
      expect(box.distanceToPoint(new Vector3(10, 10, 10))).toBeCloseTo(fixtures.box3.distanceToPoint, PRECISION);
      expect(box.intersectsSphere(new Sphere(new Vector3(1, 2, 3), 2.5))).toBe(fixtures.box3.intersectsSphere);

      const applied = box.clone().applyMatrix4(composed);
      expectVector(applied.min, fixtures.box3.appliedMatrix4.min);
      expectVector(applied.max, fixtures.box3.appliedMatrix4.max);
    });

    it('matches three for Sphere transform', () => {
      const sphere = new Sphere(new Vector3(1, 2, 3), 2.5);
      expect(sphere.distanceToPoint(new Vector3(10, 0, 0))).toBeCloseTo(fixtures.sphere.distanceToPoint, PRECISION);

      const applied = sphere.clone().applyMatrix4(composed);
      expectVector(applied.center, fixtures.sphere.appliedMatrix4.center);
      expect(applied.radius).toBeCloseTo(fixtures.sphere.appliedMatrix4.radius, PRECISION);
    });

    it('matches three for MathUtils', () => {
      expect(clamp(5.5, -1, 3)).toBe(fixtures.mathUtils.clamp);
      expect(degToRad(137.5)).toBeCloseTo(fixtures.mathUtils.degToRad, PRECISION);
      expect(radToDeg(2.4)).toBeCloseTo(fixtures.mathUtils.radToDeg, PRECISION);
      expect(lerp(-4, 10, 0.3)).toBeCloseTo(fixtures.mathUtils.lerp, PRECISION);
      expect(euclideanModulo(-7.25, 3)).toBeCloseTo(fixtures.mathUtils.euclideanModulo, PRECISION);
    });
  });
});
