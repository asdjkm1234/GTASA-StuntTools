/**
 * SA's matrix conventions, recovered from gta-reversed `Core/Matrix.cpp` (plan 097/05 — the
 * recover-the-real-formula rule) and mapped ONCE onto quaternions:
 *
 * - `CMatrix::SetRotateXOnly(a)`: right=(1,0,0), forward=(0,cos,sin), up=(0,-sin,cos) — a plain
 *   rotation about +X by `a` radians (columns are the local axes in parent space). Y/Z likewise.
 * - `CMatrix::SetRotate(x,y,z)` (0x59B120): the matrix equals **Rz(z) · Rx(x) · Ry(y)** — verified
 *   against the reversed source expression term by term (right.x = cosZ·cosY − sinZ·sinX·sinY, …).
 *   NOT Rz·Ry·Rx: the X and Y factors are swapped relative to the usual guess.
 *
 * Angles are RADIANS here — the script space already carries radians for these natives (SA's
 * script-facing degree conversions happen in the opcode handlers, not in CMatrix).
 */

export type Quat = readonly [number, number, number, number];

const axisQuat = (axis: 0 | 1 | 2, angle: number): Quat => {
  const half = angle / 2;
  const s = Math.sin(half);
  const parts: [number, number, number] = [0, 0, 0];
  parts[axis] = s;

  return [parts[0], parts[1], parts[2], Math.cos(half)];
};

export const quatRotateX = (angle: number): Quat => axisQuat(0, angle);
export const quatRotateY = (angle: number): Quat => axisQuat(1, angle);
export const quatRotateZ = (angle: number): Quat => axisQuat(2, angle);

/** The local axes (columns) of a quaternion's rotation — the fixture check against the reversed
 *  matrix expressions, and the frame `m_forward` read rhino performs. */
export function quatAxes(q: Quat): {
  forward: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
} {
  const [x, y, z, w] = q;

  return {
    forward: [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
    right: [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
    up: [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)],
  };
}

/** `CMatrix::SetRotate(x, y, z)` as a quaternion: Rz · Rx · Ry (the recovered order). */
export function quatFromSaEuler(x: number, y: number, z: number): Quat {
  return quatMultiply(quatRotateZ(z), quatMultiply(quatRotateX(x), quatRotateY(y)));
}

export function quatMultiply(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;

  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}
