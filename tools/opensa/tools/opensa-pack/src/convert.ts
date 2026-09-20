import type { AssetFileSystem, MapDefinitions } from '@opensa/renderware';
import type { RWUvAnimation } from '@opensa/renderware/parsers/binary/types';

import { GAME_CELL_SIZE } from '@opensa/cell-weld/cell-size';
import { PLANNER_CURSOR_START, TexturePlanner } from '@opensa/cell-weld/textures';
import {
  assembleCell,
  createUvAnimRegistry,
  uvAnimList,
  type UvAnimRegistry,
  WELD_ROW,
  weldCellParts,
  type WeldedCell,
  type WeldStats,
} from '@opensa/cell-weld/weld';
import {
  buildOspak,
  encodeOscol,
  encodeOswire,
  OSCELL_VERTEX_STRIDE,
  oscellSections,
  type OspakInput,
  type OspakManifest,
  OstexFormat,
} from '@opensa/engine-formats';
import { buildCellColliders, buildCollisionIndex } from '@opensa/renderware';
import { getClump } from '@opensa/renderware/archive/asset-cache';
import { getBreakable } from '@opensa/renderware/breakable/mesh';
import { breakableModelsFromText } from '@opensa/renderware/breakable/models';
import { OPEN_SCRIPT_IPL, resolveMap } from '@opensa/renderware/map/resolve-map';
import { buildWorldGrid, cellKey } from '@opensa/renderware/map/world-grid';
import { type RoadsignGlyphQuads, roadsignGlyphQuads } from '@opensa/renderware/roadsign/glyph-quads';
import { MeshoptEncoder } from 'meshoptimizer';
/**
 * District conversion orchestrator (plan 074/03): resolve the map → world grid → for every cell in the rect,
 * weld HD + LOD levels → build texture arrays → deterministic pak + manifest + the measurement report the
 * plan docs consume.
 */
import { deflateRawSync } from 'node:zlib';

import type { WaterHeightGrid } from './height-grid';

import { AO_MAX_DISTANCE, bakeAo, type BakeAoReport, buildOccluderBvh } from './ao';
import { createAstcEncoder } from './astc-encode';
import { bakeCellsPooled, defaultBakeWorkers } from './bake-pool';
import { clearChunkCheckpoints, readChunkCheckpoints, writeChunkCheckpoint } from './checkpoint';
import { type LodBakePromise, promisedGeometricError } from './geometric-error';
import { bakeCellCollision, collisionCellRect } from './pack-collision';
import { bakeSunVis, type BakeSunVisReport, SUNVIS_MAX_DISTANCE } from './sunvis';

export interface ConvertOptions {
  /** lod-TARGET models (lowercased) welded into BOTH levels (plan 087, `lod-always.json`): a TC's
   *  stub-HD/real-LOD pattern (gostown `LODEnsemble*` forests behind a `fakebit01` marker) would
   *  otherwise vanish inside the HD ring — see {@link buildWorldGrid}. */
  alwaysOnLods?: ReadonlySet<string>;
  /** Bake per-vertex AO/skyVis (074/07); on by default, `--no-ao` skips it. */
  ao?: boolean;
  /** Re-encode every world array as ASTC 4x4 (plan 200/2-02) — one byte per texel instead of RGBA8's four,
   *  on the GPUs that have no BC. Requires {@link forceRgba8}: the encode reads decoded layers, so the DXT
   *  passthrough must be off. */
  astc?: boolean;
  /** astcenc worker threads for the WORLD arrays. Must be threaded through: this encode is a separate call
   *  site from the model dictionaries', and until 2026-08-09 it silently kept the library's one-per-core
   *  default while `--astc-threads` capped only the other one — which is why three phone converts died
   *  HERE, at `encoding texture arrays`, with the cap apparently applied. */
  astcThreads?: number;

  /** Bake every cell's COLLISION into the pak (plan 200/3-01), so the browser never parses a COL. Off by
   *  default while the runtime still reads the archives — the bake costs build time and nothing reads the
   *  entries yet. Keyed on the GAME grid, never on the render one. */
  bakeCollision?: boolean;
  /** Bake pool size (074/14 A2); 1 = the serial in-process path. Default: a quarter of the cores. */
  bakeWorkers?: number;
  cellSize?: number;
  /**
   * Where per-chunk checkpoints are written (pmb plan 006): after every weld chunk, everything a later chunk
   * depends on. Absent = no checkpoints. With `resume`, the checkpoints found here are replayed and the
   * convert continues at the first chunk without one.
   */
  checkpointDir?: string;
  /** Chunk side in cells (074/14 A2 chunked welding); the full map cannot hold one welded heap. */
  chunkCells?: number;
  /** Shared overlay TXDs (basenames, no extension) searched when a def's own txdp chain misses. */
  fallbackTxds?: readonly string[];
  /** Emit every world texture as RGBA8 instead of passing SA's DXT through — the pak then loads on GPUs
   *  without BC (every mobile one). Costs 4-8x texture memory; pair it with a district `rect`. */
  forceRgba8?: boolean;
  /**
   * Weld the LOD level ONLY — the **baked 3D city map** (201/6-01): a world whose only tier is the far one.
   *
   * It is not a quality setting and not a degradation: the cell LODs are a whole simplified city already
   * (one merged mesh per cell over one shared downscaled dictionary — the modern open-world SLOD scheme),
   * and a map is what they are the right shape for. What it buys is the console's hardest budget: 150 units
   * with models at 60 fps inside 300–500 MB is a real risk in the live render and close to free here.
   *
   * The runtime needs no flag for it: a cell with no `hd` key already resolves to its `lod` one at every
   * distance inside the ring (`StreamingDriver.chooseLevel`), which is pinned by a test rather than assumed.
   */
  lodOnly?: boolean;
  /** What the cell-LOD bake promised (plan 201/1-05) — the pack turns it into the manifest's screen-error
   *  fields, so the runtime picks HD by projected error instead of by a ring radius. Absent (a pack run
   *  outside the pipeline) writes neither field and the runtime keeps its radii. */
  lodPromise?: LodBakePromise;
  /** Progress sink (chunk/bake/assembly lines with an ETA); silent when absent — tests stay quiet. */
  log?: (message: string) => void;
  /** Largest texture edge the pak may carry (0 = uncapped). Halving each edge takes back three quarters of
   *  what {@link forceRgba8} costs, which is what makes a district fit a phone. */
  maxTextureSize?: number;
  /**
   * Called once the whole map has been welded into the texture plan and before that plan is sealed — the
   * only point at which a per-model converter can resolve into the SHARED dictionary (003 phase 5g). A map
   * object's `.osm` carries no textures of its own precisely because it points into these arrays.
   */
  onWorldPlanned?: (planner: TexturePlanner, defs: MapDefinitions) => void;
  /** Inclusive GTA cell-coordinate rect [x0, y0, x1, y1]. Absent = every cell with content: a fixed rect
   *  silently drops whatever a TC places outside it (plan 087: gostown's far islands lived at x up to 37 —
   *  a quarter of its LOD map fell outside the old hardcoded ±12). */
  rect?: readonly [number, number, number, number];
  /** Continue from the checkpoints in `checkpointDir` (a chunk plan that differs is refused). */
  resume?: boolean;
  /** Curated stochastic de-tiling texture names, lowercased (074/12). */
  stochasticNames?: ReadonlySet<string>;
  /** Bake per-vertex sun visibility (074/07); on by default, `--no-sunvis` skips it. */
  sunVis?: boolean;
  /** Sea-level height sink (074/06 row 12 v3): welded triangles near sea level rasterize into it — the
   *  water bake then computes TRUE depth. Costs a linear pass per chunk, no rays. */
  waterHeights?: WaterHeightGrid;
}

