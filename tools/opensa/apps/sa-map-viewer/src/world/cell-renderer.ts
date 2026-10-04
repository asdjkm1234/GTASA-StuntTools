/**
 * Cells into the engine, welded IN THE BROWSER (plan 094, decision 1). The same `weldCell` the converter runs
 * offline produces the `.oscell` bytes, the same `TexturePlanner` produces the `.ostex` arrays, and both go
 * straight into `engine.cells.load` / `engine.textures.load` — no pak, no `.oswire`, no bakes. What the viewer
 * draws is therefore what the game would draw for these files.
 *
 * **One planner for the session, and welded bytes are cached** (phase 2). The plan is append-only and
 * deterministic — a texture keeps the layer index its first use gave it — so a cell welded earlier stays
 * valid as later cells extend the plan. What is NOT stable is the GPU side: a texture array that gains layers
 * has to be re-uploaded, and every render bundle recorded against the old one dies with it. So when an array
 * changes, every resident cell is re-created — from the cache, not re-welded. Welding is the ~200 ms per
 * cell; re-creating from bytes is not.
 */
import type { Engine } from '@opensa/engine';

import { CELL_SIZE, TexturePlanner, weldCell } from '@opensa/cell-weld';
import { cellKey, cellModelNames } from '@opensa/renderware';

import type { LoadedMap } from '../source/map-source';

export interface CellCoord {
  cx: number;
  cy: number;
}

/** What one `setCells` cost and produced — the phase-1/2 measurement. */
export interface CellLoadStats {
  /** Arrays resident after this call. */
  arrays: number;
  /** Source bytes read for the models/textures this call needed (0 once they are resident). */
  assetBytes: number;
  /** Cells resident after this call. */
  cells: number;
  /** Cells welded by this call (the rest came from the cache). */
  cellsWelded: number;
  /** Wall time of the per-cell model/texture reads. */
  fetchMs: number;
  indices: number;
  /** Wall time of `engine.cells.load` for everything (re)created. */
  loadMs: number;
  /** Median single-cell weld in this call, ms — the typical cost, which a mean hides on a mixed batch. */
  medianWeldMs: number;
  /** Slowest single cell weld in this call, ms. */
  slowestWeldMs: number;
  /** Wall time of `TexturePlanner.build()` + the uploads. */
  textureMs: number;
  /** Total `.ostex` bytes resident. */
  textures: number;
  vertices: number;
  /** Wall time of the welds in this call. */
  weldMs: number;
}

/** A welded cell held for re-creation; `.oscell` bytes stay valid as the texture plan grows. */
interface CachedCell {
  bytes: Uint8Array;
  indices: number;
  vertices: number;
}

/** One cell of the target set, with the engine key it is loaded under. */
interface WantedCell {
  cx: number;
  cy: number;
  key: string;
}

const EMPTY: CellLoadStats = {
  arrays: 0,
  assetBytes: 0,
  cells: 0,
  cellsWelded: 0,
  fetchMs: 0,
  indices: 0,
  loadMs: 0,
  medianWeldMs: 0,
  slowestWeldMs: 0,
  textureMs: 0,
  textures: 0,
  vertices: 0,
  weldMs: 0,
};

export class CellRenderer {
  private readonly cache = new Map<string, CachedCell>();
  private readonly planner: TexturePlanner;
  private readonly resident = new Set<string>();
  /** ref → the layer count last uploaded, so a grown array is detected. */
  private readonly uploaded = new Map<number, number>();

  constructor(
    private readonly engine: Engine,
    private readonly map: LoadedMap,
  ) {
    this.planner = new TexturePlanner(this.map.fs, this.map.defs.txdParents ?? new Map<string, string>());
  }

  /** Unload every resident cell (the texture plan and the weld cache survive). */
  clear(): void {
    for (const key of this.resident) {
      this.engine.cells.unload(key);
    }
    this.resident.clear();
  }

  /**
   * Drop and re-create every resident cell from the cache. This is how hiding is UNDONE: `hidePlacement`
   * degenerates indices in the GPU buffer in place and has no inverse, so the only way back is a fresh load
   * of the same bytes — which costs the upload, not the weld.
   */
  reload(): void {
    const keys = [...this.resident];
    this.clear();
    for (const key of keys) {
      const cached = this.cache.get(key);
      if (cached) {
        this.engine.cells.load(key, cached.bytes);
        this.resident.add(key);
      }
    }
  }

  /**
   * Make exactly `coords` resident at one level. Cells already welded come from the cache; new ones weld.
   * `onProgress` is called per welded cell — the whole-map toggle must show its cost, not hide it.
   */
  async setCells(
    coords: readonly CellCoord[],
    lod: boolean,
    onProgress?: (done: number, total: number) => void,
  ): Promise<CellLoadStats> {
    const stats = { ...EMPTY };
    const wanted = coords.map(({ cx, cy }) => ({ cx, cy, key: `${cx},${cy},${lod ? 'lod' : 'hd'}` }));

    // Drop what is no longer wanted before welding, so the peak GPU residency is the target set, not the sum.
    const keep = new Set(wanted.map((cell) => cell.key));
    for (const key of [...this.resident]) {
      if (!keep.has(key)) {
        this.engine.cells.unload(key);
        this.resident.delete(key);
      }
    }

    let done = 0;
    const weldTimes: number[] = [];
    for (const cell of wanted) {
      done += 1;
      await this.weldOne(cell, lod, stats, weldTimes);
      onProgress?.(done, wanted.length);
    }
    stats.medianWeldMs = median(weldTimes);

    const arraysChanged = this.syncTextures(stats);
    this.loadCells(wanted, arraysChanged, stats);

    for (const key of this.resident) {
      const cached = this.cache.get(key);
      stats.cells += 1;
      stats.indices += cached?.indices ?? 0;
      stats.vertices += cached?.vertices ?? 0;
    }

    return stats;
  }

