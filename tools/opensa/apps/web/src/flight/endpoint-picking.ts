import type { Mat4 } from '@opensa/engine';

/**
 * Screen-space picking for the 3D endpoint markers.
 *
 * The marker layer draws engine DEBUG LINES, and debug lines are not pickable — there is no engine-level
 * raycast and adding one would put a second copy of the camera matrices inside the renderer. Instead this
 * module rebuilds the exact view-projection the engine draws with from the CURRENT `CameraStateOut` — the
 * same camera state object `engine.frame()` receives — using the exported engine `mat4` helpers, projects
 * every marker anchor (the pillar base the layer writes first per endpoint) into canvas pixels, and lets an
 * ordinary pointer click hit-test it by pixel distance. No endpoint is re-derived here: positions and track
 * IDs are the marker layer's own.
 */
import { mat4Identity, mat4LookAt, mat4Multiply, mat4PerspectiveZO } from '@opensa/engine';

import type { CameraStateOut } from './camera';
import type { Vec3 } from './math';

/** Screen projection of one marker anchor, in CSS pixels relative to the canvas top-left. */
export interface MarkerProjection {
  /** False when the anchor is behind the camera, past the far plane, or outside the viewport. */
  readonly onScreen: boolean;
  /** Marker/endpoint slot in the layer's own order (import order of the contributing tracks). */
  readonly slot: number;
  /** Import-list position of the marker's track — what the existing focus flow selects by. */
  readonly trackIndex: number;
  readonly x: number;
  readonly y: number;
}

/** Sub-pixel gap below which two projected markers are geometrically the same click target. */
const COINCIDENT_PX = 1;
/** View-depth epsilon: anything at or behind it is not in front of the camera. */
const DEPTH_EPSILON = 1e-3;

/**
 * Nearest marker anchor within `radiusPx` of a canvas-space point, or null.
 *
 * Coincident markers project to the same pixel, so a click cannot tell them apart geometrically. When the
 * nearest candidate is the ALREADY ACTIVE track and other markers overlap it, the pick cycles forward in
 * TRACK-LIST order (slots keep import order) so repeated clicks reach every endpoint in the cluster instead
 * of one shadowing the others forever.
 */
export function pickEndpointMarker(
  projections: readonly MarkerProjection[],
  x: number,
  y: number,
  radiusPx: number,
  activeTrackIndex = -1,
): MarkerProjection | null {
  const candidates = projections
    .filter((marker) => marker.onScreen)
    .map((marker) => ({ distance: Math.hypot(marker.x - x, marker.y - y), marker }))
    .filter((candidate) => candidate.distance <= radiusPx)
    .sort((a, b) => a.distance - b.distance || a.marker.slot - b.marker.slot);
  if (candidates.length === 0) {
    return null;
  }
  const nearest = candidates[0].marker;
  if (nearest.trackIndex !== activeTrackIndex) {
    return nearest;
  }
  const overlapping = candidates.filter(
    (candidate) => Math.hypot(candidate.marker.x - nearest.x, candidate.marker.y - nearest.y) <= COINCIDENT_PX,
  );
  if (overlapping.length < 2) {
    return nearest;
  }
  const at = overlapping.findIndex((candidate) => candidate.marker.slot === nearest.slot);

  return overlapping[(at + 1) % overlapping.length].marker;
}

/**
 * Project every marker anchor with `camera` into `width`×`height` CSS pixels.
 *
 * The matrix is the engine's own: `cameraProjection` feeds `mat4PerspectiveZO` with near/far SWAPPED
 * (reversed-Z), then `mat4LookAt` and `mat4Multiply`. Only clip x/y and w are read below — depth itself
 * never decides a pick, `w` does — so the swap cannot move a marker on screen.
 */
export function projectMarkerEndpoints(
  positions: readonly Vec3[],
  trackIds: readonly number[],
  camera: CameraStateOut,
  width: number,
  height: number,
): MarkerProjection[] {
  const viewProj = viewProjection(camera);
  const screenWidth = Math.max(1, width);
  const screenHeight = Math.max(1, height);

  return positions.map((position, slot) => {
    const [x, y, z] = position;
    const clipX = viewProj[0] * x + viewProj[4] * y + viewProj[8] * z + viewProj[12];
    const clipY = viewProj[1] * x + viewProj[5] * y + viewProj[9] * z + viewProj[13];
    const clipW = viewProj[3] * x + viewProj[7] * y + viewProj[11] * z + viewProj[15];
    const trackIndex = trackIds[slot] ?? -1;
    if (clipW <= DEPTH_EPSILON || clipW > camera.far + DEPTH_EPSILON) {
      return { onScreen: false, slot, trackIndex, x: 0, y: 0 };
    }
    const px = ((clipX / clipW) * 0.5 + 0.5) * screenWidth;
    const py = (0.5 - (clipY / clipW) * 0.5) * screenHeight;

    return {
      onScreen: px >= 0 && px <= screenWidth && py >= 0 && py <= screenHeight,
      slot,
      trackIndex,
      x: px,
      y: py,
    };
  });
}

/** The engine's view-projection for a camera state (reversed-Z projection, as `packages/engine` builds it). */
function viewProjection(camera: CameraStateOut): Mat4 {
  const projection = mat4PerspectiveZO(new Float32Array(16), camera.fovYRad, camera.aspect, camera.far, camera.near);
  const view = mat4LookAt(mat4Identity(), camera.eye, camera.target, camera.up);

  return mat4Multiply(new Float32Array(16), projection, view);
}
