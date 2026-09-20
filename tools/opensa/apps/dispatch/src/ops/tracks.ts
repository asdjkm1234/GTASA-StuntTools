/**
 * The time axis (201/8-01): a unit's position stops being a point and becomes a **function of time**.
 *
 * A unit whose position is a point cannot be scrubbed. A unit whose position is a track can be, and
 * everything above it — smooth movement between server packets, trails, replay of a shift — falls out of the
 * same structure. This is the shape CZML gives Cesium; we take the idea (properties over an interval, driven
 * by a clock), not the format.
 *
 * **Where it lives, and why not on `Unit` as the plan first sketched it.** `Operations` is an immutable
 * snapshot and `stepOperations` is a pure reducer — the property that lets the whole board be unit-tested
 * and later swapped for a socket handler. A ring buffer cannot be immutable at a per-tick cost, so putting
 * one on `Unit` would either destroy that purity or copy 150 buffers 20 times a second. So the tracks are a
 * STORE the host owns beside the board, fed from the same tick, with exactly one writer. `Unit.at` stays
 * what it always was — the state at `ops.now` — and the store answers every other T.
 *
 * **What it records and what it drops** is the sampling policy 8/01 owes, and all three rules exist because
 * of the feed rather than by taste:
 *
 * - **Rate limit.** The mock ticks at 20 Hz; PCAD publishes every 4 s today (measured in its source, plan
 *   202 §4) and faster later. Recording at tick rate would make the mock's tracks denser than the live
 *   feed's — a memory figure that flatters, and a scrub that behaves differently in the two — and recording
 *   at a RISING feed rate would grow the ring with it. So one sample per {@link RECORD_INTERVAL_MS},
 *   whatever is driving and however fast it arrives.
 * - **A status change always samples**, rate limit or not: a unit that went en-route and arrived between two
 *   position samples has a history that says it never did.
 * - **A stationary run collapses to its two ends.** Most of a shift, most units are parked. Keeping the
 *   first and last sample of a still period says exactly as much as keeping four hundred of them.
 *
 * **What it does BETWEEN two samples is nothing, and that is the user's call (2026-08-22).** A track answers
 * with the last fix at or before the moment asked for — a step, not a slide. The plan's 8/02 was written
 * around interpolating between packets; interpolation was dropped before anything needed it, and the reasons
 * hold either way:
 *
 * - At PCAD's 4 s rate a car at 100 km/h covers ~110 m between fixes, so a straight-line slide draws it
 *   gliding through buildings — smooth, confident and wrong, which 202 §4 already named as the map's hardest
 *   constraint. A dot that jumps to where the unit was actually reported is the honest picture, and the
 *   cheapest fix for the jumping is PCAD's own publish rate (202 phase 4).
 * - Nothing on screen needed it. The mock feed integrates at 20 Hz, so the live map is already smooth; and a
 *   drag across an 8 h timeline moves about one sample per pixel, so a slide inside a 4 s gap is invisible.
 *
 * It is a decision rather than an absence, so it is written down with what would bring it back: a field
 * verdict that stepping reads badly at a publish rate nobody managed to raise.
 *
 * The interval past the last sample is likewise NOT extrapolated — {@link UnitTracks.at} holds the last
 * known state and marks it stale, so that no consumer can invent a position.
 */
import type { GtaGround } from '../map/coords';
import type { Operations, UnitStatus } from './types';

/** One resolved moment of one unit. `stale` is true past the last sample the feed delivered. */
export interface TrackState {
  /** ms the answer is older than the T asked for — 0 inside the track, >0 past its end. */
  readonly ageMs: number;
  readonly at: GtaGround;
  readonly heading: number;
  readonly stale: boolean;
  readonly status: UnitStatus;
}

/** What the store costs and how much history it is holding — the report reads this. */
export interface TrackStats {
  /** Host bytes held by the sample arrays. NOT GPU residency: `Engine.ledger()` counts that, and the two
   *  are different memories (the same distinction 5/01 drew for `pickingBytes`). */
  readonly bytes: number;
  /** Ring capacity per unit, in samples. */
  readonly capacity: number;
  /** Samples actually stored across every track. */
  readonly samples: number;
  readonly tracks: number;
  /** Oldest → newest sample time held, ms. Null while nothing has been recorded. */
  readonly window: null | readonly [number, number];
}

/** Bytes one sample occupies: t u32, x/y/heading f32, status u8 — parallel arrays, so no padding. */
export const BYTES_PER_SAMPLE = 4 + 4 + 4 + 4 + 1;

/**
 * How often the feed PUBLISHES a fix, ms — a FACT about PCAD, read out of its source rather than chosen here
 * (plan 202 §4: `cadui.lua`'s `sendPositionUpdate` thread, every 4 s, vehicles only), and one that is
 * expected to SHRINK once the transport is a socket rather than a poll.
 *
 * It is what a consumer measuring the feed's own behaviour reads: how long a fix may be old before it is
 * aging on screen, and how fast the follow damper must close a gap to stay inside one fix.
 */
