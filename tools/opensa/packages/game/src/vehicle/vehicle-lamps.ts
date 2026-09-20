/**
 * Vehicle lamps — the renderer-agnostic half (plan 074/08 B5 step 5).
 *
 * The three headlight system used to own all of this: deciding WHICH car is lit, where its lamps sit, and
 * how a brake light differs from a running one — tangled together with sprites, materials and uniform
 * arrays. The decision and the geometry are pure; only the drawing is renderer-specific. This module is the
 * pure part, shared by both renderers.
 */
import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { EnterableVehicle } from './enter-vehicle.system';
import type { VehicleQuat } from './vehicle-handle';

/**
 * SA's `eLights` (gta-reversed `DamageManager.h`): which of the four lamps a status refers to. The order is
 * the game's own, not ours — a CLEO script calling `CDamageManager::SetLightStatus` passes exactly these
 * numbers, and collision damage maps its light component group onto the same index.
 */
export type VehicleLight = 0 | 1 | 2 | 3;
export const LIGHT_FRONT_LEFT = 0;
export const LIGHT_FRONT_RIGHT = 1;
export const LIGHT_REAR_RIGHT = 2;
export const LIGHT_REAR_LEFT = 3;
/** SA's `eLights::MAX_LIGHTS` — the bound every index is checked against. */
export const MAX_LIGHTS = 4;
/** Both lamps of an end — a submesh is authored per PAIR, so the mesh glow can only go out per pair. */
export const FRONT_PAIR_MASK = 0b0011;
export const REAR_PAIR_MASK = 0b1100;

/** One lamp of a lit car, in WORLD space (native Z-up) — what a light pool or a corona needs. */
export interface VehicleLamp {
  /** Unit direction the lamp faces (a corona fades out when seen from behind it). */
  facing: [number, number, number];
  kind: 'head' | 'tail';
  /** Which SA lamp this is — the damage status is per lamp, so the beam and corona die one at a time. */
  light: VehicleLight;
  position: Vec3;
}

/** What the lamps of ONE car are doing. Both renderers consume exactly this. */
export interface VehicleLampState {
  /** Brake lights: the tail lamps go from their dim running level to full. */
  brakes: boolean;
  /** Headlights on (SA swaps the lamp texture to its lit twin, and the glass glows). */
  headlights: boolean;
  /** Config glow multiplier (`graphics.headlights.intensity`) — both renderers scale their glow by it. */
  intensity: number;
  /**
   * One bit per {@link VehicleLight}, set = SMASHED. SA keeps the same thing as two bits per lamp in
   * `CDamageManager::m_nLightsStatus`; only OK/SMASHED are ever written, so one bit carries it here.
   */
  smashed: number;
}

/**
 * True when THIS lamp is smashed — it emits no beam, no pool light and no corona. The index is bounds-checked
 * because JS shifts by `light & 31`: an index of 32 arriving from a script would otherwise read lamp 0.
 */
export function isLightSmashed(mask: number, light: number): boolean {
  if (!Number.isInteger(light) || light < 0 || light >= MAX_LIGHTS) {
    return false;
  }

  return (mask & (1 << light)) !== 0;
}

/**
 * The mask with one lamp's status replaced. The index is validated HERE, not by the callers: it arrives
 * from a CLEO script as often as from our own damage code, and a mask that silently grew a fifth bit would
 * only show up as a lamp that can never be lit again.
 */
export function withLightSmashed(mask: number, light: number, smashed: boolean): number {
  if (!Number.isInteger(light) || light < 0 || light >= MAX_LIGHTS) {
    return mask;
  }

  return smashed ? mask | (1 << light) : mask & ~(1 << light);
}

/**
 * A dummy AT the model origin is SA's way of saying the model has no lamp of that kind: a missing dummy
 * simply reads back as (0,0,0) from `CVehicleModelInfo::m_avDummyPos`, and `CVehicle::DoHeadLightBeam`
 * (0x6E0E20) tests exactly that — `if (pointModelSpace.IsZero()) return;`. The bound is float noise
 * against a real anchor (the closest in the stock fleet is 2.4 m from the origin), not a fitted threshold.
 */
const ORIGIN_EPSILON = 1e-6;

