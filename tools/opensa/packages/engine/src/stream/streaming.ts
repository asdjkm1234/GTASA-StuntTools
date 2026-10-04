import type { OspakManifest } from '@opensa/engine-formats';

/**
 * Thin streaming driver (plan 074/05): plan-060 semantics re-implemented three-free — rings + hysteresis,
 * keep-old-level-until-replacement, atomic HD↔LOD swap, bounded creates (≤1 cell/frame), eviction outside the
 * outer ring. Cells come from the pak worker as transferable blobs.
 *
 * Textures stream WITH the cells (003 phase 4): each cell entry lists the arrays it draws with, so an array
 * is fetched alongside the first cell that needs it and destroyed when the last such cell unloads. Before
 * that the whole district's arrays had to be resident from boot (~1.7 GB on a full map), because nothing
 * knew which cell wanted which. A pre-`textures` pak still loads eagerly in `setup`.
 *
 * The LOD ring is the fog-mask boundary (plan 074/21): hosts size it via `lodRadius` so that
 * `fogCut + margin ≤ lodRadius`, and the LOD/evict decisions test the closest point of the cell's TRUE
 * geometry AABB (manifest `aabb`, plan 087) — an instance welds into the cell of its PIVOT, so meshes
 * (bridges, piers) reach a mean 141 u / max 799 u past the grid rect on gostown, and a grid-rect ring
 * skipped cells whose geometry already sat inside the fog. Pre-`aabb` paks fall back to the grid rect
 * (whose closest-point test already beat the old centre test by the 177 u half-diagonal).
 */
import type { Engine } from '../engine';
import type { PakWorkerResponse } from './pak-worker';
import type { ResidencyView } from './residency';

import { COLLISION_KEY_PREFIX } from './collision-source';
import { postPakFetch } from './pak-traffic';
import { ResidencyGate, verticalExtents } from './residency';

const HD_RADIUS = 380;
const LOD_RADIUS = 1000;
const HYSTERESIS = 60;
const EVICT_MARGIN = 150;
/** Adaptive create budget (074/21 P3): a second create in one frame only while total create time stays
 *  under this — bounds the worst frame instead of doubling it (M1 worst create ≈ 1.1 ms). */
const CREATE_BUDGET_MS = 1.5;
/** Budget for draining texture-array (layer, mip) writes inside `update` — the fix for the 15–85 ms
 *  between-frames upload hitch (`docs/performance/applied/texture-upload-budget.md`): the
 *  worker handler only decodes + creates the texture, the writes are paid HERE, like cell creates. */
const UPLOAD_BUDGET_MS = 1.5;
/** Velocity prefetch (074/21 P3): request rings test a focus biased AHEAD along the smoothed per-frame
 *  motion — cells are fetched before the true focus reaches them. Lead ≈ 1.25 s at 120 Hz, capped so a
 *  fast flyover can't drag the request ring a district ahead. Eviction always uses the TRUE focus. */
const PREFETCH_LEAD_FRAMES = 150;
const PREFETCH_MAX = 300;
/** A focus jump of a cell-plus in ONE update is a teleport, not motion: zero the velocity and open the
 *  late-create GRACE (everything legitimately creates inside the fog after a teleport/boot). */
const TELEPORT_JUMP = 260;
/** Velocity EMA smoothing (per update) — frame-time jitter must not wobble the request ring. */
const VELOCITY_SMOOTH = 0.1;

/** Ring radii (engine units). Defaults keep the historical 380/1000 when a host passes nothing. */
export interface StreamingRadii {
  hdRadius?: number;
  lodRadius?: number;
}

