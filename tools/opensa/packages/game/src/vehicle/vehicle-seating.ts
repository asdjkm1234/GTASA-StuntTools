import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { PhysicsWorld } from '../physics/physics-world';

/** Raise the ground-snap ray start / how far it probes below the placement. */
const GROUND_SNAP_LIFT = 2;
const GROUND_SNAP_DROP = 6;

/** A resolved spawn pose: the seated position and the street's pitch (nose-up positive). */
export interface VehicleSeat {
  pitch: number;
  position: Vec3;
}

/**
 * Seat a ground-snapped car on the street (074 bench road cars — three field lessons, shared by both
 * hosts): the body must PITCH with the street (a horizontal spawn at a slope break drops nose-first and
 * the parking brake freezes it on its snout); the spot may be BLOCKED sideways (a lamp post, another car —
 * vertical probes can't see those), so candidates slide along the heading until the upper half is clear;
 * and with NO ground yet (the spot's collision cell hasn't streamed/parsed) the spawn is DEFERRED by
 * throwing — the vehicle-lod stream retries every frame, so the car materialises the moment the collision
 * does (spawning anyway drops it through the void and it lands on its nose when the ground appears).
 */
export function seatVehicleOnGround(
  physics: Pick<PhysicsWorld, 'groundBelow' | 'overlapsBox'>,
  position: Readonly<Vec3>,
  heading: number,
  halfExtents: Readonly<Vec3>,
): VehicleSeat {
  const forward: [number, number] = [-Math.sin(heading), Math.cos(heading)];
  const reach = halfExtents[1];
  const seatAt = (along: number): null | VehicleSeat => {
    const x = position[0] + forward[0] * along;
    const y = position[1] + forward[1] * along;
    const groundAt = (shift: number): null | number =>
      physics.groundBelow(
        [x + forward[0] * shift, y + forward[1] * shift, position[2] + GROUND_SNAP_LIFT],
        GROUND_SNAP_DROP,
      );
    const centre = groundAt(0);
    const nose = groundAt(reach) ?? centre;
    const tail = groundAt(-reach) ?? centre;
    if (centre === null || nose === null || tail === null) {
      return null;
    }

    return {
      pitch: Math.atan2(nose - tail, 2 * reach),
      position: [x, y, Math.max(centre, (nose + tail) / 2) + halfExtents[2] + 0.1],
    };
  };
  const clearAt = (spot: Vec3): boolean =>
    // The UPPER HALF of the body only: slopes pass under it, poles and other cars intersect it.
    !physics.overlapsBox([spot[0], spot[1], spot[2] + halfExtents[2] * 0.6], heading, [
      halfExtents[0] * 0.9,
      halfExtents[1] * 0.9,
      halfExtents[2] * 0.4,
    ]);
  let seated: null | VehicleSeat = null;
  for (const along of [0, 3, -3]) {
    const candidate = seatAt(along);
    if (candidate && clearAt(candidate.position)) {
      seated = candidate;
      break;
    }
  }
  seated ??= seatAt(0);
  if (!seated) {
    throw new Error(`vehicle spawn deferred: no ground at ${position[0]},${position[1]} yet`);
  }

  return seated;
}
