/**
 * Route A runtime: stream a LOCALLY BAKED map pak (see `tools/opensa/scripts/bake-map.mts`).
 *
 * The pak was produced by one `TexturePlanner`, so its texture arrays are complete and the `.oscell` cells
 * reference stable layer indices. Here we upload every array ONCE and then only add/remove cells — no
 * welding, no decoding, no texture-array growth, therefore none of the TDR/black-screen failure mode the
 * raw-install path is exposed to.
 */
import type { Engine } from '@opensa/engine';

import type { CameraStateOut } from './camera';
import type { ChaseMode } from './camera-track';

import { CameraCollisionWorld } from './camera-collision-world';
import { fetchMapPak } from './map-pak-cache';

interface PakIndex {
  arrays: { layers: number; ref: number }[];
  cells: { cx: number; cy: number; lod: boolean }[];
  cellSize: number;
  collisionCells?: { cx: number; cy: number }[];
  collisionCellSize?: number;
  generated?: string;
  source?: string;
}

// Few per frame: `engine.cells.load` records a render bundle, and creating many bundles in one frame is a
// GPU burst the Intel driver can reset on. Spreading them keeps every frame cheap.
const MAX_PARALLEL_LOADS = 2;
// CPU time alone does not bound queued GPU copies on a fast/cached browser. Keep each fenced batch small.
const MAX_UPLOAD_BYTES = 1024 * 1024;

export class PakWorld {
  get indexedCells(): number {
    return new Set(this.cells.map((cell) => `${cell.cx},${cell.cy}`)).size;
  }
  get isLoading(): boolean {
    return this.pending.size > 0;
  }
  get isReady(): boolean {
    return this.ready;
  }
  get loadedCells(): number {
    return this.loaded;
  }
  /** Includes cells not scheduled yet by the two-fetch streaming limit. */
  get missingCells(): number {
    return [...this.wanted.keys()].filter((key) => !this.resident.has(key)).length;
  }
  get renderRadius(): { hd: number; lod: number } {
    return this.radius;
  }
  /** Render/collision changes invalidate a paused frame without changing its replay clock. */
  get sceneRevision(): number {
    return this.revision + (this.cameraCollision?.sceneRevision ?? 0);
  }
  get uploadedArrays(): number {
    return this.refs.filter((ref) => this.engine.textures.has(ref)).length;
  }
  private cameraCollision: CameraCollisionWorld | null = null;
  private cells: PakIndex['cells'] = [];
  private cellSize = 300;
  private readonly failures = new Map<string, string>();
  private loaded = 0;

  private readonly pending = new Set<string>();

  private readonly radius = { hd: 1200, lod: 3000 };

  private ready = false;
  private keepResident = false;

  private readonly refs: number[] = [];

  private readonly resident = new Set<string>();

  private revision = 0;

  private streamRegion: [number, number, number, number] | null = null;

  private waitingForGpu = false;

  private wanted = new Map<string, { cx: number; cy: number; lod: boolean }>();

  constructor(
    private readonly engine: Engine,
    private readonly base: string,
  ) {}

  /** True when the full-map pak can be opened. */
  static async probe(base: string): Promise<boolean> {
    try {
      const response = await fetchMapPak(`${base}/index.json`);

      return response.ok;
    } catch {
      return false;
    }
  }

  async load(onProgress?: (done: number, total: number) => void): Promise<void> {
    const index = (await (await fetchMapPak(`${this.base}/index.json`)).json()) as PakIndex;
    this.cells = index.cells;
    this.cellSize = index.cellSize || 300;
    const collisionReady =
      index.collisionCellSize && index.collisionCells?.length
        ? CameraCollisionWorld.create(this.base, index.collisionCellSize, index.collisionCells)
        : Promise.resolve(null);
    let done = 0;
    for (const array of index.arrays) {
      const response = await fetchMapPak(`${this.base}/textures/${array.ref}.ostex`);
      if (!response.ok) continue;
      // BEGIN the upload, do not push it through in one call: a synchronous 240 MB upload between frames is
      // what trips DXGI_ERROR_DEVICE_HUNG. `pump()` drains it under a per-frame budget instead.
      this.engine.textures.beginLoad(array.ref, new Uint8Array(await response.arrayBuffer()));
      this.refs.push(array.ref);
      done += 1;
      onProgress?.(done, index.arrays.length);
    }
    this.cameraCollision = await collisionReady;
  }

