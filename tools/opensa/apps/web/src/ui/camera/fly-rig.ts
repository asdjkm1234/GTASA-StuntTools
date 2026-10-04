/**
 * Free-fly camera (the photo camera and the map viewer are the SAME detached eye, 074/22): walk, pan, dolly
 * and the top-down reset. Pure steps — the director calls them, the host only reports input.
 *
 * The fly rig opts OUT of the follow layers by construction: it frames no focus, so auto-center/look-ahead
 * (plan 03) and additive motion (06) have nothing to act on, and a map viewer must fly THROUGH geometry, so
 * collision (04) never runs here.
 */
import { screenBasis } from './engine-camera';

/** Photo-camera movement keys (prod's fly mode: ARROWS move, the WASD player keeps walking). */
export const FLY_KEYS: ReadonlySet<string> = new Set([
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'PageDown',
  'PageUp',
]);

/** Photo-camera speed (units/s) — prod's `camera-controller.FLY_SPEED`, so both hosts fly the same. */
export const FLY_SPEED = 18;

/** The steepest the map viewer may look down. A perfectly vertical forward has no defined screen basis, so
 *  this stops just short of it — the same margin `screenBasis` depends on. */
export const TOP_DOWN_PITCH = -Math.PI / 2 + 0.01;

/** Map-viewer "Top (reset view)" altitude above the player, in engine units — high enough to frame a
 *  250 u section with margin. */
export const TOP_DOWN_HEIGHT = 400;

/**
 * The yaw that puts the map the way every SA map is drawn: north up, east right. At yaw 0 the top-down basis
 * comes out rotated a half turn (screen right = −X, screen up = −Y in GTA terms), so the view reads as a
 * mirror of every reference anyone compares it against. Half a turn fixes it.
 *
 * A map viewer's top-down reset therefore has to SET the yaw: inheriting the player's heading orients the map
 * by whichever way he happened to be facing, and facing north-ish is what flips it.
 */
export const MAP_YAW = Math.PI;

/** Wheel dolly step as a fraction of the eye's height above the ground (per notch). */
const DOLLY_STEP = 0.12;
/** The dolly never pushes the eye below this — the viewer must not fall into the terrain it inspects. */
const DOLLY_MIN_HEIGHT = 2;
/** Shallower than this (radians of downward forward) there is no usable ground intersection to aim at. */
const MIN_LOOK_DOWN = 0.02;

/**
 * One wheel notch of dolly along the view (the follow rig's zoom config does not apply to a free eye): the
 * step scales with altitude, so the gesture stays usable from 5 u and from 500 u up.
 *
 * `notch` is +1 for a wheel push away (dolly back) and −1 toward the user (dolly in) — the sign the host's
 * `deltaY` carries.
 */
export function dollyStep(
  eye: readonly [number, number, number],
  forward: readonly [number, number, number],
  notch: number,
): [number, number, number] {
  const step = Math.max(1, eye[1]) * (notch > 0 ? -DOLLY_STEP : DOLLY_STEP);

  return [
    eye[0] + forward[0] * step,
    Math.max(DOLLY_MIN_HEIGHT, eye[1] + forward[1] * step),
    eye[2] + forward[2] * step,
  ];
}

/**
 * One free-fly movement step: ARROWS walk the eye along the view forward / camera right (prod's `flyUpdate`,
 * same axes — right = forward × up), PageUp/PageDown lift it (an engine addition; prod's fly camera has no
 * vertical key). Pure — the eye in, the moved eye out.
 */
export function flyStep(
  eye: readonly [number, number, number],
  keys: ReadonlySet<string>,
  forward: readonly [number, number, number],
  yaw: number,
  step: number,
): [number, number, number] {
  const [fx, fy, fz] = forward;
  // right = normalize(forward × up) — for a yaw-based forward that is (−cos yaw, 0, sin yaw).
  const right: [number, number, number] = [-Math.cos(yaw), 0, Math.sin(yaw)];
  const axes: [string, [number, number, number]][] = [
    ['ArrowUp', [fx, fy, fz]],
    ['ArrowDown', [-fx, -fy, -fz]],
    ['ArrowRight', right],
    ['ArrowLeft', [-right[0], 0, -right[2]]],
    ['PageUp', [0, 1, 0]],
    ['PageDown', [0, -1, 0]],
  ];
  const moved: [number, number, number] = [eye[0], eye[1], eye[2]];
  for (const [code, [dx, dy, dz]] of axes) {
    if (keys.has(code)) {
      moved[0] += dx * step;
      moved[1] += dy * step;
      moved[2] += dz * step;
    }
  }

  return moved;
}

/**
 * Slide the detached eye sideways until `target` sits under the crosshair, keeping its height and its
 * orientation — the model-search jump (plan 094/05). Only the looked-at point moves, so a search never
 * silently re-frames what the viewer is showing; the caller dollies in afterwards.
 *
 * `null` when the view cannot reach the target's height plane in FRONT of the eye — level or upward, or the
 * target above the eye. There is no sane sideways slide then, and the caller falls back to the viewer's own
 * top-down framing.
 */
export function lookAtStep(
  eye: readonly [number, number, number],
  forward: readonly [number, number, number],
  target: readonly [number, number, number],
): [number, number, number] | null {
  if (forward[1] >= -MIN_LOOK_DOWN) {
    return null;
  }
  const distance = (target[1] - eye[1]) / forward[1];
  if (distance <= 0) {
    return null;
  }
  // Where the view meets the target's height today; the eye slides by exactly the miss.
  const atX = eye[0] + forward[0] * distance;
  const atZ = eye[2] + forward[2] * distance;

  return [eye[0] + (target[0] - atX), eye[1], eye[2] + (target[2] - atZ)];
}

/**
 * Drag-to-pan for the map viewer (the LEFT button, as prod's OrbitControls mapped it): the eye slides in the
 * camera's own screen plane, OPPOSITE the drag, so the map follows the cursor like a grabbed sheet.
 *
 * `scale` is world units per NDC unit — pass the eye's height above the ground so panning covers the same
 * apparent distance whether you are 50 m or 500 m up, which is what made the three controls feel right.
 */
export function panStep(
  eye: readonly [number, number, number],
  forward: readonly [number, number, number],
  ndcDelta: readonly [number, number],
  scale: number,
): [number, number, number] {
  const { right, up } = screenBasis(forward);
  const dx = -ndcDelta[0] * scale;
  const dy = -ndcDelta[1] * scale;

  return [
    eye[0] + right[0] * dx + up[0] * dy,
    eye[1] + right[1] * dx + up[1] * dy,
    eye[2] + right[2] * dx + up[2] * dy,
  ];
}

/**
 * Lift the detached eye straight over a focus point and aim it down — what ENTERING the map viewer does, not
 * only the "Top" button. Detaching the eye where it already stands, looking where it already looked, is
 * indistinguishable from the activation doing nothing at all (074/22 phase 9).
 */
export function topDownEye(focus: readonly [number, number, number]): [number, number, number] {
  return [focus[0], focus[1] + TOP_DOWN_HEIGHT, focus[2]];
}
