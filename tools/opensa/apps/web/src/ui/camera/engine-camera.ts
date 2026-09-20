/**
 * Camera resolution for the own-engine host (074/22): who owns the eye this frame, plus the screen basis the
 * viewer picks and pans through. Pure math, kept out of `engine-canvas-host` so the frame loop stays readable
 * and every rule is unit-testable (the host itself is browser-only glue).
 *
 * The rig that PRODUCES eye/target lives in `camera-director.ts` (plan 080/01); this file stays the last step
 * — the priority rule — so the bench bypass is one branch in one place.
 */
import type { CameraState } from '@opensa/engine';

/** Default vertical field of view of the rig. The director carries it as a value (plan 080/05 animates it). */
export const CAMERA_FOV_Y = Math.PI / 3;

/**
 * A frame owned by video mode's director (096/03) — engine Y-up, like the bench's. `fovYRad` is optional: a
 * shot that does not choose a lens keeps the rig's live one, so an omitted field is never a hidden 60°.
 */
export interface VideoCamera {
  eye: [number, number, number];
  fovYRad?: number;
  target: [number, number, number];
}

/**
 * Prod's K+M chord (`canvas-host`, verbatim semantics): the toggle fires ONCE while both keys are held —
 * key repeat cannot re-fire it — and re-arms only after one of them is released.
 */
export function createChordWatcher(
  first: string,
  second: string,
): { down(code: string): boolean; up(code: string): void } {
  let firstDown = false;
  let secondDown = false;
  let fired = false;

  return {
    down(code: string): boolean {
      firstDown ||= code === first;
      secondDown ||= code === second;
      if (firstDown && secondDown && !fired) {
        fired = true;

        return true;
      }

      return false;
    },
    up(code: string): void {
      if (code === first || code === second) {
        firstDown = firstDown && code !== first;
        secondDown = secondDown && code !== second;
        fired = false;
      }
    },
  };
}

/**
 * The world-space ray direction through a CURSOR position (NDC, y up) — what the map viewer picks along.
 *
 * The gameplay camera picks along its own forward because the pointer is locked and the crosshair IS the aim.
 * The map viewer has no pointer lock, so the cursor is the aim and a forward-vector pick would select whatever
 * happens to sit at screen centre instead of what the user clicked.
 *
 * `fovYRad` is the FOV the frame was RENDERED with (the director's output) — a ray built on any other value
 * lands off-target the moment the rig starts animating it (plan 080/05).
 */
export function cursorRay(
  forward: readonly [number, number, number],
  ndc: readonly [number, number],
  aspect: number,
  fovYRad: number,
): [number, number, number] {
  const { right, up } = screenBasis(forward);
  const tanHalf = Math.tan(fovYRad / 2);
  const sx = ndc[0] * tanHalf * aspect;
  const sy = ndc[1] * tanHalf;
  const dir: [number, number, number] = [
    forward[0] + right[0] * sx + up[0] * sy,
    forward[1] + right[1] * sx + up[1] * sy,
    forward[2] + right[2] * sx + up[2] * sy,
  ];
  const length = Math.hypot(dir[0], dir[1], dir[2]) || 1;

  return [dir[0] / length, dir[1] / length, dir[2] / length];
}

/** The view forward for a yaw/pitch pair (engine Y-up) — the one place the rig's angle convention lives. */
export function forwardFrom(yaw: number, pitch: number): [number, number, number] {
  return [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];
}

/**
 * Whose camera this frame is, in priority order: a running BENCH owns it outright (the prod BenchPlugin
 * contract — deterministic path, player parked), then video mode's director (096/03), then the photo camera
 * (074/22), else the follow rig.
 *
 * Video sits directly BELOW the bench so bench numbers stay untouchable by construction (the 080 ground
 * rule), and ABOVE fly because a recording must not lose its frame to an accidental K+M.
 */
export function resolveCamera(state: {
  aspect: number;
  bench: null | { eye: [number, number, number]; target: [number, number, number] };
  distance: number;
  flyEye: [number, number, number] | null;
  forward: readonly [number, number, number];
  fovYRad: number;
  target: readonly [number, number, number];
  video: null | VideoCamera;
}): CameraState {
  const { aspect, bench, distance, flyEye, forward, fovYRad, target, video } = state;
  const rig = { aspect, far: 10000, fovYRad, near: 0.5, up: [0, 1, 0] as [number, number, number] };
  if (bench) {
    return { ...rig, eye: bench.eye, target: bench.target };
  }
  if (video) {
    return { ...rig, eye: video.eye, fovYRad: video.fovYRad ?? fovYRad, target: video.target };
  }
  if (flyEye) {
    return { ...rig, eye: flyEye, target: [flyEye[0] + forward[0], flyEye[1] + forward[1], flyEye[2] + forward[2]] };
  }

  return {
    ...rig,
    eye: [target[0] - forward[0] * distance, target[1] - forward[1] * distance, target[2] - forward[2] * distance],
    target: [target[0], target[1], target[2]],
  };
}

/** The camera's screen basis for a forward vector, matching `mat4LookAt`'s (right, up) rows exactly. */
export function screenBasis(forward: readonly [number, number, number]): {
  right: [number, number, number];
  up: [number, number, number];
} {
  const [fx, fy, fz] = forward;
  // `mat4LookAt` builds x = normalize(up × z) with z = eye − target = −forward, and up × (−f) = f × up.
  // With up = (0, 1, 0) that is (−fz, 0, fx) — which is why the top-down pitch stops just short of −π/2:
  // at a perfectly vertical forward both components are zero and the basis has no defined roll.
  const length = Math.hypot(fz, fx) || 1;
  const right: [number, number, number] = [-fz / length, 0, fx / length];

  // y = z × x, with z = −forward.
  return {
    right,
    up: [-fy * right[2], fx * right[2] - fz * right[0], fy * right[0]],
  };
}
