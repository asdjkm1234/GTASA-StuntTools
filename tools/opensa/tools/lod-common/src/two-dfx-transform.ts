import type { Raw2dfxEntry } from '@opensa/rw-codec/dff';

import { composeRoadsignRotation } from '@opensa/renderware/roadsign/glyph-quads';
import {
  decodeEscalator2dfx,
  decodeRoadsign2dfx,
  encodeEscalator2dfx,
  encodeRoadsign2dfx,
  ESCALATOR_2DFX,
  ROADSIGN_2DFX,
} from '@opensa/rw-codec/two-d-effect';

import type { VertexTransform } from './build-mesh';
import type { ClumpEffect } from './clump-effects';
import type { Vec3 } from './mesh';

/** A payload's own mutable coordinate triple (the codecs hold these, not the readonly {@link Vec3}). */
type Triple = [number, number, number];

/**
 * Carry ONE 2dfx entry into a LOD's space (plan 006). Every LOD path already transformed the
 * entry POSITION and left the payload alone — enough for a corona, wrong for anything whose payload is also
 * spatial. This is that rewrite, in one place:
 *
 * - **opaque types** (light, particle, and every type nobody decodes): the position moves, the payload stays
 *   byte-verbatim — exactly what happened before;
 * - **roadsign (7)**: the plate's rotation is composed with the transform's rotation, so a sign carried onto a
 *   rotated instance faces the way it faced on the HD model instead of into a wall;
 * - **escalator (10)**: its bottom / top / end are POINTS in the same space as the entry position, so they
 *   move and rotate with it. Its `direction` is a u32 step-direction FLAG, not a vector — a rotation cannot
 *   change it, and rotating it would corrupt it. (The plan that asked for this called it a direction vector;
 *   the payload says otherwise.)
 *
 * The transform is the caller's: `clumpFrameTransforms` for the decimate path, `instanceTransform` for the
 * cell path. That is what makes "an effect is in the same place on every representation" a property rather
 * than a coincidence.
 */
export function transform2dfxEntry(entry: ClumpEffect | Raw2dfxEntry, transform: VertexTransform): ClumpEffect {
  const position = point(transform, entry.position);
  if (entry.type === ROADSIGN_2DFX) {
    if (isRotationIdentity(rotationColumns(transform))) {
      return { bytes: entry.bytes, position, type: entry.type }; // nothing turned it — do not rewrite the plate
    }
    const sign = decodeRoadsign2dfx(entry.bytes);
    sign.rotation = rotateRoadsign(sign.rotation, transform);

    return { bytes: encodeRoadsign2dfx(sign), position, type: entry.type };
  }
  if (entry.type === ESCALATOR_2DFX) {
    rotationColumns(transform); // guard: a scaled basis would stretch the step path
    const escalator = decodeEscalator2dfx(entry.bytes);
    escalator.bottom = point(transform, escalator.bottom);
    escalator.top = point(transform, escalator.top);
    escalator.end = point(transform, escalator.end);

    return { bytes: encodeEscalator2dfx(escalator), position, type: entry.type };
  }

  return { bytes: entry.bytes, position, type: entry.type };
}

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
/** Orthonormality slack: a float32 basis read back out of a DFF frame does not land on 1.0 exactly. */
const ORTHONORMAL_EPS = 1e-3;
/** Below this |cos(rx)| the Y and Z angles are the same rotation (gimbal lock) — the stock ±90° plates. */
const LOCK_EPS = 1e-6;

/** True when the transform only translates — then a payload's orientation must be left exactly as authored. */
function isRotationIdentity(columns: readonly Vec3[]): boolean {
  return columns.every((column, axis) =>
    column.every((value, index) => Math.abs(value - (index === axis ? 1 : 0)) < ORTHONORMAL_EPS),
  );
}

/** Map a point through the transform, as the mutable triple the payload codecs hold. */
function point(transform: VertexTransform, [x, y, z]: Vec3): Triple {
  const mapped = transform.point(x, y, z);

  return [mapped[0], mapped[1], mapped[2]];
}

/**
 * Compose a roadsign's Euler triple (degrees) with the transform's rotation and decompose it back into the
 * SAME convention — `composeRoadsignRotation` (Z→X→Y) is that convention's only home, so the matrix is built
 * by running it over the basis vectors rather than by restating its terms here.
 */
function rotateRoadsign(rotation: Vec3, transform: VertexTransform): Triple {
  const sign = composeRoadsignRotation(rotation[0] * DEG_TO_RAD, rotation[1] * DEG_TO_RAD, rotation[2] * DEG_TO_RAD);
  // Columns of R(transform) · R(sign): the sign's own basis vectors, each carried by the transform.
  const [c0, c1, c2] = [sign(1, 0, 0), sign(0, 1, 0), sign(0, 0, 1)].map((axis) =>
    transform.normal(axis[0], axis[1], axis[2]),
  );
  // Decompose R = Ry·Rx·Rz. M[1][2] = -sin(rx); M[1][0]/M[1][1] give rz; M[0][2]/M[2][2] give ry.
  const rx = Math.asin(Math.max(-1, Math.min(1, -c2[1])));
  const cx = Math.cos(rx);
  if (Math.abs(cx) < LOCK_EPS) {
    // Gimbal lock (the stock ±90° plates land here): Y and Z are one rotation — put it all in Y.
    return [rx * RAD_TO_DEG, Math.atan2(-c0[2], c0[0]) * RAD_TO_DEG, 0];
  }

  return [rx * RAD_TO_DEG, Math.atan2(c2[0], c2[2]) * RAD_TO_DEG, Math.atan2(c0[1], c1[1]) * RAD_TO_DEG];
}

/**
 * The transform's rotation as three column vectors, checked to be a pure rotation. A scaling or mirroring
 * transform would stretch a plate rather than turn it, so it throws instead of producing one silently — LOD
 * instance transforms in both paths are rotate + translate.
 */
function rotationColumns(transform: VertexTransform): [Vec3, Vec3, Vec3] {
  const columns: [Vec3, Vec3, Vec3] = [transform.normal(1, 0, 0), transform.normal(0, 1, 0), transform.normal(0, 0, 1)];
  for (const column of columns) {
    const length = Math.hypot(...column);
    if (Math.abs(length - 1) > ORTHONORMAL_EPS) {
      throw new RangeError(
        `2dfx transform: rotation basis is scaled (axis length ${length.toFixed(4)}), not supported`,
      );
    }
  }
  const [a, b, c] = columns;
  const determinant =
    a[0] * (b[1] * c[2] - b[2] * c[1]) - b[0] * (a[1] * c[2] - a[2] * c[1]) + c[0] * (a[1] * b[2] - a[2] * b[1]);
  if (Math.abs(determinant - 1) > ORTHONORMAL_EPS) {
    throw new RangeError(`2dfx transform: rotation basis is not a pure rotation (det ${determinant.toFixed(4)})`);
  }

  return columns;
}
