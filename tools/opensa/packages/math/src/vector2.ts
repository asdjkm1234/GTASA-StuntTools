import type { Vector2Like } from './types';

/** Mutable in place, like {@link Vector3}. */
export class Vector2 {
  x: number;
  y: number;

  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  add(v: Vector2Like): this {
    return this.set(this.x + v.x, this.y + v.y);
  }

  addVectors(a: Vector2Like, b: Vector2Like): this {
    return this.set(a.x + b.x, a.y + b.y);
  }

  clone(): Vector2 {
    return new Vector2(this.x, this.y);
  }

  copy(v: Vector2Like): this {
    return this.set(v.x, v.y);
  }

  /** Signed z of the 3D cross product — the sign tells you which side `v` is on. */
  cross(v: Vector2Like): number {
    return this.x * v.y - this.y * v.x;
  }

  distanceTo(v: Vector2Like): number {
    return Math.sqrt(this.distanceToSquared(v));
  }

  distanceToSquared(v: Vector2Like): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;

    return dx * dx + dy * dy;
  }

  divideScalar(scalar: number): this {
    return this.multiplyScalar(1 / scalar);
  }

  dot(v: Vector2Like): number {
    return this.x * v.x + this.y * v.y;
  }

  equals(v: Vector2Like): boolean {
    return this.x === v.x && this.y === v.y;
  }

  fromArray(array: ArrayLike<number>, offset = 0): this {
    return this.set(array[offset], array[offset + 1]);
  }

  length(): number {
    return Math.sqrt(this.lengthSq());
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y;
  }

  lerp(v: Vector2Like, alpha: number): this {
    this.x += (v.x - this.x) * alpha;
    this.y += (v.y - this.y) * alpha;

    return this;
  }

  multiplyScalar(scalar: number): this {
    return this.set(this.x * scalar, this.y * scalar);
  }

  negate(): this {
    return this.set(-this.x, -this.y);
  }

  normalize(): this {
    const length = this.length();

    return length === 0 ? this.set(0, 0) : this.divideScalar(length);
  }

  set(x: number, y: number): this {
    this.x = x;
    this.y = y;

    return this;
  }

  setScalar(scalar: number): this {
    return this.set(scalar, scalar);
  }

  sub(v: Vector2Like): this {
    return this.set(this.x - v.x, this.y - v.y);
  }

  subVectors(a: Vector2Like, b: Vector2Like): this {
    return this.set(a.x - b.x, a.y - b.y);
  }

  toArray(array: number[] = [], offset = 0): number[] {
    array[offset] = this.x;
    array[offset + 1] = this.y;

    return array;
  }
}
