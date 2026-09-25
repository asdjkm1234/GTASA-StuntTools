/** Stream the locally baked GTA COL shapes for the replay's third-person camera. */
import { readBakedCell } from '@opensa/game/adapters/baked-collision';
import { PhysicsWorld } from '@opensa/game/physics/physics-world';
import { initRapier } from '@opensa/game/physics/rapier';

import type { CameraStateOut } from './camera';
import type { ChaseMode } from './camera-track';
import type { Vec3 } from './math';

interface CollisionCell { cx: number; cy: number }
type Models = NonNullable<ReturnType<typeof readBakedCell>>;
type Build = ReturnType<PhysicsWorld['beginStaticColliders']>;

const LOAD_RADIUS = 450;
const MAX_FETCHES = 2;
// Fitted against the 2026-09-25 camera trace at the billboard and bridge passes.
const CAMERA_RADIUS = 0.8;
const SURFACE_MARGIN = 0.12;
const RELEASE_SECONDS = 0.18;

export class CameraCollisionWorld {
  private readonly resident = new Map<string, number[]>();
  private readonly pending = new Set<string>();
  private readonly failed = new Set<string>();
  private readonly wanted = new Set<string>();
  private readonly queue: { key: string; models: Models }[] = [];
  private build: { key: string; task: Build } | null = null;
  private dirty = false;
  private readonly shown = new Map<ChaseMode, number>();

  private constructor(
    private readonly physics: PhysicsWorld,
    private readonly base: string,
    private readonly cellSize: number,
    private readonly cells: readonly CollisionCell[],
  ) {}

  static async create(base: string, cellSize: number, cells: readonly CollisionCell[]): Promise<CameraCollisionWorld> {
    return new CameraCollisionWorld(new PhysicsWorld(await initRapier()), base, cellSize, cells);
  }

  get loadedCells(): number {
    return this.resident.size;
  }

  /** Keep the local collision ring near the aircraft, independent of the much wider render ring. */
  update(x: number, y: number): void {
    const candidates = this.cells.map((cell) => ({
      ...cell,
      distance: Math.hypot((cell.cx + 0.5) * this.cellSize - x, (cell.cy + 0.5) * this.cellSize - y),
    })).filter((cell) => cell.distance <= LOAD_RADIUS).sort((a, b) => a.distance - b.distance);
    this.wanted.clear();
    for (const cell of candidates) this.wanted.add(`${cell.cx},${cell.cy}`);
    for (let i = this.queue.length - 1; i >= 0; i -= 1) {
      if (!this.wanted.has(this.queue[i].key)) this.queue.splice(i, 1);
    }

    for (const [key, handles] of this.resident) {
      if (this.wanted.has(key)) continue;
      this.physics.removeBodies(handles);
      this.resident.delete(key);
      this.dirty = true;
    }
    if (this.build && !this.wanted.has(this.build.key)) {
      this.physics.removeBodies(this.build.task.handles);
      this.build = null;
      this.dirty = true;
    }
    for (const cell of candidates) {
      if (this.pending.size >= MAX_FETCHES) break;
      const key = `${cell.cx},${cell.cy}`;
      if (this.resident.has(key) || this.pending.has(key) || this.failed.has(key)
        || this.build?.key === key || this.queue.some((item) => item.key === key)) continue;
      this.pending.add(key);
      void fetch(`${this.base}/collision/${cell.cx}_${cell.cy}.oscol`)
        .then((response) => response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status))))
        .then((buffer) => {
          const models = readBakedCell(new Uint8Array(buffer));
          if (models === null) throw new Error(`invalid collision cell ${key}`);
          if (this.wanted.has(key)) this.queue.push({ key, models });
        })
        .catch((error: unknown) => {
          this.failed.add(key);
          console.warn(`[camera collision] ${key}:`, error);
        })
        .finally(() => this.pending.delete(key));
    }
  }

  /** Spread Rapier collider creation across frames so streaming does not stall the GPU loop. */
  pump(budgetMs: number): void {
    const deadline = performance.now() + budgetMs;
    while (performance.now() < deadline) {
      if (!this.build) {
        const next = this.queue.shift();
        if (!next) break;
        if (!this.wanted.has(next.key)) continue;
        this.build = { key: next.key, task: this.physics.beginStaticColliders(next.models) };
      }
      const complete = this.build.task.step(Math.max(0, deadline - performance.now()));
      if (!complete) break;
      if (this.wanted.has(this.build.key)) this.resident.set(this.build.key, this.build.task.handles);
      else this.physics.removeBodies(this.build.task.handles);
      this.build = null;
      this.dirty = true;
    }
    // Rapier's broadphase does not see newly created fixed bodies until a world step.
    if (this.dirty) {
      this.physics.step(1 / 60);
      this.dirty = false;
    }
  }

  /** Cap the predicted eye at the first world surface between the aircraft and camera. */
  resolve(state: CameraStateOut, mode: ChaseMode, dt: number, snap: boolean): CameraStateOut {
    const { eye, target } = state;
    const offset: Vec3 = [eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]];
    const desired = Math.hypot(...offset);
    if (desired < 0.001) return state;
    const gtaTarget: [number, number, number] = [target[0], -target[2], target[1]];
    const gtaDir: [number, number, number] = [offset[0], -offset[2], offset[1]];
    const hit = this.physics.sphereCast(gtaTarget, gtaDir, CAMERA_RADIUS, desired);
    const allowed = hit ? Math.max(0.5, Math.min(desired, hit.dist - SURFACE_MARGIN)) : desired;
    const previous = this.shown.get(mode);
    const distance = snap || previous === undefined || allowed < previous
      ? allowed
      : previous + (allowed - previous) * (1 - Math.exp(-Math.max(0, dt) / RELEASE_SECONDS));
    this.shown.set(mode, distance);
    return { ...state, eye: [
      target[0] + offset[0] * distance / desired,
      target[1] + offset[1] * distance / desired,
      target[2] + offset[2] * distance / desired,
    ] };
  }
}
