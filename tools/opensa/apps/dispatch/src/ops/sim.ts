/**
 * The board's clock. One pure `stepOperations` call advances everything: units drive, calls age, work gets
 * done, new calls come in. Pure and injectable-random so the behaviour is testable — the app hands it
 * `Math.random`, a test hands it a fixed sequence.
 *
 * This is a MOCKUP feed standing in for a real one. When this app is wired to a game server, `stepOperations`
 * is what gets replaced by the socket handler; nothing else in the app changes.
 */
import type { GtaGround } from '../map/coords';
import type { Incident, Operations, Unit } from './types';

import { gtaDistance, headingOf, stepTowards } from '../map/coords';
import { CALL_TYPES, LANDMARKS, makeIncident } from './seed';

/** World units per second on a routine patrol (≈ 43 km/h). */
const PATROL_SPEED = 12;
/** World units per second responding to a call (≈ 94 km/h). */
const RESPONSE_SPEED = 26;
/** How close counts as arrived. */
const ARRIVE_RADIUS = 18;
/** A closed call stays on the board this long, so the operator sees it resolve. */
const CLOSED_LINGER_SECONDS = 12;
/** Mean seconds between new calls coming in. */
const CALL_INTERVAL_SECONDS = 22;
/** The call log never grows past this. */
const LOG_CAP = 60;

export interface StepInput {
  /** `true` assigns the nearest free unit to every pending call, the way a busy desk runs. */
  readonly autoDispatch: boolean;
  /** Advance the board by this many seconds. */
  readonly dtSeconds: number;
  readonly now: number;
  readonly random: () => number;
}

/** Assign a unit to a call by hand — what clicking "Dispatch" does. */
export function assignUnit(state: Operations, unitId: string, incidentId: string): Operations {
  const unit = state.units.find((candidate) => candidate.id === unitId);
  const incident = state.incidents.find((candidate) => candidate.id === incidentId);
  if (!unit || !incident || incident.status === 'closed') {
    return state;
  }

  return {
    ...state,
    incidents: state.incidents.map((entry) =>
      entry.id === incidentId
        ? { ...entry, assigned: [...new Set([...entry.assigned, unitId])], status: 'assigned' }
        : { ...entry, assigned: entry.assigned.filter((id) => id !== unitId) },
    ),
    log: log(state, `${unit.callsign} dispatched to ${incident.code} ${incident.place}`),
    units: state.units.map((entry) =>
      entry.id === unitId ? { ...entry, incident: incidentId, status: 'enRoute', target: incident.at } : entry,
    ),
  };
}

/** Take a unit off its call and put it back on patrol. */
export function clearUnit(state: Operations, unitId: string): Operations {
  const unit = state.units.find((candidate) => candidate.id === unitId);
  if (!unit || unit.incident === null) {
    return state;
  }

  return {
    ...state,
    incidents: state.incidents.map((entry) => ({
      ...entry,
      assigned: entry.assigned.filter((id) => id !== unitId),
      status: entry.assigned.includes(unitId) && entry.assigned.length === 1 ? 'pending' : entry.status,
    })),
    log: log(state, `${unit.callsign} cleared`),
    units: state.units.map((entry) =>
      entry.id === unitId ? { ...entry, incident: null, status: 'available', target: null } : entry,
    ),
  };
}

/** Put a new call on the board at an arbitrary point — what right-clicking the map does. */
export function createIncidentAt(
  state: Operations,
  at: GtaGround,
  now: number,
  random: () => number,
  district: null | string = null,
): Operations {
  const type = pickIndex(CALL_TYPES.length, random);
  const call = CALL_TYPES[type];
  const incident: Incident = {
    assigned: [],
    at,
    code: call.code,
    id: `i${Math.floor(now)}${Math.floor(random() * 1000)}`,
    opened: now,
    // The WORLD's own name for the point when the pak carries one (201/5-03); the hardcoded landmark table
    // is the fallback, and on a total conversion it is a list of Los Santos places that do not exist there.
    place: district ?? nearestPlace(at),
    priority: call.priority,
    remaining: 20 + type * 6,
    status: 'pending',
    title: call.title,
  };

  return {
    ...state,
    incidents: [...state.incidents, incident],
    log: log(state, `${incident.code} ${incident.title} — ${incident.place}`),
  };
}

/** Advance the whole board one tick. */
export function stepOperations(state: Operations, input: StepInput): Operations {
  const dispatched = input.autoDispatch ? autoDispatch(state) : state;
  const units = dispatched.units.map((unit) => driveUnit(unit, dispatched, input));
  const worked = workIncidents({ ...dispatched, units }, input);

  return { ...maybeNewCall(worked, input), now: input.now };
}