  /** (Re)create the wanted cells from cache. A grown array invalidated every bundle, so start over then. */
  private loadCells(wanted: readonly WantedCell[], arraysChanged: boolean, stats: CellLoadStats): void {
    const started = performance.now();
    if (arraysChanged) {
      for (const key of this.resident) {
        this.engine.cells.unload(key);
      }
      this.resident.clear();
    }
    for (const { key } of wanted) {
      const cached = this.cache.get(key);
      if (cached && !this.resident.has(key)) {
        this.engine.cells.load(key, cached.bytes);
        this.resident.add(key);
      }
    }
    stats.loadMs = Math.round(performance.now() - started);
  }

  /**
   * Upload every array the plan now holds, replacing the ones that GREW. Returns whether anything changed —
   * a replaced array's GPU texture is a new object, and the render bundles that sampled the old one are dead.
   */
  private syncTextures(stats: CellLoadStats): boolean {
    const started = performance.now();
    let changed = false;
    for (const array of this.planner.build()) {
      stats.arrays += 1;
      stats.textures += array.bytes.byteLength;
      if (this.uploaded.get(array.ref) === array.meta.layers) {
        continue;
      }
      if (this.uploaded.has(array.ref)) {
        this.engine.textures.unload(array.ref);
      }
      this.engine.textures.load(array.ref, array.bytes);
      this.uploaded.set(array.ref, array.meta.layers);
      changed = true;
    }
    stats.textureMs = Math.round(performance.now() - started);

    return changed;
  }

  /** Weld one cell into the cache, reading the models it places first. A cached or empty cell is a no-op. */
  private async weldOne(
    { cx, cy, key }: WantedCell,
    lod: boolean,
    stats: CellLoadStats,
    weldTimes: number[],
  ): Promise<void> {
    const cell = this.map.grid.get(cellKey(cx, cy));
    if (this.cache.has(key) || !cell) {
      return;
    }
    // The welder reads synchronously — every model this cell places has to be in the VFS before it runs.
    const fetchStarted = performance.now();
    stats.assetBytes += await this.map.assets.ensure(cellModelNames(this.map.defs, this.map.grid, cx, cy, lod));
    stats.fetchMs += Math.round(performance.now() - fetchStarted);

    const weldStarted = performance.now();
    // Cell origin in ENGINE coords: GTA cell centre (x, y) → engine (x, 0, −y) — the converter's own line.
    const origin: [number, number, number] = [(cx + 0.5) * CELL_SIZE, 0, -(cy + 0.5) * CELL_SIZE];
    const result = weldCell(this.map.fs, this.map.defs, cell, lod, this.planner, origin);
    const elapsed = Math.round(performance.now() - weldStarted);
    stats.weldMs += elapsed;
    stats.slowestWeldMs = Math.max(stats.slowestWeldMs, elapsed);
    weldTimes.push(elapsed);
    stats.cellsWelded += 1;
    if (result) {
      this.cache.set(key, { bytes: result.bytes, indices: result.stats.indices, vertices: result.stats.vertices });
    }
  }
}

/** The cell a GTA ground position falls in — the render grid, not the game's streaming one. */
export function cellAt(gta: readonly [number, number]): CellCoord {
  return { cx: Math.floor(gta[0] / CELL_SIZE), cy: Math.floor(gta[1] / CELL_SIZE) };
}

/**
 * The centre of the map's occupied cells, in GTA coords — where the viewer opens without an `?at`.
 *
 * The MEDIAN occupied cell, snapped to a cell that really is occupied — not the midpoint of the extent.
 * Two reasons, both measured on a merged build:
 * - A single placement far outside the map moves the midpoint off the world. Exiling an object instead of
 *   deleting it is standard SA modding, and one such lamppost (`las2_stream1.ipl`, 17 km south) dragged the
 *   midpoint from Los Santos into open sea: the viewer opened on 0 cells and stayed blank even with "Whole
 *   map" ticked, because the camera was nowhere near the map. A median does not move for one outlier.
 * - The midpoint of a sparse extent can be an EMPTY cell, and the inspector seeds itself from this cell — a
 *   default view that welds nothing is the same blank screen by another route. Snapping to the nearest
 *   occupied cell is what makes the default guaranteed to show something.
 */
export function mapCenterGta(map: LoadedMap): [number, number] {
  const cells = [...map.grid.values()].sort((a, b) => a.cx - b.cx || a.cy - b.cy); // deterministic tie-break
  const [first] = cells;
  if (!first) {
    return [0, 0];
  }
  const mx = median(cells.map((cell) => cell.cx));
  const my = median(cells.map((cell) => cell.cy));
  let best = first;
  let bestDistance = Infinity;
  for (const cell of cells) {
    const distance = (cell.cx - mx) ** 2 + (cell.cy - my) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = cell;
    }
  }

  return [(best.cx + 0.5) * CELL_SIZE, (best.cy + 0.5) * CELL_SIZE];
}

/** Median of a sample (0 when empty). */
function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}
