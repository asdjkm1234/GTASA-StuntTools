/**
 * Drawing the baked pyramid under the symbology (201/6-02).
 *
 * The whole layer is one rule: **the ground plane maps AFFINELY to the screen under an orthographic
 * projection**, at any heading and any tilt. So a tile is drawn by projecting three of its corners and
 * handing the canvas the transform between them — exact, no resampling of our own, and it costs one
 * `drawImage` per tile.
 *
 * Under PERSPECTIVE the same map is a homography, which a 2D canvas cannot express: an affine per tile would
 * bend every straight road at the tile seams. So the layer draws nothing there and says why, and the mode
 * holds the plan view — which is what a flat map is. That is a stated limit rather than a skewed picture.
 */
import type { MapProjection } from './map-camera';
import type { ScreenProjector } from './projection';
import type { TileSource } from './tile-source';

import { type GtaGround, gtaToEngine } from './coords';
import { tileExtent, tilesInBox, zoomForResolution } from './tiles';

export interface TileLayerInput {
  readonly context: CanvasRenderingContext2D;
  /** Device pixel ratio the context is scaled by — the layer sets its own transform and must restore it. */
  readonly dpr: number;
  /** The view's ground quad in GTA coordinates, from `MapCamera.groundFootprint`. */
  readonly footprint: readonly GtaGround[];
  readonly projection: MapProjection;
  readonly projector: ScreenProjector;
  readonly source: TileSource;
  /** Called when a tile lands, so a console that draws on demand wakes up for it. */
  readonly wake: () => void;
}

export interface TileLayerStatus {
  /** Tiles actually painted this frame. */
  readonly drawn: number;
  /** Tiles this frame asked for that have not landed yet — the map is still filling in. */
  readonly pending: number;
  /** Why the layer drew nothing, in words the status bar can show. Null when it drew. */
  readonly reason: null | string;
  /** The pyramid level this view resolved to, or -1 when nothing was drawn. */
  readonly zoom: number;
}

/** Tiles per frame. At 256 px a phone screen needs a dozen; the cap is what stops a bad zoom from storming. */
const TILE_CAP = 48;
/** Half a device pixel of overlap: adjacent affine draws otherwise leave a hairline seam of background. */
const BLEED = 0.5;

export function drawTileLayer(input: TileLayerInput): TileLayerStatus {
  const { context, dpr, footprint, projector, source } = input;
  if (input.projection !== 'ortho') {
    return { drawn: 0, pending: 0, reason: 'the plan view draws the tiles', zoom: -1 };
  }
  const scheme = source.meta.scheme;
  const perPixel = worldPerPixel(footprint, projector);
  if (perPixel === null) {
    return { drawn: 0, pending: 0, reason: 'the view is not over the ground', zoom: -1 };
  }
  const zoom = zoomForResolution(scheme, perPixel, dpr);
  const box = boundsOf(footprint);
  const tiles = tilesInBox(scheme, box, zoom, TILE_CAP);

  let drawn = 0;
  context.save();
  for (const tile of tiles) {
    const image = source.get(tile, input.wake);
    if (image === null) {
      continue;
    }
    const extent = tileExtent(scheme, tile);
    // North-west, north-east and south-west: the two edges out of one corner are the affine basis.
    const nw = projector.project(gtaToEngine([extent.min[0], extent.max[1]]));
    const ne = projector.project(gtaToEngine([extent.max[0], extent.max[1]]));
    const sw = projector.project(gtaToEngine([extent.min[0], extent.min[1]]));
    if (nw === null || ne === null || sw === null) {
      continue;
    }
    const size = scheme.tileSize;
    const a = (ne.x - nw.x) / size;
    const b = (ne.y - nw.y) / size;
    const c = (sw.x - nw.x) / size;
    const d = (sw.y - nw.y) / size;
    context.setTransform(dpr * a, dpr * b, dpr * c, dpr * d, dpr * nw.x, dpr * nw.y);
    const bleed = BLEED / Math.max(1e-6, Math.hypot(a, b) * dpr);
    context.drawImage(image, -bleed, -bleed, size + bleed * 2, size + bleed * 2);
    drawn += 1;
  }
  context.restore();
  context.setTransform(dpr, 0, 0, dpr, 0, 0);

  return {
    drawn,
    pending: source.pendingCount,
    reason: drawn > 0 ? null : 'no tile here yet',
    zoom,
  };
}

/** The axis-aligned world box the footprint covers — what decides which tiles are asked for. */
function boundsOf(footprint: readonly GtaGround[]): { max: GtaGround; min: GtaGround } {
  const xs = footprint.map((point) => point[0]);
  const ys = footprint.map((point) => point[1]);

  return {
    max: [Math.max(...xs), Math.max(...ys)],
    min: [Math.min(...xs), Math.min(...ys)],
  };
}

/**
 * World units per CSS pixel, measured on the view's own bottom edge.
 *
 * Measured rather than derived from the camera: the projector already carries the exact matrices the frame
 * is drawn with, and a second derivation from height and fov is a place for the two to disagree.
 */
function worldPerPixel(footprint: readonly GtaGround[], projector: ScreenProjector): null | number {
  if (footprint.length < 2) {
    return null;
  }
  const from = projector.project(gtaToEngine(footprint[0]));
  const to = projector.project(gtaToEngine(footprint[1]));
  if (from === null || to === null) {
    return null;
  }
  const screen = Math.hypot(to.x - from.x, to.y - from.y);
  const world = Math.hypot(footprint[1][0] - footprint[0][0], footprint[1][1] - footprint[0][1]);

  return screen < 1 || world <= 0 ? null : world / screen;
}
