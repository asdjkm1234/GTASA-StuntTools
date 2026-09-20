/**
 * The 3D half of the map symbology: through-depth beacons for units and calls, plus the assignment routes.
 *
 * `createDebugLines(..., { throughDepth: true })` compiles to the `debug-line-through` pipeline, whose depth
 * compare is `always` — the pillar is drawn OVER the city instead of inside it. That is exactly the property a
 * dispatch map needs: a unit behind a downtown tower still has to be findable. The flat icons and the text sit
 * on the 2D overlay; this file only draws what has to read as being *in* the world.
 *
 * Buffers are allocated once at {@link MARKER_CAPACITY} and refilled every frame — `updateDebugLines` rewrites
 * the contents and re-reads the vertex count, so a set that goes empty costs one degenerate segment.
 */
import type { DebugLineSetId, Engine } from '@opensa/engine';

import type { Operations, Selection, UnitStatus } from '../ops/types';
import type { GtaGround } from './coords';

import { UNITS_ON_SCREEN } from '../ops/budget';
import { gtaToEngine } from './coords';

export type Rgba = readonly [number, number, number, number];

/** The line sets this layer owns, keyed by what they draw. Incident keys are `call<priority>`. */
export type SetKey = 'call1' | 'call2' | 'call3' | 'callClosed' | 'route' | 'selection' | 'trail' | UnitStatus;

/**
 * Markers a single set is ALLOCATED for. Every marker of a set shares one colour, so the worst case for any
 * one of them is the whole board in a single status — which is why the allocation is the declared unit count
 * ({@link UNITS_ON_SCREEN}) rather than a fraction of it.
 *
 * Until 2026-08-21 this was a bare `96` and a set that filled up **returned without drawing the rest**: at
 * the 150 units 201's budget table declares, a fifth of the shift would simply not have been on the map, with
 * no throw, no warning and nothing on screen to say a unit was missing. The buffers grow now, and the growth
 * is counted into the inventory report — a budget is an allocation, not a ceiling
 * (`docs/project-goals.md`, directive 2).
 */
const MARKER_CAPACITY = UNITS_ON_SCREEN;

/**
 * The one colour table in the app — the 2D overlay reads it too, so a unit's pillar and its label chip can
 * never drift apart. Values are what the scene pass receives; the tonemapper takes it from there, so the
 * overlay's CSS twin is close rather than identical (and that is fine — one is a halo, one is a chip).
 */
export const SET_COLORS: Readonly<Record<SetKey, Rgba>> = {
  available: [0.26, 0.85, 0.46, 1],
  busy: [0.55, 0.58, 0.62, 1],
  call1: [1, 0.24, 0.3, 1],
  call2: [1, 0.56, 0.16, 1],
  call3: [0.92, 0.84, 0.28, 1],
  callClosed: [0.42, 0.46, 0.5, 1],
  enRoute: [1, 0.66, 0.16, 1],
  onScene: [0.32, 0.66, 1, 1],
  route: [0.34, 0.78, 1, 1],
  selection: [1, 1, 1, 1],
  // Deliberately dim: a trail is context under the live picture, not a thing to read. One colour for every
  // unit — colouring each by status would need a set per status and would compete with the units themselves.
  trail: [0.42, 0.55, 0.68, 1],
};

/** Beacon height in world units — tall enough to clear Los Santos rooftops. */
const CALL_PILLAR = 190;
const UNIT_PILLAR = 110;
/** Half-size of the ground cross under a beacon. */
const CROSS = 9;
/** Floats per marker: a pillar plus a two-segment ground cross, 6 vertices. */
const FLOATS_PER_MARKER = 18;
/** How high the route lines float, so they read above the road surface rather than inside it. */
const ROUTE_Y = 8;
/**
 * Trails ride at the same height as the assignment lines, for now.
 *
 * 8/04 says trails are ground geometry and share the clamp-to-ground work with
 * [7/05's annotations](../../../../docs/plans/201-dispatch-console/7-the-operator-map/readme.md) — *do not
 * build it twice*. 7/05 does not exist, so this does NOT invent a clamp that 7/05 would then replace: a
 * flat offset is honest on the flat half of Los Santos and visibly wrong on a hill, and that is the thing
 * 7/05 fixes for both consumers at once.
 */
