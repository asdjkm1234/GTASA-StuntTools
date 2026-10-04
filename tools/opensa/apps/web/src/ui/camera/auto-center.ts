/**
 * Auto-centering (plan 080/03, behaviours #1 and #6): the camera finding its way behind the player without
 * being asked. Two writers on the yaw, mutually exclusive, both beaten instantly by the mouse:
 *
 * - **turn-follow** (the 036 prod semantics, ported): a fast heading CHANGE swings the camera behind the new
 *   direction and then stops. Walking straight never engages it — a framing the player chose survives a whole
 *   straight run.
 * - **idle recenter** (the GTA V behaviour 036 lacked): after the look has been idle a while AND the player is
 *   actually moving, the yaw eases behind them at a speed-scaled rate. Standing still never recenters — a
 *   parked camera is left alone.
 *
 * Heading here is the GTA facing angle (`Locomotion.heading`: rate-limited and plant-aware on foot, the car's
 * own heading while seated) — NOT an atan2 of the velocity, which jitters at low speed and flips on a strafe.
 */
import type { CameraConfig } from '@opensa/game';

import { angleDelta, clamp, dampAngle } from '@opensa/math';

/** The turn-follow latch needs near-full directional authority — a swing is only ever justified by movement
 *  cleanly AWAY from the camera. Between this and zero the continuous channels fade; the latch is binary. */
const LATCH_AUTHORITY = 0.95;

/** Per-mode switches for one auto-center step. */
export interface AutoCenterOptions {
  /**
   * Directional yaw authority (plan 080/09 §1), 0..1: how much MOVEMENT may rotate the camera this frame —
   * full walking AWAY from it, zero on a strafe or walking toward it (the director derives it from
   * dot(velocity, camera forward)). It scales the idle-recenter rate continuously and gates the latch /
   * continuous chase; a suppressed steer reports `released` so the director drops the in-flight target
   * instead of letting the camera finish a swing the player's direction no longer justifies. Default 1.
   */
  authority?: number;
  /** Chase the target every frame instead of arming a turn-follow latch — the vehicle behaviour. */
  continuous?: boolean;
}

/** What the rig remembers between frames to decide whether it should be steering. */
export interface AutoCenterState {
  /** Turn-follow is engaged: the camera is swinging behind a direction change until it settles. */
  following: boolean;
  /** Seconds since the last look/zoom input. Movement does NOT reset it — only the player's hands do. */
  idleFor: number;
  lastHeading: null | number;
}

/** What one auto-center step decided. `steerTo` writes the 02 spring; `yaw` is the eased idle recenter. */
export interface AutoCenterStep {
  /** The directional authority SUPPRESSED an in-flight steer this frame: the director must drop the steered
   *  target too, or the camera finishes a swing the player's movement no longer justifies. Distinct from a
   *  natural settle, which keeps the target so the fine end of the swing stays smooth. */
  released?: boolean;
  /** A yaw for the steered channel, or null when nothing is steering this frame. */
  steerTo: null | number;
  /** The yaw after an idle recenter (unchanged when the recenter is not running). */
  yaw: number;
}

/**
 * The (heading, pitch) that AIMS at a GTA world point from another — `?look`'s math, and the inverse of
 * {@link yawBehind}: the camera looks along (sin yaw, −cos yaw), so `yaw = atan2(dx, −dy)` and the heading
 * that puts the camera behind a ped facing the same way is `yaw − π`. Seeding the PED with it is what stops
 * auto-centre undoing the aim.
 *
 * Pitch is the rig's own sign (positive = up) and ignores the eye's offset behind the ped: the knob exists
 * for LOD-range field checks, where a few metres of follow distance is far below one pixel. Degenerate input
 * (aiming at the spot you stand on) yields pitch 0 rather than a NaN from `atan2(0, 0)`'s sibling cases.
 */
