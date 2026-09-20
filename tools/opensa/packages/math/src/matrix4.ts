import type { Quaternion } from './quaternion';
import type { Matrix4Like, QuaternionLike, Vector3Like } from './types';

import { Vector3 } from './vector3';

const tmpX = new Vector3();
const tmpY = new Vector3();
const tmpZ = new Vector3();
const tmpMatrix = { elements: new Array<number>(16) };

/**
 * Column-major storage, row-major `set()` arguments — three's exact convention, so `elements` can be
 * uploaded to WebGPU and compared against three-era fixtures byte for byte.
 */
export class Matrix4 {
  readonly elements: number[];

  constructor() {
    this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }

  clone(): Matrix4 {
    return new Matrix4().copy(this);
  }

  compose(position: Vector3Like, quaternion: QuaternionLike, scale: Vector3Like): this {
    const e = this.elements;
    const { w, x, y, z } = quaternion;
    const x2 = x + x,
      y2 = y + y,
      z2 = z + z;
    const xx = x * x2,
      xy = x * y2,
      xz = x * z2;
    const yy = y * y2,
      yz = y * z2,
      zz = z * z2;
    const wx = w * x2,
      wy = w * y2,
      wz = w * z2;
    const sx = scale.x,
      sy = scale.y,
      sz = scale.z;

    e[0] = (1 - (yy + zz)) * sx;
    e[1] = (xy + wz) * sx;
    e[2] = (xz - wy) * sx;
    e[3] = 0;

    e[4] = (xy - wz) * sy;
    e[5] = (1 - (xx + zz)) * sy;
    e[6] = (yz + wx) * sy;
    e[7] = 0;

    e[8] = (xz + wy) * sz;
    e[9] = (yz - wx) * sz;
    e[10] = (1 - (xx + yy)) * sz;
    e[11] = 0;

    e[12] = position.x;
    e[13] = position.y;
    e[14] = position.z;
    e[15] = 1;

    return this;
  }

  copy(m: Matrix4Like): this {
    for (let i = 0; i < 16; i += 1) this.elements[i] = m.elements[i];

    return this;
  }

  decompose(position: Vector3, quaternion: Quaternion, scale: Vector3): this {
    const e = this.elements;
    let sx = Math.hypot(e[0], e[1], e[2]);
    const sy = Math.hypot(e[4], e[5], e[6]);
    const sz = Math.hypot(e[8], e[9], e[10]);

    // A negative determinant means one axis is mirrored; three attributes the flip to X.
    if (this.determinant() < 0) sx = -sx;

    position.set(e[12], e[13], e[14]);

    const m = tmpMatrix.elements;
    for (let i = 0; i < 16; i += 1) m[i] = e[i];
    const invSX = 1 / sx;
    const invSY = 1 / sy;
    const invSZ = 1 / sz;
    m[0] *= invSX;
    m[1] *= invSX;
    m[2] *= invSX;
    m[4] *= invSY;
    m[5] *= invSY;
    m[6] *= invSY;
    m[8] *= invSZ;
    m[9] *= invSZ;
    m[10] *= invSZ;

    quaternion.setFromRotationMatrix(tmpMatrix);
    scale.set(sx, sy, sz);

    return this;
  }

  determinant(): number {
    const e = this.elements;
    const n11 = e[0],
      n12 = e[4],
      n13 = e[8],
      n14 = e[12];
    const n21 = e[1],
      n22 = e[5],
      n23 = e[9],
      n24 = e[13];
    const n31 = e[2],
      n32 = e[6],
      n33 = e[10],
      n34 = e[14];
    const n41 = e[3],
      n42 = e[7],
      n43 = e[11],
      n44 = e[15];

    return (
      n41 *
        (n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34) +
      n42 *
        (n11 * n23 * n34 - n11 * n24 * n33 + n14 * n21 * n33 - n13 * n21 * n34 + n13 * n24 * n31 - n14 * n23 * n31) +
      n43 *
        (n11 * n24 * n32 - n11 * n22 * n34 - n14 * n21 * n32 + n12 * n21 * n34 + n14 * n22 * n31 - n12 * n24 * n31) +
      n44 * (-n13 * n22 * n31 - n11 * n23 * n32 + n11 * n22 * n33 + n13 * n21 * n32 - n12 * n21 * n33 + n12 * n23 * n31)
    );
  }

