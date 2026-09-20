import { Quaternion, Vector3 } from '@opensa/math';

import type { System } from '../core/system';
import type { Logger } from '../diagnostics/logger';
import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { Impact, PhysicsWorld } from '../physics/physics-world';
import type { VehicleHandle, VehiclePartInfo } from './vehicle-handle';

/** Contact force (N) above which a hit damages a panel (calibrated in-browser: light≈207k, crash≈377k).
 *  Exported since 089/04: the impact-smoke sink scales its puff off the same gate. */
export const STRONG_HIT = 300000;
/** Seconds a detached part falls before it disappears. */
const FALL_TTL = 1.5;
/** Gravity for falling parts (GTA Z-up). */
const FALL_GRAVITY = -9.81;
/** Initial knock applied to a detached part (m/s): up + outward + tumble. */
const FALL_UP = 1.5;
const FALL_OUT = 1.5;
const FALL_SPIN = 6;

/** Tumble axes (a detached part's own frame). */
const AXIS_X = new Vector3(1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);

interface DamageVehicle {
  body: number;
  damaged: Set<VehiclePartInfo>;
  handle: VehicleHandle;
  parts: VehiclePartInfo[];
}

/**
 * A detached part, integrated as PLAIN DATA and posed through the handle each frame. Prod re-parented the
 * three node into the scene graph and let the graph carry it; the own engine has no graph, so the fall lives
 * here and the renderer only receives a world pose.
 */
interface FallingPart {
  handle: VehicleHandle;
  name: string;
  position: Vector3;
  rotation: Quaternion;
  spin: Vector3;
  ttl: number;
  velocity: Vector3;
}

/**
 * Collision damage: on a strong impact, the body part nearest the hit swaps to its
 * `_dam` mesh; a second strong hit on an already-damaged part detaches it (it falls
 * to the ground and is removed after {@link FALL_TTL}). Impacts come from the
 * physics contact-force events ({@link PhysicsWorld.takeImpacts}).
 */
export class VehicleDamageSystem implements System {
  readonly name = 'vehicle-damage';

  /**
   * Fired for every impact that passes the strong-hit gate on a REGISTERED vehicle — the same event that
   * deforms a panel, so a kerb tap can never reach it. The impact smoke rides this (089/04): it lives here
   * because `takeImpacts` DRAINS and this system is its sole consumer — a second listener would race it.
   */
  onStrongHit: ((force: number, point: Vec3) => void) | null = null;

  private readonly dir = new Vector3();
  private readonly falling: FallingPart[] = [];
  private readonly logger: Logger;
  /** Hardest contact force per body this frame — see {@link peakImpact}. */
  private readonly peakForce = new Map<number, number>();
  private readonly physics: PhysicsWorld;
  private readonly quat = new Quaternion();
  private readonly vehicles: DamageVehicle[] = [];

  constructor(physics: PhysicsWorld, logger: Logger) {
    this.physics = physics;
    this.logger = logger;
  }

  add(vehicle: { body: number; handle: VehicleHandle }): void {
    this.vehicles.push({
      body: vehicle.body,
      damaged: new Set(),
      handle: vehicle.handle,
      parts: [...vehicle.handle.parts],
    });
  }

  /**
   * The hardest contact force this body took in the last {@link update} (0 = none) — the camera's impact
   * shake reads it (plan 080/06).
   *
   * It lives here because `physics.takeImpacts()` DRAINS: a second listener would race this one for the same
   * events and one of them would see nothing. Note this is every contact, not only the `STRONG_HIT` ones
   * that damage a panel — the camera reacts to kerbs and scrapes the bodywork shrugs off.
   */
  peakImpact(body: number): number {
    return this.peakForce.get(body) ?? 0;
  }

  remove(body: number): void {
    const index = this.vehicles.findIndex((v) => v.body === body);
    if (index >= 0) {
      this.vehicles.splice(index, 1);
    }
  }

  update(delta: number): void {
    // One state change per part per frame: a multi-contact crash shouldn't deform AND
    // detach the same panel in the same instant.
    const touched = new Set<VehiclePartInfo>();
    this.peakForce.clear();
    for (const impact of this.physics.takeImpacts()) {
      this.recordPeak(impact);
      this.handleImpact(impact, touched);
    }
    this.advanceFalling(delta);
  }