export const PUBLISH_INTERVAL_MS = 4000;

/**
 * How often a track WRITES a sample, ms — **ours to choose, and deliberately not the same number.**
 *
 * These two were one constant until 2026-08-26, and that is a memory trap with a very ordinary trigger: the
 * publish rate drops to 1 s, someone edits the one constant to match the feed, and the ring silently
 * QUADRUPLES — {@link SAMPLES_PER_TRACK} is derived from it, so a shift goes from 18.4 MB to 73.4 MB at the
 * declared 150 units, on a phone whose whole budget is 300–500 MB and whose world already holds ~76 MB of
 * it. Nothing fails; the console just gets heavier for a reason nobody would connect to a feed setting.
 *
 * The rule the split expresses: **a faster feed improves the LIVE picture, never the size of the history.**
 * Fixes arriving between two record intervals are drawn as they land (the board is live state) and simply do
 * not all become samples — the sampling policy above already collapses what a scrub cannot use.
 */
export const RECORD_INTERVAL_MS = 4000;

/** How long a track keeps history. See `docs/hacks/dispatch-shift-length.md` — the one number here nobody
 *  has named, and what it costs is linear in it. Not exported: `SAMPLES_PER_TRACK` is what a caller wants,
 *  and a second reader of the hours would be a second place to change it. */
const SHIFT_HOURS = 8;

/** Samples one unit's ring holds: a whole shift at the RECORD interval — never at the publish rate, see
 *  {@link RECORD_INTERVAL_MS} for what that distinction is worth in megabytes. */
export const SAMPLES_PER_TRACK = Math.ceil((SHIFT_HOURS * 3600 * 1000) / RECORD_INTERVAL_MS);

/** Movement below this (world units) is "the unit did not move" — a parked car's GPS jitter, not a drive. */
const STILL_RADIUS = 1.5;

/**
 * Status → the byte the ring stores.
 *
 * `satisfies` is the load-bearing part: adding a `UnitStatus` without giving it an id is a COMPILE error.
 * Before this it was an array read with `indexOf`, which answers **-1** for an unknown status — written into
 * a `Uint8Array` that is 255, replayed as `available`, and (measured) sampled on EVERY tick because 255
 * never equals -1, so a 60 s window took 1201 samples instead of 16 and a whole shift's ring burned in six
 * minutes. Silent in all three ways: no throw, no warning, and a plausible status on screen.
 */
const STATUS_ID = { available: 0, busy: 1, enRoute: 2, onScene: 3 } as const satisfies Record<UnitStatus, number>;

/** The inverse, derived so the two cannot drift. Index IS the stored byte, so this order is a format. */
const STATUS_BY_ID: readonly UnitStatus[] = (Object.keys(STATUS_ID) as UnitStatus[]).sort(
  (a, b) => STATUS_ID[a] - STATUS_ID[b],
);

/** One unit's ring of samples, stored column-wise so a sample costs exactly {@link BYTES_PER_SAMPLE}. */
class Track {
  readonly heading: Float32Array;
  /** How many samples are live, up to the ring's capacity. */
  length = 0;
  readonly status: Uint8Array;
  readonly t: Uint32Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Where sample 0 sits once the ring has wrapped. */
  private start = 0;
  /** True while the last two samples are both inside {@link STILL_RADIUS} of each other — the run this
   *  collapses. Reset by any real movement or a status change. */
  private still = false;

  constructor(capacity: number) {
    this.heading = new Float32Array(capacity);
    this.status = new Uint8Array(capacity);
    this.t = new Uint32Array(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
  }

  /** Ring position of logical sample `i`. */
  index(i: number): number {
    return (this.start + i) % this.t.length;
  }

  push(t: number, at: GtaGround, heading: number, status: number): void {
    if (this.length === 0) {
      this.write(this.index(0), t, at, heading, status);
      this.length = 1;

      return;
    }
    const last = this.index(this.length - 1);
    const moved = Math.hypot(at[0] - this.x[last], at[1] - this.y[last]) > STILL_RADIUS;
    const changed = status !== this.status[last];
    if (!changed && t - this.t[last] < RECORD_INTERVAL_MS) {
      return;
    }
    // A run of stationary samples keeps only its two ends: the moment the unit stopped, and where it still
    // is. Overwriting the tail is what makes a parked shift cost 34 bytes instead of 122 kB.
    if (!moved && !changed && this.still) {
      this.write(last, t, at, heading, status);

      return;
    }
    this.still = !moved && !changed;
    this.append(t, at, heading, status);
  }

  private append(t: number, at: GtaGround, heading: number, status: number): void {
    if (this.length < this.t.length) {
      this.write(this.index(this.length), t, at, heading, status);
      this.length += 1;

      return;
    }
    // Full: the oldest sample of the shift is what falls off.
    this.write(this.start, t, at, heading, status);
    this.start = (this.start + 1) % this.t.length;
  }

  private write(slot: number, t: number, at: GtaGround, heading: number, status: number): void {
    this.heading[slot] = heading;
    this.status[slot] = status;
    this.t[slot] = t;
    this.x[slot] = at[0];
    this.y[slot] = at[1];
  }
}

/**
 * Every unit's track, fed one board snapshot at a time.
 *
 * Deliberately NOT reactive and NOT immutable: the host records into it from the same tick the board is
 * stepped in, and everything that reads it asks a question rather than subscribing.
 */
export class UnitTracks {
  private readonly capacity: number;
  private readonly tracks = new Map<string, Track>();

