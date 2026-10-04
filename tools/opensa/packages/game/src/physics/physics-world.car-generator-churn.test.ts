import { Matrix4 } from '@opensa/math';
import { describe, expect, it } from 'vitest';

import type { ColliderShape, ModelColliders } from '../interfaces/collider.interface';
import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { VehicleController, VehicleMassProperties } from './physics-world';

import { seatVehicleOnGround } from '../vehicle/vehicle-seating';
import { PhysicsWorld } from './physics-world';
import { initRapier } from './rapier';

/**
 * The map car generators poison the physics world
 * (`docs/open-issues/fixed/map-car-generators-poison-physics.md`): a chassis reads back all-NaN, then `world.step`
 * panics `unreachable` inside Rapier and every later read dies with "recursive use of an object". The field
 * bisection narrowed it to the generator population (`?cargen=0` is clean, `?parked=0` still crashes), and
 * the open issue asks for the next round to be a TEST, because the suite runs REAL Rapier and each field run
 * cost ~10 minutes for one bit.
 *
 * What this harness reproduces is the shape of the field run, not a specific place: a view driving down a
 * corridor of streamed collision cells with car placements along it, spawned and despawned by distance
 * through the same calls the host makes. The live numbers are the game's own
 * (`apps/web/src/ui/game-runtime-config.ts`), and they are the point — **collision streams to 150 m while a
 * car unloads only at 500 m**, so every placement between the two radii is a body with no ground under it.
 */
const STEP = 1 / 60;
/** The game's own streaming radii. */
const COLLISION_DISTANCE = 150;
const CELL_UNLOAD_DISTANCE = 190;
const CAR_UNLOAD_DISTANCE = 500;
const CELL_SIZE = 64;
const HALF: [number, number, number] = [1.2, 2.5, 0.7];
const WHEELS = [
  { connection: [-0.8, 1.4, -0.5] as Vec3, front: true, radius: 0.35 },
  { connection: [0.8, 1.4, -0.5] as Vec3, front: true, radius: 0.35 },
  { connection: [-0.8, -1.4, -0.5] as Vec3, front: false, radius: 0.35 },
  { connection: [0.8, -1.4, -0.5] as Vec3, front: false, radius: 0.35 },
];

interface Cell {
  centre: [number, number];
  handles: null | number[];
}

/** A run's outcome — a throw is the fault itself (the step drops a NaN chassis by throwing). */
interface ChurnResult {
  peakLive: number;
  spawns: number;
  steps: number;
  thrown: null | string;
}

interface LiveCar {
  body: number;
  controller: VehicleController;
  home: Vec3;
  placement: Placement;
}

interface Placement {
  heading: number;
  position: Vec3;
}

function cellModel(centre: readonly [number, number]): ModelColliders {
  return { name: 'cell', shape: cellShape(), transforms: [new Matrix4().makeTranslation(centre[0], centre[1], 0)] };
}

function cellShape(): ColliderShape {
  const half = CELL_SIZE / 2;
  // A flat quad as a TRIMESH, which is what a streamed collision cell actually is.
  const vertices = new Float32Array([-half, -half, 0, half, -half, 0, half, half, 0, -half, half, 0]);

  return { boxes: [], indices: new Uint32Array([0, 1, 2, 0, 2, 3]), spheres: [], vertices };
}

