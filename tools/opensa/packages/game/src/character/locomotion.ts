/**
 * Shared locomotion constants + pure heading math (plan 088/01).
 *
 * The controller owns a per-player heading (yaw, rad, GTA Z-up) and turns it toward the INTENT
 * direction at a speed-scheduled rate — facing anticipates the move like modern third-person games,
 * while the velocity follows through the accel/decel integrator. The renderer only reads the result.
 */

/** Planar speed (units/s) below which the ped counts as standing — clip choice and heading share it. */
export const IDLE_SPEED_THRESHOLD = 0.3;

/**
 * Jump/fall FSM states the controller writes into `Locomotion.state` (plan 088/04). The renderer maps
 * them to clips; the physics meaning lives entirely in `CharacterControllerSystem.advanceAirState`.
 */
export const LOCOMOTION_GROUNDED = 0;
/** Jump accepted — the anticipation crouch plays; the vertical impulse fires when the delay elapses. */
export const LOCOMOTION_LAUNCH = 1;
/** Airborne FROM A JUMP (rising or falling). */
export const LOCOMOTION_AIRBORNE = 2;
/** Airborne WITHOUT a jump — walked or was knocked off an edge (entered once the coyote window dies). */
export const LOCOMOTION_FALL = 3;
/** Touched down — the recovery beat with reduced control. */
export const LOCOMOTION_LAND = 4;
/** Touched down past the hard-impact threshold — the impact-crouch tier (FALL_land). */
export const LOCOMOTION_HARD_LAND = 5;
/** Touched down past the collapse threshold — goes DOWN (FALL_collapse) and stands back up (getup). */
export const LOCOMOTION_COLLAPSE = 6;
/** Grounded on a slope too steep to stand (088/08) — Rapier slides the capsule, the pose braces. */
export const LOCOMOTION_SLIDE = 7;

/** Intent further than this from the current heading while moving = a reversal: plant, don't pirouette. */
export const REVERSAL_ANGLE = (2 * Math.PI) / 3; // 120°

/** Touchdowns softer than this (units/s) skip the LAND beat entirely — the spawn settle and slope/step
 *  micro-falls must not flash a landing recovery. A real hop off half a metre hits ~3. */
export const LAND_MIN_FALL_SPEED = 1;

const TWO_PI = 2 * Math.PI;
const DEG_TO_RAD = Math.PI / 180;

/** Shortest signed arc from `from` to `to`, in (−π, π]. */
export function angleDelta(from: number, to: number): number {
  let delta = (to - from) % TWO_PI;
  if (delta > Math.PI) {
    delta -= TWO_PI;
  } else if (delta <= -Math.PI) {
    delta += TWO_PI;
  }

  return delta;
}

/** Turn `current` toward `target` along the shortest arc by at most `maxDelta` (rad), snapping when within. */
export function approachAngle(current: number, target: number, maxDelta: number): number {
  if (maxDelta <= 0) {
    return current;
  }
  const delta = angleDelta(current, target);
  if (Math.abs(delta) <= maxDelta) {
    return normalizeAngle(target);
  }

  return normalizeAngle(current + Math.sign(delta) * maxDelta);
}

/**
 * Turn rate (rad/s) scheduled by speed: snappy repositioning near idle (`idleDeg`/s), wide readable
 * arcs at the top tier speed (`fullDeg`/s), lerped between. `fullSpeed` is the top locomotion tier
 * (runSpeed today; the sprint tier once 088/03 lands).
 */
export function scheduledTurnRate(speed: number, fullSpeed: number, idleDeg: number, fullDeg: number): number {
  const t = fullSpeed > 0 ? Math.min(Math.abs(speed) / fullSpeed, 1) : 1;

  return (idleDeg + (fullDeg - idleDeg) * t) * DEG_TO_RAD;
}

/** Yaw (rad) of a GTA planar vector — the renderer's heading convention (`atan2(-x, y)`). */
export function yawFromPlanar(x: number, y: number): number {
  return Math.atan2(-x, y);
}

/** Wrap into (−π, π] so an accumulating heading never drifts away from the principal range. */
function normalizeAngle(angle: number): number {
  let wrapped = angle % TWO_PI;
  if (wrapped > Math.PI) {
    wrapped -= TWO_PI;
  } else if (wrapped <= -Math.PI) {
    wrapped += TWO_PI;
  }

  return wrapped;
}
