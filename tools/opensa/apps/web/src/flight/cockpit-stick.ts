/** Replay-only transparency and surface-driven motion for the stock Hydra stick. */
import type { VehicleModelData } from '@opensa/renderware';

import { MaterialClass, type VehicleModelSubmesh } from '@opensa/renderware/vehicle/types';

import { conjugate, type Quat, quatMultiply, rotateVec, type Vec3 } from './math';

export const COCKPIT_STICK_PART = 'replay_cockpit_stick';

/** Visual linkage, not a recorded joystick: native X=right, Y=forward, Z=up. */
export function cockpitStickMotion(
  nodes: readonly (null | Quat)[],
  binds: readonly (null | Quat)[],
  inferred: { pitch: number; roll: number },
): { pitch: number; roll: number; rotation: Quat } {
  const twist = (index: number): null | number => {
    const node = nodes[index];
    const bind = binds[index];
    if (!node || !bind || !node.every(Number.isFinite)) return null;
    // Cancel the authored bind before extracting the twist about aircraft X. Both q and -q agree.
    const delta = quatMultiply(node, conjugate(bind));
    const angle = 2 * Math.atan2(delta[0], delta[3]);

    return Math.atan2(Math.sin(angle), Math.cos(angle));
  };
  const elevators = [twist(1), twist(2)].filter((angle): angle is number => angle !== null);
  const left = twist(3);
  const right = twist(4);
  // Elevators move together; opposite aileron travel drives roll. Common aileron travel cancels.
  const pitchSurface = elevators.length ? elevators.reduce((a, b) => a + b, 0) / elevators.length : inferred.pitch;
  const rollSurface =
    left !== null && right !== null ? (left - right) / 2 : (left ?? (right === null ? inferred.roll : -right));
  let pitch = -pitchSurface * 0.6;
  let roll = rollSurface * 0.6;
  const limit = (18 * Math.PI) / 180;
  const scale = Math.min(1, limit / (Math.hypot(pitch, roll) || 1));
  pitch *= scale;
  roll *= scale;

  return {
    pitch,
    roll,
    rotation: quatMultiply(
      [0, Math.sin(roll / 2), 0, Math.cos(roll / 2)],
      [Math.sin(pitch / 2), 0, 0, Math.cos(pitch / 2)],
    ),
  };
}

/** Split only small, isolated stick faces. Unknown/modded geometry is left intact. */
export function prepareCockpitStick(data: VehicleModelData, model: number): number {
  const seat = data.dummies.find((dummy) => dummy.name === 'ped_frontseat');
  if (model !== 520 || !seat || data.parts.some((part) => part.name === COCKPIT_STICK_PART)) return 0;
  const original = data.submeshes.slice();
  const indices: number[] = [];
  const selected = new Set<number>();
  const rewritten: VehicleModelSubmesh[] = [];
  const additions: VehicleModelSubmesh[] = [];
  for (const mesh of original) {
    const source = data.indices.subarray(mesh.indexOffset, mesh.indexOffset + mesh.indexCount);
    const opaque: number[] = [];
    const blend: number[] = [];
    const part = data.parts[mesh.part];
    const point = (vertex: number): Vec3 => {
      const local = Array.from(data.positions.subarray(vertex * 3, vertex * 3 + 3)) as Vec3;

      return rotateVec(part.localRotation, local).map((v, axis) => v + part.localTranslation[axis]) as Vec3;
    };
    for (let at = 0; at < source.length; at += 3) {
      const triangle = Array.from(source.subarray(at, at + 3));
      const stick =
        mesh.kind === 'body' &&
        !mesh.translucent &&
        part.name === 'chassis' &&
        triangle.every((vertex) => {
          const p = point(vertex);

          return (
            data.texture.names[data.meta[vertex * 4]] === 'hydra128' &&
            Math.abs(p[0]) < 0.045 &&
            p[1] > seat.position[1] + 0.35 &&
            p[1] < seat.position[1] + 0.72 &&
            p[2] > seat.position[2] - 0.42 &&
            p[2] < seat.position[2] + 0.5
          );
        });
      (stick ? blend : opaque).push(...triangle);
    }
    // Keep existing mesh indices/visibility slots stable; the new draw is appended below.
    rewritten.push({ ...mesh, indexCount: opaque.length, indexOffset: indices.length });
    indices.push(...opaque);
    if (!blend.length) continue;
    blend.forEach((vertex) => selected.add(vertex));
    const min = [0, 1, 2].map((axis) => Math.min(...blend.map((v) => data.positions[v * 3 + axis]))) as Vec3;
    const max = [0, 1, 2].map((axis) => Math.max(...blend.map((v) => data.positions[v * 3 + axis]))) as Vec3;
    const center = min.map((v, axis) => (v + max[axis]) / 2) as Vec3;
    additions.push({
      ...mesh,
      bounds: { max, min },
      center,
      indexCount: blend.length,
      indexOffset: indices.length,
      radius: Math.hypot(...max.map((v, axis) => (v - min[axis]) / 2)),
      translucent: true,
    });
    indices.push(...blend);
  }
  // A partial match can be a mod's dashboard detail. Require the complete stock grip + two stalk shells.
  if (selected.size !== 48) return 0;
  // Stock stick vertices are separate from the dash/body. Refuse shared vertices in unknown mods.
  const shared = rewritten.some((mesh) =>
    indices.slice(mesh.indexOffset, mesh.indexOffset + mesh.indexCount).some((vertex) => selected.has(vertex)),
  );
  if (shared) return 0;
  // The stock stick is baked into chassis coordinates. Add a pivot + inverse mesh offset so its
  // neutral geometry remains identical, and only the appended transparent draw can move.
  const chassis = data.parts[additions[0].part];
  if (additions.some((mesh) => mesh.part !== additions[0].part) || chassis.offset || (chassis.scale ?? 1) !== 1)
    return 0;
  const bottom = Math.min(...[...selected].map((vertex) => data.positions[vertex * 3 + 2]));
  const base = [...selected].filter((vertex) => data.positions[vertex * 3 + 2] < bottom + 0.001);
  const pivot = [0, 1, 2].map(
    (axis) => base.reduce((sum, vertex) => sum + data.positions[vertex * 3 + axis], 0) / base.length,
  ) as Vec3;
  const translated = rotateVec(chassis.localRotation, pivot).map(
    (v, axis) => v + chassis.localTranslation[axis],
  ) as Vec3;
  const part = data.parts.length;
  data.parts = [
    ...data.parts,
    {
      localRotation: [...chassis.localRotation],
      localTranslation: translated,
      name: COCKPIT_STICK_PART,
      offset: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -pivot[0], -pivot[1], -pivot[2], 1],
      parent: additions[0].part,
    },
  ];
  for (const mesh of additions) mesh.part = part;
  for (const vertex of selected) {
    data.colors[vertex * 4 + 3] = 64;
    data.night[vertex * 4 + 3] = 64;
    data.meta[vertex * 4 + 3] = MaterialClass.matte << 4;
    data.reflect.fill(0, vertex * 4, vertex * 4 + 4);
  }
  data.indices = data.indices instanceof Uint16Array ? new Uint16Array(indices) : new Uint32Array(indices);
  data.submeshes = [...rewritten, ...additions];

  return selected.size;
}
