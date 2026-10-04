/**
 * Minimal column-major mat4 + frustum math (plan 074/01) — the handful the M0 renderer needs, zero deps.
 * Conventions match WebGPU clip space: right-handed view, depth 0..1 (`perspectiveZO`).
 */

export type Mat4 = Float32Array; // 16, column-major
export type Vec3 = readonly [number, number, number];

/** Six frustum planes [nx, ny, nz, d] extracted from a viewProjection (Gribb–Hartmann; 0..1 depth). */
export function frustumFromViewProj(out: Float32Array, m: Mat4): Float32Array {
  const rows = [
    [m[0], m[4], m[8], m[12]],
    [m[1], m[5], m[9], m[13]],
    [m[2], m[6], m[10], m[14]],
    [m[3], m[7], m[11], m[15]],
  ];
  const planes = [
    [rows[3][0] + rows[0][0], rows[3][1] + rows[0][1], rows[3][2] + rows[0][2], rows[3][3] + rows[0][3]], // left
    [rows[3][0] - rows[0][0], rows[3][1] - rows[0][1], rows[3][2] - rows[0][2], rows[3][3] - rows[0][3]], // right
    [rows[3][0] + rows[1][0], rows[3][1] + rows[1][1], rows[3][2] + rows[1][2], rows[3][3] + rows[1][3]], // bottom
    [rows[3][0] - rows[1][0], rows[3][1] - rows[1][1], rows[3][2] - rows[1][2], rows[3][3] - rows[1][3]], // top
    [rows[2][0], rows[2][1], rows[2][2], rows[2][3]], // near (z ≥ 0 in ZO clip)
    [rows[3][0] - rows[2][0], rows[3][1] - rows[2][1], rows[3][2] - rows[2][2], rows[3][3] - rows[2][3]], // far
  ];
  for (let plane = 0; plane < 6; plane += 1) {
    const [nx, ny, nz, d] = planes[plane];
    const invLen = 1 / (Math.hypot(nx, ny, nz) || 1);
    out[plane * 4] = nx * invLen;
    out[plane * 4 + 1] = ny * invLen;
    out[plane * 4 + 2] = nz * invLen;
    out[plane * 4 + 3] = d * invLen;
  }

  return out;
}

/** Sphere-vs-frustum: true when (partially) inside. `planes` = 24 floats from {@link frustumFromViewProj}. */
export function frustumIntersectsSphere(
  planes: Float32Array,
  x: number,
  y: number,
  z: number,
  radius: number,
): boolean {
  for (let plane = 0; plane < 6; plane += 1) {
    const distance =
      planes[plane * 4] * x + planes[plane * 4 + 1] * y + planes[plane * 4 + 2] * z + planes[plane * 4 + 3];
    if (distance < -radius) {
      return false;
    }
  }

  return true;
}

export function mat4Identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = 1;
  m[5] = 1;
  m[10] = 1;
  m[15] = 1;

  return m;
}

/** General 4×4 inverse (column-major). Returns `out`; identity on a singular input (never expected here). */
export function mat4Invert(out: Mat4, m: Mat4): Mat4 {
  const a00 = m[0],
    a01 = m[1],
    a02 = m[2],
    a03 = m[3];
  const a10 = m[4],
    a11 = m[5],
    a12 = m[6],
    a13 = m[7];
  const a20 = m[8],
    a21 = m[9],
    a22 = m[10],
    a23 = m[11];
  const a30 = m[12],
    a31 = m[13],
    a32 = m[14],
    a33 = m[15];
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (det === 0) {
    out.set(mat4Identity());

    return out;
  }
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;

  return out;
}

