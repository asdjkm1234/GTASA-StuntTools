/**
 * Baking the flat map's pyramid out of our own world (201/6-02).
 *
 * The tiles are rendered by the SAME engine that draws the live map, through an orthographic top-down pass —
 * so every build has a 2D map, total conversions included, and the picture matches the world that actually
 * streams. That is the reason we bake rather than borrow: the published San Andreas rasters cover stock SA
 * only, and this project exists to run the maps that are not stock.
 *
 * This file is the ORCHESTRATION and nothing else — which tiles, in which order, what the run cost, and the
 * archive at the end. Rendering one square is the host's business (it owns the engine and the canvas), which
 * is what makes the plan testable without a GPU.
 */
import { encodePmtiles, fnv1a, type PmtilesInputTile, PmtilesTileType } from '@opensa/engine-formats';

import type { TileAddress, TileExtent, TileScheme } from '../map/tiles';

import { tileExtent } from '../map/tiles';

/** One rendered tile: the encoded picture and what the encoder actually produced. */
export interface BakedTile {
  readonly bytes: Uint8Array;
  /** `image/webp` or `image/png` — read back from the encoder rather than assumed, because a browser that
   *  cannot encode WebP silently hands back a PNG and the archive would then declare the wrong type. */
  readonly mime: string;
}

export interface TileBakeLevel {
  readonly bytes: number;
  readonly tiles: number;
  readonly zoom: number;
}

/** What the run cost, per level — the number this step owes and the reason the bake reports rather than logs. */
export interface TileBakeReport {
  readonly archiveBytes: number;
  readonly byZoom: readonly TileBakeLevel[];
  readonly ms: number;
  /** Tiles whose pixels were identical to another's — the sea, mostly. Stored once. */
  readonly shared: number;
  readonly tiles: number;
}

export interface TileBakeRequest {
  /** Deepest level to bake. */
  readonly maxZoom: number;
  /** Shallowest level to bake — 0 is the whole world in one tile. */
  readonly minZoom: number;
  readonly scheme: TileScheme;
  /** Which build this is, for the archive's own record. */
  readonly world: string;
}

export type TileRenderer = (extent: TileExtent, size: number) => Promise<BakedTile>;

/**
 * How many tiles one run may render before it is refused.
 *
 * Not a taste limit: the bake runs in the operator's own browser (there is no headless capture on the
 * development machine), each tile waits for the streamer, and z8 alone is 65 536 of them. A run that cannot
 * finish is worse than one that was never started, so the ceiling is stated and the refusal names it.
 */
export const BAKE_TILE_CAP = 4096;

/**
 * Render every planned tile and weld the archive.
 *
 * `onProgress` is called per tile because this is a long job on a phone: a bake with no visible progress is
 * one the operator kills halfway through.
 */
export async function bakeTiles(
  request: TileBakeRequest,
  render: TileRenderer,
  onProgress?: (done: number, total: number, tile: TileAddress) => void,
): Promise<{ archive: Uint8Array; report: TileBakeReport }> {
  const plan = planTiles(request.scheme, request.minZoom, request.maxZoom);
  if (plan.length > BAKE_TILE_CAP) {
    throw new Error(
      `tile bake: z${request.minZoom}–${request.maxZoom} is ${plan.length} tiles, past the ${BAKE_TILE_CAP} a browser bake can finish. Bake fewer levels.`,
    );
  }
  const started = Date.now();
  const tiles: PmtilesInputTile[] = [];
  const levels = new Map<number, { bytes: number; tiles: number }>();
  const seen = new Set<string>();
  let shared = 0;
  let mime = 'image/png';

  for (const [index, address] of plan.entries()) {
    const baked = await render(tileExtent(request.scheme, address), request.scheme.tileSize);
    mime = baked.mime;
    tiles.push({ bytes: baked.bytes, x: address.x, y: address.y, z: address.z });
    const level = levels.get(address.z) ?? { bytes: 0, tiles: 0 };
    levels.set(address.z, { bytes: level.bytes + baked.bytes.byteLength, tiles: level.tiles + 1 });
    // Content, not address: a bake of the sea is thousands of identical squares and the archive stores one.
    const key = `${baked.bytes.byteLength}:${fnv1a(baked.bytes)}`;
    if (seen.has(key)) {
      shared += 1;
    }
    seen.add(key);
    onProgress?.(index + 1, plan.length, address);
  }

  const archive = encodePmtiles({
    bounds: WHOLE_SQUARE,
    metadata: {
      built: new Date().toISOString(),
      scheme: request.scheme,
      world: request.world,
    },
    tiles,
    tileType: mime === 'image/webp' ? PmtilesTileType.WEBP : PmtilesTileType.PNG,
  });

  return {
    archive,
    report: {
      archiveBytes: archive.byteLength,
      byZoom: [...levels.entries()]
        .map(([zoom, level]): TileBakeLevel => ({ bytes: level.bytes, tiles: level.tiles, zoom }))
        .sort((a, b) => a.zoom - b.zoom),
      ms: Date.now() - started,
      shared,
      tiles: tiles.length,
    },
  };
}

/** What a report says in one line — the shape a field note and a benchmark row are both written from. */
export function describeBake(report: TileBakeReport): string {
  const levels = report.byZoom
    .map((level) => `z${level.zoom} ${level.tiles}×${(level.bytes / level.tiles / 1024).toFixed(1)}kB`)
    .join(' · ');

  return `${report.tiles} tiles in ${(report.ms / 1000).toFixed(1)}s → ${(report.archiveBytes / 1024 / 1024).toFixed(2)} MB · ${levels}`;
}

/** Every tile of every level in the requested range, shallowest first. */
export function planTiles(scheme: TileScheme, minZoom: number, maxZoom: number): readonly TileAddress[] {
  const tiles: TileAddress[] = [];
  for (let z = Math.max(0, minZoom); z <= maxZoom; z += 1) {
    const side = 2 ** z;
    for (let y = 0; y < side; y += 1) {
      for (let x = 0; x < side; x += 1) {
        tiles.push({ x, y, z });
      }
    }
  }

  return tiles;
}

/**
 * The header's lon/lat box.
 *
 * Our square is not on Earth and the format has nowhere else to put an extent, so the world square is mapped
 * onto the whole web-mercator square — the same choice SanMap made. Our own reader ignores it and takes the
 * square out of the metadata; a foreign reader at least gets a box of the right shape.
 */
const WHOLE_SQUARE = { centerZoom: 2, maxLat: 85.051_128_78, maxLon: 180, minLat: -85.051_128_78, minLon: -180 };
