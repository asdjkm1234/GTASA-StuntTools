/** View-dependent transparency for the stock Hydra's upper seat back. */
import type { VehicleModelData } from '@opensa/renderware';

import { MaterialClass } from '@opensa/renderware/vehicle/types';

import { COCKPIT_CONTROL_ALPHA } from './cockpit-stick';
import { rotateVec, type Vec3 } from './math';

export interface CockpitSeatMeshes {
  opaque: number[];
  translucent: number[];
}

interface SeatBackMatch {
  mesh: number;
  offsets: number[];
  triangles: string[];
  vertices: Map<number, number>;
}

// Stock trapezoid, relative to ped_frontseat, from its lower shoulder to its top.
// The wider lower seat/body and the black dashboard rim are outside this signature.
const BACK_POINTS: readonly Vec3[] = [
  [-0.3271, -0.4768, 0.1216],
  [0.3238, -0.4768, 0.1216],
  [0.1928, -0.4125, 0.5207],
  [-0.1942, -0.4125, 0.5207],
  [0.1133, -0.3148, 0.8414],
  [-0.1133, -0.3148, 0.8414],
  [0.2365, -0.2469, 0.3429],
  [-0.2365, -0.2469, 0.3429],
  [0.1621, -0.2568, 0.5301],
  [-0.1622, -0.2568, 0.5301],
  [0.1004, -0.2336, 0.8414],
  [-0.1004, -0.2336, 0.8414],
];
const BACK_TRIANGLES = [
  [0, 1, 2],
  [0, 2, 3],
  [2, 3, 4],
  [3, 4, 5], // rear
  [6, 7, 8],
  [8, 7, 9],
  [8, 9, 10],
  [10, 9, 11], // front
  [1, 6, 8],
  [1, 8, 2],
  [2, 8, 10],
  [2, 10, 4], // right side
  [9, 3, 11],
  [11, 3, 5],
  [9, 7, 0],
  [9, 0, 3], // left side
  [4, 10, 11],
  [4, 11, 5], // top
]
  .map((triangle) => triangle.sort((a, b) => a - b).join(','))
  .sort();
const prepared = new WeakMap<VehicleModelData, CockpitSeatMeshes>();

/** Keep an authored opaque copy; duplicate vertices so lower-seat shared vertices never change. */
export function prepareCockpitSeat(data: VehicleModelData, model: number): CockpitSeatMeshes | null {
  if (model !== 520) return null;
  const existing = prepared.get(data);
  if (existing) return existing;
  const seat = data.dummies.find((dummy) => dummy.name === 'ped_frontseat');
  if (!seat) return null;
  const matches = findSeatBack(data, seat.position);
  // Require the complete shell: rear, front, both sides and top. One opaque layer would still block the view.
  if (matches.length !== 2) return null;
  const vertices = new Map(matches.flatMap((match) => [...match.vertices]));
  const triangles = matches.flatMap((match) => match.triangles).sort();
  if (
    vertices.size !== 32 ||
    new Set(vertices.values()).size !== 12 ||
    triangles.join(';') !== BACK_TRIANGLES.join(';')
  )
    return null;
  const backs = matches.map((match) => match.offsets.flatMap((at) => Array.from(data.indices.subarray(at, at + 3))));
  const selected = [...vertices.keys()];
  const originalVertexCount = data.positions.length / 3;
  const duplicate = duplicateSeatVertices(data, selected);
  const indices: number[] = [];
  const removed = new Set(matches.flatMap((match) => match.offsets));
  const submeshes = data.submeshes.map((mesh) => {
    const indexOffset = indices.length;
    for (let at = mesh.indexOffset; at < mesh.indexOffset + mesh.indexCount; at += 3) {
      if (removed.has(at)) continue;
      indices.push(...data.indices.subarray(at, at + 3));
    }

    return { ...mesh, indexCount: indices.length - indexOffset, indexOffset };
  });
  const min = [0, 1, 2].map((axis) => Math.min(...selected.map((v) => data.positions[v * 3 + axis]))) as Vec3;
  const max = [0, 1, 2].map((axis) => Math.max(...selected.map((v) => data.positions[v * 3 + axis]))) as Vec3;
  const bounds = {
    bounds: { max, min },
    center: min.map((value, axis) => (value + max[axis]) / 2) as Vec3,
    radius: Math.hypot(...max.map((value, axis) => (value - min[axis]) / 2)),
  };
  const result: CockpitSeatMeshes = { opaque: [], translucent: [] };
  for (const translucent of [false, true]) {
    for (const [index, match] of matches.entries()) {
      const back = backs[index];
      result[translucent ? 'translucent' : 'opaque'].push(submeshes.length);
      submeshes.push({
        ...data.submeshes[match.mesh],
        ...bounds,
        indexCount: back.length,
        indexOffset: indices.length,
        translucent,
      });
      indices.push(...back.map((vertex) => (translucent ? duplicate.get(vertex)! : vertex)));
    }
  }
  data.indices =
    originalVertexCount + selected.length <= 65536 && data.indices instanceof Uint16Array
      ? new Uint16Array(indices)
      : new Uint32Array(indices);
  data.submeshes = submeshes;
  prepared.set(data, result);

  return result;
}

