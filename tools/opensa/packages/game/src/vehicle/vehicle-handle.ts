/**
 * The renderer-agnostic handle gameplay drives a car through (plan 074/08 B5 step 3).
 *
 * Vehicle logic used to hold three `Object3D` refs — the chassis, the wheel spinners, the door pivots, the
 * `_ok`/`_dam` mesh pairs — and mutate them directly (`.quaternion.copy`, `.visible = false`,
 * `parent.attach()`). The own engine has no scene graph to mutate, so both renderers implement this instead
 * and the logic above it stays identical. Everything crossing this boundary is plain data.
 */
import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { VehicleLampState } from './vehicle-lamps';

/** Distance band a car falls into, near → far. */
export type VehicleBand = 'culled' | 'hd' | 'vlo';

export interface VehicleHandle {
  /**
   * Detach a part into WORLD space: it stops following the car, and the caller integrates its fall. Returns
   * the pose it detached at (native Z-up), or null when the part is unknown.
   */
  detachPart(name: string): null | VehiclePose;
  dispose(): void;
  /** A door's hinge centre in vehicle space — the walk-up routing reads it. */
  doorHinge(side: string): null | Vec3;
  /** True when the model carries a `_vlo` low-detail mesh (else the LOD band stays HD). */
  readonly hasLod: boolean;
  /**
   * True when the model carries a retractable-headlight pod. The lamps ask because a pod car may not LIGHT
   * until its pods stand open — see {@link setPopUpLights} — and every other car must not wait for an arc it
   * does not have.
   */
  readonly hasPopUpLights: boolean;
  /**
   * The `headlights` / `taillights` dummy in vehicle space (SA authors ONE per end and mirrors it), or null
   * when the model has none — the caller then falls back to the half-extents.
   */
  lampAnchor(kind: 'head' | 'tail'): null | Vec3;
  /**
   * Which of this car's four lamps are SMASHED, one bit per SA `eLights` index — SA's
   * `CDamageManager::m_nLightsStatus`, which a CLEO script writes through `SetLightStatus` and collision
   * damage writes from its light component group. A smashed lamp emits nothing.
   */
  lightsSmashed(): number;
  /** Damageable body parts — the damage system's entire world model. */
  readonly parts: readonly VehiclePartInfo[];
  /** Drop a detached part for good. */
  removeDetached(name: string): void;
  /** CLEO natives (plan 097/05): total rig part count — the frame-order sibling walk's bound. */
  scriptPartCount(): number;
  /** CLEO natives: rig part index by frame name (`misc_a`, `dvan_l`…), or null when absent. */
  scriptPartIndex(name: string): null | number;
  /** CLEO natives: the part's CURRENT local rotation (script-absolute; starts at the bind pose). */
  scriptPartLocalRotation(part: number): VehicleQuat;
  /** CLEO natives: the part's CURRENT local translation (script-absolute; starts at the bind pose). */
  scriptPartLocalTranslation(part: number): Vec3;
  /** CLEO natives: REPLACE the part's local rotation (SA's SetRotate* writes the matrix absolutely). */
  scriptSetPartLocalRotation(part: number, quat: VehicleQuat): void;
  /** CLEO natives: REPLACE the part's local translation (the matrix pos writes). */
  scriptSetPartLocalTranslation(part: number, translation: Vec3): void;
  /** Pose a detached part in world space (native Z-up). */
  setDetachedPose(name: string, pose: VehiclePose): void;
  /** Swing a door about its hinge (radians; 0 = closed). */
  setDoorAngle(side: string, angle: number): void;
  /**
   * Lamp state for THIS car. SA swaps the lamp texture to its lit twin and glows the glass; brakes take the
   * tail lamps from their dim running level to full. Per-VEHICLE, not global: only the driven car lights up.
   */
  setLamps(state: VehicleLampState): void;
  /** Set ONE lamp's status. Out-of-range indices are ignored — the caller may be a script. */
  setLightSmashed(light: number, smashed: boolean): void;
  setLodBand(band: VehicleBand): void;
  /** Swap a part between its intact and damaged meshes. */
  setPartDamaged(name: string, damaged: boolean): void;
  /**
   * How far this car's retractable headlights stand open, 0 (parked in the nose) … 1 (facing the road).
   * A model without a pop-up component ignores it, so callers never have to ask whether this car has them.
   */
  setPopUpLights(open: number): void;
  /** Chassis pose from the rigid body (native Z-up). */
  setTransform(position: Vec3, rotation: VehicleQuat): void;
  /** One wheel's pose — a shaped argument on purpose (plan 081/06 §3.3): positional numbers about
   *  different axes are how a sign bug ships. */
  setWheel(index: number, pose: VehicleWheelPose): void;
  readonly wheels: readonly VehicleWheelInfo[];
}

/** A damageable body part: its name and centre in vehicle space (for mapping a hit to the part). */
export interface VehiclePartInfo {
  /** Part name without the `_ok`/`_dam` suffix (e.g. `bonnet`, `door_lf`). */
  name: string;
  position: [number, number, number];
}

export interface VehiclePose {
  position: Vec3;
  rotation: VehicleQuat;
}

/** Quaternion (x, y, z, w). */
export type VehicleQuat = [number, number, number, number];

export interface VehicleWheelInfo {
  /** Front wheels steer; all wheels spin. */
  front: boolean;
  /** Wheel radius in world units (roll = distance / radius). */
  radius: number;
}

/** One wheel's drawn pose. */
export interface VehicleWheelPose {
  /** Lean about the wheel's own FORWARD axis (rad, positive = its top toward the car's +X side) — the axle
   *  the car was authored with decides it (plan 081/06 §3.4). */
  camber: number;
  /** Offset from the model hub along vehicle-local Z (m), negative = dropped — the suspension travel. */
  lift: number;
  /** Roll about the axle (rad). */
  spin: number;
  /** Steer about vehicle up (rad). */
  steer: number;
}