export interface StreamStats {
  /**
   * Milliseconds spent in the worker's `message` handler since the last {@link Streaming.update} — blob
   * bookkeeping and the cheap start of a texture upload (decode + `createTexture`; the writes drain in
   * `update` under {@link UPLOAD_BUDGET_MS} and show up as {@link uploadMs}).
   *
   * It is reported because it runs BETWEEN frames, where no in-loop timer can see it: a 2026-07-27 field
   * report of 20-250 ms frames turned out to have 90-98 % of each slow frame outside every block the host
   * times, and it was this — whole-array uploads at 15-85 ms a call. Reset every update, so it is
   * per-frame like the rest.
   */
  blobMs: number;
  /** RUNNING TOTAL since the driver was constructed — not a per-update count, unlike {@link blobMs} and
   *  {@link uploadMs}. A host that ADDS it up per frame counts every earlier create again on every later
   *  frame, and gets a plausible-looking number that means nothing: the 2026-08-12 phone capture reported
   *  2454 creates against 4 resident cells and 0 evictions for exactly that reason. Read it, or difference
   *  two readings — never sum it. Same for {@link evicted} and {@link lateCreates}. */
  created: number;
  /** Running total since construction — see {@link created}. */
  evicted: number;
  /** Creates whose cell already sat INSIDE the effective fog cut (074/21 P3) — each one is a pop the
   *  player could have seen. The fog-mask honesty metric: 0 in steady driving; teleports/boot are
   *  graced until their pending queue drains. Running total since construction — see {@link created};
   *  `apps/web` differences two readings around a leg, which is the pattern. */
  lateCreates: number;
  loadedCells: number;
  pendingCells: number;
  /** Milliseconds this update spent draining texture-array writes (the budgeted, in-frame share of what
   *  {@link blobMs} used to carry all at once). Sits INSIDE the host's stream block timer. */
  uploadMs: number;
  /** The single most expensive handler call in that window — one huge texture-array upload and a pile-up of
   *  small ones are different problems, and only this number tells them apart. */
  worstBlobMs: number;
  worstCreateMs: number;
}

interface CellSlot {
  centre: [number, number];
  current: Level | null;
  cx: number;
  cy: number;
  /** Union of the level rects — eviction must keep a slot while ANY of its geometry is near the ring. */
  evictRect: [number, number, number, number];
  keys: Partial<Record<Level, string>>;
  pending: Level | null;
  /** GRID cell rect in engine XZ ([minX, maxX, minZ, maxZ]) — the fallback when a level has no `aabb`. */
  rect: [number, number, number, number];
  /** Per-level TRUE geometry rects (manifest `aabb`, plan 087) — what the LOD ring actually tests. */
  rects: Partial<Record<Level, [number, number, number, number]>>;
}

type Level = 'hd' | 'lod';

/** A slot that wants a level it has not got, and how badly — the queue both the fetch and the create read. */
interface WantedCell {
  key: string;
  level: Level;
  /** Distance from the TRUE focus to the slot's geometry, engine units: smaller = wanted sooner. */
  priority: number;
  slot: CellSlot;
}

export class StreamingDriver {
  /** Texture-array ref → the loaded cell keys drawing with it. Empty set ⇒ the array is released. */
  private readonly arrayUsers = new Map<number, Set<string>>();
  private readonly blobs = new Map<string, Uint8Array>();
  private readonly cells = new Map<string, CellSlot>();
  /** The grid the pak is welded on — the residency reserve is stated in cells rather than in metres. */
  private readonly cellSize: number;
  private readonly engine: Engine;
  /** Per-entry vertical extent, or null when the pak does not state one — see {@link verticalExtents}. */
  private readonly extents: Map<string, [number, number]> | null;
  private readonly hdRadius: number;
  private readonly keyToSlot = new Map<string, CellSlot>();
  /** Previous update's focus (engine XZ) — velocity source; null until the first update. */
  private lastFocus: [number, number] | null = null;
  private readonly lodRadius: number;
  private readonly manifest: OspakManifest;
  /** Map-inspector pin (074/22): while set, the rings are IGNORED — exactly these cells are resident at
   *  exactly this level, and every other slot evicts. `null` = normal focus-driven streaming. */
  private manual: null | { keys: Set<string>; level: Level } = null;
  private readonly requested = new Set<string>();
  private readonly stats: StreamStats = {
    blobMs: 0,
    created: 0,
    evicted: 0,
    lateCreates: 0,
    loadedCells: 0,
    pendingCells: 0,
    uploadMs: 0,
    worstBlobMs: 0,
    worstCreateMs: 0,
  };
  /** Late-create grace: open at boot and after every teleport jump, closes once pending drains. */
  private teleportGrace = true;
  /** Smoothed per-update focus delta (engine XZ) — the prefetch direction. */
  private readonly velocity: [number, number] = [0, 0];
  /** Texture-array refs already reported missing — one line each, not one per frame. */
  private readonly warnedArrays = new Set<number>();
  private readonly worker: Worker;

