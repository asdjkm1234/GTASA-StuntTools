/** Replay-only classic canopy glass and a conservative, model-derived pilot head envelope. */
import type { VehicleModelData } from '@opensa/renderware';

import { MaterialClass } from '@opensa/renderware/vehicle/types';

import type { Vec3 } from './math';

import { rotateVec } from './math';

export interface CanopyPlane {
  distance: number;
  normal: Vec3;
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Shorten a head movement before it reaches the glass, including the near-plane corners.
 * Coordinates are aircraft-local. The safe anchor must be inside the surface planes; nonconvex mod
 * shells that do not contain it hold the anchor instead of teleporting the eye. */
export function constrainCanopyEye(
  planes: readonly CanopyPlane[],
  anchor: Vec3,
  desired: Vec3,
  clearance: number,
): Vec3 {
  if (planes.some((plane) => plane.distance - dot(plane.normal, anchor) < clearance)) return anchor;
  let fraction = 1;
  const movement = desired.map((value, axis) => value - anchor[axis]) as Vec3;
  for (const plane of planes) {
    const approach = dot(plane.normal, movement);
    if (approach > 0)
      fraction = Math.min(fraction, (plane.distance - clearance - dot(plane.normal, anchor)) / approach);
  }

  return anchor.map((value, axis) => value + movement[axis] * Math.max(0, fraction)) as Vec3;
}

/** Tag the pilot's glass, leaving nose lenses, propellers, decals and opaque frames as authored. */
export function prepareAircraftCanopy(data: VehicleModelData, model: number): CanopyPlane[] {
  const seat = data.dummies.find((dummy) => dummy.name.toLowerCase() === 'ped_frontseat');
  if ((model !== 520 && model !== 476) || !seat) return [];
  const planes: CanopyPlane[] = [];
  for (const submesh of data.submeshes) {
    if (submesh.kind !== 'body' || !submesh.translucent) continue;
    const indices = data.indices.subarray(submesh.indexOffset, submesh.indexOffset + submesh.indexCount);
    if (!indices.length || !isCanopyMaterial(data, indices[0], model)) continue;
    const part = data.parts[submesh.part];
    const position = (vertex: number): Vec3 => {
      const local: Vec3 = [data.positions[vertex * 3], data.positions[vertex * 3 + 1], data.positions[vertex * 3 + 2]];
      const rotated = rotateVec(part.localRotation, local);

      return rotated.map((value, axis) => value + part.localTranslation[axis]) as Vec3;
    };
    const vertices = [...new Set(indices)];
    const points = vertices.map(position);
    // The canopy wraps the pilot; the detached nose light sits below the seat and well ahead of it.
    if (!points.some((point) => point[2] > seat.position[2] + 0.3 && Math.abs(point[1] - seat.position[1]) < 1))
      continue;
    for (const vertex of vertices) {
      data.meta[vertex * 4 + 3] = (MaterialClass.canopy << 4) | (data.meta[vertex * 4 + 3] & 0xf);
    }
    for (let index = 0; index < indices.length; index += 3) {
      const a = position(indices[index]);
      const b = position(indices[index + 1]);
      const c = position(indices[index + 2]);
      const ab = b.map((value, axis) => value - a[axis]) as Vec3;
      const ac = c.map((value, axis) => value - a[axis]) as Vec3;
      let normal: Vec3 = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      const length = Math.hypot(...normal);
      if (length < 1e-8) continue;
      const vertex = indices[index] * 3;
      const authored = rotateVec(part.localRotation, [
        data.normals[vertex],
        data.normals[vertex + 1],
        data.normals[vertex + 2],
      ]);
      const sign = dot(normal, authored) < 0 ? -1 : 1;
      normal = normal.map((value) => (value * sign) / length) as Vec3;
      planes.push({ distance: dot(normal, a), normal });
    }
  }

  return planes;
}

function isCanopyMaterial(data: VehicleModelData, vertex: number, model: number): boolean {
  const at = vertex * 4;
  // Nonreflective Rustler glass is matte to the general builder. Exclude its props and decals.

  return (
    data.meta[at + 3] >> 4 === MaterialClass.glass ||
    (model === 476 && data.colors[at + 3] === 128 && data.texture.names[data.meta[at]] === 'vehiclegeneric256')
  );
}