const TRAIL_Y = ROUTE_Y;
/**
 * Floats the `trail` set is allocated for — its own budget, because it is not a marker set.
 *
 * Sizing it from {@link MARKER_CAPACITY} would be a category error with a visible cost: a marker is 18
 * floats and a board's worth is 2 700, while trails are **45 000** at the measured 51 points per unit
 * ([the trail cost](../../../../docs/benchmarks/opensa-engine/2026-08-22-dispatch-trail-cost.json)). The set
 * grew five times on the FIRST frame that drew trails, and each growth is counted into
 * {@link BeaconStats.grownSets} — the number the inventory panel warns on to say *the board went past the
 * declared unit budget*. One frame of trails and that warning is permanently on and means nothing.
 *
 * 64 points per unit covers the measured 51 with room; past it the set still grows, and {@link grow} keeps
 * that growth out of the marker counter.
 */
const TRAIL_FLOATS = UNITS_ON_SCREEN * 64 * 6;
const RING_RADIUS = 26;
const RING_SEGMENTS = 28;
/** A degenerate segment: two identical vertices rasterize nothing, and it keeps the write non-empty. */
const EMPTY = new Float32Array(6);

/** What the layer had to do to hold the board — read by the inventory report, so a capture states it. */
export interface BeaconStats {
  /** Markers the largest MARKER set is allocated for. The trail set has its own budget and is excluded —
   *  it is a line list, not a marker ring. */
  readonly capacity: number;
  /** How many times a set has been grown past {@link MARKER_CAPACITY} since boot. Non-zero means the board
   *  went past the declared budget and the map kept drawing it; zero means the allocation held. */
  readonly grownSets: number;
}

export class Beacons {
  private readonly buffers = new Map<SetKey, Float32Array>();
  private readonly counts = new Map<SetKey, number>();
  private readonly engine: Engine;
  private grownSets = 0;
  /** Sets whose buffer outgrew its GPU allocation this frame — recreated in {@link flush}. */
  private readonly resized = new Set<SetKey>();
  private readonly sets = new Map<SetKey, DebugLineSetId>();

  constructor(engine: Engine) {
    this.engine = engine;
    for (const key of Object.keys(SET_COLORS) as SetKey[]) {
      const buffer = new Float32Array(key === 'trail' ? TRAIL_FLOATS : MARKER_CAPACITY * FLOATS_PER_MARKER);
      this.buffers.set(key, buffer);
      this.sets.set(key, engine.createDebugLines(buffer, SET_COLORS[key], { throughDepth: true }));
    }
  }

  dispose(): void {
    for (const id of this.sets.values()) {
      this.engine.destroyDebugLines(id);
    }
    this.sets.clear();
  }

  /** Allocation and growth, for the report. */
  stats(): BeaconStats {
    let capacity = 0;
    for (const [key, buffer] of this.buffers) {
      if (key !== 'trail') {
        capacity = Math.max(capacity, buffer.length / FLOATS_PER_MARKER);
      }
    }

    return { capacity, grownSets: this.grownSets };
  }

  /** Refill every set from the current board. Called once per frame; allocates nothing. */
  update(ops: Operations, selection: Selection, trails?: ReadonlyMap<string, Float32Array>): void {
    this.counts.clear();
    for (const unit of ops.units) {
      this.pushMarker(unit.status, unit.at, UNIT_PILLAR);
    }
    for (const incident of ops.incidents) {
      this.pushMarker(incidentKey(incident.status, incident.priority), incident.at, CALL_PILLAR);
    }
    this.pushRoutes(ops);
    this.pushTrails(trails);
    this.pushSelection(ops, selection);
    this.flush();
  }

  private flush(): void {
    // A grown buffer no longer fits the GPU allocation `createDebugLines` sized from the original one, and
    // `updateDebugLines` writes without checking — so a resized set is recreated at the new size FIRST.
    for (const key of this.resized) {
      const buffer = this.buffers.get(key);
      const id = this.sets.get(key);
      if (!buffer || id === undefined) {
        continue;
      }
      this.engine.destroyDebugLines(id);
      this.sets.set(key, this.engine.createDebugLines(buffer, SET_COLORS[key], { throughDepth: true }));
    }
    this.resized.clear();
    for (const [key, id] of this.sets) {
      const buffer = this.buffers.get(key);
      const count = this.counts.get(key) ?? 0;
      this.engine.updateDebugLines(id, buffer && count > 0 ? buffer.subarray(0, count) : EMPTY);
    }
  }