  constructor(engine: Engine, manifest: OspakManifest, worker: Worker, radii: StreamingRadii = {}) {
    this.engine = engine;
    this.manifest = manifest;
    this.worker = worker;
    this.hdRadius = radii.hdRadius ?? HD_RADIUS;
    this.lodRadius = radii.lodRadius ?? LOD_RADIUS;
    const cellSize = manifest.cellSize ?? 250; // pre-cellSize manifests (older converts) default to the stock grid
    this.cellSize = cellSize;
    this.extents = verticalExtents(manifest);
    for (const [key, entry] of Object.entries(manifest.cells)) {
      const [cxRaw, cyRaw, level] = key.split(',');
      const cx = Number(cxRaw);
      const cy = Number(cyRaw);
      const slotKey = `${cx},${cy}`;
      let slot = this.cells.get(slotKey);
      if (!slot) {
        // GTA cy maps to engine z = −y: the row [cy, cy+1) lands at z ∈ [−(cy+1), −cy) · cellSize.
        const rect: [number, number, number, number] = [
          cx * cellSize,
          (cx + 1) * cellSize,
          -(cy + 1) * cellSize,
          -cy * cellSize,
        ];
        slot = {
          centre: [(cx + 0.5) * cellSize, -(cy + 0.5) * cellSize],
          current: null,
          cx,
          cy,
          evictRect: rect,
          keys: {},
          pending: null,
          rect,
          rects: {},
        };
        this.cells.set(slotKey, slot);
      }
      slot.keys[level as Level] = key;
      if (entry.aabb) {
        slot.rects[level as Level] = entry.aabb;
      }
      this.keyToSlot.set(key, slot);
    }
    // Eviction must be at least as conservative as every level's DECISION rect (aabb, grid fallback) —
    // evicting by a smaller rect than the one that desires the level would load/unload-flap at the edge.
    for (const slot of this.cells.values()) {
      const levels = (Object.keys(slot.keys) as Level[]).map((level) => slot.rects[level] ?? slot.rect);
      slot.evictRect = levels.reduce(
        (union, r): [number, number, number, number] => [
          Math.min(union[0], r[0]),
          Math.max(union[1], r[1]),
          Math.min(union[2], r[2]),
          Math.max(union[3], r[3]),
        ],
        levels[0],
      );
    }
    worker.addEventListener('message', (event: MessageEvent<PakWorkerResponse>) => {
      // Timed HERE and not inside `onBlob`: this handler runs between frames, so its cost is invisible to
      // every timer the host frame keeps (see `StreamStats.blobMs`).
      const started = performance.now();
      this.onBlob(event.data);
      const spent = performance.now() - started;
      this.stats.blobMs += spent;
      this.stats.worstBlobMs = Math.max(this.stats.worstBlobMs, spent);
    });
  }

  /**
   * Let the pak worker go (201/6-03). Until a mode could be SWITCHED nothing ever tore streaming down, so
   * the worker outlived the surface that started it — a thread and its range cache per switch, on a device
   * budgeted for one.
   */
  dispose(): void {
    this.worker.terminate();
  }

  /** Every cell the pak offers, as GTA cell coords — the map inspector's section grid. Independent of
   *  what is currently resident (that is `engine.cells`), because the grid must show the whole map. */
  listCells(): [number, number][] {
    return [...this.cells.values()].map((slot): [number, number] => [slot.cx, slot.cy]);
  }