function distanceTo(view: Vec3, point: readonly [number, number, number]): number {
  const dx = point[0] - view[0];
  const dy = point[1] - view[1];
  const dz = point[2] - view[2];

  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Drive a view down the corridor while cells and cars stream by distance, exactly as the host does:
 * `seatVehicleOnGround` probes (and DEFERS by throwing when the collision has not arrived),
 * `createDynamicVehicle` spawns, `removeVehicle` + `removeBodies` despawn, in that order.
 */
function drive(physics: PhysicsWorld, placements: readonly Placement[], corridor: number): ChurnResult {
  const cells: Cell[] = [];
  for (let y = -CELL_SIZE; y <= corridor + CELL_SIZE; y += CELL_SIZE) {
    for (const x of [-CELL_SIZE, 0, CELL_SIZE]) {
      cells.push({ centre: [x, y], handles: null });
    }
  }
  const live = new Map<number, LiveCar>();
  const view: Vec3 = [0, 0, 1.6];
  const speed = 20; // m/s — an ordinary drive, which is what the field report was doing
  const steps = Math.ceil(corridor / speed / STEP);
  let spawns = 0;
  let peakLive = 0;

  try {
    for (let tick = 0; tick < steps; tick += 1) {
      view[1] = tick * STEP * speed;
      for (const cell of cells) {
        const distance = distanceTo(view, [cell.centre[0], cell.centre[1], 0]);
        if (cell.handles === null && distance < COLLISION_DISTANCE) {
          cell.handles = physics.createStaticColliders([cellModel(cell.centre)]);
        } else if (cell.handles !== null && distance >= CELL_UNLOAD_DISTANCE) {
          physics.removeBodies(cell.handles);
          cell.handles = null;
        }
      }
      placements.forEach((placement, index) => {
        const car = live.get(index);
        const distance = distanceTo(view, car ? car.home : placement.position);
        if (car && distance >= CAR_UNLOAD_DISTANCE) {
          physics.removeVehicle(car.controller);
          physics.removeBodies([car.body]);
          live.delete(index);

          return;
        }
        if (!car && distance < COLLISION_DISTANCE) {
          let seated;
          try {
            // Map car generators ground-snap: the probe's throw is what DEFERS a spawn onto a cell that has
            // not streamed in, and its pitch is what seats the car on the street.
            seated = seatVehicleOnGround(physics, placement.position, placement.heading, HALF);
          } catch {
            return; // no ground yet — the stream retries next tick, as the host does
          }
          const spawned = physics.createDynamicVehicle(
            seated.position,
            placement.heading,
            null,
            massProps(),
            WHEELS,
            HALF,
            seated.pitch,
          );
          live.set(index, {
            body: spawned.body,
            controller: spawned.controller,
            home: [...seated.position],
            placement,
          });
          spawns += 1;
        }
      });
      peakLive = Math.max(peakLive, live.size);
      physics.step(STEP);
      // The home is the car's LIVE position while loaded — which is how a car that fell away from its spot
      // carries its own unload trigger with it.
      for (const car of live.values()) {
        car.home = physics.readBody(car.body).position;
      }
    }
  } catch (error) {
    return { peakLive, spawns, steps, thrown: error instanceof Error ? error.message : String(error) };
  }

  return { peakLive, spawns, steps, thrown: null };
}

/** Deterministic pseudo-randomness — a test that streams a different map on every run proves nothing. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;

    return state / 4294967296;
  };
}

function massProps(): VehicleMassProperties {
  return {
    centreOfMass: [0, 0, 0],
    mass: 1500,
    suspension: { bias: 0.5, damping: 0.15, force: 1.1, restLength: 0.15, travel: 0.25 },
    traction: { bias: 0.5, loss: 0.8, mult: 0.7 },
    turnMass: 3000,
  };
}

/** `count` placements scattered along the corridor, on the cell grid the drive streams. */
function scatter(count: number, corridor: number, seed: number): Placement[] {
  const random = lcg(seed);

  return Array.from({ length: count }, () => ({
    heading: random() * Math.PI * 2,
    position: [(random() - 0.5) * CELL_SIZE * 2.5, random() * corridor, 0.5] as Vec3,
  }));
}

describe('PhysicsWorld — map car generator churn', () => {
  describe('negative cases', () => {
    it('survives a drive past a generator-sized population without poisoning the world', async () => {
      const physics = new PhysicsWorld(await initRapier());
      const corridor = 1600;

      const result = drive(physics, scatter(960, corridor, 1), corridor);

      expect(result.spawns).toBeGreaterThan(0);
      expect(result.thrown).toBeNull();
      physics.dispose();
    }, 120_000);

    it('survives the same drive with a parked-sized population', async () => {
      const physics = new PhysicsWorld(await initRapier());
      const corridor = 1600;

      const result = drive(physics, scatter(212, corridor, 2), corridor);

      expect(result.spawns).toBeGreaterThan(0);
      expect(result.thrown).toBeNull();
      physics.dispose();
    }, 120_000);
  });
});