export interface ConvertReport {
  /** IDE-anim instances welded at bind pose (frozen — no runtime animation yet). */
  /** Placements whose moving frames left the bundle for the host to animate (B7·b). */
  animatedObjects: number;
  animatedStatic: number;
  ao: (BakeAoReport & { ms: number }) | null;
  /** Smashable placements recorded (B7·a). */
  breakables: number;
  cells: { groups: number; indices: number; kbytes: number; key: string; vertices: number }[];
  /** Normals provenance over the rect's unique placed models (opensa-pack plan 001): `computed` = at least
   *  one triangle geometry ships NO normals block, so the runtime invented them — a conditioned
   *  (map-optimizer) input has ~0, vanilla ~93 %. */
  normals: { authored: number; computed: number };
  pakBytes: number;
  /** ObjectTable entries across cells (074/06 row 9: timed windows / props). */
  /** 2dfx PARTICLE emitters welded into the pak (B6). */
  particles: number;
  /** 2dfx roadsign entries welded as beam-class text (plan 076). */
  roadsigns: number;
  skippedTimed: number;
  sunVis: (BakeSunVisReport & { ms: number }) | null;
  textures: TexturePlanner['report'] & { arrays: number };
  timedObjects: number;
  uvAnimations: number;
  /** UV-scroll draws welded (B7·c) + distinct animations registered map-wide. */
  uvAnimObjects: number;
}

/** The invariant context of a `weldRect` pass — everything constant across its cells. */
export interface WeldRectContext {
  breakableModels: ReadonlySet<string>;
  cellSize: number;
  defs: ReturnType<typeof resolveMap>;
  fs: AssetFileSystem;
  grid: ReturnType<typeof buildWorldGrid>;
  /** Weld the LOD level ONLY (201/6-01): the baked 3D city map is a world whose only tier is the far one. */
  lodOnly?: boolean;
  planner: TexturePlanner;
  roadsignsByCell: ReadonlyMap<string, RoadsignGlyphQuads[]>;
  uvAnimRegistry: UvAnimRegistry;
}

/** World XZ AABB of a welded cell's geometry (engine coords, integer-rounded outward) — the manifest `aabb`
 *  the streaming rings test instead of the grid rect (plan 087: pivot-welded meshes reach past it). */
export function cellAabbXZ(cell: WeldedCell): [number, number, number, number] | undefined {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const bucket of cell.buckets) {
    if (bucket.vertices.length === 0) {
      continue;
    }
    minX = Math.min(minX, bucket.min[0]);
    maxX = Math.max(maxX, bucket.max[0]);
    minZ = Math.min(minZ, bucket.min[2]);
    maxZ = Math.max(maxZ, bucket.max[2]);
  }
  if (minX > maxX) {
    return undefined;
  }

  return [
    Math.floor(minX + cell.origin[0]),
    Math.ceil(maxX + cell.origin[0]),
    Math.floor(minZ + cell.origin[2]),
    Math.ceil(maxZ + cell.origin[2]),
  ];
}

/** World Y extent of a welded cell's geometry (engine coords, rounded outward) — the manifest `aabbY`
 *  a VIEW test needs and a ring never did (plan 201/1-05: a cell with no height cannot be frustum-tested,
 *  and a guessed one streams a tower out from under a pitched camera). */
export function cellAabbY(cell: WeldedCell): [number, number] | undefined {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const bucket of cell.buckets) {
    if (bucket.vertices.length === 0) {
      continue;
    }
    minY = Math.min(minY, bucket.min[1]);
    maxY = Math.max(maxY, bucket.max[1]);
  }

  return minY > maxY ? undefined : [Math.floor(minY + cell.origin[1]), Math.ceil(maxY + cell.origin[1])];
}

