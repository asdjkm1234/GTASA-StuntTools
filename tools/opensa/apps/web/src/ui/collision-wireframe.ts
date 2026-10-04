/**
 * Collision wireframe for the map viewer's "Show collision" (074/22 — the three overlay's replacement).
 *
 * The three build (`renderware/three/build-col-wireframe`) produced a `LineSegments`; that file went with
 * three. The engine already carries a line-list debug pipeline and a `createDebugLines` API that nothing
 * outside it called, so this only has to produce the ONE thing that API wants: a flat Float32Array of
 * segment ENDPOINT PAIRS, in engine space.
 *
 * Source is `ModelColliders` — the engine-agnostic collider seam the physics layer already consumes — rather
 * than renderware's `RegionColliders`, so the overlay always draws exactly the shapes physics was given.
 */
import type { ColliderShape, ModelColliders } from '@opensa/game/interfaces/collider.interface';
import type { Matrix4 } from '@opensa/math';

/** Rings per sphere axis. Twelve reads as round at map-viewer distance and keeps the vertex count sane. */
const SPHERE_SEGMENTS = 12;

/**
 * Every collider in `cells` as line-segment endpoints, transformed by each placement and converted to
 * ENGINE space (GTA is Z-up: `(x, y, z)` → `(x, z, −y)`, the same swap the render path uses).
 *
 * One array for the whole set: the overlay is a single draw, so a cell boundary costs nothing extra.
 */
export function buildCollisionLines(cells: readonly ModelColliders[]): Float32Array {
  const out: number[] = [];
  for (const { shape, transforms } of cells) {
    const local = shapeLines(shape);
    for (const transform of transforms) {
      appendTransformed(out, local, transform);
    }
  }

  return new Float32Array(out);
}

/** Push `local` (GTA-space endpoint pairs) through a placement matrix and into engine space. */
function appendTransformed(out: number[], local: readonly number[], transform: Matrix4): void {
  const e = transform.elements;
  for (let at = 0; at < local.length; at += 3) {
    const x = local[at];
    const y = local[at + 1];
    const z = local[at + 2];
    const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
    const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
    const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
    out.push(wx, wz, -wy); // GTA Z-up → engine Y-up
  }
}

/** The 12 edges of an axis-aligned box, as endpoint pairs. */
function boxLines(out: number[], min: readonly number[], max: readonly number[]): void {
  const corners: [number, number, number][] = [
    [min[0], min[1], min[2]],
    [max[0], min[1], min[2]],
    [max[0], max[1], min[2]],
    [min[0], max[1], min[2]],
    [min[0], min[1], max[2]],
    [max[0], min[1], max[2]],
    [max[0], max[1], max[2]],
    [min[0], max[1], max[2]],
  ];
  const edges: [number, number][] = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 0],
    [4, 5],
    [5, 6],
    [6, 7],
    [7, 4],
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 7],
  ];
  for (const [a, b] of edges) {
    out.push(...corners[a], ...corners[b]);
  }
}

/** A point on the great circle around `axis` (0 = YZ, 1 = XZ, 2 = XY). */
function ringPoint(centre: readonly number[], radius: number, axis: number, angle: number): [number, number, number] {
  const u = Math.cos(angle) * radius;
  const w = Math.sin(angle) * radius;
  if (axis === 0) {
    return [centre[0], centre[1] + u, centre[2] + w];
  }
  if (axis === 1) {
    return [centre[0] + u, centre[1], centre[2] + w];
  }

  return [centre[0] + u, centre[1] + w, centre[2]];
}

/** One model's collision flattened to endpoint pairs in MODEL space: triangle edges, box edges, sphere rings. */
function shapeLines(shape: ColliderShape): number[] {
  const out: number[] = [];
  const { indices, vertices } = shape;
  for (let at = 0; at + 2 < indices.length; at += 3) {
    const [a, b, c] = [indices[at], indices[at + 1], indices[at + 2]];
    // Each triangle contributes its three edges. Shared edges are drawn twice — the three build did the
    // same, and de-duplicating costs more than the redundant lines do at one draw call.
    for (const [from, to] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      out.push(vertices[from * 3], vertices[from * 3 + 1], vertices[from * 3 + 2]);
      out.push(vertices[to * 3], vertices[to * 3 + 1], vertices[to * 3 + 2]);
    }
  }
  for (const box of shape.boxes) {
    boxLines(out, box.min, box.max);
  }
  for (const sphere of shape.spheres) {
    sphereLines(out, sphere.center, sphere.radius);
  }

  return out;
}

/** Three great circles per sphere — enough to read as a ball without a mesh. */
function sphereLines(out: number[], centre: readonly number[], radius: number): void {
  for (let axis = 0; axis < 3; axis += 1) {
    for (let segment = 0; segment < SPHERE_SEGMENTS; segment += 1) {
      const a0 = (segment / SPHERE_SEGMENTS) * Math.PI * 2;
      const a1 = ((segment + 1) / SPHERE_SEGMENTS) * Math.PI * 2;
      out.push(...ringPoint(centre, radius, axis, a0), ...ringPoint(centre, radius, axis, a1));
    }
  }
}
