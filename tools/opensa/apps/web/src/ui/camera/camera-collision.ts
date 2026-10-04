/**
 * Camera collision (plan 080/04, behaviour #9): the eye must never sit behind a wall from the look point.
 *
 * The layer runs on the FINAL rig pose (after the follow/mode layers, before additive motion) and only CAPS
 * the distance — the zoom state is preserved, so the chosen distance is restored the moment the occlusion
 * clears, exactly as GTA restores your distance after a tunnel.
 *
 * Response is deliberately ASYMMETRIC, the industry standard: pulling IN is instant (a wall between the
 * camera and the player is never shown, not even for one frame); easing OUT is damped, so leaving a doorway
 * glides instead of popping. Whisker casts (±`collisionWhiskerAngle` around the eye direction) start the
 * pull-in BEFORE the wall edge crosses screen centre, which reads as "the camera avoids the wall".
 *
 * A `CameraProbe` is injected (the 080/01 contract) so this is pure and unit-testable; the host passes the
 * real `PhysicsWorld` sphere cast, the tests script hit distances.
 */
import type { CameraConfig } from '@opensa/game';

import { damp } from '@opensa/math';

/** One sphere cast from `fromGta` toward `dirGta` (both GTA Z-up): the free distance and whether the hit
 *  can MOVE (a car, a ped — anything not fixed world geometry), or null for a clear cast. */
export type CameraProbe = (
  fromGta: readonly [number, number, number],
  dirGta: readonly [number, number, number],
  radius: number,
  maxDist: number,
) => null | { dist: number; dynamic: boolean };

/** The ground Z below a GTA point (or null) — the floor guard lifts the eye off it on a steep down-pitch. */
export type GroundProbe = (atGta: readonly [number, number, number]) => null | number;

/** How far the eye is kept above the ground when the floor guard lifts it (world units). */
const FLOOR_MARGIN = 0.3;

/** The collision layer's live state — the damped, currently-shown distance. */
export interface CollisionState {
  /** The distance actually rendered last frame (eases out; snaps in). */
  shown: number;
}

export function createCollisionState(distance: number): CollisionState {
  return { shown: distance };
}

/** GTA Z-up from engine Y-up: `(x, y, z) → (x, −z, y)` — the inverse the host uses at the render boundary. */
export function gtaFromEngine(v: readonly [number, number, number]): [number, number, number] {
  return [v[0], -v[2], v[1]];
}

/**
 * The eye (engine Y-up) lifted so it never sinks below the ground beneath it — a steep down-pitch on a slope
 * or a raised porch otherwise buries the camera and the near plane shows only skybox. Returns the same eye
 * when no lift is needed (or there is no probe).
 */
export function guardFloor(
  eye: readonly [number, number, number],
  groundProbe: GroundProbe | null,
): [number, number, number] {
  if (groundProbe === null) {
    return [eye[0], eye[1], eye[2]];
  }
  const groundZ = groundProbe(gtaFromEngine(eye));
  const minY = groundZ === null ? -Infinity : groundZ + FLOOR_MARGIN; // engine Y is GTA Z (up)

  return [eye[0], Math.max(eye[1], minY), eye[2]];
}

/**
 * Cap `desiredDistance` so the eye clears geometry between the look point and the eye.
 *
 * `lookPointEngine` is the orbit centre (head height — by definition outside geometry); `dirEngine` is the
 * unit vector from the look point toward the eye (engine space). Returns the distance to render this frame.
 *
 * The floor is `collisionMinDistance` (the near-plane radius): a wall closer than that pulls the eye right up
 * to the surface — it may sit inside the ped for a frame, but it never slides BEHIND the wall (which reads far
 * worse) and it never stalls.
 */