  /**
   * Pin an explicit cell set (map-inspector) or return to focus-driven streaming with `null`. The rings
   * are bypassed rather than the update loop suspended, so creates keep their frame budget and the
   * atomic HD↔LOD swap still applies — a pinned set fills in over a few frames instead of hitching.
   */
  setManualCells(cells: null | readonly (readonly [number, number])[], lod = false): void {
    this.manual =
      cells === null ? null : { keys: new Set(cells.map(([cx, cy]) => `${cx},${cy}`)), level: lod ? 'lod' : 'hd' };
  }

  /** Tear down every loaded cell (the leak-assertion hook: the residency ledger must return to its
   *  post-texture baseline afterwards). */
  unloadAll(): void {
    for (const slot of this.cells.values()) {
      this.unload(slot);
    }
    this.blobs.clear();
    this.requested.clear();
    this.teleportGrace = true; // the re-stream is boot-like — its creates are not pops
  }

  /**
   * Per frame: retarget residency at `focus` (engine coords) and advance the bounded creates + swaps.
   *
   * `view` is what the host's NEXT frame will look at, and passing it changes the question the driver asks
   * from *"how far is this cell from the focus"* to *"will the frame draw it"* (plan 201/1-05). A host that
   * passes nothing keeps the rings — and the game shell is one on purpose: it streams around the PLAYER, who
   * has physics behind the camera, and a view gate there would spawn cars into a hole
   * ([restrictions/streaming-residency.md](../../../../docs/restrictions/streaming-residency.md)).
   */
  update(focus: readonly [number, number, number], view?: ResidencyView): StreamStats {
    // Velocity prefetch (074/21 P3): REQUESTS test a focus biased ahead along the smoothed motion;
    // EVICTION stays on the true focus (symmetric safety — the ring behind never thrashes).
    const [biasX, biasZ] = this.advanceVelocity(focus[0], focus[2]);
    // Drain BEFORE the slot loop: an array whose last write lands here unblocks its cell the same frame.
    this.stats.uploadMs = this.engine.textures.drainUploads(UPLOAD_BUDGET_MS);
    const gate = view !== undefined && this.extents !== null ? new ResidencyGate(view) : null;
    const { loaded, wanted } = this.retarget(biasX, biasZ, focus[0], focus[2], gate);
    let pendingCells = wanted.length;
    let loadedCells = loaded;
    let createSpentMs = 0;
    let creates = 0;
    for (const want of wanted) {
      if (!this.requested.has(want.key)) {
        this.requestBlob(want.key);
        this.texturesReady(want.key); // kick the arrays off IN PARALLEL with the cell — never serialize the two
        continue;
      }
      // Adaptive budget: up to two creates while the total stays under CREATE_BUDGET_MS — a heavy first
      // create keeps the old 1/frame behaviour, two light ones drain ring-entry bursts twice as fast.
      if (creates > 0 && (creates >= 2 || createSpentMs >= CREATE_BUDGET_MS)) {
        continue;
      }
      const blob = this.blobs.get(want.key);
      if (!blob || !this.texturesReady(want.key)) {
        continue; // arrays still in flight — a cell must never record against an unloaded array
      }
      const wasLoaded = want.slot.current !== null;
      createSpentMs += this.create(
        want.slot,
        want.level,
        want.key,
        blob,
        rectDistanceOf(this.levelRect(want.slot, want.level), focus[0], focus[2]),
      );
      creates += 1;
      pendingCells -= 1; // the create cleared this slot's `pending`, and the counters are read this frame
      if (!wasLoaded) {
        loadedCells += 1;
      }
    }
    this.stats.pendingCells = pendingCells;
    this.stats.loadedCells = loadedCells;
    if (this.teleportGrace && pendingCells === 0) {
      this.teleportGrace = false; // the boot/teleport queue drained — late creates count again
    }
    this.pruneStaleBlobs();
    const stats = { ...this.stats };
    this.stats.blobMs = 0; // per-FRAME, like the host's own block timers — the rest are running totals
    this.stats.worstBlobMs = 0;

    return stats;
  }

