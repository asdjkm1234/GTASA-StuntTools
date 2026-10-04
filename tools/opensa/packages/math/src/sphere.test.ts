import { describe, expect, it } from 'vitest';

import { Box3 } from './box3';
import { Matrix4 } from './matrix4';
import { Quaternion } from './quaternion';
import { Sphere } from './sphere';
import { Vector3 } from './vector3';

/**
 * The engine culls cells and clutter groups by bounding sphere, so the cases that matter are the
 * boundary ones (touching counts as intersecting) and the NEGATIVE-radius empty convention, which
 * a caller that assumes `radius >= 0` will silently mis-handle.
 */
describe('Sphere', () => {
  describe('negative cases', () => {
    it('defaults to EMPTY via a negative radius', () => {
      const fresh = new Sphere();
      expect(fresh.radius).toBe(-1);
      expect(fresh.isEmpty()).toBe(true);
    });

    it('TRAP: an empty sphere still "contains" its own centre — a negative radius squares positive', () => {
      // `containsPoint` compares squared distances, so radius −1 behaves like radius 1 there.
      // Callers must gate on `isEmpty()`; pinned so nobody "simplifies" the gate away.
      const empty = new Sphere();
      expect(empty.isEmpty()).toBe(true);
      expect(empty.containsPoint({ x: 0, y: 0, z: 0 })).toBe(true);
      expect(empty.containsPoint({ x: 2, y: 0, z: 0 })).toBe(false);
      expect(empty.distanceToPoint({ x: 0, y: 0, z: 0 })).toBe(1); // sign is inverted too
    });

    it('makeEmpty resets a real sphere back to the empty convention', () => {
      const emptied = new Sphere({ x: 5, y: 5, z: 5 }, 10).makeEmpty();
      expect(emptied.isEmpty()).toBe(true);
      expect(emptied.center).toMatchObject({ x: 0, y: 0, z: 0 });
    });

    it('reports no intersection for spheres just short of touching', () => {
      const unit = new Sphere({ x: 0, y: 0, z: 0 }, 1);
      expect(unit.intersectsSphere(new Sphere({ x: 2.0001, y: 0, z: 0 }, 1))).toBe(false);
    });

    it('reports no intersection for a box out of reach', () => {
      const unit = new Sphere({ x: 0, y: 0, z: 0 }, 1);
      expect(unit.intersectsBox(new Box3({ x: 2, y: 2, z: 2 }, { x: 3, y: 3, z: 3 }))).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('treats surface points and exactly-touching spheres as hits', () => {
      const unit = new Sphere({ x: 0, y: 0, z: 0 }, 1);
      expect(unit.containsPoint({ x: 1, y: 0, z: 0 })).toBe(true);
      expect(unit.intersectsSphere(new Sphere({ x: 2, y: 0, z: 0 }, 1))).toBe(true);
    });

    it('intersects a box it overlaps or touches', () => {
      const unit = new Sphere({ x: 0, y: 0, z: 0 }, 1);
      expect(unit.intersectsBox(new Box3({ x: 0.5, y: -1, z: -1 }, { x: 2, y: 1, z: 1 }))).toBe(true);
      expect(unit.intersectsBox(new Box3({ x: 1, y: -1, z: -1 }, { x: 2, y: 1, z: 1 }))).toBe(true);
    });

    it('signs distanceToPoint negative inside and positive outside', () => {
      const unit = new Sphere({ x: 0, y: 0, z: 0 }, 1);
      expect(unit.distanceToPoint({ x: 0, y: 0, z: 0 })).toBe(-1);
      expect(unit.distanceToPoint({ x: 4, y: 0, z: 0 })).toBe(3);
    });

    it('translates the centre and leaves the radius alone', () => {
      const moved = new Sphere({ x: 1, y: 2, z: 3 }, 5).translate({ x: 10, y: 0, z: -3 });
      expect(moved.center).toMatchObject({ x: 11, y: 2, z: 0 });
      expect(moved.radius).toBe(5);
    });

    it('grows the radius by the LARGEST axis scale — a sphere cannot squash', () => {
      const scaled = new Sphere({ x: 1, y: 0, z: 0 }, 2).applyMatrix4(new Matrix4().makeScale(3, 1, 0.5));
      expect(scaled.radius).toBeCloseTo(6, 12); // 2 × max(3, 1, 0.5)
      expect(scaled.center).toMatchObject({ x: 3, y: 0, z: 0 });
    });

    it('carries the radius through a rotation unchanged', () => {
      const quarterTurn = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
      const rotation = new Matrix4().makeRotationFromQuaternion(quarterTurn);
      const rotated = new Sphere({ x: 1, y: 0, z: 0 }, 2).applyMatrix4(rotation);
      expect(rotated.radius).toBeCloseTo(2, 12);
      expect(rotated.center.y).toBeCloseTo(1, 12);
    });

    it('clones and copies without aliasing the centre', () => {
      const source = new Sphere({ x: 1, y: 2, z: 3 }, 4);
      const clone = source.clone();
      clone.translate({ x: 100, y: 0, z: 0 });
      expect(source.center.x).toBe(1);
      expect(new Sphere().copy(source)).toMatchObject({ radius: 4 });
    });
  });
});
