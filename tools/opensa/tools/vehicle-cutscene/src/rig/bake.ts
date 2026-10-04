import { readRw, RW_STRUCT, writeRw } from '@opensa/rw-codec/chunk';
/**
 * Vertex baking — the gate-4 lesson (2026-08-12, second field round). Cutscene animations bind by frame
 * NAME through `CAnimBlendAssociation` (gta-reversed `CCutsceneMgr`), and their translation channels
 * drive every animated bone to the VANILLA model's local — the converted model's frame positions only
 * survive on frames the anim doesn't touch. So the emitted rig carries the VANILLA locals (the anims'
 * bind pose), and the donor's different hinge placement is baked INTO THE PART'S VERTICES instead:
 * `delta = inv(W_vanilla) ∘ shift_z ∘ W_donor`. For a stock donor on a body-reusing template the delta
 * is identity and the geometry stays byte-identical (the fast path the caller checks).
 *
 * The bake replaces ONLY the Geometry Struct child (positions, normals under rotation, morph bounds) via
 * the byte-exact rw-codec `decode ⇄ encode`; materials, BinMesh and every other sibling chunk are
 * re-emitted verbatim.
 */
import { decodeGeometryStruct, encodeGeometryStruct } from '@opensa/rw-codec/geometry-struct';

import type { OpaqueChunk } from './clump-io';

import { isIdentityRotation, rotatePoint, type Transform, transformPoint, type Vec3 } from './matrix';

/** Transform a geometry body's vertices (+ normals, morph bounds) by `delta`, byte-faithfully. */
export function bakeGeometryBody(geometry: OpaqueChunk, delta: Transform): OpaqueChunk {
  const file = readRw(geometry.body);
  const struct = file.chunks.find((chunk) => chunk.type === RW_STRUCT);
  if (!struct?.data) {
    throw new Error('geometry has no struct to bake');
  }
  const decoded = decodeGeometryStruct(struct.data);
  const rotate = !isIdentityRotation(delta.rotation);
  for (const morph of decoded.morphs) {
    if (morph.positions) {
      applyToTriples(morph.positions, (point) => transformPoint(delta, point));
    }
    if (rotate && morph.normals) {
      applyToTriples(morph.normals, (normal) => rotatePoint(delta.rotation, normal));
    }
    const [x, y, z] = transformPoint(delta, [morph.bounds[0], morph.bounds[1], morph.bounds[2]]);
    morph.bounds = [x, y, z, morph.bounds[3]];
  }
  struct.data = encodeGeometryStruct(decoded);

  return { body: writeRw(file), version: geometry.version };
}

/** Whether the delta is close enough to identity that baking would be a byte-identical no-op. */
export function isIdentityDelta(delta: Transform, epsilon = 1e-3): boolean {
  return isIdentityRotation(delta.rotation, epsilon) && delta.position.every((value) => Math.abs(value) <= epsilon);
}

/**
 * A mirrored copy across x: positions and normals flip their x, triangles rewind (b ↔ c) so the faces
 * keep pointing outward. The LEFT wheel of identity-rotation templates uses this — their anims replay
 * identity rotations, so nothing else can mirror the shared wheel geometry (gate-7 field round).
 */
export function mirrorGeometryBodyX(geometry: OpaqueChunk): OpaqueChunk {
  const file = readRw(geometry.body.slice());
  const struct = file.chunks.find((chunk) => chunk.type === RW_STRUCT);
  if (!struct?.data) {
    throw new Error('geometry has no struct to mirror');
  }
  const decoded = decodeGeometryStruct(struct.data);
  for (const morph of decoded.morphs) {
    for (const values of [morph.positions, morph.normals]) {
      if (values) {
        for (let at = 0; at < values.length; at += 3) {
          values[at] = -values[at];
        }
      }
    }
    morph.bounds = [-morph.bounds[0], morph.bounds[1], morph.bounds[2], morph.bounds[3]];
  }
  for (const triangle of decoded.triangles) {
    const swap = triangle.b;
    triangle.b = triangle.c;
    triangle.c = swap;
  }
  struct.data = encodeGeometryStruct(decoded);

  return { body: writeRw(file), version: geometry.version };
}

function applyToTriples(values: Float32Array, transform: (point: Vec3) => Vec3): void {
  for (let at = 0; at + 2 < values.length; at += 3) {
    const [x, y, z] = transform([values[at], values[at + 1], values[at + 2]]);
    values[at] = x;
    values[at + 1] = y;
    values[at + 2] = z;
  }
}
