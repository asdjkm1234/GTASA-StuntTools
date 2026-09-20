/**
 * The screen-error view model (plan 003, Phase 0) — converts world sizes to on-screen pixels for the distance
 * band a LOD is visible from. All simplification thresholds ("smaller than N pixels") derive from this one
 * place so opensa-lod-generator and sa-lod-generator cull by the same maths.
 */

/** Where a LOD can be seen from — the pessimistic (closest, sharpest) viewing conditions. */
export interface LodView {
  /** Vertical camera field of view in degrees (the engine camera uses 60 — see `game/core/renderer.ts`). */
  fovYDeg: number;
  /**
   * The **closest** distance (world units) the LOD is ever rendered at — opensa: the engine's `hdDrawDistance`
   * (a cell flips HD→LOD past it); sa: the HD object's IDE draw distance (the HD unloads there).
   */
  minDistance: number;
  /** Viewport height in pixels the error budget is judged at (a common 1080p screen by default). */
  viewportHeight: number;
}

export const DEFAULT_FOV_Y_DEG = 60;
export const DEFAULT_VIEWPORT_HEIGHT = 1080;

/** A {@link LodView} at `minDistance` with the default engine FOV + a 1080p viewport. */
export function lodView(minDistance: number): LodView {
  return { fovYDeg: DEFAULT_FOV_Y_DEG, minDistance, viewportHeight: DEFAULT_VIEWPORT_HEIGHT };
}

/**
 * How many screen pixels a sphere of `radiusWorld` covers (diameter) at `distance` — the pessimistic screen
 * footprint of an object. `distance` defaults to the view's `minDistance` (the closest = largest the LOD gets).
 */
export function pixelsSubtended(view: LodView, radiusWorld: number, distance = view.minDistance): number {
  return (2 * radiusWorld) / unitsPerPixel(view, distance);
}

/**
 * Whether an object of `radiusWorld` covers at least `minPixels` on screen at the view's closest LOD distance —
 * the shared "worth keeping in a LOD" predicate (plan 003, Track 1). A sub-`minPixels` object is invisible at
 * every distance the LOD renders, so dropping it whole cannot hole the far view.
 */
export function subtendsAtLeast(view: LodView, radiusWorld: number, minPixels: number): boolean {
  return pixelsSubtended(view, radiusWorld) >= minPixels;
}

/** World units covered by one screen pixel at `distance` (perspective, vertical FOV). */
export function unitsPerPixel(view: LodView, distance: number): number {
  return (2 * Math.tan(((view.fovYDeg / 2) * Math.PI) / 180) * distance) / view.viewportHeight;
}
