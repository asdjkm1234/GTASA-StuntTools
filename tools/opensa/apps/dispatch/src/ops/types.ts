/**
 * The dispatch domain. Deliberately tiny and renderer-free: nothing here knows about WebGPU, the pak or the
 * camera, so the whole operations model can be unit-tested and later swapped for a real backend feed without
 * touching the map.
 */
import type { GtaGround } from '../map/coords';

export interface Incident {
  /** Unit ids currently working it. */
  readonly assigned: readonly string[];
  readonly at: GtaGround;
  /** The radio code a dispatcher actually says out loud ("10-50", "10-31"). */
  readonly code: string;
  readonly id: string;
  /** `performance.now()` at creation — the panels age it into "3m ago". */
  readonly opened: number;
  /** Nearest named place, for the address line. */
  readonly place: string;
  readonly priority: IncidentPriority;
  /** Seconds of work still needed once a unit is on scene; the sim counts it down. */
  readonly remaining: number;
  readonly status: IncidentStatus;
  readonly title: string;
}

/** 1 = life at risk (roll everything), 2 = urgent, 3 = routine. */
export type IncidentPriority = 1 | 2 | 3;

export type IncidentStatus = 'assigned' | 'closed' | 'onScene' | 'pending';

/** The whole board, as one immutable snapshot. */
export interface Operations {
  readonly incidents: readonly Incident[];
  /** Newest first — the call log the status bar counts. */
  readonly log: readonly string[];
  /** The clock at the last tick. Panels age calls against THIS, so rendering stays pure. */
  readonly now: number;
  readonly units: readonly Unit[];
}

/** What the operator currently has selected — panels and map symbology both read it. */
export type Selection =
  | null
  | {
      readonly at: GtaGround;
      /** The named district the point falls in (201/5-03) — null when the world ships no `info.zon`, or on
       *  the synthetic demo, which is nowhere. */
      readonly district: null | string;
      readonly kind: 'world';
      readonly model: string;
      readonly txd: string;
    }
  | { readonly id: string; readonly kind: 'incident' }
  | { readonly id: string; readonly kind: 'unit' };

export interface Unit {
  readonly at: GtaGround;
  readonly callsign: string;
  /**
   * The fix's height, GTA `pos_z` — metres, applied VERBATIM (201/5-04).
   *
   * It arrives with the position ([202 §4](../../../../docs/plans/202-pcad-dispatch/readme.md): PCAD
   * publishes `pos_x, pos_y, pos_z`), and it is already correct because **the game resolved it**: the run
   * that produced this fix had collision, so the car was standing on the road when the number was taken.
   * This surface does not re-do that work and must never try — here a unit is a model drawn ON the map, not
   * an object in a world (the user's own framing, 2026-08-26). Correcting a height here would move the car
   * off the place the game says it is, which is the one thing the operator is acting on.
   *
   * A replayed fix carries the unit's last known height rather than the one it had then: the track ring
   * stores what a dispatcher reads (201/8-01), and widening a 17-byte sample for a drawing detail is a cost
   * the whole shift pays.
   */
  readonly elevation: number;
  /** Radians, 0 = north, CLOCKWISE — a compass bearing, and the chevron's rotation. SA measures the same
   *  direction the other way round, so a feed's z-angle comes through `headingFromZAngle` and never raw. */
  readonly heading: number;
  readonly id: string;
  /** The incident this unit is committed to, or null when it is patrolling. */
  readonly incident: null | string;
  readonly kind: UnitKind;
  /**
   * What the unit is driving — a bare model NAME the built game resolves (`copcarls`, `ambulan`), or `null`
   * for a unit whose vehicle is unknown, which draws the symbol alone (201/5-04).
   *
   * **It does not come from the position feed.** PCAD publishes a position (plus a `vehicleId` whose meaning
   * is [202 §4](../../../../docs/plans/202-pcad-dispatch/readme.md)'s seam to settle); what a unit drives is
   * board state, the way its callsign and status are. A name rather than an id, always: an id is a SLOT and a
   * slot means different things in two builds (`docs/restrictions/assets-and-data.md`), so whoever resolves
   * one does it where the build's own tables are.
   */
  readonly model: null | string;
  readonly status: UnitStatus;
  /** Where it is currently driving; null means "pick a new patrol point". */
  readonly target: GtaGround | null;
}

/** Which service the unit belongs to — it picks the symbol and the colour on the map. */
export type UnitKind = 'ambulance' | 'fire' | 'patrol';

export type UnitStatus = 'available' | 'busy' | 'enRoute' | 'onScene';