  /** Smooth the per-update focus delta; returns the REQUEST focus (true focus + capped lead vector). */
  private advanceVelocity(fx: number, fz: number): [number, number] {
    if (this.lastFocus === null) {
      this.lastFocus = [fx, fz];
    } else {
      const dx = fx - this.lastFocus[0];
      const dz = fz - this.lastFocus[1];
      this.lastFocus[0] = fx;
      this.lastFocus[1] = fz;
      if (Math.hypot(dx, dz) > TELEPORT_JUMP) {
        // A teleport: yesterday's heading is meaningless, and everything about to create sits inside
        // the fog by necessity — grace the late-create metric until the queue drains.
        this.velocity[0] = 0;
        this.velocity[1] = 0;
        this.teleportGrace = true;
      } else {
        this.velocity[0] += (dx - this.velocity[0]) * VELOCITY_SMOOTH;
        this.velocity[1] += (dz - this.velocity[1]) * VELOCITY_SMOOTH;
      }
    }
    let leadX = this.velocity[0] * PREFETCH_LEAD_FRAMES;
    let leadZ = this.velocity[1] * PREFETCH_LEAD_FRAMES;
    const lead = Math.hypot(leadX, leadZ);
    if (lead > PREFETCH_MAX) {
      leadX *= PREFETCH_MAX / lead;
      leadZ *= PREFETCH_MAX / lead;
    }

    return [fx + leadX, fz + leadZ];
  }

  /** Record this cell as a user of every array it draws with. */
  private claimTextures(key: string): void {
    for (const ref of this.manifest.cells[key].textures ?? []) {
      const users = this.arrayUsers.get(ref) ?? new Set<string>();
      users.add(key);
      this.arrayUsers.set(ref, users);
    }
  }

  /** Load a delivered blob into the engine; returns the create's duration for the frame budget. */
  private create(slot: CellSlot, level: Level, key: string, blob: Uint8Array, trueRect: number): number {
    const start = performance.now();
    // The honesty metric (074/21 P3): a cell APPEARING (current === null) inside the effective fog cut
    // was visible while absent — a pop the fog failed to mask. Steady driving must keep this at zero.
    // HD↔LOD swaps are exempt by design: they happen deep inside the clear zone and swap atomically —
    // the old level renders until the replacement is live, so nothing pops.
    if (!this.teleportGrace && slot.current === null && trueRect < this.engine.environment.fogCutDistance) {
      this.stats.lateCreates += 1;
    }
    this.engine.cells.load(key, blob);
    this.claimTextures(key);
    // Atomic swap: the replacement is live — drop the old level the same frame (no hole, no double-draw).
    const previousKey = slot.current ? slot.keys[slot.current] : undefined;
    if (previousKey !== undefined && previousKey !== key) {
      this.engine.cells.unload(previousKey);
      // Claim BEFORE release: an array both levels draw with must never drop to zero users in between,
      // or the HD↔LOD swap would destroy the texture and immediately re-fetch it.
      this.releaseTextures(previousKey);
      this.requested.delete(previousKey);
    }
    slot.current = level;
    slot.pending = null;
    // `requested` marks IN-FLIGHT fetches only: clear it with the blob, or a demoted level can never be
    // re-fetched on return (the field bug: revisited areas stuck at LOD — blob consumed, mark kept).
    this.blobs.delete(key); // the CPU copy dies immediately after upload (memory model)
    this.requested.delete(key);
    this.stats.created += 1;
    const duration = performance.now() - start;
    this.stats.worstCreateMs = Math.max(this.stats.worstCreateMs, duration);

    return duration;
  }