/** Nearest available unit to each pending call, closest call first. */
function autoDispatch(state: Operations): Operations {
  const pending = state.incidents
    .filter((incident) => incident.status === 'pending')
    .sort((a, b) => a.priority - b.priority);
  let next = state;
  for (const incident of pending) {
    const free = next.units.filter((unit) => unit.status === 'available');
    if (free.length === 0) {
      break;
    }
    const nearest = free.reduce((best, unit) =>
      gtaDistance(unit.at, incident.at) < gtaDistance(best.at, incident.at) ? unit : best,
    );
    next = assignUnit(next, nearest.id, incident.id);
  }

  return next;
}

/** One unit's movement for this tick: responding units drive to their call, free ones patrol. */
function driveUnit(unit: Unit, state: Operations, input: StepInput): Unit {
  if (unit.status === 'busy' || unit.status === 'onScene') {
    return unit;
  }
  const target =
    unit.status === 'enRoute' ? (incidentOf(state, unit)?.at ?? null) : (unit.target ?? patrolPoint(input.random));
  if (!target) {
    return { ...unit, incident: null, status: 'available', target: null };
  }
  const speed = unit.status === 'enRoute' ? RESPONSE_SPEED : PATROL_SPEED;
  const moved = stepTowards(unit.at, target, speed * input.dtSeconds);
  const heading = gtaDistance(unit.at, moved) > 0.01 ? headingOf(unit.at, moved) : unit.heading;
  if (gtaDistance(moved, target) > ARRIVE_RADIUS) {
    return { ...unit, at: moved, heading, target };
  }

  // Arrived: a responder goes on scene and stops, a patrol just picks a new corner to head for.
  return unit.status === 'enRoute'
    ? { ...unit, at: moved, heading, status: 'onScene', target }
    : { ...unit, at: moved, heading, target: null };
}

function incidentOf(state: Operations, unit: Unit): Incident | undefined {
  return unit.incident === null ? undefined : state.incidents.find((entry) => entry.id === unit.incident);
}

function log(state: Operations, line: string): readonly string[] {
  return [line, ...state.log].slice(0, LOG_CAP);
}

/** New calls arrive as a Poisson-ish trickle rather than on a metronome. */
function maybeNewCall(state: Operations, input: StepInput): Operations {
  if (input.random() > input.dtSeconds / CALL_INTERVAL_SECONDS) {
    return state;
  }
  const landmark = pickIndex(LANDMARKS.length, input.random);
  const incident = makeIncident(
    `i${Math.floor(input.now)}`,
    input.now,
    landmark,
    pickIndex(CALL_TYPES.length, input.random),
  );

  return {
    ...state,
    incidents: [...state.incidents, incident],
    log: log(state, `${incident.code} ${incident.title} — ${incident.place}`),
  };
}

function nearestPlace(at: GtaGround): string {
  return LANDMARKS.reduce((best, place) => (gtaDistance(place.at, at) < gtaDistance(best.at, at) ? place : best)).name;
}

function patrolPoint(random: () => number): [number, number] {
  const place = LANDMARKS[pickIndex(LANDMARKS.length, random)];

  return [place.at[0] + (random() - 0.5) * 220, place.at[1] + (random() - 0.5) * 220];
}

/** An index into a list of `length`, safe at the closed end — a random source that can return 1 must not
 *  index past the array (and a test's fixed sequence is exactly such a source). */
function pickIndex(length: number, random: () => number): number {
  return Math.min(length - 1, Math.max(0, Math.floor(random() * length)));
}

/**
 * Count down the work at every scene, close what is finished, and drop long-closed calls.
 *
 * Units are released by the link the UNIT owns (`unit.incident`), not by the call's `assigned` list. The two
 * are meant to agree, but only one of them can strand a unit if they ever drift: a responder whose id fell out
 * of the list would sit on scene for the rest of the shift, invisible to the dispatcher and to auto-dispatch.
 */
function workIncidents(state: Operations, input: StepInput): Operations {
  const closed: string[] = [];
  const lines: string[] = [];
  const incidents = state.incidents.flatMap((incident): Incident[] => {
    if (incident.status === 'closed') {
      return input.now - incident.opened > (incident.remaining + CLOSED_LINGER_SECONDS) * 1000 ? [] : [incident];
    }
    const onScene = state.units.some((unit) => unit.incident === incident.id && unit.status === 'onScene');
    if (!onScene) {
      return [incident];
    }
    const remaining = incident.remaining - input.dtSeconds;
    if (remaining > 0) {
      return [{ ...incident, remaining, status: 'onScene' }];
    }
    closed.push(incident.id);
    lines.push(`${incident.code} ${incident.place} — cleared`);

    return [{ ...incident, assigned: [], opened: input.now, remaining: 0, status: 'closed' }];
  });

  return {
    ...state,
    incidents,
    log: lines.reduce((entries, line) => [line, ...entries].slice(0, LOG_CAP), state.log),
    units: state.units.map((unit) =>
      unit.incident !== null && closed.includes(unit.incident)
        ? { ...unit, incident: null, status: 'available', target: null }
        : unit,
    ),
  };
}
