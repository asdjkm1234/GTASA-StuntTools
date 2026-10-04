import { describe, expect, it } from 'vitest';

import { Box3 } from './box3';
import { Matrix4 } from './matrix4';
import { Quaternion } from './quaternion';
import { Sphere } from './sphere';
import { Vector3 } from './vector3';

/**
 * The EMPTY convention (`min = +Infinity`, `max = -Infinity`) is what makes `expandByPoint`
 * accumulate without special-casing, and it is also what breaks naive code — so it gets the
 * negative block. Everything else is asserted through the culling questions the engine actually
 * asks: does this box contain / touch that box or sphere.
 */
const box = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Box3 =>
  new Box3({ x: minX, y: minY, z: minZ }, { x: maxX, y: maxY, z: maxZ });

describe('Box3', () => {
  describe('negative cases', () => {
    it('starts EMPTY, with inverted infinite bounds', () => {
      const fresh = new Box3();
      expect(fresh.isEmpty()).toBe(true);
      expect(fresh.min).toMatchObject({ x: Infinity, y: Infinity, z: Infinity });
      expect(fresh.max).toMatchObject({ x: -Infinity, y: -Infinity, z: -Infinity });
    });

    it('reports the ORIGIN, not NaN, as an empty box centre and size', () => {
      const empty = new Box3();
      expect(empty.getCenter(new Vector3())).toMatchObject({ x: 0, y: 0, z: 0 });
      expect(empty.getSize(new Vector3())).toMatchObject({ x: 0, y: 0, z: 0 });
    });

    it('leaves an empty box empty under a transform instead of producing NaN corners', () => {
      const empty = new Box3().applyMatrix4(new Matrix4().makeTranslation(5, 5, 5));
      expect(empty.isEmpty()).toBe(true);
    });

    it('contains nothing while empty', () => {
      expect(new Box3().containsPoint({ x: 0, y: 0, z: 0 })).toBe(false);
    });

    it('reports no intersection for boxes separated on a single axis', () => {
      expect(box(0, 0, 0, 1, 1, 1).intersectsBox(box(2, 0, 0, 3, 1, 1))).toBe(false);
      expect(box(0, 0, 0, 1, 1, 1).intersectsBox(box(0, 0, 2, 1, 1, 3))).toBe(false);
    });

    it('reports no intersection for a sphere just out of reach', () => {
      const unit = box(0, 0, 0, 1, 1, 1);
      expect(unit.intersectsSphere(new Sphere({ x: 3, y: 0.5, z: 0.5 }, 1.5))).toBe(false);
      expect(unit.intersectsSphere(new Sphere({ x: 3, y: 0.5, z: 0.5 }, 2))).toBe(true);
    });

    it('does not contain a box that pokes out on one side', () => {
      expect(box(0, 0, 0, 10, 10, 10).containsBox(box(1, 1, 1, 11, 9, 9))).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('accumulates points from empty, needing no seed', () => {
      const fitted = new Box3().setFromPoints([
        { x: 1, y: 2, z: 3 },
        { x: -4, y: 0, z: 8 },
        { x: 0, y: -6, z: 1 },
      ]);
      expect(fitted.min).toMatchObject({ x: -4, y: -6, z: 1 });
      expect(fitted.max).toMatchObject({ x: 1, y: 2, z: 8 });
      expect(fitted.isEmpty()).toBe(false);
    });

    it('builds from a centre and size', () => {
      const centred = new Box3().setFromCenterAndSize({ x: 10, y: 0, z: -5 }, { x: 4, y: 2, z: 6 });
      expect(centred.min).toMatchObject({ x: 8, y: -1, z: -8 });
      expect(centred.max).toMatchObject({ x: 12, y: 1, z: -2 });
      expect(centred.getCenter(new Vector3())).toMatchObject({ x: 10, y: 0, z: -5 });
      expect(centred.getSize(new Vector3())).toMatchObject({ x: 4, y: 2, z: 6 });
    });

    it('treats surface points as contained (inclusive bounds)', () => {
      const unit = box(0, 0, 0, 1, 1, 1);
      expect(unit.containsPoint({ x: 0, y: 0, z: 0 })).toBe(true);
      expect(unit.containsPoint({ x: 1, y: 1, z: 1 })).toBe(true);
      expect(unit.containsPoint({ x: 0.5, y: 0.5, z: 1.0001 })).toBe(false);
    });

    it('treats touching boxes as intersecting and nested boxes as contained', () => {
      expect(box(0, 0, 0, 1, 1, 1).intersectsBox(box(1, 1, 1, 2, 2, 2))).toBe(true);
      expect(box(0, 0, 0, 10, 10, 10).containsBox(box(1, 1, 1, 9, 9, 9))).toBe(true);
      expect(box(0, 0, 0, 10, 10, 10).containsBox(box(0, 0, 0, 10, 10, 10))).toBe(true);
    });

    it('measures zero distance inside the box and the true gap outside', () => {
      const unit = box(0, 0, 0, 1, 1, 1);
      expect(unit.distanceToPoint({ x: 0.5, y: 0.5, z: 0.5 })).toBe(0);
      expect(unit.distanceToPoint({ x: 4, y: 0.5, z: 0.5 })).toBe(3);
      expect(unit.distanceToPoint({ x: 4, y: 5, z: 0.5 })).toBeCloseTo(5, 12); // 3-4-5 corner gap
    });

    it('clamps a point onto the box surface', () => {
      const clamped = box(0, 0, 0, 1, 1, 1).clampPoint({ x: -5, y: 0.5, z: 9 }, new Vector3());
      expect(clamped).toMatchObject({ x: 0, y: 0.5, z: 1 });
    });

    it('expands, translates and unions', () => {
      expect(box(0, 0, 0, 1, 1, 1).expandByScalar(1).min).toMatchObject({ x: -1, y: -1, z: -1 });
      expect(box(0, 0, 0, 1, 1, 1).translate({ x: 5, y: 0, z: 0 }).max).toMatchObject({ x: 6, y: 1, z: 1 });

      const merged = box(0, 0, 0, 1, 1, 1).union(box(-3, 0, 0, 0, 4, 0));
      expect(merged.min).toMatchObject({ x: -3, y: 0, z: 0 });
      expect(merged.max).toMatchObject({ x: 1, y: 4, z: 1 });
    });

    it('GROWS a box when the transform rotates it — the eight-corner refit', () => {
      // A unit box rotated 45° about Z spans √2 across the diagonal axes; a naive min/max
      // transform of only the two corners would keep it 1 wide.
      const eighthTurn = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4);
      const rotation = new Matrix4().makeRotationFromQuaternion(eighthTurn);
      const rotated = box(-0.5, -0.5, -0.5, 0.5, 0.5, 0.5).applyMatrix4(rotation);
      expect(rotated.max.x).toBeCloseTo(Math.SQRT1_2, 12);
      expect(rotated.max.y).toBeCloseTo(Math.SQRT1_2, 12);
      expect(rotated.max.z).toBeCloseTo(0.5, 12); // untouched axis
    });

    it('clones and copies without aliasing the vectors', () => {
      const source = box(0, 0, 0, 1, 1, 1);
      const clone = source.clone();
      clone.translate({ x: 9, y: 9, z: 9 });
      expect(source.min).toMatchObject({ x: 0, y: 0, z: 0 });
      expect(new Box3().copy(source).max).toMatchObject({ x: 1, y: 1, z: 1 });
    });
  });
});
