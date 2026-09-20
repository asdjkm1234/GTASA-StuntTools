/**
 * Cells into the engine, welded IN THE BROWSER (adapted from sa-map-viewer). The same `weldCell` the offline
 * converter runs produces the `.oscell` bytes, the same `TexturePlanner` produces the `.ostex` arrays, and
 * both go straight into `engine.cells.load` / `engine.textures.load`. What is drawn is what the game would
 * draw for these files. One planner for the session; welded bytes are cached; a grown texture array
 * invalidates the render bundles, so resident cells are re-created from cache (not re-welded).
 */
import type { Engine } from '@opensa/engine';

import { CELL_SIZE, TexturePlanner, weldCell } from '@opensa/cell-weld';
import { cellModelNames } from '@opensa/renderware/map/cell-groups';
import { cellKey } from '@opensa/renderware/map/world-grid';

import type { LoadedMap } from './map-source';

export interface CellCoord {
  cx: number;
  cy: number;
}

/** What one `setCells` cost and produced. */
export interface CellLoadStats {
  arrays: number;
  assetBytes: number;
  cells: number;
  cellsWelded: number;
  fetchMs: number;
  indices: number;
  loadMs: number;
  medianWeldMs: number;
  slowestWeldMs: number;
  textureMs: number;
  textures: number;
  vertices: number;
  weldMs: number;
}

interface CachedCell {
  bytes: Uint8Array;
  indices: number;
  vertices: number;
}

interface WantedCell {
  cx: number;
  cy: number;
  key: string;
  lod: boolean;
}

/** One cell to make resident, at a chosen level. HD near the aircraft, LOD for the far base map. */
export interface CellTarget {
  cx: number;
  cy: number;
  lod: boolean;
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
  private readonly uploaded = new Map<number, number>();
  /**
   * Set when the texture plan actually gained layers. `TexturePlanner.build()` re-encodes EVERY array
   * (`encodeArray`/`packOstexPayload` — full allocation + copy), so calling it on every streaming tick while
   * the plan is unchanged was a periodic main-thread hitch (~2 Hz). It now runs only when something changed.
   */
  private texturesDirty = false;

  constructor(
    private readonly engine: Engine,
    private readonly map: LoadedMap,
  ) {
    this.planner = new TexturePlanner(this.map.fs, this.map.defs.txdParents ?? new Map<string, string>());
  }

  /**
   * Weld a batch of cells into the CACHE. With `commit` the texture arrays are also (re)uploaded after the
   * batch, in the SAFE order (resident cells are unloaded first, so nothing submits against a destroyed
   * texture). Safe mode commits ONCE for the whole route before playback; the experimental dynamic mode
   * welds without committing and lets `setTargets` commit as regions arrive.
   */
  async preloadTargets(
    targets: readonly CellTarget[],
    onProgress?: (done: number, total: number) => void,
    commit = false,
  ): Promise<CellLoadStats> {
    const stats = { ...EMPTY };
    const weldTimes: number[] = [];
    let done = 0;
    for (const { cx, cy, lod } of targets) {
      done += 1;
      await this.weldOne({ cx, cy, lod, key: `${cx},${cy},${lod ? 'lod' : 'hd'}` }, stats, weldTimes);
      onProgress?.(done, targets.length);
    }
    stats.medianWeldMs = median(weldTimes);
    if (commit) {
      this.commitTextures(stats);
    }

    return stats;
  }

  /** Replace grown texture arrays with NO resident cells alive, then (re)create them from the cache. */
  private commitTextures(stats: CellLoadStats): void {
    if (!this.texturesDirty) return;
    for (const key of this.resident) {
      this.engine.cells.unload(key);
    }
    this.resident.clear();
    this.syncTextures(stats);
  }

  /** Unload every resident cell (the texture plan and the weld cache survive). */
  clear(): void {
    for (const key of this.resident) {
      this.engine.cells.unload(key);
    }
    this.resident.clear();
  }