  equals(m: Matrix4Like): boolean {
    for (let i = 0; i < 16; i += 1) {
      if (this.elements[i] !== m.elements[i]) return false;
    }

    return true;
  }

  /** Copies the rotation basis of `m`, normalized so any scale in the source is dropped. */
  extractRotation(m: Matrix4Like): this {
    const me = m.elements;
    const scaleX = 1 / Math.hypot(me[0], me[1], me[2]);
    const scaleY = 1 / Math.hypot(me[4], me[5], me[6]);
    const scaleZ = 1 / Math.hypot(me[8], me[9], me[10]);

    return this.set(
      me[0] * scaleX,
      me[4] * scaleY,
      me[8] * scaleZ,
      0,
      me[1] * scaleX,
      me[5] * scaleY,
      me[9] * scaleZ,
      0,
      me[2] * scaleX,
      me[6] * scaleY,
      me[10] * scaleZ,
      0,
      0,
      0,
      0,
      1,
    );
  }

  fromArray(array: ArrayLike<number>, offset = 0): this {
    for (let i = 0; i < 16; i += 1) this.elements[i] = array[i + offset];

    return this;
  }

  identity(): this {
    return this.set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  }

  /** A singular matrix inverts to all-zeros — three's behaviour, chosen over throwing. */
  invert(): this {
    const e = this.elements;
    const n11 = e[0],
      n21 = e[1],
      n31 = e[2],
      n41 = e[3];
    const n12 = e[4],
      n22 = e[5],
      n32 = e[6],
      n42 = e[7];
    const n13 = e[8],
      n23 = e[9],
      n33 = e[10],
      n43 = e[11];
    const n14 = e[12],
      n24 = e[13],
      n34 = e[14],
      n44 = e[15];

    const t11 =
      n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
    const t12 =
      n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
    const t13 =
      n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
    const t14 =
      n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;

    const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
    if (det === 0) return this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);

    const inv = 1 / det;

