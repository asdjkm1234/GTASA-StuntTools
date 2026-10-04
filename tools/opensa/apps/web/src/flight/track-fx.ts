import type { FlightRow, FlightTrack } from './csv';
/**
 * The recorder's V7/V8 EFFECT columns, read STRUCTURALLY.
 *
 * `csv.ts` is the integration parser's file and is deliberately not extended here; instead these optional
 * extension shapes are the CONTRACT the integration parser must expose on `FlightRow` / `FlightTrack`:
 *
 *   FlightRow.nozzleRotation : number | null      raw `CAutomobile::m_wMiscComponentAngle` (CAutomobile+0x86C)
 *   FlightRow.propNodes      : (Quat | null)[4]   real local rotations of ePlaneNodes 12..15
 *   FlightRow.smokeActive    : boolean | null     plane smoke pointer/ejector is active
 *   FlightTrack.events       : { s, kind:'explosion'|'collision', pos }[]   sampled track events
 *
 * Reading through these accessors keeps the replay compiling and WORKING against either parser revision:
 * when the fields are absent every accessor answers `undefined` and the replay simply draws no sprite
 * effects and leaves the nozzle at its bind pose — never a wrong number, never a crash.
 */
import type { Quat, Vec3 } from './math';

/** One recorded event on the track. `s` is replay seconds; `pos` is GTA world space (x, y, z). */
export interface FlightEventFx {
  kind: 'collision' | 'explosion';
  pos: readonly [number, number, number];
  s: number;
}

/** Optional per-row effect columns the integration parser may add (see the module header). */
export interface FlightRowFx {
  nozzleRotation: null | number;
  /** Real local rotations of {@link PROP_NODE_NAMES} (ePlaneNodes 12..15). */
  propNodes: (null | Quat)[];
  /** Recorded CPlane smoke pointer/ejector; not a complete engine-damage smoke signal. */
  smokeActive: boolean | null;
}

/** Optional per-track effect columns. */
export interface FlightTrackFx {
  events: readonly FlightEventFx[];
}

/** A GTA position array prototype-guarded into a `Vec3`, or null. */
export function eventPosition(event: FlightEventFx): null | Vec3 {
  const p = event.pos;
  if (!Array.isArray(p) || p.length < 3 || !p.slice(0, 3).every((v) => Number.isFinite(v))) {
    return null;
  }

  return [p[0], p[1], p[2]];
}

/** `FlightTrack.events`, or an empty list on an older parser. Only MEASURED explosions are returned: an
 * INFERRED collision must never be rendered as an explosion burst. */
export function eventsOf(track: FlightTrack): readonly FlightEventFx[] {
  const events = trackFx(track).events ?? [];

  return events.filter((event) => event.kind === 'explosion');
}

/** Real prop-node quaternions (12..15) when the parser carries them, else an empty list. */
export function propNodesOf(row: FlightRow): (null | Quat)[] {
  return rowFx(row).propNodes ?? [];
}

/** The row's optional effect columns, or `undefined`-valued fields on an older parser. */
export function rowFx(row: FlightRow): Partial<FlightRowFx> {
  return row;
}

/** The track's optional effect columns, or `undefined` on an older parser. */
export function trackFx(track: FlightTrack): Partial<FlightTrackFx> {
  return track;
}
