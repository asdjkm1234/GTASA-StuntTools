/**
 * The board as it was (201/8-03): unit tracks plus the calls' own history, resolved into an `Operations`
 * snapshot for any moment the clock is at.
 *
 * **The whole of replay is one substitution.** Nothing downstream of `read.ops()` knows the clock exists —
 * the map loop, the symbology, the panels and the detail card all take the board they always took, and when
 * the operator scrubs they are handed the board OF THAT MOMENT instead of the live one. That is the payoff
 * of 8/01's decision to keep time out of `Unit` and in a store beside it: a resolved snapshot is the same
 * shape as a live one, so there is no second rendering path to maintain.
 *
 * A unit and a call need different histories, because they change differently. A unit MOVES, continuously,
 * and is sampled ({@link UnitTracks}). A call does not move at all — it changes STATUS, a handful of times
 * in its life — so its history is an event list, which is both smaller and exact.
 */
import type { Incident, IncidentStatus, Operations, Unit } from './types';

import { UnitTracks } from './tracks';

/** What the history is holding, for `?inventory=1`. */
export interface HistoryStats {
  /** Host bytes: the unit tracks' rings plus a rough count of the call events. */
  readonly bytes: number;
  readonly capacity: number;
  /** Recorded call transitions across every call of the shift. */
  readonly incidentEvents: number;
  readonly samples: number;
  readonly tracks: number;
  readonly window: null | readonly [number, number];
}

/** One recorded change to a call. Its position never changes, so nothing here carries one. */
interface IncidentEvent {
  readonly assigned: readonly string[];
  readonly status: IncidentStatus;
  readonly t: number;
}

/** Bytes an event costs, accounted the way the tracks are: t + status + a short id list. A call changes
 *  state a handful of times in its life, so this is an estimate of a rounding error, and it is labelled
 *  one rather than being left out of the total. */
const BYTES_PER_EVENT = 64;

/**
 * Points one unit's trail may contribute to a frame. A WORK bound, not a look choice: the span a trail
 * covers is the unit's current leg (see {@link UnitTracks.trail}), and this only stops one very long leg
 * from growing the per-frame copy without limit. 240 points is 16 minutes at the 4 s publish rate.
 */
const TRAIL_MAX_POINTS = 240;

export class BoardHistory {
  private readonly incidents = new Map<string, { events: IncidentEvent[]; incident: Incident }>();
  /**
   * Every unit the history has ever seen, by id — the ROSTER a replay is built from.
   *
   * It cannot come from the live board, which is where it came from until 2026-08-22: a unit that goes off
   * duty leaves `live.units`, and the replay of an hour when it WAS on duty then loses it too. The mock
   * never removes a unit so nothing showed it, but a real feed's units go off shift constantly, and the
   * symptom would be a past that quietly disagrees with what the operator remembers seeing.
   */
  private readonly roster = new Map<string, Unit>();
  private readonly tracks = new UnitTracks();

  /**
   * The board at wall time `t`.
   *
   * Units come from their tracks, over the roster this history has seen rather than the one the live board
   * holds now — a unit that went off duty was still on the map an hour ago. A unit with no sample at `t` is
   * dropped rather than drawn at a position nobody recorded, which is also what keeps a unit that joined
   * later out of the earlier picture. Calls that had not been opened yet are not on the board, and the ones
   * that had carry the status they had. The log is left as the live one's — a scrub is for the map and the
   * roster, and a reconstructed ticker would be a second source of truth for what was said.
   */
  at(t: number, live: Operations): Operations {
    const units: Unit[] = [];
    for (const unit of this.roster.values()) {
      const state = this.tracks.at(unit.id, t);
      if (state) {
        units.push({ ...unit, at: state.at, heading: state.heading, status: state.status });
      }
    }
    const incidents: Incident[] = [];
    for (const { events, incident } of this.incidents.values()) {
      if (incident.opened > t) {
        continue;
      }
      const event = lastAtOrBefore(events, t);
      incidents.push(event ? { ...incident, assigned: event.assigned, status: event.status } : incident);
    }

    return { ...live, incidents, now: t, units };
  }

  /**
   * How old each unit's last fix is at `t`, in ms, keyed by unit id (201/8-02).
   *
   * It cannot come off the board: a `Unit` carries a position, not the moment that position was reported,
   * and the live board's `now` is the console's clock rather than the feed's. The age is a property of the
   * TRACK — the gap between the moment asked for and the last sample the feed actually delivered — which is
   * the only place it exists.
   */
  fixAges(t: number): Map<string, number> {
    const out = new Map<string, number>();
    for (const id of this.roster.keys()) {
      const state = this.tracks.at(id, t);
      if (state) {
        out.set(id, state.ageMs);
      }
    }

    return out;
  }

  /** Drop a unit's history entirely — it is off the board for good, not merely off duty. */
  forget(id: string): void {
    this.roster.delete(id);
    this.tracks.forget(id);
  }

  /** Take one board snapshot. Called once per tick; the policies decide what actually lands. */
  record(ops: Operations): void {
    this.tracks.record(ops);
    for (const unit of ops.units) {
      this.roster.set(unit.id, unit);
    }
    for (const incident of ops.incidents) {
      const held = this.incidents.get(incident.id);
      if (!held) {
        this.incidents.set(incident.id, {
          events: [{ assigned: incident.assigned, status: incident.status, t: ops.now }],
          incident,
        });
        continue;
      }
      const last = held.events[held.events.length - 1];
      if (last.status !== incident.status || !sameIds(last.assigned, incident.assigned)) {
        held.events.push({ assigned: incident.assigned, status: incident.status, t: ops.now });
      }
    }
  }

  stats(): HistoryStats {
    const track = this.tracks.stats();
    let incidentEvents = 0;
    for (const held of this.incidents.values()) {
      incidentEvents += held.events.length;
    }

    return { ...track, bytes: track.bytes + incidentEvents * BYTES_PER_EVENT, incidentEvents };
  }

  /**
   * Every unit's trail at `t` — the leg each one is on, as flat GTA `x, y` pairs, keyed by unit id.
   *
   * Rebuilt from the rings rather than cached: the alternative is a second copy of the same samples that
   * has to be invalidated on every record, and the measured cost says there is nothing to buy.
   */
  trails(t: number, limit = TRAIL_MAX_POINTS): Map<string, Float32Array> {
    const out = new Map<string, Float32Array>();
    for (const id of this.roster.keys()) {
      const points = this.tracks.trail(id, t, limit);
      if (points) {
        out.set(id, points);
      }
    }

    return out;
  }

  /** The span a scrub may ask for, or null while nothing has been recorded. */
  window(): null | { newest: number; oldest: number } {
    const held = this.tracks.stats().window;

    return held ? { newest: held[1], oldest: held[0] } : null;
  }
}

/** The last event at or before `t`, or null when the call had not changed yet. */
function lastAtOrBefore(events: readonly IncidentEvent[], t: number): IncidentEvent | null {
  let found: IncidentEvent | null = null;
  for (const event of events) {
    if (event.t > t) {
      break;
    }
    found = event;
  }

  return found;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}