  /** Ring pick with a hysteresis dead-band: keep the current level near the boundary (no flip-flop).
   *  HD tests the GRID cell CENTRE (a quality ring — a rect test would nearly double HD residency for no
   *  guarantee); the LOD ring tests the level's TRUE geometry rect (manifest `aabb`, grid-rect fallback) —
   *  the fog-mask guarantee is geometric, and the geometry is what must not pop (074/21, 087). */
  private desiredLevel(slot: CellSlot, fx: number, fz: number, gate: null | ResidencyGate): Level | null {
    if (this.manual !== null) {
      const { keys, level } = this.manual;

      return keys.has(`${slot.cx},${slot.cy}`) && slot.keys[level] ? level : null;
    }
    const lodEdge = slot.current !== null ? this.lodRadius + HYSTERESIS : this.lodRadius;
    // The LOD ring stays the REACH in every mode: a frustum runs to the far plane, and a view gate that
    // widened the set would stream the far side of the map the moment the operator tilted towards it.
    // The gate only ever REMOVES cells the ring already wanted — which is what makes it safe.
    if (rectDistanceOf(slot.evictRect, fx, fz) >= lodEdge) {
      return null;
    }
    if (gate !== null && !this.inView(slot, fx, fz, gate)) {
      return null;
    }
    if (slot.keys.hd && this.wantsHd(slot, fx, fz, gate)) {
      return 'hd';
    }
    if (slot.keys.lod && rectDistanceOf(this.levelRect(slot, 'lod'), fx, fz) < lodEdge) {
      return 'lod';
    }

    return null;
  }

  /**
   * Drop a slot the residency no longer wants, once it is past the ring plus its margin. Eviction stays
   * RADIAL even when the requests are view-gated: a cell that left the screen because the operator turned
   * is one they are about to turn back to, and unloading on the turn would thrash the fetch queue for a
   * saving the ring already bounds.
   */
  private evictIfBeyondRing(slot: CellSlot, trueX: number, trueZ: number): void {
    // The evict margin is a RING hysteresis; a pinned set has no ring, so an unselected cell must go
    // regardless of how close it sits to the camera — otherwise deselecting one never clears it.
    if (
      slot.current !== null &&
      (this.manual !== null || rectDistanceOf(slot.evictRect, trueX, trueZ) > this.lodRadius + EVICT_MARGIN)
    ) {
      this.unload(slot);
    }
  }

  /**
   * Is this slot inside the view, plus the reserve? The reserve is ONE grid cell on every side, which is the
   * quantum the whole decision is taken in: a residency set is a set of cells, so slack smaller than a cell
   * cannot be expressed and slack larger than one is a number somebody picked. The near cells are exempt —
   * a turn is instant and a fetch is not, so everything within the HD ring stays resident whichever way the
   * operator is facing.
   */
  private inView(slot: CellSlot, fx: number, fz: number, gate: ResidencyGate): boolean {
    if (rectDistanceOf(slot.evictRect, fx, fz) < this.hdRadius) {
      return true;
    }
    for (const level of Object.keys(slot.keys) as Level[]) {
      const extent = this.extents?.get(slot.keys[level] as string);
      if (extent && gate.sees(this.levelRect(slot, level), extent[0], extent[1], this.cellSize)) {
        return true;
      }
    }

    return false;
  }

  /** The rect a level's ring decisions test: its true geometry AABB, or the grid rect on a pre-`aabb` pak. */
  private levelRect(slot: CellSlot, level: Level): readonly [number, number, number, number] {
    return slot.rects[level] ?? slot.rect;
  }

