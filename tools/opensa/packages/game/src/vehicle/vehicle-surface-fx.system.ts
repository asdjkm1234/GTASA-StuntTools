/**
 * Surface-driven wheel effects (plan 089/05): WHAT the driven car's wheels are running over, turned into
 * spawn requests — dust off a dirt road, sand off a beach, spray off a ford. The dispatch mirrors the
 * original's `CVehicle::AddWheelDirtAndWater`: the surface's `W_*` flags (surfinfo.dat, read since 081/10)
 * choose the effect class; the class → look mapping lives in the host's sink.
 *
 * Unlike the tyre smoke, these fire from plain ROLLING too — a dirt road dusts at speed with no slide at
 * all (that is what sells the surface change) — and a slide on the same surface throws more. Both fold
 * into one drive term; the thresholds are an eye-fit (`CFx::AddWheel*` are stubs in gta-reversed),
 * recorded in `docs/hacks/surface-fx-fit.md`.
 *
 * Cost note: this reads `readVehicleWheelSurfaces` every fixed step for the DRIVEN car — one short ray per
 * contacting wheel, priced in 081/07 §3 as the same order as the whole controller update. It stays on the
 * driven car for exactly that reason (the readme's budget: the player's car is the target).
 */
import type { System } from '../core/system';
import type { SurfaceRecord } from '../interfaces/world-adapter.interface';
import type { VehicleController } from '../physics/physics-world';
import type { TyreSmokeCar, TyreSmokePhysics } from './vehicle-tyre-smoke.system';

import { planarMotion } from './vehicle-telemetry';
import { equivalentSlideSpeed } from './vehicle-tyre-smoke.system';

/**
 * The original's dispatch classes — one per `W_*` column of surfinfo.dat, MINUS spray. `W_SPRAY` is set on
 * `default` and every `tarmac*` row: in SA it means "spray WHEN THE ROAD IS WET" (`CWeather` wetness gates
 * it), and this game tracks no road wetness yet — read unconditionally it sprayed every road (field
 * round 1's "white snowflakes on asphalt"). Spray returns with a wet-roads state, not before.
 */
export type SurfaceFxClass = 'dust' | 'grass' | 'gravel' | 'mud' | 'sand';

/** The physics slice — the tyre smoke's plus the per-wheel surface probe (081/10). */
export interface SurfaceFxPhysics extends TyreSmokePhysics {
  readVehicleWheelSurfaces(controller: VehicleController, chassisBody: number): readonly (null | number)[];
}

/** One wheel's spawn request. `position` is the contact point, native GTA space. */
export interface SurfaceFxPuff {
  count: number;
  fx: SurfaceFxClass;
  /** 0..1 — how hard the wheel works the surface; the sink scales opacity/life with it. */
  intensity: number;
  position: [number, number, number];
}

/**
 * The surfinfo row → effect class. Pure and exported so the tarmac-stays-silent rule is PINNED by a test:
 * `wheelSpray` alone must map to null (the field bug was reading it unconditionally).
 */
export function surfaceFxClassOf(record: SurfaceRecord | undefined): null | SurfaceFxClass {
  if (!record) {
    return null;
  }
  if (record.wheelSand) {
    return 'sand';
  }
  if (record.wheelMud) {
    return 'mud';
  }
  if (record.wheelGrass) {
    return 'grass';
  }
  if (record.wheelGravel) {
    return 'gravel';
  }

  return record.wheelDust ? 'dust' : null;
}

/** Ground speed (m/s) where a flagged surface starts throwing material, and where it throws hardest. */
const DRIVE_START = 4;
const DRIVE_FULL = 20;

/** A sliding wheel works the surface harder than a rolling one — the slide counts double. */
const SLIDE_WEIGHT = 2;

/** Puffs per wheel per second at full intensity. */
const RATE = 10;

/** More wheels than any SA vehicle carries. */
const MAX_WHEELS = 8;

export class VehicleSurfaceFxSystem implements System {
  readonly name = 'vehicle-surface-fx';

  /** Fractional puffs owed per wheel. */
  private readonly accumulators = new Float64Array(MAX_WHEELS);
  /** The car whose accumulators are valid — a car change resets them. */
  private car: null | TyreSmokeCar = null;

  constructor(
    private readonly driven: () => null | TyreSmokeCar,
    private readonly physics: SurfaceFxPhysics,
    /** Surface id → effect class, from the world's surfinfo table; null = the surface throws nothing. */
    private readonly classify: (surface: null | number) => null | SurfaceFxClass,
    private readonly sink: (puff: SurfaceFxPuff) => void,
    private readonly enabled: () => boolean,
  ) {}

  fixedUpdate(step: number): void {
    const car = this.enabled() ? this.driven() : null;
    if (car !== this.car) {
      this.accumulators.fill(0);
      this.car = car;
    }
    if (car === null || step <= 0) {
      return;
    }
    const slips = this.physics.readVehicleWheelSlip(car.controller);
    if (slips === null) {
      return;
    }
    const wheels = this.physics.readVehicleWheels(car.controller);
    const surfaces = this.physics.readVehicleWheelSurfaces(car.controller, car.body);
    const motion = planarMotion(car.orientation, this.physics.getLinvel(car.body));
    for (let index = 0; index < Math.min(wheels.length, MAX_WHEELS); index += 1) {
      const fx = wheels[index].contact ? this.classify(surfaces[index] ?? null) : null;
      if (fx === null) {
        this.accumulators[index] = 0; // tarmac (or the air) throws nothing
        continue;
      }
      const slide = equivalentSlideSpeed(slips[index], motion);
      const drive = Math.max(Math.abs(motion.speed), slide * SLIDE_WEIGHT);
      const intensity = Math.min(1, Math.max(0, (drive - DRIVE_START) / (DRIVE_FULL - DRIVE_START)));
      if (intensity <= 0) {
        this.accumulators[index] = 0;
        continue;
      }
      this.accumulators[index] += RATE * intensity * step;
      const count = Math.floor(this.accumulators[index]);
      if (count === 0) {
        continue;
      }
      this.accumulators[index] -= count;
      const point = this.physics.wheelContactPoint(car.controller, index);
      if (point !== null) {
        this.sink({ count, fx, intensity, position: point });
      }
    }
  }
}