export async function convertDistrict(
  fs: AssetFileSystem,
  options: ConvertOptions,
): Promise<{ defs: MapDefinitions; manifest: OspakManifest; pak: Uint8Array; report: ConvertReport }> {
  await MeshoptEncoder.ready;
  const cellSize = options.cellSize ?? 250;
  const defs = resolveMap(fs, { extraIpl: OPEN_SCRIPT_IPL });
  // Smashable props (B7·a): object.dat's smash effects are the second half of the gate (the first is the DFF's
  // own shatter mesh). Absent-tolerant, and the SAME helper the runtime adapter gates with.
  const breakableModels = breakableModelsFromText(fs.getText('data/object.dat'));
  const grid = buildWorldGrid(defs, cellSize, options.alwaysOnLods);
  const rect = options.rect ?? occupiedRect(grid);
  const planner = new TexturePlanner(
    fs,
    defs.txdParents ?? new Map<string, string>(),
    options.fallbackTxds ?? [],
    options.stochasticNames ?? new Set(),
    { forceRgba8: options.forceRgba8 ?? false, maxTextureSize: options.maxTextureSize ?? 0 },
  );

  const inputs: OspakInput[] = [];
  // The bake's promise as a world size, written onto every LOD entry — see `geometric-error.ts`.
  const lodError = options.lodPromise === undefined ? undefined : promisedGeometricError(options.lodPromise);
  const report: ConvertReport = {
    animatedObjects: 0,
    animatedStatic: 0,
    ao: null,
    breakables: 0,
    cells: [],
    normals: countNormalsProvenance(fs, defs, rect, cellSize),
    pakBytes: 0,
    particles: 0,
    roadsigns: 0,
    skippedTimed: 0,
    sunVis: null,
    textures: { arrays: 0, colors: 0, crossTxd: {}, dedup: 0, missing: {}, opaquePass: 0, processed: 0 },
    timedObjects: 0,
    uvAnimations: 0,
    uvAnimObjects: 0,
  };
  // UV-scroll (B7·c / plan 074/18): one registry for the whole convert — dict names are global, so every
  // material referencing one shares a slot; only the HD (non-occluder) weld feeds it.
  const uvAnims = createUvAnimRegistry();
  // Roadsign text (plan 076): a GLOBAL pre-pass — 2dfx roadsigns store WORLD coords (not instance-local), so
  // each is bucketed by the cell containing its position (near its instance, ≤~60 m in the data) and welded
  // there; deduped by model (its coords are the same for every instance).
  const roadsignsByCell = collectRoadsigns(fs, defs, cellSize);

  // Phases 1-2, CHUNKED (074/14 A2): weld → bake → encode per chunk of cells, releasing the weld scratch
  // between chunks — the full map cannot hold one welded heap (16 GB held ONE city). The bake ring
  // (2 cells @250) covers the longest bake ray (sun-vis 400 u), so a chunk BVH shadows exactly like the
  // old district BVH; ring cells weld ONLY as occluders (HD, uncounted) and re-weld in their own chunk.
  // NB chunking changes texture-array layer ORDER vs the monolithic path (ring cells plan textures early)
  // — reruns stay byte-identical, which is the determinism contract.
  const ao = options.ao !== false;
  const sunVis = options.sunVis !== false;
  const chunkSide = Math.max(1, options.chunkCells ?? 6);
  const ringCells = ao || sunVis ? Math.ceil(Math.max(AO_MAX_DISTANCE, SUNVIS_MAX_DISTANCE) / cellSize) : 0;
  const workers = options.bakeWorkers ?? defaultBakeWorkers();
  const log = options.log ?? ((): void => undefined);
  const [x0, y0, x1, y1] = normalizedRect(rect);

  const chunks = planChunks(grid, [x0, y0, x1, y1], chunkSide);
  const totalCells = chunks.reduce((sum, entry) => sum + entry.cells, 0);
  log(
    `plan: rect ${x0},${y0},${x1},${y1}${options.rect ? '' : ' (auto-fit to content)'} — ` +
      `${chunks.length} chunks / ${totalCells} grid cells (chunk ${chunkSide}², bake ring ${ringCells})`,
  );
  const startedMs = Date.now();
  let doneCells = 0;

  // Checkpoints (pmb plan 006): a fresh convert clears any previous run's; a resume replays them onto the
  // fresh state above and skips the chunks they cover.
  const chunkPlan = chunks.map((chunk) => chunk.rect.join(','));
  const resumed = openCheckpoints(options, chunkPlan, { inputs, planner, report, uvAnims }, log);
  const firstChunk = resumed.firstChunk;
  doneCells = resumed.doneCells;
  const checkpoint = (chunkIndex: number, produced: readonly OspakInput[]): void =>
    resumed.write(chunkIndex, produced, doneCells, report, uvAnims, options.waterHeights);

  for (const [chunkIndex, chunk] of chunks.entries()) {
    if (chunkIndex < firstChunk) {
      continue;
    }
    const tag = `chunk ${chunkIndex + 1}/${chunks.length} [${chunk.rect.join(',')}]`;
    const chunkStarted = Date.now();
    const welded = weldRect(
      fs,
      defs,
      grid,
      planner,
      chunk.rect,
      cellSize,
      breakableModels,
      uvAnims,
      roadsignsByCell,
      options.lodOnly ?? false,
    );
    if (welded.length === 0) {
      doneCells += chunk.cells;
      checkpoint(chunkIndex, []);
      continue;
    }
    if (ao || sunVis) {
      // Occluder ring: HD-only welds of the surrounding cells (clipped to the convert rect — geometry
      // outside it never occluded in the monolithic path either).
      const ring = weldRing(fs, defs, grid, planner, chunk.rect, [x0, y0, x1, y1], ringCells, cellSize);
      const cellsOnly = welded.map((entry) => entry.cell);
      const bvh = buildOccluderBvh([...cellsOnly, ...ring]);
      // Bucket rows, not stats (stats.vertices only fills during the later encode pass).
      const verts = cellsOnly.reduce(
        (sum, cell) => sum + cell.buckets.reduce((rows, bucket) => rows + bucket.vertices.length / WELD_ROW, 0),
        0,
      );
      log(`${tag}: welded ${welded.length} entries (${(verts / 1e6).toFixed(2)} M verts), baking …`);
      await bakeChunk(cellsOnly, bvh, { ao, sunVis, workers }, report);
    }
    if (options.waterHeights) {
      collectWaterHeights(options.waterHeights, welded);
    }
    const produced = assembleChunk(welded, report, lodError);
    inputs.push(...produced);
    doneCells += chunk.cells;
    checkpoint(chunkIndex, produced);
    const elapsed = (Date.now() - startedMs) / 1000;
    const eta = doneCells > 0 ? (elapsed * (totalCells - doneCells)) / doneCells : 0;
    log(
      `${tag}: done in ${((Date.now() - chunkStarted) / 1000).toFixed(1)}s — ` +
        `${doneCells}/${totalCells} cells (${((doneCells / totalCells) * 100).toFixed(0)} %), ` +
        `elapsed ${elapsed.toFixed(0)}s, eta ~${eta.toFixed(0)}s`,
    );
  }

  // The ONE moment the world's texture plan is both COMPLETE (every cell welded) and still OPEN (not yet
  // sealed by `build()`): the per-model conversion hooks in here, because a map object's dictionary IS
  // this plan (003 phase 5g).
  options.onWorldPlanned?.(planner, defs);

  const collisionCells = options.bakeCollision
    ? bakeCollision(fs, defs, [x0, y0, x1, y1], cellSize, breakableModels, inputs, log)
    : 0;

  log('encoding texture arrays …');
  for (const input of await encodeTextureArrays(planner, options.astc === true, options.astcThreads ?? 0, log)) {
    inputs.push(input);
    report.textures.arrays += 1;
  }
  Object.assign(report.textures, planner.report, { arrays: report.textures.arrays });
  log(`assembling pak (${inputs.length} entries) …`);

  const uvAnimations = uvAnimList(uvAnims);
  report.uvAnimations = uvAnimations.length;
  const { manifest, pak } = buildOspak(inputs, {
    cellSize,
    ...(collisionCells > 0 ? { collisionCellSize: GAME_CELL_SIZE } : {}),
    ...(options.lodPromise !== undefined ? { lodPixelThreshold: options.lodPromise.screenPixels } : {}),
    missingLayers: planner.missingLayers, // buildOspak drops the key when the list is empty
    uvAnimations, // buildOspak drops the key when the list is empty
  });
  report.pakBytes = pak.byteLength;

  return { defs, manifest, pak, report };
}

