/** Replay-only matte lining for the stock Hydra's isolated cockpit sidewalls. */
import type { VehicleModelData } from '@opensa/renderware';

import { MaterialClass } from '@opensa/renderware/vehicle/types';

import { rotateVec, type Vec3 } from './math';

/** The stock lining shares a reflective material with exterior tail faces. Select complete inward
 * sidewall triangles, never the whole material; incompatible or shared-vertex mods remain untouched. */
export function prepareAircraftInterior(data: VehicleModelData, model: number): number {
  const seat = data.dummies.find((dummy) => dummy.name === 'ped_frontseat');
  if (model !== 520 || !seat) return 0;
  const selected = new Set<number>();
  const outside = new Set<number>();
  let triangles = 0;
  for (const mesh of data.submeshes) {
    const part = data.parts[mesh.part];
    const source = data.indices.subarray(mesh.indexOffset, mesh.indexOffset + mesh.indexCount);
    for (let at = 0; at < source.length; at += 3) {
      const vertices = Array.from(source.subarray(at, at + 3));
      const lining =
        mesh.kind === 'body' &&
        !mesh.translucent &&
        part.name === 'chassis' &&
        !part.offset &&
        (part.scale ?? 1) === 1 &&
        vertices.every((vertex) => {
          const slot = vertex * 4;
          const local = Array.from(data.positions.subarray(vertex * 3, vertex * 3 + 3)) as Vec3;
          const p = rotateVec(part.localRotation, local).map((v, axis) => v + part.localTranslation[axis]);
          const normal = rotateVec(
            part.localRotation,
            Array.from(data.normals.subarray(vertex * 3, vertex * 3 + 3)) as Vec3,
          );

          return (
            data.texture.names[data.meta[slot]] === 'white' &&
            data.meta[slot + 3] >> 4 === MaterialClass.paint &&
            data.colors[slot + 3] === 255 &&
            data.reflect[slot + 1] === 128 &&
            data.reflect[slot + 2] === 128 &&
            data.reflect[slot + 3] === 0 &&
            Math.abs(p[0]) > 0.25 &&
            Math.abs(p[0]) < 0.4 &&
            normal[0] * Math.sign(p[0]) < -0.95 &&
            p[1] > seat.position[1] - 0.85 &&
            p[1] < seat.position[1] + 1.5 &&
            p[2] > seat.position[2] - 0.45 &&
            p[2] < seat.position[2] + 0.5
          );
        });
      vertices.forEach((vertex) => (lining ? selected : outside).add(vertex));
      if (lining) triangles++;
    }
  }
  if (selected.size !== 16 || triangles !== 12 || [...selected].some((vertex) => outside.has(vertex))) return 0;
  for (const vertex of selected) {
    const slot = vertex * 4;
    data.meta[slot + 3] = (MaterialClass.matte << 4) | (data.meta[slot + 3] & 0xf);
    data.reflect.fill(0, slot, slot + 4);
  }

  return selected.size;
}