  /**
   * Make exactly `coords` resident at one level. Cells already welded come from the cache; new ones weld.
   * `onProgress` is called per welded cell.
   */
  async setCells(
    coords: readonly CellCoord[],
    lod: boolean,
    onProgress?: (done: number, total: number) => void,
  ): Promise<CellLoadStats> {
    return this.setTargets(coords.map(({ cx, cy }) => ({ cx, cy, lod })), onProgress);
  }

  /**
   * Make a MIXED target set resident: high-detail cells near the aircraft plus the far LOD base map beyond
   * them. Each target carries its own level, so a nearby HD cell and a distant LOD cell coexist (a single
   * `setCells` pass would unload one when the other was applied).
   */
  async setTargets(
    targets: readonly CellTarget[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<CellLoadStats> {
    const stats = { ...EMPTY };
    const wanted = targets.map(({ cx, cy, lod }) => ({ cx, cy, lod, key: `${cx},${cy},${lod ? 'lod' : 'hd'}` }));

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
      await this.weldOne(cell, stats, weldTimes);
      onProgress?.(done, wanted.length);
    }
    stats.medianWeldMs = median(weldTimes);

    // ORDER MATTERS. Replacing a texture array destroys its GPUTexture, and a resident render bundle that
    // still references it is what produces "Destroyed texture ... used in a submit" → DXGI_ERROR_DEVICE_HUNG
    // → black. So: unload ALL resident cells FIRST, then replace the arrays, then (re)create the wanted set.
    // No resident cell ever spans an array replacement.
    if (this.texturesDirty) {
      for (const key of this.resident) {
        this.engine.cells.unload(key);
      }
      this.resident.clear();
    }
    const arraysChanged = this.syncTextures(stats);
    this.loadCells(wanted, arraysChanged, stats);

    for (const key of this.resident) {
      const cached = this.cache.get(key);
      if (!cached) {
        continue;
      }
      stats.cells += 1;
      stats.indices += cached.indices;
      stats.vertices += cached.vertices;
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
    if (!this.texturesDirty) {
      return false;
    }
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
    this.texturesDirty = false;

    return changed;
  }

  /** Weld one cell into the cache, reading the models it places first. A cached or empty cell is a no-op. */
  private async weldOne(
    { cx, cy, key, lod }: WantedCell,
    stats: CellLoadStats,
    weldTimes: number[],
  ): Promise<void> {
    const cell = this.map.grid.get(cellKey(cx, cy));
    if (this.cache.has(key) || !cell) {
      return;
    }
    const fetchStarted = performance.now();
    stats.assetBytes += await this.map.assets.ensure(cellModelNames(this.map.defs, this.map.grid, cx, cy, lod));
    stats.fetchMs += Math.round(performance.now() - fetchStarted);

    const weldStarted = performance.now();
    // Cell origin in ENGINE coords: GTA cell centre (x, y) → engine (x, 0, −y).
    const origin: [number, number, number] = [(cx + 0.5) * CELL_SIZE, 0, -(cy + 0.5) * CELL_SIZE];
    const result = weldCell(this.map.fs, this.map.defs, cell, lod, this.planner, origin);
    const elapsed = Math.round(performance.now() - weldStarted);
    stats.weldMs += elapsed;
    stats.slowestWeldMs = Math.max(stats.slowestWeldMs, elapsed);
    weldTimes.push(elapsed);
    stats.cellsWelded += 1;
    if (result) {
      this.cache.set(key, { bytes: result.bytes, indices: result.stats.indices, vertices: result.stats.vertices });
      this.texturesDirty = true;
    }
  }
}

/** The cell a GTA ground position falls in — the render grid, not the game's streaming one. */
export function cellAt(gta: readonly [number, number]): CellCoord {
  return { cx: Math.floor(gta[0] / CELL_SIZE), cy: Math.floor(gta[1] / CELL_SIZE) };
}

/** The centre of the map's occupied cells, in GTA coords — the fallback opening pose. */
export function mapCenterGta(map: LoadedMap): [number, number] {
  const cells = [...map.grid.values()].sort((a, b) => a.cx - b.cx || a.cy - b.cy);
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