export function normalizedRect(rect: readonly [number, number, number, number]): [number, number, number, number] {
  return [
    Math.min(rect[0], rect[2]),
    Math.min(rect[1], rect[3]),
    Math.max(rect[0], rect[2]),
    Math.max(rect[1], rect[3]),
  ];
}

/** The tightest cell rect covering every grid cell with content — the no-`rect` default (a TC's true extent). */
export function occupiedRect(grid: ReturnType<typeof buildWorldGrid>): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const cell of grid.values()) {
    x0 = Math.min(x0, cell.cx);
    y0 = Math.min(y0, cell.cy);
    x1 = Math.max(x1, cell.cx);
    y1 = Math.max(y1, cell.cy);
  }
  if (x0 > x1) {
    throw new Error('cannot auto-fit the convert rect: the world grid has no exterior instances');
  }

  return [x0, y0, x1, y1];
}

/**
 * Weld one grid cell's HD + LOD levels (skips empty cells); appends the results to `welded`.
 *
 * Exported for its test: which of the two levels gets the cell's roadsign list is decided HERE, and losing
 * the LOD half is silent — the bundle simply welds no text and the plate goes blank past the HD ring.
 */
export function weldGridCell(
  ctx: WeldRectContext,
  cx: number,
  cy: number,
  welded: { cell: WeldedCell; key: string }[],
): void {
  const cell = ctx.grid.get(cellKey(cx, cy));
  if (!cell) {
    return;
  }
  // Cell origin in ENGINE coords: GTA cell centre (x, y) → engine (x, 0, −y).
  const origin: [number, number, number] = [(cx + 0.5) * ctx.cellSize, 0, -(cy + 0.5) * ctx.cellSize];
  const roadsigns = ctx.roadsignsByCell.get(cellKey(cx, cy));
  // Both levels, unless the build is the baked 3D city map — where the LOD tier is the whole world and the
  // HD weld would be geometry the pak carries and nothing ever asks for (201/6-01). The occluder ring the
  // AO bake reads stays HD either way: it is an INPUT to the bake, not an entry in the pak.
  for (const lod of ctx.lodOnly ? [true] : [false, true]) {
    // Both levels get the same world-keyed roadsign list since plan 100/03 — the text has to survive to LOD
    // range, and one key per plate is what keeps it from doubling (see `weldCellParts`' note).
    const parts = weldCellParts(
      ctx.fs,
      ctx.defs,
      cell,
      lod,
      ctx.planner,
      origin,
      ctx.breakableModels,
      ctx.uvAnimRegistry,
      roadsigns,
    );
    if (parts) {
      welded.push({ cell: parts, key: `${cx},${cy},${lod ? 'lod' : 'hd'}` });
    }
  }
}

function accumulate(report: ConvertReport, key: string, bytes: number, stats: WeldStats): void {
  report.cells.push({
    groups: stats.groups,
    indices: stats.indices,
    kbytes: Math.round(bytes / 1024),
    key,
    vertices: stats.vertices,
  });
  report.animatedStatic += stats.animatedStatic;
  report.animatedObjects += stats.animatedObjects;
  report.skippedTimed += stats.skippedTimed;
  report.particles += stats.particles;
  report.timedObjects += stats.timedObjects;
  report.uvAnimObjects += stats.uvAnimObjects;
  report.roadsigns += stats.roadsigns;
  report.breakables += stats.breakables;
}