/**
 * A car's head/tail lamp anchors in VEHICLE space, or null for an end this model has no lamp at.
 * SA authors one dummy per end and mirrors it to ±X for the left/right lamp.
 *
 * **There is no fallback, deliberately** (plan 098/11). Inventing an anchor from the half-extents gave
 * headlights to every trailer, tow box and aeroplane in the game — 15 stock models that carry no head
 * dummy at all — and put both tail lamps INSIDE the body of any car whose dummy sits at the origin. SA
 * has no such fallback: what the model does not author, the game does not light.
 */
export function lampAnchorsOf(vehicle: EnterableVehicle): { front: null | Vec3; rear: null | Vec3 } {
  const anchor = (kind: 'head' | 'tail'): null | Vec3 => {
    const dummy = vehicle.handle.lampAnchor(kind);

    return dummy && dummy.some((value) => Math.abs(value) > ORIGIN_EPSILON) ? dummy : null;
  };

  return { front: anchor('head'), rear: anchor('tail') };
}

/**
 * The four lamps of a car in world space: each anchor yields a left and a right lamp (mirrored on X).
 * Heads face forward (+Y), tails backward (−Y) — a corona fades out when seen from behind its lamp.
 */
export function lampsOf(vehicle: EnterableVehicle): VehicleLamp[] {
  const { front: head, rear: tail } = lampAnchorsOf(vehicle);
  // The car's FULL orientation, not its heading: a yaw cannot express a car on its roof, and the lamps (and
  // the coronas on them) then float off the body the moment it rolls. Use the DRAWN pose (interpolated, plan
  // 080/03), not the physics one: on the raw fixed-step orientation the coronas twitch against the slerp-drawn
  // body through a turn. Both fall back to the physics pose for a car not yet through a render step.
  const quat = vehicle.renderOrientation ?? vehicle.orientation;
  const origin = vehicle.renderPosition ?? vehicle.position;
  const lamps: VehicleLamp[] = [];
  // Vehicle space is +X right, so the +1 mirror is the RIGHT lamp of its end — which is what pins each of
  // the four to its SA light index. Get this backwards and a script that smashes the left headlight puts
  // out the right one.
  for (const [anchor, kind, right, left] of [
    [head, 'head', LIGHT_FRONT_RIGHT, LIGHT_FRONT_LEFT],
    [tail, 'tail', LIGHT_REAR_RIGHT, LIGHT_REAR_LEFT],
  ] as const) {
    if (!anchor) {
      continue; // this model has no lamp at this end — see lampAnchorsOf
    }
    for (const mirror of [1, -1]) {
      lamps.push({
        facing: rotate([0, kind === 'head' ? 1 : -1, 0], quat),
        kind,
        light: mirror === 1 ? right : left,
        position: add(origin, rotate([anchor[0] * mirror, anchor[1], anchor[2]], quat)),
      });
    }
  }

  return lamps;
}

/**
 * Which car has its lamps on, and how. Occupant-agnostic by design (it asks whether the car is BEING DRIVEN,
 * not whether the player is in it), so NPC traffic drops in unchanged.
 */
export function lampStateFor(
  car: EnterableVehicle | null,
  seated: boolean,
  braking: boolean,
  night: boolean,
  intensity: number,
): { car: EnterableVehicle | null; state: VehicleLampState } {
  const lit = car && seated && night ? car : null;

  return {
    car: lit,
    state: {
      brakes: lit ? braking : false,
      headlights: lit !== null,
      intensity,
      // Damage belongs to the CAR, not to whether it is lit: a car whose lamps are switched off still has
      // its smashed ones, and the renderer must not light them the moment somebody gets in.
      smashed: car?.handle.lightsSmashed() ?? 0,
    },
  };
}

/** Yaw about GTA +Z (the car's heading) as a quaternion. */
/** A yaw-only quaternion — the SEED for a freshly placed car; the physics system replaces it every step. */
export function quatFromHeading(heading: number): VehicleQuat {
  return [0, 0, Math.sin(heading / 2), Math.cos(heading / 2)];
}

function add(a: Vec3, b: [number, number, number]): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function rotate(v: readonly [number, number, number], q: VehicleQuat): [number, number, number] {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  // t = 2 × (q.xyz × v); v' = v + w·t + q.xyz × t
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);

  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}
