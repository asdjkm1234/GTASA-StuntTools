import { lerp, Quaternion, Vector3 } from '@opensa/math';

import type { System } from '../core/system';
import type { PhysicsWorld } from '../physics/physics-world';
import type { EnterableVehicle } from './enter-vehicle.system';

/** Vehicle forward in model space (GTA cars face +Y). */
const FORWARD = new Vector3(0, 1, 0);
/** Below this forward speed (m/s) the wheels are treated as still (no jitter-roll at rest). */
const ROLL_DEADZONE = 0.1;

/** The last two fixed-step poses of one car, for render interpolation. */
interface CarInterp {
  curPos: [number, number, number];
  curQuat: [number, number, number, number];
  prevPos: [number, number, number];
  prevQuat: [number, number, number, number];
}

/**
 * Owns the dynamic (raycast) vehicles. It runs in two halves so the DRAWN car is smooth even though physics
 * steps at a fixed rate while the frame draws in the variable loop (plan 080/03):
 *
 * - {@link snapshot} runs in the host's fixed loop, AFTER the physics step. It reads each body, keeps the
 *   pose from before and after this step, writes the GAMEPLAY state (`position`/`heading`/`orientation`, read
 *   by the enter/seat logic) and rolls the wheels from real displacement.
 * - {@link render} runs once per frame with the fixed-step `alpha`. It interpolates the last two poses into
 *   `renderPosition` and pushes that to the renderer — so the car, and the camera that follows it, glide.
 *
 * The physics step itself (incl. `updateVehicle`) runs in {@link PhysicsWorld.step}.
 */
export class VehiclePhysicsSystem implements System {
  readonly name = 'vehicle-physics';

  private readonly forward = new Vector3();
  private readonly interp = new Map<EnterableVehicle, CarInterp>();
  /** Previous planar position per car, for displacement-based wheel roll. */
  private readonly lastPlanar = new Map<EnterableVehicle, [number, number]>();
  private readonly physics: PhysicsWorld;
  private readonly quaternion = new Quaternion();
  private readonly vehicles: EnterableVehicle[] = [];

  constructor(physics: PhysicsWorld) {
    this.physics = physics;
  }

  add(vehicle: EnterableVehicle): void {
    this.vehicles.push(vehicle);
    this.lastPlanar.set(vehicle, [vehicle.position[0], vehicle.position[1]]);
    const pos: [number, number, number] = [vehicle.position[0], vehicle.position[1], vehicle.position[2]];
    const quat: [number, number, number, number] = [...vehicle.orientation];
    this.interp.set(vehicle, { curPos: [...pos], curQuat: [...quat], prevPos: [...pos], prevQuat: [...quat] });
  }

  remove(vehicle: EnterableVehicle): void {
    const index = this.vehicles.indexOf(vehicle);
    if (index >= 0) {
      this.vehicles.splice(index, 1);
    }
    this.lastPlanar.delete(vehicle);
    this.interp.delete(vehicle);
  }

  /** Draw each car at the interpolated pose (`alpha` = fraction into the next fixed step). */
  render(alpha: number): void {
    for (const car of this.vehicles) {
      const state = this.interp.get(car);
      if (!state) {
        continue;
      }
      const px = lerp(state.prevPos[0], state.curPos[0], alpha);
      const py = lerp(state.prevPos[1], state.curPos[1], alpha);
      const pz = lerp(state.prevPos[2], state.curPos[2], alpha);
      const q = slerp(state.prevQuat, state.curQuat, alpha);
      car.renderPosition[0] = px;
      car.renderPosition[1] = py;
      car.renderPosition[2] = pz;
      car.renderOrientation[0] = q[0];
      car.renderOrientation[1] = q[1];
      car.renderOrientation[2] = q[2];
      car.renderOrientation[3] = q[3];
      car.handle.setTransform([px, py, pz], q);
    }
  }

  /** Fixed step: sample the bodies, keep prev/cur for interpolation, write the gameplay pose, roll wheels. */
  snapshot(delta: number): void {
    for (const car of this.vehicles) {
      const { position, quaternion } = this.physics.readBody(car.body);
      const state = this.interp.get(car);
      if (state) {
        state.prevPos = state.curPos;
        state.prevQuat = state.curQuat;
        state.curPos = [position[0], position[1], position[2]];
        state.curQuat = [quaternion[0], quaternion[1], quaternion[2], quaternion[3]];
      }
      car.position[0] = position[0];
      car.position[1] = position[1];
      car.position[2] = position[2];
      car.orientation[0] = quaternion[0];
      car.orientation[1] = quaternion[1];
      car.orientation[2] = quaternion[2];
      car.orientation[3] = quaternion[3];
      this.quaternion.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
      // Heading about Z from the body's forward (+Y) projected onto the ground plane.
      this.forward.copy(FORWARD).applyQuaternion(this.quaternion);
      car.heading = Math.atan2(-this.forward.x, this.forward.y);

      // The drawn wheels follow the physics suspension (plan 081/06 §3): offset from the model hub =
      // the connection's lift minus the live spring length. The rig smooths it against raycast jitter.
      const lengths = this.physics.suspensionLengths(car.controller);
      car.rig.setLift(lengths.map((length, index) => (car.wheelLift[index] ?? 0) - length));
      // …and WHETHER each wheel is on anything: a wheel in the air turns with the engine, not with the car.
      car.rig.setContacts(this.physics.wheelContacts(car.controller));

      this.rollWheels(car, position, delta);
    }
  }

  /**
   * Roll the wheels from the car's real planar displacement (signed by forward).
   * This is immune to the phantom rigid-body velocity the raycast controller writes
   * while resting, so parked cars keep their wheels still.
   */
  private rollWheels(car: EnterableVehicle, position: readonly number[], delta: number): void {
    const last = this.lastPlanar.get(car) ?? [position[0], position[1]];
    const dx = position[0] - last[0];
    const dy = position[1] - last[1];
    last[0] = position[0];
    last[1] = position[1];
    this.lastPlanar.set(car, last);

    const distance = Math.hypot(dx, dy);
    const forward = dx * this.forward.x + dy * this.forward.y >= 0 ? 1 : -1;
    const speed = delta > 0 ? (forward * distance) / delta : 0;
    car.rig.setSpeed(Math.abs(speed) < ROLL_DEADZONE ? 0 : speed);
    car.rig.update(delta);
  }
}

function normalizeQuat(q: [number, number, number, number]): [number, number, number, number] {
  const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;

  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

/** Nearest-arc quaternion interpolation (flip the sign on the far arc), then normalise. */
function slerp(
  a: readonly [number, number, number, number],
  b: readonly [number, number, number, number],
  t: number,
): [number, number, number, number] {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sign = dot < 0 ? -1 : 1;
  dot *= sign;
  // Near-parallel: a plain lerp is within float noise and avoids the sin(θ)→0 blow-up.
  if (dot > 0.9995) {
    return normalizeQuat([
      a[0] + (b[0] * sign - a[0]) * t,
      a[1] + (b[1] * sign - a[1]) * t,
      a[2] + (b[2] * sign - a[2]) * t,
      a[3] + (b[3] * sign - a[3]) * t,
    ]);
  }
  const theta = Math.acos(dot);
  const sinTheta = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sinTheta;
  const wb = (Math.sin(t * theta) / sinTheta) * sign;

  return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb, a[3] * wa + b[3] * wb];
}
