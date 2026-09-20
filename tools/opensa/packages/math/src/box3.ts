import type { Matrix4Like, Vector3Like } from './types';

import { Vector3 } from './vector3';

const corner = new Vector3();

/**
 * Axis-aligned bounds. An EMPTY box is `min = +Infinity`, `max = -Infinity` — the identity for
 * `expandByPoint`, so accumulating into a fresh box needs no special-casing.
 */
export class Box3 {
  readonly max: Vector3;
  readonly min: Vector3;

  constructor(min?: Vector3Like, max?: Vector3Like) {
    this.min = new Vector3(Infinity, Infinity, Infinity);
    this.max = new Vector3(-Infinity, -Infinity, -Infinity);
    if (min) this.min.copy(min);
    if (max) this.max.copy(max);
  }

  /** Transforms all eight corners and re-fits — a rotated box grows, as it must. */
  applyMatrix4(m: Matrix4Like): this {
    if (this.isEmpty()) return this;

    const { max, min } = this;
    const x0 = min.x,
      y0 = min.y,
      z0 = min.z;
    const x1 = max.x,
      y1 = max.y,
      z1 = max.z;
    this.makeEmpty();

    for (let i = 0; i < 8; i += 1) {
      corner.set(i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0).applyMatrix4(m);
      this.expandByPoint(corner);
    }

    return this;
  }

  clampPoint(point: Vector3Like, target: Vector3): Vector3 {
    return target.copy(point).clamp(this.min, this.max);
  }

  clone(): Box3 {
    return new Box3().copy(this);
  }

  containsBox(box: Box3): boolean {
    return (
      this.min.x <= box.min.x &&
      box.max.x <= this.max.x &&
      this.min.y <= box.min.y &&
      box.max.y <= this.max.y &&
      this.min.z <= box.min.z &&
      box.max.z <= this.max.z
    );
  }

  containsPoint(point: Vector3Like): boolean {
    return (
      point.x >= this.min.x &&
      point.x <= this.max.x &&
      point.y >= this.min.y &&
      point.y <= this.max.y &&
      point.z >= this.min.z &&
      point.z <= this.max.z
    );
  }

  copy(box: Box3): this {
    return this.set(box.min, box.max);
  }

  distanceToPoint(point: Vector3Like): number {
    return Math.hypot(
      Math.max(this.min.x - point.x, 0, point.x - this.max.x),
      Math.max(this.min.y - point.y, 0, point.y - this.max.y),
      Math.max(this.min.z - point.z, 0, point.z - this.max.z),
    );
  }

  expandByPoint(point: Vector3Like): this {
    this.min.min(point);
    this.max.max(point);

    return this;
  }

  expandByScalar(scalar: number): this {
    this.min.addScalar(-scalar);
    this.max.addScalar(scalar);

    return this;
  }

  /** An empty box has no meaningful centre; three returns the origin rather than NaN. */
  getCenter(target: Vector3): Vector3 {
    return this.isEmpty() ? target.set(0, 0, 0) : target.addVectors(this.min, this.max).multiplyScalar(0.5);
  }

  getSize(target: Vector3): Vector3 {
    return this.isEmpty() ? target.set(0, 0, 0) : target.subVectors(this.max, this.min);
  }

  intersectsBox(box: Box3): boolean {
    return !(
      box.max.x < this.min.x ||
      box.min.x > this.max.x ||
      box.max.y < this.min.y ||
      box.min.y > this.max.y ||
      box.max.z < this.min.z ||
      box.min.z > this.max.z
    );
  }

  intersectsSphere(sphere: { center: Vector3Like; radius: number }): boolean {
    return this.distanceToPoint(sphere.center) <= sphere.radius;
  }

  isEmpty(): boolean {
    return this.max.x < this.min.x || this.max.y < this.min.y || this.max.z < this.min.z;
  }

  makeEmpty(): this {
    this.min.set(Infinity, Infinity, Infinity);
    this.max.set(-Infinity, -Infinity, -Infinity);

    return this;
  }

  set(min: Vector3Like, max: Vector3Like): this {
    this.min.copy(min);
    this.max.copy(max);

    return this;
  }

  setFromCenterAndSize(center: Vector3Like, size: Vector3Like): this {
    const halfX = size.x / 2;
    const halfY = size.y / 2;
    const halfZ = size.z / 2;
    this.min.set(center.x - halfX, center.y - halfY, center.z - halfZ);
    this.max.set(center.x + halfX, center.y + halfY, center.z + halfZ);

    return this;
  }

  setFromPoints(points: readonly Vector3Like[]): this {
    this.makeEmpty();
    for (const point of points) this.expandByPoint(point);

    return this;
  }

  translate(offset: Vector3Like): this {
    this.min.add(offset);
    this.max.add(offset);

    return this;
  }

  union(box: Box3): this {
    this.min.min(box.min);
    this.max.max(box.max);

    return this;
  }
}