/**
 * One welded chunk's cells as pak inputs, accumulating each cell's stats into the report on the way.
 *
 * Every cell records the texture arrays it binds, so the runtime can load textures PER RING instead of
 * uploading the whole district up front (074/21 residency follow-up, 003 phase 4).
 */
function assembleChunk(
  welded: readonly { cell: WeldedCell; key: string }[],
  report: ConvertReport,
  lodError: number | undefined,
): OspakInput[] {
  const produced: OspakInput[] = [];
  for (const entry of welded) {
    const bytes = assembleCell(entry.cell);
    const textures = entry.cell.buckets.map((bucket) => bucket.textureArrayRef);
    const aabb = cellAabbXZ(entry.cell);
    const aabbY = cellAabbY(entry.cell);
    produced.push(
      wireCompress({
        ...(aabb !== undefined ? { aabb } : {}),
        ...(aabbY !== undefined ? { aabbY } : {}),
        bytes,
        ...(lodError === undefined ? {} : { geometricError: entry.key.endsWith(',lod') ? lodError : 0 }),
        key: entry.key,
        kind: 'cell',
        textures,
      }),
    );
    accumulate(report, entry.key, bytes.byteLength, entry.cell.stats);
  }

  return produced;
}

/** Bake one chunk's cells (pooled when workers > 1) and fold the counters into the report. */
async function bakeChunk(
  cells: WeldedCell[],
  bvh: ReturnType<typeof buildOccluderBvh>,
  options: { ao: boolean; sunVis: boolean; workers: number },
  report: ConvertReport,
): Promise<void> {
  const started = Date.now();
  if (options.workers > 1) {
    // Pooled path: both bakes run interleaved per cell across the pool — the wall time is one shared
    // number, attributed to both report rows.
    const pooled = await bakeCellsPooled(cells, bvh, options);
    mergeBakeReports(report, pooled.ao, pooled.sunVis, Date.now() - started);

    return;
  }
  const aoBake = options.ao ? bakeAo(cells, { bvh }) : null;
  const aoMs = Date.now() - started;
  const sunStarted = Date.now();
  const sunBake = options.sunVis ? bakeSunVis(cells, bvh) : null;
  mergeBakeReports(report, aoBake, sunBake, aoMs, Date.now() - sunStarted);
}

/**
 * Bake the district's collision onto the GAME grid and push one `.oscol` entry per non-empty cell.
 *
 * The rect conversion is the whole of the care here: the convert rect is in RENDER cells (250) and collision
 * streams on 256, so the cells are re-derived through the world extent rather than reused
 * (`collisionCellRect`). An empty cell contributes no entry — the runtime treats a missing key as "this pak
 * has no bake for that cell" and falls back, which is also what an older pak looks like.
 *
 * The breakable gate is resolved HERE for the same reason the collision is: the runtime's version of it opens
 * a model's DFF to look for a shatter mesh, which is an archive read on the one path this bake exists to keep
 * out of the archive. It is the same gate, expression for expression — a RW Breakable atomic (or a converted
 * `.osm` SHAT section) OR an `object.dat` smash effect — over the same lowercased region names.
 */
function bakeCollision(
  fs: AssetFileSystem,
  defs: MapDefinitions,
  renderRect: readonly [number, number, number, number],
  cellSize: number,
  breakableModels: ReadonlySet<string>,
  inputs: OspakInput[],
  log: (message: string) => void,
): number {
  const index = buildCollisionIndex(fs);
  const grid = buildWorldGrid(defs, GAME_CELL_SIZE);
  const [gx0, gy0, gx1, gy1] = collisionCellRect(renderRect, cellSize, GAME_CELL_SIZE);
  // Memoized per RUN, not per cell: the shatter-mesh half of the gate parses the model's DFF, the same model
  // stands in many cells, and `getClump`'s LRU is 512 against a map with thousands of models — without this
  // the bake re-parses the same geometry until the flag is too slow to use on a full map.
  const breakableByModel = new Map<string, boolean>();
  const isBreakable = (modelName: string): boolean => {
    let known = breakableByModel.get(modelName);
    if (known === undefined) {
      known = getBreakable(fs, modelName) !== undefined || breakableModels.has(modelName);
      breakableByModel.set(modelName, known);
    }

    return known;
  };
  let cells = 0;
  let triangles = 0;
  let breakables = 0;
  for (let cy = gy0; cy <= gy1; cy += 1) {
    for (let cx = gx0; cx <= gx1; cx += 1) {
      const regions = buildCellColliders(index, defs, grid, cx, cy);
      if (regions.length === 0) {
        continue;
      }
      const baked = bakeCellCollision(regions, isBreakable);
      triangles += baked.regions.reduce((total, region) => total + region.indices.length / 3, 0);
      breakables += baked.regions.filter((region) => region.instanceKeys !== undefined).length;
      inputs.push(wireCompress({ bytes: encodeOscol(baked), key: `${cx},${cy}`, kind: 'collision' }));
      cells += 1;
    }
  }
  log(
    `collision: baked ${cells} cells (${triangles} triangles, ${breakables} breakable regions) on the ${GAME_CELL_SIZE} game grid`,
  );

  return cells;
}

/** Build one roadsign's glyph quads and file them under the cell containing its WORLD position. */
function bucketRoadsign(
  sign: Parameters<typeof roadsignGlyphQuads>[0],
  cellSize: number,
  byCell: Map<string, RoadsignGlyphQuads[]>,
): void {
  const quads = roadsignGlyphQuads(sign);
  if (!quads) {
    return;
  }
  const key = cellKey(Math.floor(sign.position[0] / cellSize), Math.floor(sign.position[1] / cellSize));
  const list = byCell.get(key);
  if (list) {
    list.push(quads);
  } else {
    byCell.set(key, [quads]);
  }
}

