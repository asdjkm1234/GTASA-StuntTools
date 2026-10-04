import type { System } from '../core/system';
import type { Config } from '../interfaces/config.interface';
import type { Vec3, WorldAdapter } from '../interfaces/world-adapter.interface';
import type { PhysicsWorld, StaticColliderBuild } from '../physics/physics-world';

import { cellKey, cellsWithin } from './grid';

/** What collision streaming needs from the adapter / physics world. */
type ColliderAdapter = Pick<WorldAdapter, 'cellSize' | 'loadCellColliders'>;
type ColliderPhysics = Pick<PhysicsWorld, 'beginStaticColliders' | 'removeBodies'>;

/**
 * Per-frame allowance for building a cell's static bodies (plan 200/3-02).
 *
 * A cell measured **5.6–28.1 ms** built in one go (plan 091) — a frame the player feels. Spread at this
 * rate the same cell lands over ~4–19 frames instead. The number mirrors the texture-upload drain, which is
 * the one budget of this shape this project has already validated in the field
 * (`docs/performance/applied/texture-upload-budget.md`); it is a BUDGET, not a measured property of
 * anything, and the field round owes it a check.
 *
 * The cost of spreading is the streaming MARGIN: the collision radius is sized so a cell is ready a cell
 * before the player reaches it, and a build now eats into that. At 120 Hz the worst cell costs ~160 ms of
 * margin; on a phone's frame rate it costs more, which is why the margin is the thing to watch when this is
 * measured rather than the average.
 */
const COLLIDER_BUDGET_MS = 1.5;

/**
 * Streams static map collision per grid cell around the view (the same grid the
 * renderer uses), so the player always has ground/walls without holding the whole
 * map in the physics world. Each `update`: view cell → desired cells within
 * `collisionDrawDistance` → diff the loaded set → `loadCellColliders` +
 * `createStaticColliders` for new cells (tracking their body handles), and
 * `removeBodies` for cells that left. Collision is HD-only (LODs have none) and
 * Z-up. The radius carries a margin so colliders are ready a cell before the
 * player arrives (the async load is tolerated).
 */
export class CollisionStreamingSystem implements System {
  readonly name = 'collision-streaming';

  private readonly adapter: ColliderAdapter;
  /** Breakable-prop bodies (plan 045): instance key → its cell + body handle, so a smashed prop's
   *  one static body can be dropped without disturbing the rest of its cell. */
  private readonly breakable = new Map<string, { cellKey: string; handle: number }>();
  /** Reverse of {@link breakable}: body handle → instance key, so a contact-force impact on a static
   *  body can be resolved to the prop it hit. */
  private readonly breakableByHandle = new Map<number, string>();
  /** The prop's world matrix (column-major), so a smash can bake its shards where the prop actually stands —
   *  the key alone carries only the position, and a rotated bin would shatter into a sheared cloud. */
  private readonly breakableTransforms = new Map<string, readonly number[]>();
  /** Cells whose bodies are being created a slice at a time. A cell is NOT `loaded` until its build
   *  finishes: announcing it early would let a car spawn where only half the ground exists. */
  private readonly building = new Map<string, StaticColliderBuild>();
  private readonly config: Readonly<Config>;
  private current = new Set<string>();
  private readonly loaded = new Map<string, number[]>();
  private readonly loading = new Set<string>();
  private readonly physics: ColliderPhysics;
  private readonly viewOf: () => Vec3;

  constructor(adapter: ColliderAdapter, physics: ColliderPhysics, viewOf: () => Vec3, config: Readonly<Config>) {
    this.adapter = adapter;
    this.physics = physics;
    this.viewOf = viewOf;
    this.config = config;
  }

  /** Drop every loaded cell's physics bodies — the next `update` re-streams them through the
   *  adapter (whose collider cache the caller invalidated first). Used when the procedural-clutter
   *  knobs change, so collision always matches the rendered set (plan 042). */
  /** The breakable instance key of a static body handle (from a contact-force impact), if any. */
  breakableKeyOf(handle: null | number): string | undefined {
    return handle === null ? undefined : this.breakableByHandle.get(handle);
  }

  /** The world matrix of a smashable placement (column-major), for baking its debris where it stands. */
  breakableTransform(key: string): readonly number[] | undefined {
    return this.breakableTransforms.get(key);
  }

  /**
   * The LOADED smashable placement nearest to `position` within `radius` (native Z-up), or undefined.
   * Only props whose static body is still standing are considered — a smashed one is already gone from the
   * registry. Used by the debugger's "break nearest prop" action (a hit the player cannot deal on foot).
   */
  nearestBreakable(position: Vec3, radius: number): string | undefined {
    let best: string | undefined;
    let bestDistance = radius * radius;
    for (const key of this.breakable.keys()) {
      const transform = this.breakableTransforms.get(key);
      if (!transform) {
        continue;
      }
      const dx = transform[12] - position[0];
      const dy = transform[13] - position[1];
      const dz = transform[14] - position[2];
      const distance = dx * dx + dy * dy + dz * dz;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = key;
      }
    }

