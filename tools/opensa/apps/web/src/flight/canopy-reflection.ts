/** Small, model-local ray scene for pilot-side glass. No captured image or game file is written. */
import type { VehicleModelData } from '@opensa/renderware';

import { MaterialClass } from '@opensa/renderware/vehicle/types';

import type { CanopyPlane } from './aircraft-canopy';
import type { Vec3 } from './math';

import { conjugate, rotateVec } from './math';

export interface ReflectionTriangle {
  color: Vec3;
  layer: number;
  night: Vec3;
  normal: Vec3;
  occlusion: number;
  points: [Vec3, Vec3, Vec3];
  uv: [[number, number], [number, number], [number, number]];
}

const MAX_TRIANGLES = 512;
const dot = (a: Vec3, b: Vec3): number => a.reduce((sum, value, axis) => sum + value * b[axis], 0);

/** Only static, opaque, inward-facing chassis triangles within the canopy/seat region are eligible.
 * Moving doors/gear, distant body, glazing, decals, damage and LOD cannot become floating reflections. */
export function buildCanopyReflection(data: VehicleModelData, planes: readonly CanopyPlane[]): Float32Array {
  const seat = data.dummies.find((dummy) => dummy.name === 'ped_frontseat');
  const referencePart = data.parts.findIndex((part) => part.name === 'chassis');
  if (!seat || !planes.length || referencePart < 0) return packReflectionScene([], 0, 1);
  const ref = data.parts[referencePart];
  const inverse = conjugate(ref.localRotation);
  const point = (vertex: number, part: number): Vec3 => {
    const local = Array.from(data.positions.subarray(vertex * 3, vertex * 3 + 3)) as Vec3;
    const p = rotateVec(data.parts[part].localRotation, local);

    return p.map((v, axis) => v + data.parts[part].localTranslation[axis]) as Vec3;
  };
  const glass = glassPoints(data, point);
  if (!glass.length) return packReflectionScene([], 0, 1);
  const lower = [0, 1, 2].map((axis) => Math.min(...glass.map((p) => p[axis])) - 0.12);
  const upper = [0, 1, 2].map((axis) => Math.max(...glass.map((p) => p[axis])) + 0.12);
  lower[2] = seat.position[2] - 0.55;
  const eye: Vec3 = [0, seat.position[1] - 0.12, seat.position[2] + 0.62];
  const triangles: ReflectionTriangle[] = [];
  for (const submesh of data.submeshes) {
    if (submesh.kind !== 'body' || submesh.translucent || submesh.part !== referencePart) continue;
    const indices = data.indices.subarray(submesh.indexOffset, submesh.indexOffset + submesh.indexCount);
    for (let at = 0; at < indices.length; at += 3) {
      const vertices = Array.from(indices.subarray(at, at + 3));
      const points = vertices.map((v) => point(v, submesh.part)) as [Vec3, Vec3, Vec3];
      if (points.some((p) => p.some((v, axis) => v < lower[axis] || v > upper[axis]))) continue;
      const centre = [0, 1, 2].map((axis) => points.reduce((s, p) => s + p[axis] / 3, 0)) as Vec3;
      if (planes.some((plane) => dot(plane.normal, centre) > plane.distance + 0.015)) continue;
      const normal = [0, 1, 2].map((axis) => vertices.reduce((s, v) => s + data.normals[v * 3 + axis] / 3, 0)) as Vec3;
      const worldNormal = rotateVec(ref.localRotation, normal);
      if (Math.hypot(...normal) < 1e-5 || dot(worldNormal, eye.map((v, i) => v - centre[i]) as Vec3) <= 0) continue;
      const average = (colors: Uint8Array): Vec3 =>
        [0, 1, 2].map((axis) => vertices.reduce((s, v) => s + colors[v * 4 + axis] / (3 * 255), 0)) as Vec3;
      triangles.push({
        color: average(data.colors),
        layer: data.meta[vertices[0] * 4],
        night: average(data.night),
        normal,
        occlusion: vertices.reduce((s, v) => s + data.night[v * 4 + 3] / (3 * 255), 0),
        points: points.map((p) => rotateVec(inverse, p.map((v, axis) => v - ref.localTranslation[axis]) as Vec3)) as [
          Vec3,
          Vec3,
          Vec3,
        ],
        uv: vertices.map((v) => [data.uvs[v * 2], data.uvs[v * 2 + 1]]) as ReflectionTriangle['uv'],
      });
    }
  }

  return packReflectionScene(triangles, referencePart, data.parts.length);
}

/** Threaded BVH: header [nodeCount, triangleVec4Offset, referencePart, partCount], then two vec4s per
 * node (lower/escape, upper/triangle or -1). Eight vec4s per triangle. Escape links need no GPU stack. */
export function packReflectionScene(
  triangles: readonly ReflectionTriangle[],
  referencePart: number,
  partCount: number,
): Float32Array {
  if (!triangles.length || triangles.length > MAX_TRIANGLES) return new Float32Array([0, 0, 0, 1]);
  const nodes: number[][] = [];
  const ordered: ReflectionTriangle[] = [];
  function split(items: readonly ReflectionTriangle[]): void {
    const lower = [0, 1, 2].map((axis) => Math.min(...items.flatMap((item) => item.points.map((p) => p[axis]))));
    const upper = [0, 1, 2].map((axis) => Math.max(...items.flatMap((item) => item.points.map((p) => p[axis]))));
    const node = [...lower, 0, ...upper, -1];
    nodes.push(node);
    if (items.length === 1) {
      node[7] = ordered.length;
      ordered.push(items[0]);
    } else {
      const axis = [0, 1, 2].sort((a, b) => upper[b] - lower[b] - (upper[a] - lower[a]))[0];
      const sorted = [...items].sort(
        (a, b) => a.points.reduce((s, p) => s + p[axis], 0) - b.points.reduce((s, p) => s + p[axis], 0),
      );
      const middle = Math.floor(sorted.length / 2);
      split(sorted.slice(0, middle));
      split(sorted.slice(middle));
    }
    node[3] = nodes.length;
  }
  split(triangles);
  const result = [nodes.length, 1 + nodes.length * 2, referencePart, partCount, ...nodes.flat()];
  for (const item of ordered) {
    const [a, b, c] = item.points;
    result.push(
      ...a,
      item.layer,
      ...b.map((v, i) => v - a[i]),
      0,
      ...c.map((v, i) => v - a[i]),
      0,
      ...item.normal,
      item.occlusion,
      ...item.uv[0],
      ...item.uv[1],
      ...item.uv[2],
      0,
      0,
      ...item.color,
      0,
      ...item.night,
      0,
    );
  }

  return new Float32Array(result);
}

function glassPoints(data: VehicleModelData, point: (vertex: number, part: number) => Vec3): Vec3[] {
  const glass: Vec3[] = [];
  for (const submesh of data.submeshes) {
    if (submesh.kind !== 'body') continue;
    for (const vertex of data.indices.subarray(submesh.indexOffset, submesh.indexOffset + submesh.indexCount)) {
      if (data.meta[vertex * 4 + 3] >> 4 === MaterialClass.canopy) glass.push(point(vertex, submesh.part));
    }
  }

  return glass;
}