  /**
   * Double a full set's buffer, keeping what it already holds.
   *
   * Counted for MARKER sets only. `grownSets` answers one question — *did the board go past the declared
   * unit budget* — and the trail set is not a board of units; letting its growth in would answer that
   * question with a yes on every session.
   */
  private grow(key: SetKey, needed: number): Float32Array | undefined {
    const current = this.buffers.get(key);
    if (!current) {
      return undefined;
    }
    let length = Math.max(FLOATS_PER_MARKER, current.length);
    while (length < needed) {
      length *= 2;
    }
    const next = new Float32Array(length);
    next.set(current);
    this.buffers.set(key, next);
    this.resized.add(key);
    if (key !== 'trail') {
      this.grownSets += 1;
    }

    return next;
  }

  private pushMarker(key: SetKey, ground: GtaGround, pillar: number): void {
    const at = this.counts.get(key) ?? 0;
    const held = this.buffers.get(key);
    const out = held && at + FLOATS_PER_MARKER > held.length ? this.grow(key, at + FLOATS_PER_MARKER) : held;
    if (!out) {
      return;
    }
    const [x, , z] = gtaToEngine(ground);
    out.set([x, 0, z, x, pillar, z], at);
    out.set([x - CROSS, 1, z, x + CROSS, 1, z], at + 6);
    out.set([x, 1, z - CROSS, x, 1, z + CROSS], at + 12);
    this.counts.set(key, at + FLOATS_PER_MARKER);
  }

  /** One straight line per responding unit. It is a BEARING, not a driven route — see the app readme. */
  private pushRoutes(ops: Operations): void {
    const out = this.buffers.get('route');
    if (!out) {
      return;
    }
    let buffer = out;
    let at = 0;
    for (const unit of ops.units) {
      const incident = ops.incidents.find((entry) => entry.id === unit.incident);
      if (!incident || unit.status !== 'enRoute') {
        continue;
      }
      if (at + 6 > buffer.length) {
        const grown = this.grow('route', at + 6);
        if (!grown) {
          break;
        }
        buffer = grown;
      }
      buffer.set(gtaToEngine(unit.at, ROUTE_Y), at);
      buffer.set(gtaToEngine(incident.at, ROUTE_Y), at + 3);
      at += 6;
    }
    this.counts.set('route', at);
  }

  /** A ground ring under the selected entity — the "you are looking at this one" halo. */
  private pushSelection(ops: Operations, selection: Selection): void {
    const out = this.buffers.get('selection');
    const ground = selectionGround(ops, selection);
    if (!out || ground === null) {
      return;
    }
    const [cx, , cz] = gtaToEngine(ground);
    for (let i = 0; i < RING_SEGMENTS; i += 1) {
      const a0 = (i / RING_SEGMENTS) * Math.PI * 2;
      const a1 = ((i + 1) / RING_SEGMENTS) * Math.PI * 2;
      out.set(
        [
          cx + Math.cos(a0) * RING_RADIUS,
          2,
          cz + Math.sin(a0) * RING_RADIUS,
          cx + Math.cos(a1) * RING_RADIUS,
          2,
          cz + Math.sin(a1) * RING_RADIUS,
        ],
        i * 6,
      );
    }
    this.counts.set('selection', RING_SEGMENTS * 6);
  }

  /** Every unit's leg so far, as a line list: each pair of points is one segment. */
  private pushTrails(trails: ReadonlyMap<string, Float32Array> | undefined): void {
    let out = this.buffers.get('trail');
    let at = 0;
    if (!out || !trails) {
      this.counts.set('trail', 0);

      return;
    }
    for (const points of trails.values()) {
      for (let i = 0; i + 3 < points.length; i += 2) {
        if (at + 6 > out.length) {
          const grown = this.grow('trail', at + 6);
          if (!grown) {
            break;
          }
          out = grown;
        }
        out.set(gtaToEngine([points[i], points[i + 1]], TRAIL_Y), at);
        out.set(gtaToEngine([points[i + 2], points[i + 3]], TRAIL_Y), at + 3);
        at += 6;
      }
    }
    this.counts.set('trail', at);
  }
}

/** The set a call belongs to: closed calls go grey whatever their priority was. */
export function incidentKey(status: string, priority: number): SetKey {
  if (status === 'closed') {
    return 'callClosed';
  }

  return priority === 1 ? 'call1' : priority === 2 ? 'call2' : 'call3';
}

function selectionGround(ops: Operations, selection: Selection): GtaGround | null {
  if (selection === null) {
    return null;
  }
  if (selection.kind === 'world') {
    return selection.at;
  }
  const found =
    selection.kind === 'unit'
      ? ops.units.find((unit) => unit.id === selection.id)
      : ops.incidents.find((incident) => incident.id === selection.id);

  return found?.at ?? null;
}