  /** Advance this frame's slice of the array uploads; flips `isReady` once every array is resident. */
  pump(budgetMs: number): void {
    if (this.ready || this.waitingForGpu) return;
    if (this.refs.length > 0 && this.refs.every((ref) => this.engine.textures.has(ref))) {
      this.ready = true;

      return;
    }
    this.engine.textures.drainUploads(budgetMs, MAX_UPLOAD_BYTES);
    // Flush copy-only startup batches even when no display frame is submitted (pause/export/loading).
    this.engine.device.queue.submit([]);
    // A CPU time budget limits how fast writes are queued, not how fast the GPU executes them.
    // Wait for this batch before queuing the next one so the Arc driver is not buried in uploads.
    this.waitingForGpu = true;
    void this.engine.device.queue.onSubmittedWorkDone().then(
      () => {
        this.waitingForGpu = false;
      },
      () => {
        this.waitingForGpu = false;
      },
    );
  }

  pumpCameraCollision(budgetMs: number): void {
    this.cameraCollision?.pump(budgetMs);
  }

  resolveCamera(state: CameraStateOut, mode: ChaseMode, dt: number, snap: boolean): CameraStateOut {
    return this.cameraCollision?.resolve(state, mode, dt, snap) ?? state;
  }
  /** A brief route-camera transition retains its departure cells while its destination is prepared. */
  retainForTravel(keep: boolean): void {
    this.keepResident = keep;
  }

  /** Make the cells around (x, y) resident: HD within `hd`, LOD within `lod`, HD wins on overlap. */
  update(x: number, y: number, hd: number, lod: number): void {
    if (!this.ready) return;
    this.streamRegion = [x, y, hd, lod];
    this.cameraCollision?.update(x, y);
    const wanted = new Map<string, { cx: number; cy: number; lod: boolean }>();
    for (const cell of this.cells) {
      const dx = (cell.cx + 0.5) * this.cellSize - x;
      const dy = (cell.cy + 0.5) * this.cellSize - y;
      const distance = Math.hypot(dx, dy);
      if (cell.lod) {
        if (distance <= lod && !wanted.has(`${cell.cx},${cell.cy}`)) {
          wanted.set(`${cell.cx},${cell.cy},lod`, cell);
        }
      } else if (distance <= hd) {
        wanted.set(`${cell.cx},${cell.cy}`, cell);
      }
    }
    this.wanted = wanted;

    for (const key of [...this.resident]) {
      if (!wanted.has(key) && !this.keepResident) {
        this.engine.cells.unload(key);
        this.resident.delete(key);
        this.loaded -= 1;
        this.revision++;
      }
    }
    for (const [key, cell] of wanted) {
      if (this.resident.has(key) || this.pending.has(key)) continue;
      if (this.pending.size >= MAX_PARALLEL_LOADS) break;
      this.failures.delete(key);
      this.pending.add(key);
      const file = `${this.base}/cells/${cell.cx}_${cell.cy}${cell.lod ? '_lod' : ''}.bin`;
      void fetchMapPak(file)
        .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))
        .then((buffer) => {
          if (!this.wanted.has(key) && !this.keepResident) return;
          this.engine.cells.load(key, new Uint8Array(buffer));
          this.resident.add(key);
          this.loaded += 1;
          this.revision++;
        })
        .catch((error: unknown) => {
          this.failures.set(key, error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          this.pending.delete(key);
        });
    }
  }

  /** Finish the entire current ring before export readback, without advancing capture time. */
  async waitForExport(timeoutMs = 30_000, signal?: AbortSignal): Promise<void> {
    if (!this.ready || !this.streamRegion) throw new Error('导出地图尚未就绪');
    const region = this.streamRegion;
    const deadline = performance.now() + timeoutMs;
    for (;;) {
      signal?.throwIfAborted();
      for (const [key, message] of this.failures) {
        if (this.wanted.has(key)) throw new Error(`导出地图地块 ${key} 载入失败：${message}`);
      }
      const before = this.revision;
      this.update(...region);
      this.pumpCameraCollision(2);
      // CellStore.load writes vertex/index buffers too. Submit copy-only work and fence each slice,
      // rather than relying on an incomplete scene render to flush a growing upload queue.
      this.engine.device.queue.submit([]);
      await this.engine.device.queue.onSubmittedWorkDone();
      if (this.missingCells === 0 && (this.cameraCollision?.isSettled ?? true) && this.revision === before) return;
      if (performance.now() >= deadline) throw new Error(`地图地块载入超时（剩余 ${this.missingCells}）`);
      // Yield network callbacks and retain the ordinary per-frame two-cell scheduling cadence.
      await new Promise<void>((resolve) => setTimeout(resolve, 16));
    }
  }
}
