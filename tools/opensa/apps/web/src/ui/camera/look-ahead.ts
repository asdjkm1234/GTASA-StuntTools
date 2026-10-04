/**
 * Look-ahead (plan 080/03, behaviour #4): the frame leans toward where the player is going, so they sit
 * slightly on the trailing side of the screen with the road ahead in view.
 *
 * It is a lateral offset on the LOOK POINT, which translates the whole rig (eye and target together) — the
 * orbit geometry the collision layer has to defend is untouched, only the composition moves.
 *
 * The offset damps with its own (slow-ish) time so it reads as framing rather than tracking, and it scales
 * with speed: a walk gets a hint, a sprint the full shift. It fades to zero through the same channel when
 * the player stops — never a snap.
 */
import type { CameraConfig } from '@opensa/game';

import { clamp, smoothDamp, type SmoothDampRef } from '@opensa/math';

/** The live offset (engine planar axes) and its spring velocities. */
export interface LookAheadState {
  velocityX: SmoothDampRef;
  velocityZ: SmoothDampRef;
  x: number;
  z: number;
}

export function createLookAhead(): LookAheadState {
  return { velocityX: { velocity: 0 }, velocityZ: { velocity: 0 }, x: 0, z: 0 };
}

/**
 * Step the offset toward the current travel direction and return it.
 *
 * `velocityX/velocityZ` are the framed object's planar velocity in engine space (units/s). Pass zeros and the
 * offset eases back to nothing.
 */
export function stepLookAhead(
  state: LookAheadState,
  velocityX: number,
  velocityZ: number,
  config: CameraConfig,
  dt: number,
): { x: number; z: number } {
  const speed = Math.hypot(velocityX, velocityZ);
  let goalX = 0;
  let goalZ = 0;
  if (speed > config.moveThreshold && config.lookAheadDistance > 0) {
    const factor = clamp(speed / config.lookAheadFullSpeed, 0, 1);
    const reach = config.lookAheadDistance * factor;
    goalX = (velocityX / speed) * reach;
    goalZ = (velocityZ / speed) * reach;
  }
  state.x = smoothDamp(state.x, goalX, state.velocityX, config.lookAheadTime, Number.POSITIVE_INFINITY, dt);
  state.z = smoothDamp(state.z, goalZ, state.velocityZ, config.lookAheadTime, Number.POSITIVE_INFINITY, dt);
  // The cap is a frame guarantee, not a tuning knob: whatever the channels do, the player cannot be pushed
  // out of the safe area by look-ahead alone.
  const offset = Math.hypot(state.x, state.z);
  if (offset > config.lookAheadDistance) {
    const keep = config.lookAheadDistance / offset;
    state.x *= keep;
    state.z *= keep;
  }

  return { x: state.x, z: state.z };
}
