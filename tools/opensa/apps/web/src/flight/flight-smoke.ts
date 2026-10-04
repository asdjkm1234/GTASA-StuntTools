import type { FxBakedEmitter, VehicleModelData } from '@opensa/renderware';

import type { FlightRow, FlightTrack, SampledPose } from './csv';
import type { Vec3 } from './math';

import { SURFACE_NAMES } from './csv';
import { gtaToEngine, rotateVec } from './math';

export interface FlightSmokeSource {
  alpha: number;
  /** Stable identity: five measured surface slots, followed by the engine. */
  id: number;
  position: Vec3;
}

interface SurfaceSmokeAnchor {
  center: Vec3;
  part: number;
}

const anchors = new WeakMap<VehicleModelData, readonly (null | SurfaceSmokeAnchor)[]>();

/** Visual damage smoke, inferred from recorded health; not a measured engine/surface diagnosis. */
export function flightSmokeAt(track: FlightTrack, seconds: number): number {
  return smokeAlpha(recordedRow(track, seconds));
}

/** Four puffs per source/tick, with a shared cap that leaves room in the 1024-particle blend pool. */
export function flightSmokeCount(sources: number, source: number, tick: number): number {
  if (sources <= 0) return 0;
  const total = Math.min(sources * 4, 8);

  return Math.floor(total / sources) + ((source + tick) % sources < total % sources ? 1 : 0);
}

/** A compact, immediately visible aircraft plume using the owner's baked smoke sprite. */
export function flightSmokeEmitter(emitter: FxBakedEmitter): FxBakedEmitter {
  return {
    ...emitter,
    additive: false,
    colors: [
      [0.1, 0.11, 0.12, 0.95],
      [0.16, 0.17, 0.19, 0.75],
      [0.24, 0.25, 0.27, 0],
    ],
    cone: { angle: Math.PI / 8, direction: [0, 1, 0] },
    force: [0, 0.5, 0],
    life: { bias: 0.4, seconds: 3.2 },
    sizes: [2, 5, 8],
    speed: { bias: 0.6, magnitude: 2.4 },
  };
}

/** Emit from measured damaged nodes; health alone never assigns damage to a particular surface. */
export function flightSmokeSources(
  track: FlightTrack,
  seconds: number,
  pose: SampledPose,
  data: null | VehicleModelData,
): FlightSmokeSource[] {
  const row = recordedRow(track, seconds);
  if (!row || !Number.isFinite(row.health) || row.health <= 0) return [];
  const sources: FlightSmokeSource[] = [];
  const severity = smokeAlpha(row);
  const base = gtaToEngine(...pose.pos);
  const worldPoint = (local: Vec3): Vec3 => {
    const offset = rotateVec(pose.orientation, local);

    return [base[0] + offset[0], base[1] + offset[1], base[2] + offset[2]];
  };
  if (data && row.surfaceDamage.source === 'game_memory') {
    surfaceAnchors(data).forEach((anchor, id) => {
      const state = row.surfaceDamage.states[id];
      if (!anchor || !(row.surfaceDamage.validMask & (1 << id)) || (state !== 1 && state !== 2)) return;
      const part = data.parts[anchor.part];
      // Match the rendered part's bind × animation = recorded absolute rotation, at this BIRTH pose.
      // A detached surface emits at its attachment stump, never at an invented debris trajectory.
      const rotation = state === 2 ? part.localRotation : (pose.nodes[id] ?? part.localRotation);
      const moved = state === 2 ? [0, 0, 0] : rotateVec(rotation, anchor.center);
      const local: Vec3 = [
        part.localTranslation[0] + moved[0],
        part.localTranslation[1] + moved[1],
        part.localTranslation[2] + moved[2],
      ];
      sources.push({ alpha: Math.max(severity, state === 2 ? 0.85 : 0.75), id, position: worldPoint(local) });
    });
  }
  // Keep the generic damage plume for older/unknown recordings. A measured smoke flag is independent.
  if ((sources.length === 0 && severity > 0) || row.smokeActive === true) {
    const dummy =
      data?.dummies.find((d) => /^engine(?:_dummy)?$/i.test(d.name)) ??
      data?.dummies.find((d) => /^exhaust(?:_dummy|_1|_secondary)?$/i.test(d.name));
    const local: Vec3 = dummy ? [...dummy.position] : row.model === 476 ? [0, 2.1, -0.15] : [0, -2.3, 0];
    sources.push({ alpha: severity, id: 5, position: worldPoint(local) });
  }

  return sources;
}

function recordedRow(track: FlightTrack, seconds: number): FlightRow | undefined {
  // Health is normally interpolated for instruments. Smoke must not anticipate the next damage sample.
  let lo = 0;
  let hi = track.rows.length;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (track.rows[mid].s <= seconds) lo = mid;
    else hi = mid;
  }

  return track.rows[lo];
}

function smokeAlpha(row: FlightRow | undefined): number {
  if (!row || !Number.isFinite(row.health) || row.health <= 0) return 0;
  const damage = row.health < 900 ? 0.6 + 0.4 * Math.min(1, (900 - row.health) / 650) : 0;
  // The plane smoke pointer/ejector is a separate recorded signal and may stay off despite damage.

  return Math.max(damage, row.smokeActive === true ? 0.7 : 0);
}

/** Derive the attachment from the actual DFF part geometry, once per loaded aircraft. */
function surfaceAnchors(data: VehicleModelData): readonly (null | SurfaceSmokeAnchor)[] {
  const cached = anchors.get(data);
  if (cached) return cached;
  const built = SURFACE_NAMES.map((name): null | SurfaceSmokeAnchor => {
    const exact = data.parts.findIndex((p) => p.name.toLowerCase() === name);
    const part = exact >= 0 ? exact : data.parts.findIndex((p) => p.name.toLowerCase().includes(name));
    if (part < 0) return null;
    const frame = data.parts[part];
    // Door-style offset matrices have a separate geometry basis; retain the reliable node pivot there.
    const vertices = new Set<number>();
    if (!frame.offset)
      for (const mesh of data.submeshes) {
        if (mesh.part !== part || mesh.kind !== 'body') continue;
        for (let i = mesh.indexOffset; i < mesh.indexOffset + mesh.indexCount; i++) vertices.add(data.indices[i]);
      }
    const center: Vec3 = [0, 0, 0];
    for (const vertex of vertices)
      for (let axis = 0; axis < 3; axis++) {
        center[axis] += (data.positions[vertex * 3 + axis] * (frame.scale ?? 1)) / vertices.size;
      }
    if (![...center, ...frame.localTranslation, ...frame.localRotation].every(Number.isFinite)) return null;

    return { center, part };
  });
  anchors.set(data, built);

  return built;
}
