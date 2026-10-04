import type { Matrix4Like, QuaternionLike, Vector3Like } from './types';

import { clamp as clampNumber } from './math-utils';

/**
 * Mutable by design: every operation writes in place and returns `this`, so hot paths (streaming,
 * physics, scatter) chain without allocating. Use `clone()` when you need a copy.
 */
export class Vector3 {
  x: number;
  y: number;
  z: number;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  add(v: Vector3Like): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;

    return this;
  }

  addScalar(scalar: number): this {
    return this.set(this.x + scalar, this.y + scalar, this.z + scalar);
  }

  addScaledVector(v: Vector3Like, scale: number): this {
    this.x += v.x * scale;
    this.y += v.y * scale;
    this.z += v.z * scale;

    return this;
  }

  addVectors(a: Vector3Like, b: Vector3Like): this {
    return this.set(a.x + b.x, a.y + b.y, a.z + b.z);
  }

  /** Angle between the two directions, in radians, clamped against float drift outside [-1, 1]. */
  angleTo(v: Vector3): number {
    const denominator = Math.sqrt(this.lengthSq() * v.lengthSq());
    if (denominator === 0) return Math.PI / 2;

    return Math.acos(clampNumber(this.dot(v) / denominator, -1, 1));
  }

  applyAxisAngle(axis: Vector3Like, angle: number): this {
    const half = angle / 2;
    const s = Math.sin(half);

    return this.applyQuaternion({
      w: Math.cos(half),
      x: axis.x * s,
      y: axis.y * s,
      z: axis.z * s,
    });
  }

  /** Full 4×4 transform including translation, with the perspective divide three applies. */
  applyMatrix4(m: Matrix4Like): this {
    const e = m.elements;
    const { x, y, z } = this;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);

    return this.set(
      (e[0] * x + e[4] * y + e[8] * z + e[12]) * w,
      (e[1] * x + e[5] * y + e[9] * z + e[13]) * w,
      (e[2] * x + e[6] * y + e[10] * z + e[14]) * w,
    );
  }

  applyQuaternion(q: QuaternionLike): this {
    const { w, x, y, z } = q;
    const vx = this.x;
    const vy = this.y;
    const vz = this.z;

    // t = 2 * cross(q.xyz, v)
    const tx = 2 * (y * vz - z * vy);
    const ty = 2 * (z * vx - x * vz);
    const tz = 2 * (x * vy - y * vx);

    // v + w * t + cross(q.xyz, t)
    return this.set(vx + w * tx + y * tz - z * ty, vy + w * ty + z * tx - x * tz, vz + w * tz + x * ty - y * tx);
  }

  clamp(min: Vector3Like, max: Vector3Like): this {
    return this.set(
      clampNumber(this.x, min.x, max.x),
      clampNumber(this.y, min.y, max.y),
      clampNumber(this.z, min.z, max.z),
    );
  }

  clone(): Vector3 {
    return new Vector3(this.x, this.y, this.z);
  }

  copy(v: Vector3Like): this {
    return this.set(v.x, v.y, v.z);
  }

  cross(v: Vector3Like): this {
    return this.crossVectors(this, v);
  }

  crossVectors(a: Vector3Like, b: Vector3Like): this {
    return this.set(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  }

  distanceTo(v: Vector3Like): number {
    return Math.sqrt(this.distanceToSquared(v));
  }

  distanceToSquared(v: Vector3Like): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;

    return dx * dx + dy * dy + dz * dz;
  }

  divide(v: Vector3Like): this {
    this.x /= v.x;
    this.y /= v.y;
    this.z /= v.z;

    return this;
  }

  divideScalar(scalar: number): this {
    return this.multiplyScalar(1 / scalar);
  }

  dot(v: Vector3Like): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  equals(v: Vector3Like): boolean {
    return this.x === v.x && this.y === v.y && this.z === v.z;
  }

  floor(): this {
    return this.set(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z));
  }

  fromArray(array: ArrayLike<number>, offset = 0): this {
    return this.set(array[offset], array[offset + 1], array[offset + 2]);
  }

  length(): number {
    return Math.sqrt(this.lengthSq());
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  lerp(v: Vector3Like, alpha: number): this {
    this.x += (v.x - this.x) * alpha;
    this.y += (v.y - this.y) * alpha;
    this.z += (v.z - this.z) * alpha;

    return this;
  }

  lerpVectors(a: Vector3Like, b: Vector3Like, alpha: number): this {
    return this.set(a.x + (b.x - a.x) * alpha, a.y + (b.y - a.y) * alpha, a.z + (b.z - a.z) * alpha);
  }

  max(v: Vector3Like): this {
    return this.set(Math.max(this.x, v.x), Math.max(this.y, v.y), Math.max(this.z, v.z));
  }

  min(v: Vector3Like): this {
    return this.set(Math.min(this.x, v.x), Math.min(this.y, v.y), Math.min(this.z, v.z));
  }

  multiply(v: Vector3Like): this {
    this.x *= v.x;
    this.y *= v.y;
    this.z *= v.z;

    return this;
  }

  multiplyScalar(scalar: number): this {
    return this.set(this.x * scalar, this.y * scalar, this.z * scalar);
  }

  negate(): this {
    return this.set(-this.x, -this.y, -this.z);
  }

  /** A zero vector normalizes to zero (three's behaviour: division by zero length yields NaN-free zeros). */
  normalize(): this {
    const length = this.length();

    return length === 0 ? this.set(0, 0, 0) : this.divideScalar(length);
  }

  round(): this {
    return this.set(Math.round(this.x), Math.round(this.y), Math.round(this.z));
  }

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;

    return this;
  }

  setFromMatrixColumn(m: Matrix4Like, index: number): this {
    return this.fromArray(m.elements, index * 4);
  }

  setFromMatrixPosition(m: Matrix4Like): this {
    const e = m.elements;

    return this.set(e[12], e[13], e[14]);
  }

  /** Component-wise scale magnitude of a transform — the length of each basis column. */
  setFromMatrixScale(m: Matrix4Like): this {
    const e = m.elements;

    return this.set(Math.hypot(e[0], e[1], e[2]), Math.hypot(e[4], e[5], e[6]), Math.hypot(e[8], e[9], e[10]));
  }

  setLength(length: number): this {
    return this.normalize().multiplyScalar(length);
  }

  setScalar(scalar: number): this {
    return this.set(scalar, scalar, scalar);
  }

  sub(v: Vector3Like): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;

    return this;
  }

  subVectors(a: Vector3Like, b: Vector3Like): this {
    return this.set(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  toArray(array: number[] = [], offset = 0): number[] {
    array[offset] = this.x;
    array[offset + 1] = this.y;
    array[offset + 2] = this.z;

    return array;
  }

  /** Rotation and scale only — for directions and normals-ish vectors that must not be translated. */
  transformDirection(m: Matrix4Like): this {
    const e = m.elements;
    const { x, y, z } = this;

    return this.set(
      e[0] * x + e[4] * y + e[8] * z,
      e[1] * x + e[5] * y + e[9] * z,
      e[2] * x + e[6] * y + e[10] * z,
    ).normalize();
  }
}
