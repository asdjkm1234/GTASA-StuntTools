/**
 * The demo board: Los Santos landmarks, a shift's worth of units, and the call types a dispatcher sees.
 *
 * These are ordinary GTA coordinates — swap the table for your own map's places and the whole app follows.
 * Nothing else in the app hardcodes a position.
 */
import type { Incident, IncidentPriority, Operations, Unit } from './types';

import { DEFAULT_CALLS, DEFAULT_SHIFT } from './budget';

/** Named places calls come in at, GTA coords. Los Santos, roughly clockwise from Ganton. */
export const LANDMARKS: readonly { readonly at: readonly [number, number]; readonly name: string }[] = [
  { at: [2495, -1687], name: 'Grove Street, Ganton' },
  { at: [2100, -1800], name: 'Idlewood' },
  { at: [2400, -2000], name: 'Willowfield' },
  { at: [1685, -2330], name: "Los Santos Int'l" },
  { at: [1750, -2050], name: 'El Corona' },
  { at: [1774, -1897], name: 'Unity Station' },
  { at: [1481, -1770], name: 'Pershing Square' },
  { at: [1420, -1550], name: 'Commerce' },
  { at: [1480, -1300], name: 'Downtown LS' },
  { at: [1000, -1300], name: 'Market' },
  { at: [700, -1500], name: 'Marina' },
  { at: [900, -1800], name: 'Verona Beach' },
  { at: [350, -1800], name: 'Santa Maria Beach' },
  { at: [1250, -900], name: 'Vinewood Boulevard' },
  { at: [1350, -700], name: 'Mulholland' },
  { at: [1980, -1150], name: 'Glen Park' },
  { at: [2220, -1150], name: 'Jefferson' },
  { at: [2700, -1150], name: 'Los Flores' },
  { at: [2650, -1400], name: 'East Los Santos' },
  { at: [2750, -1900], name: 'East Beach' },
];

/** The call types, with the priority a dispatcher would give them and who normally rolls. */
export const CALL_TYPES: readonly {
  readonly code: string;
  readonly priority: IncidentPriority;
  readonly title: string;
}[] = [
  { code: '10-50', priority: 2, title: 'Traffic collision' },
  { code: '10-31', priority: 1, title: 'Crime in progress' },
  { code: '10-70', priority: 1, title: 'Structure fire' },
  { code: '10-52', priority: 1, title: 'Medical — ambulance needed' },
  { code: '10-90', priority: 2, title: 'Bank alarm' },
  { code: '10-16', priority: 3, title: 'Domestic disturbance' },
  { code: '10-66', priority: 3, title: 'Suspicious person' },
  { code: '10-91', priority: 3, title: 'Abandoned vehicle' },
  { code: '10-80', priority: 1, title: 'Pursuit in progress' },
  { code: '10-15', priority: 2, title: 'Prisoner transport' },
];

/** The nine named cars a demo shift opens with. Past these the roster is generated — see {@link fillUnit}. */
const ROSTER: readonly { readonly callsign: string; readonly kind: Unit['kind']; readonly landmark: number }[] = [
  { callsign: '1-ADAM-12', kind: 'patrol', landmark: 0 },
  { callsign: '1-ADAM-20', kind: 'patrol', landmark: 3 },
  { callsign: '2-LINCOLN-7', kind: 'patrol', landmark: 7 },
  { callsign: '2-LINCOLN-9', kind: 'patrol', landmark: 11 },
  { callsign: '3-KING-4', kind: 'patrol', landmark: 15 },
  { callsign: 'MEDIC-3', kind: 'ambulance', landmark: 5 },
  { callsign: 'MEDIC-7', kind: 'ambulance', landmark: 17 },
  { callsign: 'ENGINE-51', kind: 'fire', landmark: 9 },
  { callsign: 'TRUCK-9', kind: 'fire', landmark: 13 },
];

/** Every fourth generated car is an ambulance and every seventh a truck — a roster, not one long patrol. */
const FILL_KINDS: readonly Unit['kind'][] = ['patrol', 'patrol', 'patrol', 'ambulance', 'patrol', 'patrol', 'fire'];

