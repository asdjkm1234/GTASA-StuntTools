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

interface PakIndex {
  arrays: { layers: number; ref: number }[];
  cellSize: number;
  cells: { cx: number; cy: number; lod: boolean }[];
  collisionCellSize?: number;
  collisionCells?: { cx: number; cy: number }[];
  generated?: string;
  source?: string;
}

// Few per frame: `engine.cells.load` records a render bundle, and creating many bundles in one frame is a
// GPU burst the Intel driver can reset on. Spreading them keeps every frame cheap.
const MAX_PARALLEL_LOADS = 2;

export class PakWorld {
  private arrays = 0;
  private cellSize = 300;
  private cells: PakIndex['cells'] = [];
  private failed = 0;
  private loaded = 0;
  private readonly pending = new Set<string>();
  private readonly resident = new Set<string>();
  private readonly refs: number[] = [];
  private ready = false;
  private waitingForGpu = false;
  private cameraCollision: CameraCollisionWorld | null = null;

  constructor(
    private readonly engine: Engine,
    private readonly base: string,
  ) {}

  /** True when the pak could not be opened (caller falls back to the raw-install path). */
  static async probe(base: string): Promise<boolean> {
    try {
      const response = await fetch(`${base}/index.json`, { method: 'GET' });
      return response.ok;
    } catch {
      return false;
    }
  }

  async load(onProgress?: (done: number, total: number) => void): Promise<void> {
    const index = (await (await fetch(`${this.base}/index.json`)).json()) as PakIndex;
    this.cells = index.cells;
    this.cellSize = index.cellSize || 300;
    const collisionReady = index.collisionCellSize && index.collisionCells?.length
      ? CameraCollisionWorld.create(this.base, index.collisionCellSize, index.collisionCells)
      : Promise.resolve(null);
    let done = 0;
    for (const array of index.arrays) {
      const response = await fetch(`${this.base}/textures/${array.ref}.ostex`);
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
      this.arrays = this.refs.length;
      this.ready = true;
      return;
    }
    this.engine.textures.drainUploads(budgetMs);
    // A CPU time budget limits how fast writes are queued, not how fast the GPU executes them.
    // Wait for this batch before queuing the next one so the Arc driver is not buried in uploads.
    this.waitingForGpu = true;
    void this.engine.device.queue.onSubmittedWorkDone().then(
      () => { this.waitingForGpu = false; },
      () => { this.waitingForGpu = false; },
    );
  }

  get isReady(): boolean {
    return this.ready;
  }

  get uploadedArrays(): number {
    return this.refs.filter((ref) => this.engine.textures.has(ref)).length;
  }

  get loadedCells(): number {
    return this.loaded;
  }

  get indexedCells(): number {
    return new Set(this.cells.map((cell) => `${cell.cx},${cell.cy}`)).size;
  }

  get isLoading(): boolean {
    return this.pending.size > 0;
  }

  note(): string {
    return ` · pak ${this.arrays} 纹理数组 · 地块 ${this.loaded}（加载中 ${this.pending.size}，失败 ${this.failed}）` +
      ` · 相机碰撞 ${this.cameraCollision?.loadedCells ?? 0}`;
  }

  pumpCameraCollision(budgetMs: number): void {
    this.cameraCollision?.pump(budgetMs);
  }

  resolveCamera(state: CameraStateOut, mode: ChaseMode, dt: number, snap: boolean): CameraStateOut {
    return this.cameraCollision?.resolve(state, mode, dt, snap) ?? state;
  }

  /** Make the cells around (x, y) resident: HD within `hd`, LOD within `lod`, HD wins on overlap. */
  update(x: number, y: number, hd: number, lod: number): void {
    if (!this.ready) return;
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

    for (const key of [...this.resident]) {
      if (!wanted.has(key)) {
        this.engine.cells.unload(key);
        this.resident.delete(key);
        this.loaded -= 1;
      }
    }
    for (const [key, cell] of wanted) {
      if (this.resident.has(key) || this.pending.has(key)) continue;
      if (this.pending.size >= MAX_PARALLEL_LOADS) break;
      this.pending.add(key);
      const file = `${this.base}/cells/${cell.cx}_${cell.cy}${cell.lod ? '_lod' : ''}.bin`;
      void fetch(file)
        .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))
        .then((buffer) => {
          this.engine.cells.load(key, new Uint8Array(buffer));
          this.resident.add(key);
          this.loaded += 1;
        })
        .catch(() => {
          this.failed += 1;
        })
        .finally(() => {
          this.pending.delete(key);
        });
    }
  }
}