  /** A delivered pak entry: a texture array uploads straight away, a cell blob waits for its create slot. */
  private onBlob(message: PakWorkerResponse): void {
    if (message.type !== 'blob') {
      return;
    }
    // A texture array BEGINS its upload the moment it lands (decode + `createTexture` — cheap) and never
    // enters `blobs`: it has no slot, so the stale-blob prune would throw it away. The expensive (layer,
    // mip) writes drain from `update` under UPLOAD_BUDGET_MS — a whole-array upload here ran between
    // frames at 15-85 ms a call, invisible to every in-loop timer.
    // Baked collision shares this worker (200/3-01) and its replies land here too — they belong to
    // `PakCollisionSource`, and a blob with no cell slot would be pruned away a frame later anyway.
    if (message.key.startsWith(COLLISION_KEY_PREFIX)) {
      return;
    }
    if (message.key.startsWith('array-')) {
      if (message.buffer) {
        this.engine.textures.beginLoad(Number(message.key.slice('array-'.length)), new Uint8Array(message.buffer));
      } else {
        this.requested.delete(message.key); // failed: let the next cell that needs it re-request
        // Said out loud for the same reason the cell branch is: a world whose ARRAYS all fail draws nothing
        // and reports nothing, which is a whole field session to diagnose without this line.
        // eslint-disable-next-line no-console -- deliberate field diagnostic, same class as the cell warning below
        console.warn(`[stream] array ${message.key} failed: ${message.error ?? 'unknown'} — will retry`);
      }

      return;
    }
    if (message.buffer) {
      this.blobs.set(message.key, new Uint8Array(message.buffer));

      return;
    }
    // Failed fetch/inflate: clear the in-flight mark so the slot RETRIES next time it wants the level
    // (a permanently-poisoned key was the original stuck-at-LOD failure mode).
    this.requested.delete(message.key);
    // eslint-disable-next-line no-console -- deliberate field diagnostic: a silent retry loop hid the stuck-at-LOD bug once already
    console.warn(`[stream] entry ${message.key} failed: ${message.error ?? 'unknown'} — will retry`);
  }

  /** Backpressure (whip-bench finding: 736 MB heap): fetched blobs whose slot no longer wants that level
   *  are DROPPED (with their in-flight mark, so a future desire re-fetches). Camera whips order far more
   *  data than the 1-create/frame budget can consume — without pruning it piles up in the worker handoff. */
  private pruneStaleBlobs(): void {
    for (const key of this.blobs.keys()) {
      const slot = this.keyToSlot.get(key);
      if (!slot || slot.keys[slot.pending ?? 'hd'] !== key || slot.pending === null) {
        this.blobs.delete(key);
        this.requested.delete(key);
      }
    }
  }

  /** Drop this cell's claims; an array nothing draws with any more is destroyed — unless a live rigid
   *  model (a CLEO object, the osm spike) still binds it, which `releaseWorldArray` checks. A kept array
   *  keeps its `requested` mark too: it IS resident, nothing needs to re-fetch it. */
  private releaseTextures(key: string): void {
    for (const ref of this.manifest.cells[key].textures ?? []) {
      const users = this.arrayUsers.get(ref);
      if (!users) {
        continue;
      }
      users.delete(key);
      if (users.size === 0) {
        this.arrayUsers.delete(ref);
        if (this.engine.releaseWorldArray(ref)) {
          this.requested.delete(`array-${ref}`);
        }
      }
    }
  }

  private requestBlob(key: string): void {
    this.requested.add(key);
    postPakFetch(this.worker, key, this.manifest.cells[key]);
  }

  /**
   * The decision pass: what every slot wants this update, what that leaves resident, and the queue of slots
   * that want a level they have not got — sorted nearest-focus-first, because that queue IS the network's
   * order and the create budget's. Eviction happens here too, on the slots that want nothing.
   */
  private retarget(
    biasX: number,
    biasZ: number,
    trueX: number,
    trueZ: number,
    gate: null | ResidencyGate,
  ): { loaded: number; wanted: WantedCell[] } {
    let loaded = 0;
    const wanted: WantedCell[] = [];
    for (const slot of this.cells.values()) {
      const desired = this.desiredLevel(slot, biasX, biasZ, gate);
      const key = desired === null ? undefined : slot.keys[desired];
      if (desired === null) {
        slot.pending = null;
        this.evictIfBeyondRing(slot, trueX, trueZ);
      } else if (key === undefined || desired === slot.current) {
        slot.pending = null;
      } else {
        slot.pending = desired;
        wanted.push({ key, level: desired, priority: rectDistanceOf(slot.evictRect, trueX, trueZ), slot });
      }
      if (slot.current !== null) {
        loaded += 1;
      }
    }

    return { loaded, wanted: wanted.sort((a, b) => a.priority - b.priority) };
  }

