import type { ColModel } from '../parsers/binary/col-types';
import type { Vec3 } from '../parsers/binary/types';

/**
 * A collision model flattened to LINE-SEGMENT endpoints (pairs of xyz), in native GTA model space (Z-up).
 * Renderer-agnostic on purpose: extracted from the three-only `build-col-wireframe.ts` in plan 074/13 so
 * the geometry survives that file's deletion. Callers upload it wherever they draw lines and own the
 * basis change to their own space.
 */

const SPHERE_SEGMENTS = 12;

export function colLines(col: ColModel): Float32Array {
  const out: number[] = [];
  const vertices = col.vertices;

  for (const face of col.faces) {
    pushEdge(out, vertices, face.a, face.b);
    pushEdge(out, vertices, face.b, face.c);
    pushEdge(out, vertices, face.c, face.a);
  }
  for (const box of col.boxes) {
    pushBox(out, box.min, box.max);
  }
  for (const sphere of col.spheres) {
    pushSphere(out, sphere.center, sphere.radius);
  }

  return new Float32Array(out);
}

/**
 * Mesh EDGES as a line list, deduplicated so a shared edge is not drawn twice — the "wireframe" debug
 * view for rendered geometry (WebGPU has no polygon-mode line, so wireframe IS a line list).
 */
export function meshEdgeLines(positions: Float32Array, indices: ArrayLike<number>): Float32Array {
  const seen = new Set<number>();
  const out: number[] = [];

  const push = (a: number, b: number): void => {
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    // Vertex counts stay well under 2^21 per model, so this packs into a float-safe integer key.
    const key = low * 2_097_152 + high;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(positions[low * 3], positions[low * 3 + 1], positions[low * 3 + 2]);
    out.push(positions[high * 3], positions[high * 3 + 1], positions[high * 3 + 2]);
  };

  for (let i = 0; i + 2 < indices.length; i += 3) {
    push(indices[i], indices[i + 1]);
    push(indices[i + 1], indices[i + 2]);
    push(indices[i + 2], indices[i]);
  }

  return new Float32Array(out);
}

function pushBox(out: number[], min: Vec3, max: Vec3): void {
  const corners: Vec3[] = [
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

function pushEdge(out: number[], vertices: Float32Array, i: number, j: number): void {
  out.push(vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]);
  out.push(vertices[j * 3], vertices[j * 3 + 1], vertices[j * 3 + 2]);
}

function pushSphere(out: number[], center: Vec3, radius: number): void {
  for (let axis = 0; axis < 3; axis += 1) {
    for (let s = 0; s < SPHERE_SEGMENTS; s += 1) {
      const a0 = (s / SPHERE_SEGMENTS) * Math.PI * 2;
      const a1 = ((s + 1) / SPHERE_SEGMENTS) * Math.PI * 2;
      out.push(...ringPoint(center, radius, axis, a0), ...ringPoint(center, radius, axis, a1));
    }
  }
}

/** A point on the great circle around `axis` (0 = YZ, 1 = XZ, 2 = XY). */
function ringPoint(center: Vec3, radius: number, axis: number, angle: number): Vec3 {
  const u = Math.cos(angle) * radius;
  const w = Math.sin(angle) * radius;
  if (axis === 0) {
    return [center[0], center[1] + u, center[2] + w];
  }
  if (axis === 1) {
    return [center[0] + u, center[1], center[2] + w];
  }

  return [center[0] + u, center[1] + w, center[2]];
}