    return best;
  }

  reload(): void {
    for (const handles of this.loaded.values()) {
      this.physics.removeBodies(handles);
    }
    // A cell still being built (200/3-02) is dropped with the rest — leaving it would finish against the OLD
    // collider set and hand the world a cell the new knobs never asked for.
    for (const build of this.building.values()) {
      this.physics.removeBodies(build.handles);
    }
    this.building.clear();
    this.loaded.clear();
    this.breakable.clear();
    this.breakableByHandle.clear();
  }

  /** Drop a smashed breakable prop's static body (plan 045). No-op if it is already gone (already
   *  broken, or its cell unloaded). Returns whether a body was removed. */
  removeBreakable(key: string): boolean {
    const entry = this.breakable.get(key);
    if (!entry) {
      return false;
    }
    this.breakable.delete(key);
    this.breakableByHandle.delete(entry.handle);
    this.physics.removeBodies([entry.handle]);
    const handles = this.loaded.get(entry.cellKey);
    const index = handles?.indexOf(entry.handle) ?? -1;
    if (handles && index >= 0) {
      handles.splice(index, 1); // so the cell unload doesn't double-remove the handle
    }

    return true;
  }

  /** Whether every desired collision cell is loaded (plan 061) — the physics half of world readiness. */
  settled(): boolean {
    if (this.current.size === 0) {
      return false; // no update ran yet
    }
    for (const key of this.current) {
      if (!this.loaded.has(key)) {
        return false;
      }
    }

    return true;
  }

  update(): void {
    this.current = this.desiredKeys();
    for (const [key, handles] of this.loaded) {
      if (!this.current.has(key)) {
        this.physics.removeBodies(handles);
        this.loaded.delete(key);
        this.forgetBreakables(key);
      }
    }
    // A cell that left while still building leaves nothing behind: the build owns exactly the bodies it
    // created, and its breakable registrations go with them.
    for (const [key, build] of this.building) {
      if (!this.current.has(key)) {
        this.physics.removeBodies(build.handles);
        this.building.delete(key);
        this.forgetBreakables(key);
      }
    }
    this.drainBuilds();
    for (const key of this.current) {
      if (!this.loaded.has(key) && !this.loading.has(key) && !this.building.has(key)) {
        this.load(key);
      }
    }
  }

  private desiredKeys(): Set<string> {
    const cells = cellsWithin(this.viewOf(), this.config.streaming.collisionDrawDistance, this.adapter.cellSize);

    return new Set(cells.map(([cx, cy]) => cellKey(cx, cy)));
  }

  /**
   * Spend this frame's allowance on the cells still being built.
   *
   * NO SPAN HERE, deliberately: this runs inside `collision.update()`, which the frame loop already times as
   * its `collision` block, and a span would be subtracted from `dt` a second time — the same double-count
   * the 2026-08-02 field drive read as `unattributed -65.9`.
   */
  private drainBuilds(): void {
    if (this.building.size === 0) {
      return;
    }
    // One allowance for the frame, divided across whatever is in flight — not one budget EACH, which is how
    // a teleport into a fresh district would spend twenty of them in a frame.
    const share = COLLIDER_BUDGET_MS / this.building.size;
    for (const [key, build] of this.building) {
      if (!build.step(share)) {
        continue;
      }
      this.building.delete(key);
      this.loaded.set(key, build.handles);
    }
  }

  /** Drop a cell's breakable bookkeeping when it unloads (its bodies are removed with the cell). */
  private forgetBreakables(cellKey: string): void {
    for (const [key, entry] of this.breakable) {
      if (entry.cellKey === cellKey) {
        this.breakable.delete(key);
        this.breakableByHandle.delete(entry.handle);
      }
    }
  }

  private load(key: string): void {
    this.loading.add(key);
    const [cx, cy] = key.split(',');
    void this.adapter
      .loadCellColliders(Number(cx), Number(cy))
      .then((models) => {
        this.loading.delete(key);
        if (this.current.has(key) && !this.loaded.has(key) && !this.building.has(key)) {
          // The bodies are no longer created here. This continuation runs BETWEEN frames, where no loop
          // timer reaches, and building a whole cell in it is exactly the 5.6–28.1 ms spike plan 091
          // measured — so it only STARTS the build, and `drainBuilds` spends the frame's allowance on it.
          // Nothing expensive happens in this continuation any more, which is why its span is gone.
          this.building.set(
            key,
            this.physics.beginStaticColliders(models, (instanceKey, handle) => {
              this.breakable.set(instanceKey, { cellKey: key, handle });
              this.breakableByHandle.set(handle, instanceKey);
            }),
          );
          // Recorded up front rather than on completion: a prop smashed while its cell is still building
          // must still know where it stands, and the transforms are the adapter's, not the build's.
          for (const model of models) {
            model.instanceKeys?.forEach((instanceKey, index) => {
              this.breakableTransforms.set(instanceKey, [...model.transforms[index].elements]);
            });
          }
        }
      })
      .catch(() => this.loading.delete(key));
  }
}
