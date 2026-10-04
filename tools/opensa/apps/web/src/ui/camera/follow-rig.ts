/**
 * The follow rig's LOOK POINT (plan 080/02, behaviours #2 and #3): the camera does not orbit the player, it
 * orbits a smoothed point that trails the player.
 *
 * Three channels, deliberately at different rates:
 * - planar (x/z) — a critically damped spring, `positionLagTime`: this is the weight. A hard direction
 *   change leaves the character leading the frame for a beat, then the frame eases back around them.
 * - vertical (y) — exponential, `verticalLagTime`, slower on purpose: stairs, curbs and jump arcs must not
 *   jolt the horizon.
 * - a soft DEAD ZONE under `deadZone` units, so idle breathing and physics micro-jitter move nothing.
 *
 * Two floors keep "cinematic" from becoming "unresponsive": the look point may never trail the focus by more
 * than `lagMaxDistance`, and a focus jump beyond `teleportSnapDistance` is treated as a teleport (snap, not
 * a flight across the map).
 */
import type { CameraConfig } from '@opensa/game';

import { clamp, damp, smoothDamp, type SmoothDampRef } from '@opensa/math';

/** The smoothed point the rig frames, plus its spring velocities. Null until the first frame seeds it. */
export interface FollowPointState {
  point: [number, number, number] | null;
  velocityX: SmoothDampRef;
  velocityZ: SmoothDampRef;
}

export function createFollowPoint(): FollowPointState {
  return { point: null, velocityX: { velocity: 0 }, velocityZ: { velocity: 0 } };
}

/** Drop the smoothing for one frame — the next step lands exactly on the target (teleports, mode entry). */
export function resetFollowPoint(state: FollowPointState): void {
  state.point = null;
  state.velocityX.velocity = 0;
  state.velocityZ.velocity = 0;
}

/**
 * Step the look point toward `target` (the focus already raised by `followHeight`) and return it.
 *
 * `smoothing = false` makes the point BE the target — what every mode that should not lag (the free-fly eye)
 * gets.
 */
export function stepFollowPoint(
  state: FollowPointState,
  target: readonly [number, number, number],
  config: CameraConfig,
  dt: number,
  smoothing: boolean,
): [number, number, number] {
  const jumped =
    state.point !== null &&
    distance(state.point, target) > config.teleportSnapDistance &&
    config.teleportSnapDistance > 0;
  if (!smoothing || state.point === null || jumped) {
    resetFollowPoint(state);
    state.point = [target[0], target[1], target[2]];

    return state.point;
  }
  const point = state.point;
  const planarX = target[0] - point[0];
  const planarZ = target[2] - point[2];
  const planar = Math.hypot(planarX, planarZ);
  const pull = deadZonePull(planar, config.deadZone);
  // Spring toward the dead-zone-relieved goal, per axis: two 1-D springs on the same lag time behave as one
  // planar spring, and each keeps its own velocity across frames.
  const goalX = point[0] + planarX * pull;
  const goalZ = point[2] + planarZ * pull;
  point[0] = smoothDamp(point[0], goalX, state.velocityX, config.positionLagTime, Number.POSITIVE_INFINITY, dt);
  point[2] = smoothDamp(point[2], goalZ, state.velocityZ, config.positionLagTime, Number.POSITIVE_INFINITY, dt);
  const verticalPull = deadZonePull(Math.abs(target[1] - point[1]), config.deadZone);
  point[1] = damp(point[1], point[1] + (target[1] - point[1]) * verticalPull, lambdaOf(config.verticalLagTime), dt);
  clampLag(point, target, config.lagMaxDistance);

  return point;
}

/** The responsiveness floor: pull the point onto the trailing boundary if the spring fell too far behind. */
function clampLag(point: [number, number, number], target: readonly [number, number, number], maxLag: number): void {
  if (maxLag <= 0) {
    return;
  }
  const behind = distance(point, target);
  if (behind <= maxLag) {
    return;
  }
  const keep = maxLag / behind;
  point[0] = target[0] + (point[0] - target[0]) * keep;
  point[1] = target[1] + (point[1] - target[1]) * keep;
  point[2] = target[2] + (point[2] - target[2]) * keep;
}

/**
 * How much of an error of magnitude `error` the rig may act on, 0..1.
 *
 * Inside the dead zone: nothing. Above it the relief fades out over two more dead-zone widths (smoothstep),
 * so there is no kink at the edge and no permanent offset once the player is genuinely moving.
 */
function deadZonePull(error: number, deadZone: number): number {
  if (deadZone <= 0) {
    return 1;
  }
  if (error <= deadZone) {
    return 0;
  }
  const t = clamp((error - deadZone) / (deadZone * 2), 0, 1);

  return t * t * (3 - 2 * t);
}

function distance(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** A lag TIME reads better in config than a lambda; the exponential channels want the lambda. */
function lambdaOf(lagTime: number): number {
  return lagTime > 0 ? 1 / lagTime : Number.POSITIVE_INFINITY;
}
