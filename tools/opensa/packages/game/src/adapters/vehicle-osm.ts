import type { OsmCollision } from '@opensa/engine-formats';
/**
 * `.osm` → everything a vehicle SPAWN needs (opensa-pack 003 phase 3) — the game's half of the optimized path.
 *
 * The container read itself is not game logic and no longer lives here: `readModelOsm` moved to
 * `@opensa/loaders/model-osm` when the dispatch console needed the same bytes (201/5-04), and is re-exported
 * from this module so the hosts that already import it are unchanged. What stays is what only a spawn wants —
 * the baked collision in engine shape, the rig, the seat and the wheels.
 */
import type { VehicleFixture } from '@opensa/renderware/vehicle/types';

import { type OptimizedModel, readModelOsm, type RigidModelInit } from '@opensa/loaders/model-osm';

import type { ModelColliders } from '../interfaces/collider.interface';
import type { VehicleRigData } from './engine-vehicle-handle';

export { type OptimizedModel, readModelOsm };

export interface OptimizedVehicle {
  /** Null when the source DFF carried no collision — the same signal the unoptimized path gives. */
  colliders: ModelColliders | null;
  halfExtents: [number, number, number];
  model: RigidModelInit;
  /** The articulation the handle animates — the fixture IS this, so no conversion is needed. */
  rig: VehicleRigData;
  /** `ped_frontseat` dummy in vehicle space, or null. */
  seat: [number, number, number] | null;
  wheels: { connection: [number, number, number]; front: boolean; index: number; radius: number }[];
}

/** Read one converted vehicle. Throws when a required section is missing — a truncated `.osm` is a bug. */
export function readVehicleOsm(name: string, osm: Uint8Array): OptimizedVehicle {
  const read = readModelOsm(name, osm);
  const { collision, fixture } = read;
  if (!collision) {
    throw new Error(`${name}.osm is missing its COLL section`);
  }

  return {
    colliders: toColliders(name, collision),
    halfExtents: [...collision.halfExtents],
    model: read.model,
    rig: fixture,
    seat: seatOf(fixture),
    wheels: fixture.wheels.map((wheel, index) => ({
      connection: [...fixture.parts[wheel.part].localTranslation] as [number, number, number],
      front: wheel.front,
      index,
      radius: wheel.radius,
    })),
  };
}

/** SA's driver-seat dummy name. One source: both the osm reader and the DFF adapter look it up by this. */
export const SEAT_DUMMY_NAME = 'ped_frontseat';

function seatOf(fixture: VehicleFixture): [number, number, number] | null {
  const seat = fixture.dummies.find((dummy) => dummy.name === SEAT_DUMMY_NAME);

  return seat ? [...seat.position] : null;
}

/**
 * The baked collision in engine shape. An EMPTY shape means the DFF had no COL and the writer baked the
 * fallback half-extents instead — the unoptimized path reports that as `colliders: null`, so this must too,
 * or a car with no collision would get a zero-triangle body instead of the adapter's fallback.
 */
function toColliders(name: string, collision: OsmCollision): ModelColliders | null {
  const empty = collision.vertices.length === 0 && collision.spheres.length === 0 && collision.boxes.length === 0;
  if (empty) {
    return null;
  }

  return {
    name,
    shape: {
      boxes: collision.boxes.map((box) => ({ max: [...box.max], min: [...box.min] })),
      indices: collision.indices,
      spheres: collision.spheres.map((sphere) => ({ center: [...sphere.center], radius: sphere.radius })),
      vertices: collision.vertices,
    },
    transforms: [],
  };
}
