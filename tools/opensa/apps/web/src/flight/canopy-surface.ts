/** Replay detail coordinates, fitted from the owner's glass without changing its mesh or base UVs. */
import type { VehicleModelData } from '@opensa/renderware';

import { MaterialClass } from '@opensa/renderware/vehicle/types';

import type { Vec3 } from './math';

import { rotateVec } from './math';

const PRECISION = 4096;
const OFFSET = 32768;

/** Circumferential ellipse arc length and longitudinal metres. The real mesh still defines the
 * surface and its lighting normals; this fit only replaces the badly stretched stock detail UVs. */
export function canopyCoordinates(points: readonly Vec3[]): [number, number][] {
  if (!points.length) return [];
  const low = [0, 1, 2].map((axis) => Math.min(...points.map((point) => point[axis])));
  const high = [0, 1, 2].map((axis) => Math.max(...points.map((point) => point[axis])));
  const centre = (low[0] + high[0]) / 2;
  const radius = Math.max((high[0] - low[0]) / 2, 0.01);
  const height = Math.max(high[2] - low[2], 0.01);

  return points.map((point) => {
    const angle = Math.atan2((point[0] - centre) / radius, (point[2] - low[2]) / height);
    // Simpson integration gives ellipse arc length rather than stretching a flat side projection.
    const step = Math.abs(angle) / 16;
    let sum = 0;
    for (let index = 0; index <= 16; index += 1) {
      const t = step * index;
      const speed = Math.hypot(radius * Math.cos(t), height * Math.sin(t));
      sum += speed * (index === 0 || index === 16 ? 1 : index % 2 === 0 ? 2 : 4);
    }

    return [(Math.sign(angle) * sum * step) / 3, point[1] - low[1]];
  });
}

/** Canopy-only reinterpretation of the unused four reflection bytes: two signed fixed-point UVs.
 * Packing before vertex interpolation preserves fine detail without another buffer or varying slot.
 * Four zero bytes disable details (Rustler and unsupported oversized mod canopies). */
export function packCanopyCoordinate(uv: readonly [number, number]): Uint8Array {
  const packed = uv.map((value) => Math.round(value * PRECISION) + OFFSET);
  if (packed.some((value) => !Number.isFinite(value) || value <= 0 || value > 65535)) return new Uint8Array(4);

  return new Uint8Array([packed[0] & 255, packed[0] >> 8, packed[1] & 255, packed[1] >> 8]);
}

export function prepareCanopySurface(data: VehicleModelData, model: number): void {
  if (model !== 520) return;
  const vertices = new Map<number, Vec3>();
  for (const submesh of data.submeshes) {
    if (submesh.kind !== 'body') continue;
    const part = data.parts[submesh.part];
    for (const vertex of data.indices.subarray(submesh.indexOffset, submesh.indexOffset + submesh.indexCount)) {
      if (data.meta[vertex * 4 + 3] >> 4 !== MaterialClass.canopy || vertices.has(vertex)) continue;
      const local: Vec3 = [data.positions[vertex * 3], data.positions[vertex * 3 + 1], data.positions[vertex * 3 + 2]];
      const point = rotateVec(part.localRotation, local);
      vertices.set(vertex, point.map((value, axis) => value + part.localTranslation[axis]) as Vec3);
    }
  }
  const coordinates = canopyCoordinates([...vertices.values()]);
  // Disable the whole detail layer if an unsupported mod cannot fit, avoiding interpolation seams.
  const packed = coordinates.map(packCanopyCoordinate);
  if (packed.some((coordinate) => coordinate.every((value) => value === 0))) return;
  [...vertices.keys()].forEach((vertex, index) => data.reflect.set(packed[index], vertex * 4));
}