/**
 * What each service drives on the MOCK board — stock San Andreas model names, and a demo fixture exactly
 * like the landmark table above it. On a real board this is CAD state, not feed state: the position stream
 * carries a position, and what a unit is driving is known the way its callsign is. A total conversion ships
 * none of these names, which is not a defect to hide — it is the fallback path (symbol, and a line in the
 * log) doing its job.
 */
const DEMO_MODELS: Readonly<Record<Unit['kind'], string>> = {
  ambulance: 'ambulan',
  fire: 'firetruk',
  patrol: 'copcarls',
};

/**
 * The height the mock puts its units at, metres. Los Santos street level, ONE number rather than twenty
 * invented ones: the demo board has no world under it to measure, and a fiction that says so is better than
 * twenty that look surveyed. A real feed reports the z its player is standing at.
 */
const DEMO_GROUND = 13;

/** How far a generated car is scattered around its landmark, world units. Nine cars stacked on one corner
 *  would measure a symbol count without measuring the decluttering it causes. */
const SCATTER = 220;

/**
 * The shift on duty when the board opens.
 *
 * `size` is what `?units=`/`?calls=` resolved to ({@link seedSize}). Past the nine named cars the roster is
 * GENERATED and scattered around the landmark table, because the console's declared worst case is 150 units
 * (201's budget table) and a board that cannot be loaded to it cannot be measured at it. Deterministic: the
 * scatter is a hash of the index, never `Math.random`, so two runs of the same size are the same board.
 */
export function initialOperations(now: number, size = { calls: DEFAULT_CALLS, units: DEFAULT_SHIFT }): Operations {
  const units: Unit[] = [];
  for (let i = 0; i < size.units; i += 1) {
    units.push(i < ROSTER.length ? unit(`u${i + 1}`, ROSTER[i]) : fillUnit(i));
  }
  const incidents: Incident[] = [];
  for (let i = 0; i < size.calls; i += 1) {
    incidents.push(makeIncident(`i${i + 1}`, now - i * 45_000, 1 + i * 4));
  }

  return {
    incidents,
    log: [`Shift start — ${units.length} units on duty`],
    now,
    units,
  };
}

/** A call at a named landmark. `landmark` and `type` index the tables above, so a caller can be explicit. */
export function makeIncident(
  id: string,
  opened: number,
  landmark: number,
  type = landmark % CALL_TYPES.length,
): Incident {
  const place = LANDMARKS[landmark % LANDMARKS.length];
  const call = CALL_TYPES[type % CALL_TYPES.length];

  return {
    assigned: [],
    at: place.at,
    code: call.code,
    id,
    opened,
    place: place.name,
    priority: call.priority,
    remaining: 20 + (type % 4) * 12,
    status: 'pending',
    title: call.title,
  };
}

/** A generated car past the named roster: `4-XRAY-<n>`, scattered deterministically around a landmark. */
function fillUnit(index: number): Unit {
  const place = LANDMARKS[index % LANDMARKS.length].at;
  const kind = FILL_KINDS[index % FILL_KINDS.length];

  return {
    at: [place[0] + jitter(index * 2 + 1) * SCATTER, place[1] + jitter(index * 2 + 2) * SCATTER],
    callsign: `${prefix(kind)}-${index + 1}`,
    elevation: DEMO_GROUND,
    heading: (jitter(index) + 1) * Math.PI,
    id: `u${index + 1}`,
    incident: null,
    kind,
    model: DEMO_MODELS[kind],
    status: 'available',
    target: null,
  };
}

/** A stable −1..1 from an integer — enough scatter to look like a shift, and the same board every run. */
function jitter(seed: number): number {
  const mixed = Math.sin(seed * 12.9898) * 43_758.5453;

  return (mixed - Math.floor(mixed)) * 2 - 1;
}

function prefix(kind: Unit['kind']): string {
  return kind === 'ambulance' ? 'MEDIC' : kind === 'fire' ? 'ENGINE' : '4-XRAY';
}

function unit(id: string, entry: (typeof ROSTER)[number]): Unit {
  return {
    at: LANDMARKS[entry.landmark % LANDMARKS.length].at,
    callsign: entry.callsign,
    elevation: DEMO_GROUND,
    heading: 0,
    id,
    incident: null,
    kind: entry.kind,
    model: DEMO_MODELS[entry.kind],
    status: 'available',
    target: null,
  };
}
