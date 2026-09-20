import type { Matrix4Like, Vector4Like } from './types';

/** Mutable in place, like {@link Vector3}. Mostly a shader-uniform carrier in this codebase. */
export class Vector4 {
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

  add(v: Vector4Like): this {
    return this.set(this.x + v.x, this.y + v.y, this.z + v.z, this.w + v.w);
  }

  applyMatrix4(m: Matrix4Like): this {
    const e = m.elements;
    const { w, x, y, z } = this;

    return this.set(
      e[0] * x + e[4] * y + e[8] * z + e[12] * w,
      e[1] * x + e[5] * y + e[9] * z + e[13] * w,
      e[2] * x + e[6] * y + e[10] * z + e[14] * w,
      e[3] * x + e[7] * y + e[11] * z + e[15] * w,
    );
  }

  clone(): Vector4 {
    return new Vector4(this.x, this.y, this.z, this.w);
  }

  copy(v: Vector4Like): this {
    return this.set(v.x, v.y, v.z, v.w);
  }

  divideScalar(scalar: number): this {
    return this.multiplyScalar(1 / scalar);
  }

  dot(v: Vector4Like): number {
    return this.x * v.x + this.y * v.y + this.z * v.z + this.w * v.w;
  }

  equals(v: Vector4Like): boolean {
    return this.x === v.x && this.y === v.y && this.z === v.z && this.w === v.w;
  }

  fromArray(array: ArrayLike<number>, offset = 0): this {
    return this.set(array[offset], array[offset + 1], array[offset + 2], array[offset + 3]);
  }

  length(): number {
    return Math.sqrt(this.lengthSq());
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;
  }

  lerp(v: Vector4Like, alpha: number): this {
    this.x += (v.x - this.x) * alpha;
    this.y += (v.y - this.y) * alpha;
    this.z += (v.z - this.z) * alpha;
    this.w += (v.w - this.w) * alpha;

    return this;
  }

  multiplyScalar(scalar: number): this {
    return this.set(this.x * scalar, this.y * scalar, this.z * scalar, this.w * scalar);
  }

  normalize(): this {
    const length = this.length();

    return length === 0 ? this.set(0, 0, 0, 0) : this.divideScalar(length);
  }

  set(x: number, y: number, z: number, w: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;

    return this;
  }

  setScalar(scalar: number): this {
    return this.set(scalar, scalar, scalar, scalar);
  }

  sub(v: Vector4Like): this {
    return this.set(this.x - v.x, this.y - v.y, this.z - v.z, this.w - v.w);
  }

  toArray(array: number[] = [], offset = 0): number[] {
    array[offset] = this.x;
    array[offset + 1] = this.y;
    array[offset + 2] = this.z;
    array[offset + 3] = this.w;

    return array;
  }
}
