import type { Box3 } from './box3';
import type { Matrix4Like, Vector3Like } from './types';

import { Vector3 } from './vector3';

/** A negative radius marks an EMPTY sphere — three's convention, and what `makeEmpty` produces. */
export class Sphere {
  readonly center: Vector3;
  radius: number;

  constructor(center?: Vector3Like, radius = -1) {
    this.center = new Vector3();
    if (center) this.center.copy(center);
    this.radius = radius;
  }

  /** The radius grows by the largest axis scale — a sphere cannot represent a non-uniform squash. */
  applyMatrix4(m: Matrix4Like): this {
    const e = m.elements;
    const maxScaleSq = Math.max(
      e[0] * e[0] + e[1] * e[1] + e[2] * e[2],
      e[4] * e[4] + e[5] * e[5] + e[6] * e[6],
      e[8] * e[8] + e[9] * e[9] + e[10] * e[10],
    );
    this.center.applyMatrix4(m);
    this.radius *= Math.sqrt(maxScaleSq);

    return this;
  }

  clone(): Sphere {
    return new Sphere().copy(this);
  }

  containsPoint(point: Vector3Like): boolean {
    return this.center.distanceToSquared(point) <= this.radius * this.radius;
  }

  copy(sphere: Sphere): this {
    return this.set(sphere.center, sphere.radius);
  }

  distanceToPoint(point: Vector3Like): number {
    return this.center.distanceTo(point) - this.radius;
  }

  intersectsBox(box: Box3): boolean {
    return box.intersectsSphere(this);
  }

  intersectsSphere(sphere: Sphere): boolean {
    const radiusSum = this.radius + sphere.radius;

    return this.center.distanceToSquared(sphere.center) <= radiusSum * radiusSum;
  }

  isEmpty(): boolean {
    return this.radius < 0;
  }

  makeEmpty(): this {
    this.center.set(0, 0, 0);
    this.radius = -1;

    return this;
  }

  set(center: Vector3Like, radius: number): this {
    this.center.copy(center);
    this.radius = radius;

    return this;
  }

  translate(offset: Vector3Like): this {
    this.center.add(offset);

    return this;
  }
}
