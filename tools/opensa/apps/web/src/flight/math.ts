/** Minimal quaternion/vector maths for the flight replay. Quaternions are xyzw. */

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];

/**
 * The ONE GTA→engine basis change: engine = (gta.x, gta.z, −gta.y). Applied here and nowhere else, so no
 * caller can accidentally swap axes twice or add an extra 90°.
 */
export function gtaToEngine(x: number, y: number, z: number): Vec3 {
  return [x, z, -y];
}

/** A direction: same basis change, no translation. */
export function gtaDirToEngine(v: readonly [number, number, number]): Vec3 {
  return [v[0], v[2], -v[1]];
}

/** Quaternion from an orthonormal basis given as three COLUMNS (x, y, z axes). */
export function quatFromColumns(x: readonly [number, number, number], y: readonly [number, number, number], z: readonly [number, number, number]): Quat {
  const m00 = x[0], m01 = y[0], m02 = z[0];
  const m10 = x[1], m11 = y[1], m12 = z[1];
  const m20 = x[2], m21 = y[2], m22 = z[2];
  const trace = m00 + m11 + m22;
  let qx: number, qy: number, qz: number, qw: number;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    qw = 0.25 * s;
    qx = (m21 - m12) / s;
    qy = (m02 - m20) / s;
    qz = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    qw = (m21 - m12) / s;
    qx = 0.25 * s;
    qy = (m01 + m10) / s;
    qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    qw = (m02 - m20) / s;
    qx = (m01 + m10) / s;
    qy = 0.25 * s;
    qz = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    qw = (m10 - m01) / s;
    qx = (m02 + m20) / s;
    qy = (m12 + m21) / s;
    qz = 0.25 * s;
  }

  return normalizeQuat([qx, qy, qz, qw]);
}

/** Orientation quaternion from the aircraft's GTA world basis (right, up, forward). */
export function orientationFromGta(right: readonly [number, number, number], up: readonly [number, number, number], forward: readonly [number, number, number]): Quat {
  // Model axes are X=right, Y=forward, Z=up; convert all three in one place.
  return quatFromColumns(gtaDirToEngine(right), gtaDirToEngine(forward), gtaDirToEngine(up));
}

export function normalizeQuat(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  if (n < 1e-9) {
    return [0, 0, 0, 1];
  }

  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

export function conjugate(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** Hamilton product a ⊗ b (apply b first, then a). */
export function quatMultiply(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/** Shortest-path spherical interpolation. */
export function slerp(a: Quat, b: Quat, t: number): Quat {
  let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  if (cos < 0) {
    cos = -cos;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  if (cos > 0.9995) {
    return normalizeQuat([a[0] + (bx - a[0]) * t, a[1] + (by - a[1]) * t, a[2] + (bz - a[2]) * t, a[3] + (bw - a[3]) * t]);
  }
  const theta = Math.acos(Math.min(1, Math.max(-1, cos)));
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = Math.sin(t * theta) / sinTheta;

  return normalizeQuat([a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb]);
}

/** Rotate a vector by a quaternion (xyzw). */
export function rotateVec(q: Quat, v: readonly [number, number, number]): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);

  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}