  /** `capacity` is the ring length per unit; the default is a whole shift at the publish rate. */
  constructor(capacity: number = SAMPLES_PER_TRACK) {
    this.capacity = Math.max(2, Math.floor(capacity));
  }

  /**
   * One unit's state at time `t`.
   *
   * **The last fix at or before it**, and nothing invented in between. Past the last sample it holds, marked
   * stale with its age — a car continued along its last vector drives through a wall, and a map that invents
   * a position is worse than one that admits it is a second behind (decided 2026-08-06). Before the first
   * sample, the first. Between two, the earlier one — see the header for why there is no slide.
   */
  at(id: string, t: number): null | TrackState {
    const track = this.tracks.get(id);
    if (!track || track.length === 0) {
      return null;
    }
    const i = indexAt(track, t);
    const last = track.index(track.length - 1);

    return state(track, track.index(i), i === track.length - 1 ? Math.max(0, t - track.t[last]) : 0);
  }

  /** Drop a unit's history — it went off duty. */
  forget(id: string): void {
    this.tracks.delete(id);
  }

  /**
   * Take one board snapshot into the tracks. Called once per tick, whatever the tick rate: the policy in
   * this file decides what actually lands.
   */
  record(ops: Operations): void {
    for (const unit of ops.units) {
      let track = this.tracks.get(unit.id);
      if (!track) {
        track = new Track(this.capacity);
        this.tracks.set(unit.id, track);
      }
      track.push(ops.now, unit.at, unit.heading, STATUS_ID[unit.status]);
    }
  }

  stats(): TrackStats {
    let samples = 0;
    let oldest = Infinity;
    let newest = -Infinity;
    for (const track of this.tracks.values()) {
      samples += track.length;
      if (track.length > 0) {
        oldest = Math.min(oldest, track.t[track.index(0)]);
        newest = Math.max(newest, track.t[track.index(track.length - 1)]);
      }
    }

    return {
      bytes: this.tracks.size * this.capacity * BYTES_PER_SAMPLE,
      capacity: this.capacity,
      samples,
      tracks: this.tracks.size,
      window: samples > 0 ? [oldest, newest] : null,
    };
  }

  /**
   * The unit's path up to `t`, as flat GTA `x, y` pairs, or null when there is nothing to draw.
   *
   * **How far back it goes is DERIVED, not a constant.** The trail covers the unit's current LEG — back to
   * its last status change — which is the span an operator is actually asking about: where a responding car
   * came from since it was dispatched, where a patrol has been since it went available. 8/04 asked for "the
   * last N minutes" and warned that a constant chosen by eye is a debt (`docs/hacks/`); the leg needs no
   * such constant, and it says something the clock cannot.
   *
   * `limit` is a WORK bound rather than a look choice: it caps the points one unit can contribute to the
   * frame so a long leg cannot grow the per-frame copy without limit.
   */
  trail(id: string, t: number, limit: number): Float32Array | null {
    const track = this.tracks.get(id);
    if (!track || track.length < 2) {
      return null;
    }
    const end = indexAt(track, t);
    const status = track.status[track.index(end)];
    let start = end;
    while (start > 0 && track.status[track.index(start - 1)] === status && end - start + 1 < limit) {
      start -= 1;
    }
    if (start === end) {
      return null;
    }
    const points = new Float32Array((end - start + 1) * 2);
    for (let i = start; i <= end; i += 1) {
      const slot = track.index(i);
      points[(i - start) * 2] = track.x[slot];
      points[(i - start) * 2 + 1] = track.y[slot];
    }

    return points;
  }
}

/** Logical index of the last sample at or before `t` — the ONE place that question is answered. */
function indexAt(track: Track, t: number): number {
  if (t >= track.t[track.index(track.length - 1)]) {
    return track.length - 1;
  }
  if (t <= track.t[track.index(0)]) {
    return 0;
  }
  let low = 0;
  let high = track.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (track.t[track.index(mid)] <= t) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return low;
}

/** One ring slot, as a state. `ageMs` is how much older than the moment asked for this fix is. */
function state(track: Track, slot: number, ageMs: number): TrackState {
  return {
    ageMs,
    at: [track.x[slot], track.y[slot]],
    heading: track.heading[slot],
    stale: ageMs > PUBLISH_INTERVAL_MS,
    status: STATUS_BY_ID[track.status[slot]] ?? 'available',
  };
}
