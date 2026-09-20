/**
 * The residency rule (plan 201/1-05): WHAT the streamer keeps, and at WHICH level.
 *
 * The driver's rings answer both questions with two radii around a focus point. That is the right rule for a
 * player standing in the world — everything around them is equally likely to be needed a second from now,
 * and their physics is behind them as much as in front. It is the wrong rule for a MAP: an operator's camera
 * sits hundreds of units up looking at a wedge of city, the radius that fills the screen at block zoom is a
 * thirtieth of the one that fills it at city zoom, and a fixed radius is therefore either a stall or a waste
 * at every zoom but the one it was picked at.
 *
 * Two rules replace it, and neither is a number somebody liked:
 *
 * **What.** A cell is worth fetching when the frame will draw it. That is the same frustum test
 * {@link Engine.frame} culls with, taken one frame early — so the residency set and the draw set cannot
 * disagree about the convention ({@link cameraProjection} is the one owner of it).
 *
 * **Which level.** A cell's LOD is good enough while the error it introduces stays under the screen-error
 * budget the LOD was BAKED to. That is the 3D Tiles / CesiumJS rule (`maximumScreenSpaceError`), and the two
 * numbers it needs are read from the pak rather than chosen here: the per-entry geometric error and the
 * pixel threshold the bake culled at (`opensa-lod-generator` drops what subtends fewer than N pixels — see
 * `tools/lod-common/src/view.ts`, the other half of this same projection). One rule then serves every zoom,
 * every screen height and every device pixel ratio, because all three are already in the formula.
 *
 * **A pak that carries neither field keeps the rings**, which is what makes this safe to land before the
 * bake half exists: the fields are optional, absent on every pak built so far, and their absence selects the
 * behaviour that shipped ({@link OspakCellEntry.aabbY}, {@link OspakCellEntry.geometricError}).
 */
import type { OspakManifest } from '@opensa/engine-formats';

import type { CameraState } from '../engine';

import { cameraProjection } from '../core/camera';
import { frustumFromViewProj, mat4Identity, mat4LookAt, mat4Multiply } from '../core/math';

/** World XZ rect `[minX, maxX, minZ, maxZ]`, engine coords — the shape the manifest states a cell's extent in. */
export type Rect = readonly [number, number, number, number];

/**
 * What the host's next frame will look at. `pixelHeight` is the DRAWING buffer's height, not the CSS one:
 * the screen-error rule is about texels the operator can resolve, and a phone at DPR 3 resolves three times
 * what its CSS height suggests.
 */
export interface ResidencyView {
  readonly camera: CameraState;
  readonly pixelHeight: number;
}

/**
 * The view half of the rule, built once per update. Holds the frustum planes the box tests read and the
 * projection scale the screen-error reads; nothing about the world, so it is cheap to rebuild every frame
 * and never stale.
 */
export class ResidencyGate {
  private readonly camera: CameraState;
  private readonly pixelHeight: number;
  private readonly planes = new Float32Array(24);

  constructor(view: ResidencyView) {
    this.camera = view.camera;
    this.pixelHeight = Math.max(1, view.pixelHeight);
    const proj = cameraProjection(mat4Identity(), view.camera);
    const lookAt = mat4LookAt(mat4Identity(), view.camera.eye, view.camera.target, view.camera.up);
    frustumFromViewProj(this.planes, mat4Multiply(mat4Identity(), proj, lookAt));
  }

  /** Distance from the eye to the closest point of a box — what the screen error is judged at. */
  distanceToBox(rect: Rect, minY: number, maxY: number): number {
    const [eyeX, eyeY, eyeZ] = this.camera.eye;
    const dx = Math.max(rect[0] - eyeX, 0, eyeX - rect[1]);
    const dy = Math.max(minY - eyeY, 0, eyeY - maxY);
    const dz = Math.max(rect[2] - eyeZ, 0, eyeZ - rect[3]);

    return Math.hypot(dx, dy, dz);
  }

  /**
   * Screen-space error, in pixels, of drawing something whose geometric error is `geometricError` world
   * units at `distance`. Perspective divides by distance; an orthographic plan view does not, because a
   * distance on screen is a distance in the world wherever it is measured (201/7-01).
   *
   * `backOff` is the caller's hysteresis, in world units, and it is applied to whatever *further out* means
   * for the projection — the distance under perspective, the view box's half-height in the plan view. Both
   * make the error smaller by the same relative amount, so one dead-band serves both.
   */
  screenError(geometricError: number, distance: number, backOff = 0): number {
    return geometricError / this.unitsPerPixel(distance, backOff);
  }

  /**
   * Is any part of this box inside the view, once the box is grown by `margin` on every side? The margin is
   * the RESERVE the operator's turn and the fetch's latency are paid out of, and the driver states it in
   * grid terms rather than in metres.
   */
  sees(rect: Rect, minY: number, maxY: number, margin: number): boolean {
    return frustumIntersectsBox(
      this.planes,
      [rect[0] - margin, rect[1] + margin, rect[2] - margin, rect[3] + margin],
      minY - margin,
      maxY + margin,
    );
  }

  /** World units one screen pixel covers at `distance` — the same projection `tools/lod-common` bakes with. */
  unitsPerPixel(distance: number, backOff = 0): number {
    const { fovYRad, orthoHalfHeight } = this.camera;

    return orthoHalfHeight === undefined
      ? (2 * Math.tan(fovYRad / 2) * Math.max(distance + backOff, 0)) / this.pixelHeight
      : (2 * (orthoHalfHeight + backOff)) / this.pixelHeight;
  }
}

/**
 * Box-vs-frustum, the standard positive-vertex test: a box is out only when it lies entirely on the far side
 * of one plane. Conservative by construction (it can answer "visible" for a box that a corner test would
 * reject), which is the answer a streamer must round towards — a false "visible" costs a fetch, a false
 * "hidden" costs a hole in the world.
 */
export function frustumIntersectsBox(planes: Float32Array, rect: Rect, minY: number, maxY: number): boolean {
  for (let plane = 0; plane < 6; plane += 1) {
    const nx = planes[plane * 4];
    const ny = planes[plane * 4 + 1];
    const nz = planes[plane * 4 + 2];
    const d = planes[plane * 4 + 3];
    // The corner furthest along the plane normal — if even that one is behind, the whole box is.
    const x = nx >= 0 ? rect[1] : rect[0];
    const y = ny >= 0 ? maxY : minY;
    const z = nz >= 0 ? rect[3] : rect[2];
    if (nx * x + ny * y + nz * z + d < 0) {
      return false;
    }
  }

  return true;
}

/**
 * The vertical extent every entry of this manifest states, or `null` when even one cell does not — the view
 * gate is all-or-nothing per pak, because a cell with no stated height cannot be tested against a frustum
 * and guessing one is how a tower gets streamed out from under a pitched view.
 */
export function verticalExtents(manifest: OspakManifest): Map<string, [number, number]> | null {
  const extents = new Map<string, [number, number]>();
  for (const [key, entry] of Object.entries(manifest.cells)) {
    if (entry.aabbY === undefined) {
      return null;
    }
    extents.set(key, entry.aabbY);
  }

  return extents.size > 0 ? extents : null;
}
