import type { Matrix4Like, QuaternionLike, Vector3Like } from './types';

import { clamp } from './math-utils';

/** Mutable in place, like {@link Vector3}. */
export class Quaternion {
  w: number;
  x: number;
  y: number;
  z: number;

  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  angleTo(q: Quaternion): number {
    return 2 * Math.acos(Math.abs(clamp(this.dot(q), -1, 1)));
  }

  clone(): Quaternion {
    return new Quaternion(this.x, this.y, this.z, this.w);
  }

  conjugate(): this {
    return this.set(-this.x, -this.y, -this.z, this.w);
  }

  copy(q: QuaternionLike): this {
    return this.set(q.x, q.y, q.z, q.w);
  }

  dot(q: QuaternionLike): number {
    return this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w;
  }

  equals(q: QuaternionLike): boolean {
    return this.x === q.x && this.y === q.y && this.z === q.z && this.w === q.w;
  }

  fromArray(array: ArrayLike<number>, offset = 0): this {
    return this.set(array[offset], array[offset + 1], array[offset + 2], array[offset + 3]);
  }

  identity(): this {
    return this.set(0, 0, 0, 1);
  }

  /** Unit quaternions only, where the inverse IS the conjugate — three made the same simplification. */
  invert(): this {
    return this.conjugate();
  }

  length(): number {
    return Math.sqrt(this.lengthSq());
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
  }

  multiply(q: QuaternionLike): this {
    return this.multiplyQuaternions(this, q);
  }

  multiplyQuaternions(a: QuaternionLike, b: QuaternionLike): this {
    return this.set(
      a.x * b.w + a.w * b.x + a.y * b.z - a.z * b.y,
      a.y * b.w + a.w * b.y + a.z * b.x - a.x * b.z,
      a.z * b.w + a.w * b.z + a.x * b.y - a.y * b.x,
      a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    );
  }

  /** A zero quaternion normalizes to identity rather than NaN. */
  normalize(): this {
    const length = this.length();
    if (length === 0) return this.identity();
    const inverse = 1 / length;

    return this.set(this.x * inverse, this.y * inverse, this.z * inverse, this.w * inverse);
  }

  premultiply(q: QuaternionLike): this {
    return this.multiplyQuaternions(q, this);
  }

  set(x: number, y: number, z: number, w: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;

    return this;
  }

  setFromAxisAngle(axis: Vector3Like, angle: number): this {
    const half = angle / 2;
    const s = Math.sin(half);

    return this.set(axis.x * s, axis.y * s, axis.z * s, Math.cos(half));
  }

  /** Assumes the matrix's upper 3×3 is a pure rotation (no scale) — three's contract too. */
  setFromRotationMatrix(m: Matrix4Like): this {
    const e = m.elements;
    const m11 = e[0];
    const m12 = e[4];
    const m13 = e[8];
    const m21 = e[1];
    const m22 = e[5];
    const m23 = e[9];
    const m31 = e[2];
    const m32 = e[6];
    const m33 = e[10];
    const trace = m11 + m22 + m33;

    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1);

      return this.set((m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s);
    }

    if (m11 > m22 && m11 > m33) {
      const s = 2 * Math.sqrt(1 + m11 - m22 - m33);

      return this.set(0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s);
    }

    if (m22 > m33) {
      const s = 2 * Math.sqrt(1 + m22 - m11 - m33);

      return this.set((m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s);
    }

    const s = 2 * Math.sqrt(1 + m33 - m11 - m22);

    return this.set((m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s);
  }

  /** Shortest rotation taking `from` to `to`; both must already be unit length. */
  setFromUnitVectors(from: Vector3Like, to: Vector3Like): this {
    const r = from.x * to.x + from.y * to.y + from.z * to.z + 1;

    if (r < Number.EPSILON) {
      // Opposite vectors: any perpendicular axis works — pick the one furthest from `from`.
      return Math.abs(from.x) > Math.abs(from.z)
        ? this.set(-from.y, from.x, 0, 0).normalize()
        : this.set(0, -from.z, from.y, 0).normalize();
    }

    return this.set(
      from.y * to.z - from.z * to.y,
      from.z * to.x - from.x * to.z,
      from.x * to.y - from.y * to.x,
      r,
    ).normalize();
  }

  slerp(q: QuaternionLike, t: number): this {
    if (t === 0) return this;
    if (t === 1) return this.copy(q);

    const { w, x, y, z } = this;
    let cosHalfTheta = w * q.w + x * q.x + y * q.y + z * q.z;

    // Take the shorter arc.
    if (cosHalfTheta < 0) {
      this.set(-q.x, -q.y, -q.z, -q.w);
      cosHalfTheta = -cosHalfTheta;
    } else {
      this.copy(q);
    }

    if (cosHalfTheta >= 1) return this.set(x, y, z, w);

    const sqrSinHalfTheta = 1 - cosHalfTheta * cosHalfTheta;
    if (sqrSinHalfTheta <= Number.EPSILON) {
      // Nearly parallel: linear blend, then renormalize.
      const s = 1 - t;

      return this.set(s * x + t * this.x, s * y + t * this.y, s * z + t * this.z, s * w + t * this.w).normalize();
    }

    const sinHalfTheta = Math.sqrt(sqrSinHalfTheta);
    const halfTheta = Math.atan2(sinHalfTheta, cosHalfTheta);
    const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta;
    const ratioB = Math.sin(t * halfTheta) / sinHalfTheta;

    return this.set(
      x * ratioA + this.x * ratioB,
      y * ratioA + this.y * ratioB,
      z * ratioA + this.z * ratioB,
      w * ratioA + this.w * ratioB,
    );
  }

  slerpQuaternions(a: QuaternionLike, b: QuaternionLike, t: number): this {
    return this.copy(a).slerp(b, t);
  }

  toArray(array: number[] = [], offset = 0): number[] {
    array[offset] = this.x;
    array[offset + 1] = this.y;
    array[offset + 2] = this.z;
    array[offset + 3] = this.w;

    return array;
  }
}
