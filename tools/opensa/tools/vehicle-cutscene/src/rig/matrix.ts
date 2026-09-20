/**
 * RW frame-matrix helpers. A frame's rotation is 9 floats `[right, up, at]` — the images of the child's
 * x/y/z axes in parent space — and `v_parent = vx·right + vy·up + vz·at + position`. All rotations here
 * are orthonormal (RW frames carry no scale on the models we touch), so the inverse is the transpose.
 */

export interface Transform {
  position: Vec3;
  /** 9 floats, `[right, up, at]` row layout as stored in the DFF. */
  rotation: number[];
}

export type Vec3 = [number, number, number];

export const IDENTITY_ROTATION: readonly number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** 180° about z — the left-wheel mesh rotation every vanilla cutscene car uses (measured: csbobcat92
 *  `wheel02`/`wheel03`, csremington92 `wheel02`/`wheel03`, all `[-1,0,0, 0,-1,0, 0,0,1]`). */
export const Z180_ROTATION: readonly number[] = [-1, 0, 0, 0, -1, 0, 0, 0, 1];

/** `outer ∘ inner` — apply `inner` (child → its parent), then `outer` (that parent → grandparent). */
export function compose(outer: Transform, inner: Transform): Transform {
  return {
    position: transformPoint(outer, inner.position),
    rotation: [
      ...rotatePoint(outer.rotation, [inner.rotation[0], inner.rotation[1], inner.rotation[2]]),
      ...rotatePoint(outer.rotation, [inner.rotation[3], inner.rotation[4], inner.rotation[5]]),
      ...rotatePoint(outer.rotation, [inner.rotation[6], inner.rotation[7], inner.rotation[8]]),
    ],
  };
}

/** Inverse of an orthonormal transform. */
export function invert(transform: Transform): Transform {
  const rotation = transpose(transform.rotation);
  const [x, y, z] = rotatePoint(rotation, transform.position);

  return { position: [-x, -y, -z], rotation };
}

export function isIdentityRotation(rotation: readonly number[], epsilon = 1e-4): boolean {
  return rotation.every((value, at) => Math.abs(value - IDENTITY_ROTATION[at]) <= epsilon);
}

/** Rotate a point/vector (no translation). */
export function rotatePoint(rotation: readonly number[], point: Vec3): Vec3 {
  const [x, y, z] = point;

  return [
    x * rotation[0] + y * rotation[3] + z * rotation[6],
    x * rotation[1] + y * rotation[4] + z * rotation[7],
    x * rotation[2] + y * rotation[5] + z * rotation[8],
  ];
}

/** Apply the full transform to a point. */
export function transformPoint(transform: Transform, point: Vec3): Vec3 {
  const [x, y, z] = rotatePoint(transform.rotation, point);

  return [x + transform.position[0], y + transform.position[1], z + transform.position[2]];
}

function transpose(rotation: readonly number[]): number[] {
  return [
    rotation[0],
    rotation[3],
    rotation[6],
    rotation[1],
    rotation[4],
    rotation[7],
    rotation[2],
    rotation[5],
    rotation[8],
  ];
}