export function aimAt(
  from: readonly [number, number, number],
  target: readonly [number, number, number],
): { heading: number; pitch: number } {
  const dx = target[0] - from[0];
  const dy = target[1] - from[1];
  const flat = Math.hypot(dx, dy);

  return {
    heading: Math.atan2(dx, -dy) - Math.PI,
    pitch: flat > 0 ? Math.atan2(target[2] - from[2], flat) : 0,
  };
}

/** The mouse takes the camera back: the swing stops, and the idle clock restarts from zero. */
export function cancelAutoCenter(state: AutoCenterState): void {
  state.following = false;
  state.idleFor = 0;
}

export function createAutoCenter(): AutoCenterState {
  return { following: false, idleFor: 0, lastHeading: null };
}

/**
 * Step the auto-center logic for one frame.
 *
 * `speed` is the framed object's planar speed in units/s, `heading` its facing. Both channels are gated on
 * real movement (`moveThreshold`), so a player standing still is never rotated.
 */
export function stepAutoCenter(
  state: AutoCenterState,
  yaw: number,
  heading: number,
  speed: number,
  config: CameraConfig,
  dt: number,
  options: AutoCenterOptions = {},
): AutoCenterStep {
  state.idleFor += dt;
  const moving = speed > config.moveThreshold;
  const previous = state.lastHeading;
  // A stationary character must not drift the tracker: heading is only sampled while they are moving.
  if (moving) {
    state.lastHeading = heading;
  } else {
    state.lastHeading = null;
    state.following = false;
  }
  if (!moving || dt <= 0) {
    return { steerTo: null, yaw };
  }
  const authority = options.authority ?? 1;
  const behind = yawBehind(heading);
  // Driving: the camera chases the car's rear CONTINUOUSLY, with no arm/settle latch. The latch is what
  // made a long corner read as a series of jerks — it disarms the moment the camera is within
  // `settleEpsilon`, which zeroes the swing spring's velocity, then re-arms a frame later and starts the
  // swing again from a standstill. On foot the latch is right (a framing the player chose must survive a
  // straight run); in a car, hands-off following IS the behaviour. Zero authority (reversing — the framed
  // object drives AT the camera) suppresses the chase and releases the in-flight target.
  if (options.continuous) {
    return authority <= 0 ? { released: true, steerTo: null, yaw } : { steerTo: behind, yaw };
  }
  // The latch demands near-full authority (moving cleanly AWAY): a sharp turn into a strafe must not start
  // a swing, and one already swinging stops the moment the movement stops justifying it (plan 080/09 §1 —
  // on foot "movement never turns the camera" except easing behind a walk away).
  const suppressed = authority < LATCH_AUTHORITY;
  if (state.following && suppressed) {
    state.following = false;

    return { released: true, steerTo: null, yaw };
  }
  const turnRate = previous === null ? 0 : Math.abs(angleDelta(previous, heading)) / dt;
  const grace = state.idleFor < config.manualGraceSec;
  if (!grace && !suppressed && turnRate > config.turnThreshold) {
    state.following = true;
  }
  if (state.following) {
    if (Math.abs(angleDelta(yaw, behind)) < config.settleEpsilon) {
      state.following = false;

      return { steerTo: null, yaw };
    }

    return { steerTo: behind, yaw };
  }
  if (state.idleFor <= config.recenterDelaySec) {
    return { steerTo: null, yaw };
  }
  // Idle recenter is a RATE, not a fixed-time spring: that is what lets a walk barely drift home while a
  // sprint commits (the speed factor scales the rate directly). The directional authority scales the same
  // rate — full behind a walk away, zero on a strafe — so the rotation FADES with direction, never steps.
  const factor = clamp(speed / config.lookAheadFullSpeed, 0, 1);

  return { steerTo: null, yaw: dampAngle(yaw, behind, config.recenterRate * factor * authority, dt) };
}

/**
 * The camera yaw that frames a character facing `heading` from behind.
 *
 * Convention (the one the host's vehicle spawn already documents): in GTA space the camera looks along
 * (sin yaw, −cos yaw) and a heading h points along (−sin h, cos h), so the two agree at `yaw = h + π`.
 */
export function yawBehind(heading: number): number {
  return heading + Math.PI;
}