  /** Advance detached parts: gravity + tumble, then remove once their time is up. */
  private advanceFalling(delta: number): void {
    for (let i = this.falling.length - 1; i >= 0; i -= 1) {
      const part = this.falling[i];
      part.velocity.z += FALL_GRAVITY * delta;
      part.position.addScaledVector(part.velocity, delta);
      // Tumble about the part's OWN axes, in x-y-z order — three's rotateX/Y/Z, which this replaces.
      for (const [axis, rate] of [
        [AXIS_X, part.spin.x],
        [AXIS_Y, part.spin.y],
        [AXIS_Z, part.spin.z],
      ] as const) {
        this.quat.setFromAxisAngle(axis, rate * delta);
        part.rotation.multiply(this.quat);
      }
      part.handle.setDetachedPose(part.name, {
        position: [part.position.x, part.position.y, part.position.z],
        rotation: [part.rotation.x, part.rotation.y, part.rotation.z, part.rotation.w],
      });
      part.ttl -= delta;
      if (part.ttl <= 0) {
        part.handle.removeDetached(part.name);
        this.falling.splice(i, 1);
      }
    }
  }

  /** Detach a damaged part: cut it loose in world space, knock it, schedule removal. */
  private detach(car: DamageVehicle, part: VehiclePartInfo): void {
    car.parts = car.parts.filter((p) => p !== part);
    car.damaged.delete(part);
    const pose = car.handle.detachPart(part.name);
    if (!pose) {
      return;
    }
    this.falling.push({
      handle: car.handle,
      name: part.name,
      position: new Vector3(...pose.position),
      rotation: new Quaternion(...pose.rotation),
      spin: new Vector3(rand(FALL_SPIN), rand(FALL_SPIN), rand(FALL_SPIN)),
      ttl: FALL_TTL,
      velocity: new Vector3(rand(FALL_OUT), rand(FALL_OUT), FALL_UP),
    });
  }

  private handleImpact(impact: Impact, touched: Set<VehiclePartInfo>): void {
    // Every contact force, gated to `debug` — turn on `showLogs: 'debug'` to recalibrate STRONG_HIT.
    this.logger.debug('damage', `impact force=${impact.force.toFixed(0)}`, impact);
    if (impact.force < STRONG_HIT || !impact.point) {
      return;
    }
    const car = this.vehicles.find((v) => v.body === impact.bodyA || v.body === impact.bodyB);
    if (!car) {
      return;
    }
    this.onStrongHit?.(impact.force, impact.point);
    const part = this.hitPart(car, impact.point);
    if (!part || touched.has(part)) {
      return;
    }
    touched.add(part);
    if (car.damaged.has(part)) {
      this.detach(car, part); // already damaged → second hit knocks it off
      this.logger.log('damage', `detach ${part.name}`, { force: impact.force, part: part.name });
    } else {
      car.handle.setPartDamaged(part.name, true);
      car.damaged.add(part);
      this.logger.log('damage', `deform ${part.name}`, { force: impact.force, part: part.name });
    }
  }

  /** The damageable part nearest the world-space contact point (mapped into the car's frame). */
  private hitPart(car: DamageVehicle, worldPoint: Vec3): null | VehiclePartInfo {
    const { position, quaternion } = this.physics.readBody(car.body);
    this.quat.set(quaternion[0], quaternion[1], quaternion[2], quaternion[3]).invert();
    // World contact point → car-local space (so we compare against parts' vehicle-space positions).
    this.dir.set(worldPoint[0] - position[0], worldPoint[1] - position[1], worldPoint[2] - position[2]);
    this.dir.applyQuaternion(this.quat);

    let best: null | VehiclePartInfo = null;
    let bestDistance = Infinity;
    for (const part of car.parts) {
      const dx = part.position[0] - this.dir.x;
      const dy = part.position[1] - this.dir.y;
      const dz = part.position[2] - this.dir.z;
      const distance = dx * dx + dy * dy + dz * dz;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = part;
      }
    }

    return best;
  }

  /** Keep the hardest force per body for this frame. */
  private recordPeak(impact: Impact): void {
    for (const body of [impact.bodyA, impact.bodyB]) {
      if (body !== null && impact.force > (this.peakForce.get(body) ?? 0)) {
        this.peakForce.set(body, impact.force);
      }
    }
  }
}

/** A random value in [-magnitude, +magnitude]. */
function rand(magnitude: number): number {
  return (Math.random() * 2 - 1) * magnitude;
}