/**
 * Global roadsign pre-pass (plan 076): each unique placed model's 2dfx roadsign entries → world-space glyph
 * quads, bucketed by the cell that contains the sign's WORLD position (roadsigns store world coords, not
 * instance-local). Deduped by model id — a roadsign's coords are the same for every instance, so it welds ONCE
 * regardless of placement count (matching prod, which adds the parts once with an identity transform).
 */
function collectRoadsigns(
  fs: AssetFileSystem,
  defs: ReturnType<typeof resolveMap>,
  cellSize: number,
): Map<string, RoadsignGlyphQuads[]> {
  const byCell = new Map<string, RoadsignGlyphQuads[]>();
  const seen = new Set<number>();
  for (const instance of defs.instances) {
    if (instance.isLod || seen.has(instance.id)) {
      continue;
    }
    seen.add(instance.id);
    const def = defs.catalog.get(instance.id);
    const clump = def ? tryGetClump(fs, def.modelName) : null;
    for (const sign of clump?.geometries.flatMap((geometry) => geometry.roadsigns ?? []) ?? []) {
      bucketRoadsign(sign, cellSize, byCell);
    }
  }

  return byCell;
}

/** Feed HD welded triangles into the sea-level height grid (074/06 row 12 v3). Cell-local ENGINE coords →
 *  GTA: gx = ox+px, gy = −(oz+pz), gz = oy+py. LOD entries skip — they duplicate the HD ground. */
