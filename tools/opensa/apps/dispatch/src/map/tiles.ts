/**
 * The tile pyramid the flat 2D map is drawn from (201/6-02).
 *
 * The scheme is SanMap's, because it is proven and free: the world is one SQUARE, zoom 0 is that square in a
 * single tile, and each zoom doubles the grid. Tile `y` counts from the NORTH edge down, which is the XYZ
 * convention every tile reader already speaks — inventing our own would cost us `pmtiles`, MapLibre and QGIS
 * for nothing.
 *
 * **The square is a parameter, never San Andreas' 6000.** A total conversion has its own extent, and the one
 * the tiles were baked over is recorded in the archive rather than assumed here — a map read on the wrong
 * square is not a broken picture, it is a picture that is silently in the wrong place, which is the failure
 * PCAD's hand-calibrated bounds exist to work around and this mode exists to delete.
 */
import type { GtaGround } from './coords';

export interface TileAddress {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** A tile's own square in world coordinates. */
export interface TileExtent {
  readonly max: GtaGround;
  readonly min: GtaGround;
}

/** The square the pyramid covers, in GTA ground coordinates. */
export interface TileScheme {
  /** Highest zoom the archive carries — past it the map holds the last level and stretches it. */
  readonly maxZoom: number;
  /** Lowest zoom the archive carries; zoom 0 is the whole square in one tile. */
  readonly minZoom: number;
  /** The square's south-west corner. */
  readonly origin: GtaGround;
  /** World units per side. The pyramid is square by construction — a rectangle would put two resolutions in
   *  one tile and every zoom decision downstream would have to say which axis it meant. */
  readonly span: number;
  /** Pixels per tile side, as baked. */
  readonly tileSize: number;
}

/** The San Andreas square, and the default a `sa` pak is baked over. */
export const SA_TILE_SPAN = 6000;
export const SA_TILE_ORIGIN: GtaGround = [-3000, -3000];
/** 256 is the tile size every reader assumes when a scheme does not say otherwise. */
export const DEFAULT_TILE_SIZE = 256;

/** The tile containing a world point, clamped to the pyramid — a point outside the square has no tile, and
 *  clamping is what keeps the edge of the world drawn rather than blank. */
export function tileAt(scheme: TileScheme, at: GtaGround, z: number): TileAddress {
  const side = 2 ** z;
  const span = tileSpan(scheme, z);
  const north = scheme.origin[1] + scheme.span;

  return {
    x: clamp(Math.floor((at[0] - scheme.origin[0]) / span), side),
    y: clamp(Math.floor((north - at[1]) / span), side),
    z,
  };
}

/** The tile square in world coordinates. `y` counts down from the north edge. */
export function tileExtent(scheme: TileScheme, tile: TileAddress): TileExtent {
  const span = tileSpan(scheme, tile.z);
  const north = scheme.origin[1] + scheme.span;

  return {
    max: [scheme.origin[0] + (tile.x + 1) * span, north - tile.y * span],
    min: [scheme.origin[0] + tile.x * span, north - (tile.y + 1) * span],
  };
}

/** A stable key for a tile — what a cache and a request ledger are keyed by. */
export function tileKey(tile: TileAddress): string {
  return `${tile.z}/${tile.x}/${tile.y}`;
}

/** World units per tile PIXEL — the resolution a zoom actually delivers. */
export function tileResolution(scheme: TileScheme, z: number): number {
  return tileSpan(scheme, z) / scheme.tileSize;
}

/**
 * Every tile of `z` covering the view's world box, nearest the centre first.
 *
 * Order matters on a slow link: the tiles under the operator's eye arrive first and the corners fill in,
 * rather than the map painting from its north-west corner inwards. `cap` is a hard stop — a view that
 * somehow asks for ten thousand tiles gets the ones nearest its centre and no more, because a request storm
 * on a phone is worse than a coarse picture.
 */
export function tilesInBox(scheme: TileScheme, box: TileExtent, z: number, cap = 64): readonly TileAddress[] {
  const first = tileAt(scheme, [box.min[0], box.max[1]], z);
  const last = tileAt(scheme, [box.max[0], box.min[1]], z);
  const centre: GtaGround = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2];
  const middle = tileAt(scheme, centre, z);
  const tiles: TileAddress[] = [];
  for (let y = first.y; y <= last.y; y += 1) {
    for (let x = first.x; x <= last.x; x += 1) {
      tiles.push({ x, y, z });
    }
  }
  tiles.sort((a, b) => distanceSquared(a, middle) - distanceSquared(b, middle));

  return tiles.slice(0, cap);
}

/** How much world one tile covers at this zoom. */
export function tileSpan(scheme: TileScheme, z: number): number {
  return scheme.span / 2 ** z;
}

/**
 * The zoom whose pixels are nearest the screen's, clamped to what the archive carries.
 *
 * `worldPerPixel` is the view's own resolution — how much world one CSS pixel covers right now. Rounding
 * rather than flooring picks the level whose texels are closest to one screen pixel; flooring would hold a
 * blurry level halfway through every zoom step.
 */
export function zoomForResolution(scheme: TileScheme, worldPerPixel: number, dpr = 1): number {
  if (!Number.isFinite(worldPerPixel) || worldPerPixel <= 0) {
    return scheme.minZoom;
  }
  const wanted = Math.log2(tileResolution(scheme, 0) / (worldPerPixel / Math.max(1, dpr)));

  return Math.min(scheme.maxZoom, Math.max(scheme.minZoom, Math.round(wanted)));
}

function clamp(value: number, side: number): number {
  return Math.min(side - 1, Math.max(0, value));
}

function distanceSquared(a: TileAddress, b: TileAddress): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}