  /**
   * Whether every array this cell draws with is uploaded, requesting the missing ones. A pak built before
   * the `textures` field carries no refs — those districts loaded every array eagerly at boot, so there is
   * nothing to wait for and this is trivially true.
   */
  private texturesReady(key: string): boolean {
    const refs = this.manifest.cells[key]?.textures;
    if (refs === undefined) {
      return true;
    }
    let ready = true;
    for (const ref of refs) {
      if (this.engine.textures.has(ref)) {
        continue;
      }
      ready = false;
      const arrayKey = `array-${ref}`;
      if (!this.requested.has(arrayKey)) {
        const entry = this.manifest.textures[arrayKey];
        if (!entry) {
          // A cell naming an array the pak does not carry — a converter bug. The cell stays unbuilt rather
          // than crashing the frame in `cells.load`, but it must SAY so: a silently absent cell is the
          // failure mode this project keeps paying for.
          if (!this.warnedArrays.has(ref)) {
            this.warnedArrays.add(ref);
            // eslint-disable-next-line no-console -- a malformed pak must not fail silently
            console.warn(`[stream] cell ${key} needs ${arrayKey}, which the pak does not carry`);
          }
          continue;
        }
        this.requested.add(arrayKey);
        postPakFetch(this.worker, arrayKey, entry);
      }
    }

    return ready;
  }

  private unload(slot: CellSlot): void {
    const currentKey = slot.current ? slot.keys[slot.current] : undefined;
    if (currentKey !== undefined) {
      this.engine.cells.unload(currentKey);
      this.releaseTextures(currentKey);
      this.requested.delete(currentKey);
    }
    slot.current = null;
    slot.pending = null;
    this.stats.evicted += 1;
  }

  /**
   * Does this slot need its HD level? Two rules, and which one runs is a property of the PAK rather than of
   * the host: a pak that states a cell LOD's geometric error and the pixel budget it was baked to is judged
   * by screen-space error (3D Tiles / CesiumJS — one rule at every zoom, screen height and DPR), and one
   * that states neither keeps the HD radius it always had.
   *
   * The hysteresis is the same 60 units in both, applied to the quantity that means *further out*: a
   * resident HD level is judged from `HYSTERESIS` units further away in perspective, and from a view box
   * `HYSTERESIS` units taller in the plan view. Judging it exactly where it is makes a cell parked on the
   * boundary refetch itself.
   */
  private wantsHd(slot: CellSlot, fx: number, fz: number, gate: null | ResidencyGate): boolean {
    const backOff = slot.current === 'hd' ? HYSTERESIS : 0;
    const lodKey = slot.keys.lod;
    const error = lodKey === undefined ? undefined : this.manifest.cells[lodKey].geometricError;
    const budget = this.manifest.lodPixelThreshold;
    if (gate === null || error === undefined || budget === undefined) {
      return Math.hypot(slot.centre[0] - fx, slot.centre[1] - fz) < this.hdRadius + backOff;
    }
    const extent = this.extents?.get(lodKey as string);
    const rect = this.levelRect(slot, 'lod');
    const distance = extent ? gate.distanceToBox(rect, extent[0], extent[1]) : rectDistanceOf(rect, fx, fz);

    return gate.screenError(error, distance, backOff) > budget;
  }
}

/** Horizontal distance from (fx, fz) to the closest point of a cell rect — 0 inside. */
function rectDistanceOf(rect: readonly [number, number, number, number], fx: number, fz: number): number {
  const dx = Math.max(rect[0] - fx, 0, fx - rect[1]);
  const dz = Math.max(rect[2] - fz, 0, fz - rect[3]);

  return Math.hypot(dx, dz);
}