    e[0] = t11 * inv;
    e[1] =
      (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * inv;
    e[2] =
      (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * inv;
    e[3] =
      (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * inv;

    e[4] = t12 * inv;
    e[5] =
      (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * inv;
    e[6] =
      (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * inv;
    e[7] =
      (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * inv;

    e[8] = t13 * inv;
    e[9] =
      (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * inv;
    e[10] =
      (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * inv;
    e[11] =
      (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * inv;

    e[12] = t14 * inv;
    e[13] =
      (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * inv;
    e[14] =
      (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * inv;
    e[15] =
      (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * inv;

    return this;
  }

  /** Sets the rotation part only, leaving translation untouched — as three does. */
  lookAt(eye: Vector3Like, target: Vector3Like, up: Vector3Like): this {
    const e = this.elements;

    tmpZ.set(eye.x - target.x, eye.y - target.y, eye.z - target.z);
    if (tmpZ.lengthSq() === 0) tmpZ.z = 1;
    tmpZ.normalize();

    tmpX.crossVectors(up, tmpZ);
    if (tmpX.lengthSq() === 0) {
      // up and the view direction are parallel — nudge one axis to break the degeneracy.
      if (Math.abs(up.z) === 1) tmpZ.x += 0.0001;
      else tmpZ.z += 0.0001;
      tmpZ.normalize();
      tmpX.crossVectors(up, tmpZ);
    }
    tmpX.normalize();
    tmpY.crossVectors(tmpZ, tmpX);

    e[0] = tmpX.x;
    e[4] = tmpY.x;
    e[8] = tmpZ.x;
    e[1] = tmpX.y;
    e[5] = tmpY.y;
    e[9] = tmpZ.y;
    e[2] = tmpX.z;
    e[6] = tmpY.z;
    e[10] = tmpZ.z;

    return this;
  }

  makeRotationFromQuaternion(q: QuaternionLike): this {
    return this.compose({ x: 0, y: 0, z: 0 }, q, { x: 1, y: 1, z: 1 });
  }

  makeScale(x: number, y: number, z: number): this {
    return this.set(x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1);
  }

  makeTranslation(x: number | Vector3Like, y = 0, z = 0): this {
    return typeof x === 'number'
      ? this.set(1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1)
      : this.set(1, 0, 0, x.x, 0, 1, 0, x.y, 0, 0, 1, x.z, 0, 0, 0, 1);
  }

  multiply(m: Matrix4Like): this {
    return this.multiplyMatrices(this, m);
  }

  multiplyMatrices(a: Matrix4Like, b: Matrix4Like): this {
    const ae = a.elements;
    const be = b.elements;
    const te = this.elements;

    const a11 = ae[0],
      a12 = ae[4],
      a13 = ae[8],
      a14 = ae[12];
    const a21 = ae[1],
      a22 = ae[5],
      a23 = ae[9],
      a24 = ae[13];
    const a31 = ae[2],
      a32 = ae[6],
      a33 = ae[10],
      a34 = ae[14];
    const a41 = ae[3],
      a42 = ae[7],
      a43 = ae[11],
      a44 = ae[15];

    const b11 = be[0],
      b12 = be[4],
      b13 = be[8],
      b14 = be[12];
    const b21 = be[1],
      b22 = be[5],
      b23 = be[9],
      b24 = be[13];
    const b31 = be[2],
      b32 = be[6],
      b33 = be[10],
      b34 = be[14];
    const b41 = be[3],
      b42 = be[7],
      b43 = be[11],
      b44 = be[15];

    te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
    te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
    te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
    te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;

    te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
    te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
    te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
    te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;

    te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
    te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
    te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
    te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;

    te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
    te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
    te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
    te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;

    return this;
  }

  premultiply(m: Matrix4Like): this {
    return this.multiplyMatrices(m, this);
  }

  scale(v: Vector3Like): this {
    const e = this.elements;
    const { x, y, z } = v;
    e[0] *= x;
    e[4] *= y;
    e[8] *= z;
    e[1] *= x;
    e[5] *= y;
    e[9] *= z;
    e[2] *= x;
    e[6] *= y;
    e[10] *= z;
    e[3] *= x;
    e[7] *= y;
    e[11] *= z;

    return this;
  }

  /** Arguments are in READING order (row by row); storage is column-major. */
  set(
    n11: number,
    n12: number,
    n13: number,
    n14: number,
    n21: number,
    n22: number,
    n23: number,
    n24: number,
    n31: number,
    n32: number,
    n33: number,
    n34: number,
    n41: number,
    n42: number,
    n43: number,
    n44: number,
  ): this {
    const e = this.elements;
    e[0] = n11;
    e[4] = n12;
    e[8] = n13;
    e[12] = n14;
    e[1] = n21;
    e[5] = n22;
    e[9] = n23;
    e[13] = n24;
    e[2] = n31;
    e[6] = n32;
    e[10] = n33;
    e[14] = n34;
    e[3] = n41;
    e[7] = n42;
    e[11] = n43;
    e[15] = n44;

    return this;
  }

  setPosition(x: number | Vector3Like, y = 0, z = 0): this {
    const e = this.elements;
    if (typeof x === 'number') {
      e[12] = x;
      e[13] = y;
      e[14] = z;
    } else {
      e[12] = x.x;
      e[13] = x.y;
      e[14] = x.z;
    }

    return this;
  }

  toArray(array: number[] = [], offset = 0): number[] {
    for (let i = 0; i < 16; i += 1) array[i + offset] = this.elements[i];

    return array;
  }

  transpose(): this {
    const e = this.elements;
    const swap = (i: number, j: number): void => {
      const t = e[i];
      e[i] = e[j];
      e[j] = t;
    };
    swap(1, 4);
    swap(2, 8);
    swap(6, 9);
    swap(3, 12);
    swap(7, 13);
    swap(11, 14);

    return this;
  }
}
