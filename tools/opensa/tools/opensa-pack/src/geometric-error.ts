/**
 * What a cell LOD's error IS, in world units (plan 201/1-05).
 *
 * The runtime picks HD over LOD by screen-space error — the 3D Tiles rule — and that arithmetic needs a
 * number the pak never carried: how wrong, in the world, drawing this cell's LOD instead of its HD actually
 * is. This module answers it from the ONE thing that is genuinely known about a baked LOD: the promise its
 * bake made.
 *
 * `opensa-lod-generator` culls what subtends fewer than `minLodPixels` at `hdDrawDistance` and decimates
 * inside a pixel-diff budget judged at that same distance (`tools/lod-common/src/view.ts`). Turned round,
 * that promise is a world size: **the error the bake allowed itself is whatever `minLodPixels` covers at
 * `hdDrawDistance`** — 2 px at 300 u on the bake's 1080p/60° view is 0.64 world units. Feed that back into
 * the screen-error rule and it reproduces the bake's own HD ring exactly at the view it was written for,
 * while moving correctly for every other screen height, zoom and projection. Which is the point: the 300 u
 * stops being a constant the engine has to be told and becomes a consequence.
 *
 * **This is a per-BUILD number today, written onto every LOD entry.** The per-CELL refinement — the largest
 * thing a given cell's bake actually dropped — is the generator's to measure (only it knows what it culled;
 * a cell's LOD weld is one baked model, so the pack cannot diff the two levels' placements). Until it does,
 * a cell that dropped something big is judged by the bake's average promise rather than by its own worst
 * case, which is exactly what the fixed HD ring did before this — no worse anywhere, better everywhere the
 * screen is not 1080p.
 */
import { lodView, unitsPerPixel } from '@opensa/lod-common/view';

/** What the LOD bake promised, taken from the config it ran with — never restated by hand. */
export interface LodBakePromise {
  /** `LodConfig.hdDrawDistance`: the closest distance the bake judged its output at. */
  hdDrawDistance: number;
  /** `LodConfig.minLodPixels`: the screen size below which the bake dropped a thing. */
  screenPixels: number;
}

/**
 * The promise as a world size — the geometric error every cell LOD of this build is written with, and the
 * value the runtime's screen-error test reads against {@link LodBakePromise.screenPixels}.
 */
export function promisedGeometricError(promise: LodBakePromise): number {
  return promise.screenPixels * unitsPerPixel(lodView(promise.hdDrawDistance), promise.hdDrawDistance);
}