function collectWaterHeights(gridSink: WaterHeightGrid, welded: readonly { cell: WeldedCell; key: string }[]): void {
  for (const { cell } of welded) {
    if (cell.lod) {
      continue;
    }
    const [ox, oy, oz] = cell.origin;
    for (const bucket of cell.buckets) {
      const rows = bucket.vertices;
      const gta = (index: number): [number, number, number] => {
        const at = index * WELD_ROW;

        return [ox + rows[at], -(oz + rows[at + 2]), oy + rows[at + 1]];
      };
      for (let tri = 0; tri + 2 < bucket.indices.length; tri += 3) {
        const a = gta(bucket.indices[tri]);
        const b = gta(bucket.indices[tri + 1]);
        const c = gta(bucket.indices[tri + 2]);
        gridSink.addTriangle(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      }
    }
  }
}

/** `getClump` that swallows a missing/broken DFF (returns null) — the roadsign pre-pass skips it. */
/**
 * Normals provenance over the rect's unique placed models (opensa-pack plan 001): a model counts `computed`
 * when ANY triangle geometry ships no normals block — the runtime then invents them (naive index average,
 * the plan-17 polygon-patch cause). Clump parses are cached, so the weld re-uses every one of these reads.
 */
function countNormalsProvenance(
  fs: AssetFileSystem,
  defs: ReturnType<typeof resolveMap>,
  rect: readonly [number, number, number, number],
  cellSize: number,
): { authored: number; computed: number } {
  const [x0, y0, x1, y1] = normalizedRect(rect);
  const [minX, minY, maxX, maxY] = [x0 * cellSize, y0 * cellSize, (x1 + 1) * cellSize, (y1 + 1) * cellSize];
  const seen = new Set<number>();
  let authored = 0;
  let computed = 0;
  for (const instance of defs.instances) {
    const [ix, iy] = instance.position;
    if (ix < minX || ix >= maxX || iy < minY || iy >= maxY || seen.has(instance.id)) {
      continue;
    }
    seen.add(instance.id);
    const def = defs.catalog.get(instance.id);
    const clump = def ? tryGetClump(fs, def.modelName) : null;
    if (!clump) {
      continue;
    }
    const meshes = clump.geometries.filter((geometry) => geometry.triangles.length > 0);
    if (meshes.length === 0) {
      continue;
    }
    if (meshes.some((geometry) => !geometry.normals)) {
      computed += 1;
    } else {
      authored += 1;
    }
  }

  return { authored, computed };
}

/** Grid cells with content inside a rect — the progress/ETA weight (cheap: pure map lookups). */
function countRectCells(
  grid: ReturnType<typeof buildWorldGrid>,
  rect: readonly [number, number, number, number],
): number {
  let count = 0;
  for (let cy = rect[1]; cy <= rect[3]; cy += 1) {
    for (let cx = rect[0]; cx <= rect[2]; cx += 1) {
      if (grid.has(cellKey(cx, cy))) {
        count += 1;
      }
    }
  }

  return count;
}

async function encodeTextureArrays(
  planner: TexturePlanner,
  astc: boolean,
  astcThreads: number,
  log: (message: string) => void,
): Promise<OspakInput[]> {
  const encoder = astc ? createAstcEncoder({ threads: astcThreads }) : null;
  const inputs: OspakInput[] = [];
  const arrays = planner.build();
  // The ASTC pass is minutes long, single-threaded on a phone, and used to print ONE line before it and one
  // after — so a working encode and a hung one looked identical for the whole stage. Progress is per array
  // (the granularity the loop actually has) in mip-0 texels, which is what the eta is proportional to.
  const totalTexels = arrays.reduce((sum, array) => sum + texelsOf(array.meta), 0);
  const started = Date.now();
  let doneTexels = 0;
  for (const [index, array] of arrays.entries()) {
    const bytes = encoder === null ? array.bytes : await encoder.ostex(array.bytes);
    const meta = encoder === null ? array.meta : { ...array.meta, format: OstexFormat.ASTC4x4 };
    inputs.push(wireCompress({ bytes, key: `array-${array.ref}`, kind: 'texture', meta }));
    doneTexels += texelsOf(array.meta);
    if (encoder !== null) {
      const elapsed = (Date.now() - started) / 1000;
      const eta = (elapsed / doneTexels) * (totalTexels - doneTexels);
      log(
        `astc: array ${index + 1}/${arrays.length} — ${(doneTexels / 1e6).toFixed(1)}/` +
          `${(totalTexels / 1e6).toFixed(1)} M texels, elapsed ${elapsed.toFixed(0)}s, eta ~${eta.toFixed(0)}s`,
      );
    }
  }
  if (encoder !== null) {
    log(
      `astc: world arrays, ${(encoder.stats.texels / 1e6).toFixed(1)} M texels in ` +
        `${(encoder.stats.ms / 1000).toFixed(1)} s`,
    );
  }

  return inputs;
}

/** Fold one chunk's bake counters into the report (ms accumulates; both pooled rows share one wall time). */
function mergeBakeReports(
  report: ConvertReport,
  aoBake: BakeAoReport | null,
  sunBake: BakeSunVisReport | null,
  aoMs: number,
  sunMs = aoMs,
): void {
  if (aoBake) {
    const prev = report.ao ?? { ms: 0, rays: 0, triangles: 0, uniqueVertices: 0, vertices: 0 };
    report.ao = {
      ms: prev.ms + aoMs,
      rays: prev.rays + aoBake.rays,
      // Ring occluders overlap between chunks — the sum overcounts shared border triangles.
      triangles: prev.triangles + aoBake.triangles,
      uniqueVertices: prev.uniqueVertices + aoBake.uniqueVertices,
      vertices: prev.vertices + aoBake.vertices,
    };
  }
  if (sunBake) {
    const prev = report.sunVis ?? { ms: 0, rays: 0, uniqueVertices: 0, vertices: 0 };
    report.sunVis = {
      ms: prev.ms + sunMs,
      rays: prev.rays + sunBake.rays,
      uniqueVertices: prev.uniqueVertices + sunBake.uniqueVertices,
      vertices: prev.vertices + sunBake.vertices,
    };
  }
}

/**
 * The convert's checkpoint session (pmb plan 006): with `resume`, replay every checkpoint under
 * `checkpointDir` onto the fresh state (inputs, report, UV anims, water, planner) and say which chunk to
 * continue at; without it, clear the dir. `write` journals one finished chunk. No dir = no-op session.
 */
function openCheckpoints(
  options: ConvertOptions,
  chunkPlan: readonly string[],
  state: {
    inputs: OspakInput[];
    planner: TexturePlanner;
    report: ConvertReport;
    uvAnims: ReturnType<typeof createUvAnimRegistry>;
  },
  log: (message: string) => void,
): {
  doneCells: number;
  firstChunk: number;
  write: (
    chunkIndex: number,
    produced: readonly OspakInput[],
    doneCells: number,
    report: ConvertReport,
    uvAnims: ReturnType<typeof createUvAnimRegistry>,
    water: undefined | WaterHeightGrid,
  ) => void;
} {
  const dir = options.checkpointDir;
  let plannerCursor = PLANNER_CURSOR_START;
  let firstChunk = 0;
  let doneCells = 0;
  if (dir !== undefined && options.resume) {
    for (const checkpoint of readChunkCheckpoints(dir)) {
      if (checkpoint.chunkPlan.join(';') !== chunkPlan.join(';')) {
        throw new Error(
          `resume refused: the checkpoints in ${dir} were written for a different chunk plan ` +
            `(${checkpoint.chunkPlan.length} chunks vs ${chunkPlan.length} now) — run without resume`,
        );
      }
      state.inputs.push(...checkpoint.inputs);
      Object.assign(state.report, checkpoint.report as ConvertReport);
      restoreUvAnims(state.uvAnims, checkpoint.uvAnims);
      options.waterHeights?.restore(checkpoint.water);
      state.planner.restore(checkpoint.planner);
      plannerCursor = state.planner.journalSince(plannerCursor).cursor;
      doneCells = checkpoint.doneCells;
      firstChunk = checkpoint.chunkIndex + 1;
    }
    if (firstChunk > 0) {
      log(
        `resume: ${firstChunk}/${chunkPlan.length} chunks taken from checkpoints (${doneCells} cells) — continuing; ` +
          'the model classes after the weld are NOT checkpointed and re-run ' +
          '(docs/in-reserve/opensa-pack-model-class-checkpoints.md)',
      );
    }
  } else if (dir !== undefined) {
    clearChunkCheckpoints(dir);
  }

  return {
    doneCells,
    firstChunk,
    write: (chunkIndex, produced, done, report, uvAnims, water): void => {
      if (dir === undefined) {
        return;
      }
      const { cursor, journal } = state.planner.journalSince(plannerCursor);
      plannerCursor = cursor;
      writeChunkCheckpoint(dir, {
        chunkIndex,
        chunkPlan,
        doneCells: done,
        inputs: produced,
        planner: journal,
        report: structuredClone(report),
        uvAnims: [...uvAnims.byName].map(([name, entry]) => ({ anim: entry.anim, name, slot: entry.slot })),
        water: water?.entries() ?? [],
      });
    },
  };
}

/** Split a normalized rect into chunk rects, keeping only chunks with content. Progress accounting rides
 *  the cell counts (user ask: long converts must say where they are and what's left) — the grid knows which
 *  cells have content up front, so the ETA weights chunks by their cell counts, not chunk counts. */
function planChunks(
  grid: ReturnType<typeof buildWorldGrid>,
  [x0, y0, x1, y1]: readonly [number, number, number, number],
  chunkSide: number,
): { cells: number; rect: readonly [number, number, number, number] }[] {
  const chunks: { cells: number; rect: readonly [number, number, number, number] }[] = [];
  for (let chunkY = y0; chunkY <= y1; chunkY += chunkSide) {
    for (let chunkX = x0; chunkX <= x1; chunkX += chunkSide) {
      const rect = [
        chunkX,
        chunkY,
        Math.min(chunkX + chunkSide - 1, x1),
        Math.min(chunkY + chunkSide - 1, y1),
      ] as const;
      const cells = countRectCells(grid, rect);
      if (cells > 0) {
        chunks.push({ cells, rect });
      }
    }
  }

  return chunks;
}

/** Put a checkpointed UV-anim registry back (slots are the manifest order, so they must survive a resume). */
function restoreUvAnims(
  registry: ReturnType<typeof createUvAnimRegistry>,
  entries: readonly { readonly anim: RWUvAnimation; readonly name: string; readonly slot: number }[],
): void {
  registry.byName.clear();
  for (const entry of entries) {
    registry.byName.set(entry.name, { anim: entry.anim, slot: entry.slot });
  }
}

/**
 * Seal the texture plan into pak inputs, re-encoding to ASTC 4x4 when the build asked for it (200/2-02).
 *
 * The format lives in the entry META as well as in the `.ostex` header: the manifest is what the runtime's
 * platform check and `texture-budget.ts` read, and a manifest that still said RGBA8 would describe a pak that
 * no longer exists.
 */
/** Mip-0 texels of one planned array — the progress unit the ASTC pass advances in. */
function texelsOf(meta: { height: number; layers: number; width: number }): number {
  return meta.width * meta.height * meta.layers;
}

function tryGetClump(fs: AssetFileSystem, modelName: string): null | ReturnType<typeof getClump> {
  try {
    return getClump(fs, modelName);
  } catch {
    return null;
  }
}

function weldRect(
  fs: AssetFileSystem,
  defs: ReturnType<typeof resolveMap>,
  grid: ReturnType<typeof buildWorldGrid>,
  planner: TexturePlanner,
  rect: readonly [number, number, number, number],
  cellSize: number,
  breakableModels: ReadonlySet<string>,
  uvAnimRegistry: UvAnimRegistry,
  roadsignsByCell: ReadonlyMap<string, RoadsignGlyphQuads[]>,
  lodOnly = false,
): { cell: WeldedCell; key: string }[] {
  const ctx: WeldRectContext = {
    breakableModels,
    cellSize,
    defs,
    fs,
    grid,
    lodOnly,
    planner,
    roadsignsByCell,
    uvAnimRegistry,
  };
  const [x0, y0, x1, y1] = rect;
  const welded: { cell: WeldedCell; key: string }[] = [];
  for (let cx = Math.min(x0, x1); cx <= Math.max(x0, x1); cx += 1) {
    for (let cy = Math.min(y0, y1); cy <= Math.max(y0, y1); cy += 1) {
      weldGridCell(ctx, cx, cy, welded);
    }
  }

  return welded;
}

/** HD-only occluder welds of the ring around `inner` (clipped to the convert rect, inner cells excluded). */
function weldRing(
  fs: AssetFileSystem,
  defs: ReturnType<typeof resolveMap>,
  grid: ReturnType<typeof buildWorldGrid>,
  planner: TexturePlanner,
  inner: readonly [number, number, number, number],
  rect: readonly [number, number, number, number],
  ring: number,
  cellSize: number,
): WeldedCell[] {
  const cells: WeldedCell[] = [];
  for (let cy = Math.max(inner[1] - ring, rect[1]); cy <= Math.min(inner[3] + ring, rect[3]); cy += 1) {
    for (let cx = Math.max(inner[0] - ring, rect[0]); cx <= Math.min(inner[2] + ring, rect[2]); cx += 1) {
      if (cx >= inner[0] && cx <= inner[2] && cy >= inner[1] && cy <= inner[3]) {
        continue;
      }
      const cell = grid.get(cellKey(cx, cy));
      if (!cell) {
        continue;
      }
      const origin: [number, number, number] = [(cx + 0.5) * cellSize, 0, -(cy + 0.5) * cellSize];
      const parts = weldCellParts(fs, defs, cell, false, planner, origin);
      if (parts) {
        cells.push(parts);
      }
    }
  }

  return cells;
}

/** Per-entry wire compression (074/10 A1 + 074/14 stage 2): cells go meshopt (vertex + index streams in an
 *  `.oswire` container) then deflate-raw; everything else plain deflate-raw — natively inflatable in the pak
 *  worker via `DecompressionStream`. Skipped when it doesn't pay (already-compressed payloads). */
function wireCompress(input: OspakInput): OspakInput {
  if (input.kind === 'cell') {
    const sections = oscellSections(input.bytes);
    // The meshopt index codec is triangle-list-only; every welded cell is one (guard stays for safety).
    // NB the codec canonicalizes each triangle's cyclic rotation (order + winding preserved, provoking
    // vertex not) — safe here because the only flat-interpolated attribute is the texture layer, and a
    // triangle never mixes layers (vertex dedup keys the full 36-byte content; one triangle = one material).
    if (sections.indexCount % 3 === 0 && sections.vertexCount > 0 && sections.indexCount > 0) {
      const vertexBlock = MeshoptEncoder.encodeVertexBuffer(
        input.bytes.subarray(
          sections.vertexOffset,
          sections.vertexOffset + sections.vertexCount * OSCELL_VERTEX_STRIDE,
        ),
        sections.vertexCount,
        OSCELL_VERTEX_STRIDE,
      );
      const indexBlock = MeshoptEncoder.encodeIndexBuffer(
        input.bytes.subarray(sections.indexOffset, sections.tailOffset),
        sections.indexCount,
        sections.indexElemSize,
      );
      const container = encodeOswire(input.bytes, vertexBlock, indexBlock);
      const wire = deflateRawSync(container, { level: 6 });
      if (wire.byteLength < input.bytes.byteLength * 0.95) {
        return { ...input, bytes: wire, enc: 'oswire-deflate-raw', rawLength: input.bytes.byteLength };
      }
    }
  }
  const wire = deflateRawSync(input.bytes, { level: 6 });
  if (wire.byteLength >= input.bytes.byteLength * 0.95) {
    return input;
  }

  return { ...input, bytes: wire, enc: 'deflate-raw', rawLength: input.bytes.byteLength };
}