/** Right-handed lookAt view matrix. */
export function mat4LookAt(out: Mat4, eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const zx = eye[0] - target[0];
  const zy = eye[1] - target[1];
  const zz = eye[2] - target[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  const z = [zx / len, zy / len, zz / len];
  const xx = up[1] * z[2] - up[2] * z[1];
  const xy = up[2] * z[0] - up[0] * z[2];
  const xz = up[0] * z[1] - up[1] * z[0];
  len = Math.hypot(xx, xy, xz) || 1;
  const x = [xx / len, xy / len, xz / len];
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  out[0] = x[0];
  out[1] = y[0];
  out[2] = z[0];
  out[3] = 0;
  out[4] = x[1];
  out[5] = y[1];
  out[6] = z[1];
  out[7] = 0;
  out[8] = x[2];
  out[9] = y[2];
  out[10] = z[2];
  out[11] = 0;
  out[12] = -(x[0] * eye[0] + x[1] * eye[1] + x[2] * eye[2]);
  out[13] = -(y[0] * eye[0] + y[1] * eye[1] + y[2] * eye[2]);
  out[14] = -(z[0] * eye[0] + z[1] * eye[1] + z[2] * eye[2]);
  out[15] = 1;

  return out;
}

/**
 * `out = a × b` (column-major). **`out` must not alias `a`** — the loop writes `out` column by column
 * while still reading every column of `a`, so `mat4Multiply(m, m, b)` silently corrupts. Aliasing `b` is
 * fine (its column is read into locals first). Guarding this would cost a 16-element copy on a per-frame
 * hot path for a case no caller has; the constraint is documented instead (plan 077).
 */
export function mat4Multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  for (let column = 0; column < 4; column += 1) {
    const b0 = b[column * 4];
    const b1 = b[column * 4 + 1];
    const b2 = b[column * 4 + 2];
    const b3 = b[column * 4 + 3];
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] = a[row] * b0 + a[4 + row] * b1 + a[8 + row] * b2 + a[12 + row] * b3;
    }
  }

  return out;
}

/**
 * Orthographic with WebGPU 0..1 depth — a symmetric box `halfHeight` tall and `halfHeight * aspect` wide.
 *
 * The plan view (201/7-01), and the same matrix 6/02's tile bake reads: parallel rays, so a building stops
 * leaning and a distance on screen is a distance in the world wherever it is measured. Same conventions as
 * {@link mat4PerspectiveZO} — right-handed view down −Z, near→0 and far→1 — so passing them SWAPPED gives
 * the reversed-Z the renderer runs, exactly as it does for perspective.
 *
 * `near` may be negative: an orthographic box has no apex to sit behind, so pulling the front plane back
 * past the eye is how geometry ABOVE the eye plane (a tower, at block zoom) keeps drawing instead of being
 * sliced off — a perspective frustum cannot express that and does not need to.
 */
export function mat4OrthographicZO(out: Mat4, halfHeight: number, aspect: number, near: number, far: number): Mat4 {
  out.fill(0);
  out[0] = 1 / (halfHeight * aspect);
  out[5] = 1 / halfHeight;
  out[10] = 1 / (near - far);
  out[14] = near / (near - far);
  out[15] = 1;

  return out;
}

/** Perspective with WebGPU 0..1 depth. `fovY` radians. */
export function mat4PerspectiveZO(out: Mat4, fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = far / (near - far);
  out[11] = -1;
  out[14] = (far * near) / (near - far);

  return out;
}

/** Sphere entirely at/past `distance` from `eye` (3D) — every point of it is ≥ that far. The fog cut test
 *  (plan 074/21): the world shader's hard cut reaches fogFactor 1 exactly at the cut distance, so a sphere
 *  that passes this against the effective fog cut renders as pure sky and can be culled. */
export function sphereFullyBeyond(
  eye: Vec3,
  x: number,
  y: number,
  z: number,
  radius: number,
  distance: number,
): boolean {
  const dx = x - eye[0];
  const dy = y - eye[1];
  const dz = z - eye[2];
  const reach = distance + radius;

  return dx * dx + dy * dy + dz * dz >= reach * reach;
}