function duplicateSeatVertices(data: VehicleModelData, selected: number[]): Map<number, number> {
  const originalVertexCount = data.positions.length / 3;
  const duplicate = new Map(selected.map((vertex, index) => [vertex, originalVertexCount + index]));
  for (const key of ['positions', 'normals', 'uvs', 'colors', 'night', 'meta', 'reflect'] as const) {
    const stride = key === 'uvs' ? 2 : key === 'positions' || key === 'normals' ? 3 : 4;
    const original = data[key];
    const expanded =
      original instanceof Float32Array
        ? new Float32Array(original.length + selected.length * stride)
        : new Uint8Array(original.length + selected.length * stride);
    expanded.set(original);
    selected.forEach((vertex, index) =>
      expanded.set(original.subarray(vertex * stride, (vertex + 1) * stride), (originalVertexCount + index) * stride),
    );
    // The key determines the array's element type; every float lane above stays Float32Array.
    if (key === 'positions' || key === 'normals' || key === 'uvs') data[key] = expanded as Float32Array;
    else data[key] = expanded as Uint8Array;
  }
  for (const vertex of duplicate.values()) {
    data.colors[vertex * 4 + 3] = COCKPIT_CONTROL_ALPHA;
    data.night[vertex * 4 + 3] = COCKPIT_CONTROL_ALPHA;
    data.meta[vertex * 4 + 3] = MaterialClass.matte << 4;
    data.reflect.fill(0, vertex * 4, vertex * 4 + 4);
  }

  return duplicate;
}

function findSeatBack(data: VehicleModelData, seat: Vec3): SeatBackMatch[] {
  const matches: SeatBackMatch[] = [];
  for (const [meshIndex, mesh] of data.submeshes.entries()) {
    const part = data.parts[mesh.part];
    if (mesh.kind !== 'body' || mesh.translucent || part.name !== 'chassis' || part.offset || (part.scale ?? 1) !== 1)
      continue;
    const vertices = new Map<number, number>();
    for (let at = mesh.indexOffset; at < mesh.indexOffset + mesh.indexCount; at += 1) {
      const vertex = data.indices[at];
      const point = rotateVec(
        part.localRotation,
        Array.from(data.positions.subarray(vertex * 3, vertex * 3 + 3)) as Vec3,
      );
      const relative = point.map((value, axis) => value + part.localTranslation[axis] - seat[axis]);
      const signature = BACK_POINTS.findIndex((expected) =>
        expected.every((value, axis) => Math.abs(value - relative[axis]) < 0.002),
      );
      if (
        signature >= 0 &&
        ((data.texture.names[data.meta[vertex * 4]] === 'vehiclegeneric256' &&
          data.colors.subarray(vertex * 4, vertex * 4 + 3).every((value) => value === 0)) ||
          (data.texture.names[data.meta[vertex * 4]] === 'hydra128' &&
            data.colors.subarray(vertex * 4, vertex * 4 + 3).every((value) => value === 255))) &&
        data.colors[vertex * 4 + 3] === 255
      )
        vertices.set(vertex, signature);
    }
    const offsets: number[] = [];
    const triangles: string[] = [];
    for (let at = mesh.indexOffset; at < mesh.indexOffset + mesh.indexCount; at += 3) {
      const triangle = Array.from(data.indices.subarray(at, at + 3));
      if (!triangle.every((vertex) => vertices.has(vertex))) continue;
      offsets.push(at);
      triangles.push(
        triangle
          .map((vertex) => vertices.get(vertex)!)
          .sort((a, b) => a - b)
          .join(','),
      );
    }
    if (offsets.length) {
      const used = new Set(offsets.flatMap((at) => Array.from(data.indices.subarray(at, at + 3))));
      matches.push({
        mesh: meshIndex,
        offsets,
        triangles,
        vertices: new Map([...vertices].filter(([vertex]) => used.has(vertex))),
      });
    }
  }

  return matches;
}