export function resolveCollision(
  state: CollisionState,
  lookPointEngine: readonly [number, number, number],
  dirEngine: readonly [number, number, number],
  desiredDistance: number,
  config: CameraConfig,
  probe: CameraProbe | null,
  dt: number,
  eased = false,
): number {
  if (probe === null || config.collisionRadius <= 0) {
    state.shown = desiredDistance;

    return desiredDistance;
  }
  const fromGta = gtaFromEngine(lookPointEngine);
  let binding = castDistance(probe, fromGta, dirEngine, 0, config, desiredDistance);
  if (config.collisionWhiskerAngle > 0) {
    // Whiskers ease the pull-in in early: take the min of the primary and the two flanking casts.
    for (const angle of [config.collisionWhiskerAngle, -config.collisionWhiskerAngle]) {
      const whisker = castDistance(probe, fromGta, dirEngine, angle, config, desiredDistance);
      if (whisker.allowed < binding.allowed) {
        binding = whisker;
      }
    }
  }
  // Never closer than the near-plane radius (below it the near plane renders from inside geometry).
  const allowed = Math.max(binding.allowed, Math.min(desiredDistance, config.collisionMinDistance));
  const lambdaOut = config.collisionReleaseTime > 0 ? 1 / config.collisionReleaseTime : Number.POSITIVE_INFINITY;
  // This layer only ever holds the eye CLOSER than desired (occlusion); a FALLING desired distance is the
  // zoom channel's own glide, already smoothed, and is followed directly. Treating it as a pull-in sent it
  // down the eased path during a seat sequence, where it lagged the glide — and the sequence's end then
  // completed the leftover difference as a SNAP (the 09 field round's entry jump: approach, then the
  // camera slams the rest of the way onto the car).
  state.shown = Math.min(state.shown, desiredDistance);
  // Snap IN (a wall is never shown a single frame); ease OUT so leaving a doorway glides.
  //
  // `eased` drops the snap for BOTH directions. It is what a scripted enter/exit runs: the cap has to stay
  // on there (without it the camera stops sliding along surfaces and can sink through the ground — the eye
  // is under the floor before the guard's downward probe can see it), but an instant pull-in mid-animation
  // reads as a jump, which is what the 04 field round rejected. Easing in satisfies both: the camera keeps
  // clearing geometry, and it never snaps while the sequence plays.
  //
  // A DYNAMIC hit takes the eased path too (plan 09 §4.2): a traffic car or ped crossing the focus→eye
  // line is not a wall about to be shown — an instant yank there reads as an unexplained camera jump, the
  // exact class the 09 brief reported. Static geometry keeps the snap; nothing shows a wall for a frame.
  if (allowed < state.shown) {
    state.shown = eased || binding.dynamic ? damp(state.shown, allowed, lambdaOut, dt) : allowed;
  } else {
    state.shown = damp(state.shown, allowed, lambdaOut, dt);
  }

  return state.shown;
}

/** One cast at `yawOffset` around the eye direction (yaw about the engine up axis), capped at `desired`. */
function castDistance(
  probe: CameraProbe,
  fromGta: readonly [number, number, number],
  dirEngine: readonly [number, number, number],
  yawOffset: number,
  config: CameraConfig,
  desired: number,
): { allowed: number; dynamic: boolean } {
  const dirGta = gtaFromEngine(rotateYaw(dirEngine, yawOffset));
  // Cast a touch past the desired eye so a wall exactly at the eye still registers.
  const hit = probe(fromGta, dirGta, config.collisionRadius, desired + config.collisionRadius);
  if (hit === null || hit.dist >= desired) {
    return { allowed: desired, dynamic: false };
  }

  return { allowed: hit.dist, dynamic: hit.dynamic };
}

/** Rotate an engine-space vector about the up (Y) axis by `angle` — the whisker spread lives in the yaw plane. */
function rotateYaw(v: readonly [number, number, number], angle: number): [number, number, number] {
  if (angle === 0) {
    return [v[0], v[1], v[2]];
  }
  const c = Math.cos(angle);
  const s = Math.sin(angle);

  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
}
