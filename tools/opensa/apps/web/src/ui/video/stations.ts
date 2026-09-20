/**
 * Tripod stations (plan 096/04): where a world-anchored camera may stand, and whether it can actually SEE
 * the car from there.
 *
 * The whole module exists inside one constraint, and it is the 080 multi-ray postmortem's
 * (`docs/postmortem/080-cinematic-camera/multiray-collision.md`): a hard boolean over rays "has no
 * continuous middle, so it cannot ease". So occlusion here NEVER steers a live camera. It decides two
 * things only, both discrete by nature:
 *
 * 1. which station is picked, BEFORE its shot starts (this file), and
 * 2. whether to CUT AWAY, which is a declared cut (`director.ts`).
 *
 * The survey is amortised — a few casts per frame during the PRECEDING shot — so a station is chosen with
 * the same budget a live check could never afford, and the frame it is chosen on costs nothing.
 *
 * Everything here is GTA Z-up, like the physics it probes; the director converts once at the boundary.
 */

/** How far from the driven line a station may stand (m, both sides). */
export const STATION_LATERALS = [8, 11, 14, 18] as const;

/** …and the walk scene's own set (096/07): a person filmed from 8 m of pavement is already a wide shot, and
 *  the far offsets would put the tripod through the buildings the pavement runs along. */
export const WALK_STATION_LATERALS = [2.5, 4, 6, 8] as const;

/** The survey thresholds a WALK scene is judged on — the defaults with the distance ceiling brought in to
 *  what a person actually reads at (the `station` preset's own `maxDist` in {@link WALK_SHOTS}). */
export const WALK_SURVEY_DEFAULTS: SurveyOptions = { maxDist: 26, minCoverage: 0.8, minDwell: 0.8 };

/** One place a tripod could stand, before anything has been probed. */
export interface StationCandidate {
  /** Height above the ground under it (m) — applied once the ground snap has answered. */
  height: number;
  kind: StationKind;
  /** Signed lateral offset from the driven line (m, positive = right of travel). */
  lateral: number;
  /** GTA position; z is provisional until the ground snap replaces it. */
  position: [number, number, number];
}

/** The probes a survey needs from the world. Two calls, so a test can stand in for the whole physics world. */
export interface StationProbes {
  /** Ground Z under a GTA point (searching `maxDrop` down), or null when nothing is below it. */
  groundBelow(at: readonly [number, number, number], maxDrop: number): null | number;
  /** True when the straight line between two GTA points hits nothing solid. `excludeBody` skips one body —
   *  the live sightline aims AT the car, so without it every probe would hit the car it is checking for. */
  pathClear(
    from: readonly [number, number, number],
    to: readonly [number, number, number],
    excludeBody?: number,
  ): boolean;
}

/**
 * The survey's running state. Stepped a few casts at a time from the render loop, so the frame it completes
 * on is no more expensive than any other.
 */
export interface StationSurvey {
  /** Which candidate is being probed. */
  at: number;
  readonly candidates: readonly StationCandidate[];
  /** Casts spent so far — the ledger's own number, and the check that the budget is real. */
  casts: number;
  /** The ground snap for the current candidate has answered. */
  grounded: boolean;
  /** Window samples with a clear line, for the current candidate. */
  hits: number;
  /** Window samples within {@link SurveyOptions.maxDist} — the dwell test (D4: a station a fast car leaves
   *  in under a shot's length is rejected HERE, not discovered live). */
  near: number;
  readonly options: SurveyOptions;
  /** How many candidates were rejected, by reason — the ledger's accept/reject stats. */
  readonly rejected: { dwell: number; ground: number; sight: number };
  /** Which window sample is next for the current candidate. */
  sample: number;
  readonly samples: readonly (readonly [number, number, number])[];
  /** The winner, once one passes; null while the survey is still running or after it gave up. */
  station: null | SurveyedStation;
}

export interface SurveyOptions {
  /** Beyond this the car is too far to read (m). */
  maxDist: number;
  /** Share of window samples that must have a clear line (0..1). Soft on purpose: one lamppost may not
   *  reject a usable station, which is the whole difference from the rejected all-rays gate. */
  minCoverage: number;
  /** Share of window samples the car must be within {@link maxDist} for. */
  minDwell: number;
}

/** The camera height classes a station is drawn from — a low kerb angle, eye level, or up on a roof. */
type StationKind = 'eye' | 'high' | 'low';

/** A station that passed its survey — what the director is handed. */
interface SurveyedStation {
  /** Share of the window samples with a clear line to the car (0..1). */
  coverage: number;
  kind: StationKind;
  /** GTA eye, ground-snapped and lifted. */
  position: [number, number, number];
}

/** Bounds on the measured speed scale: a car pulling away from rest must not shrink the horizon to nothing,
 *  and one running downhill must not stretch it past the road that was surveyed. */
export const SPEED_SCALE_MIN = 0.6;
export const SPEED_SCALE_MAX = 1.1;

/** How far above the road the car's body centre sits (m) — what a sightline actually has to reach. */
const CAR_CENTRE_LIFT = 0.8;
/** Height classes: what a station is lifted above the ground it snapped to (m). */
const STATION_HEIGHTS: Record<StationKind, readonly number[]> = {
  eye: [1.2, 1.8, 2.5],
  high: [6, 7.5, 9],
  low: [0.6],
};
/** Relative weight of each height class in the seeded draw — eye level is the trailer default. */
const STATION_KIND_WEIGHTS: Record<StationKind, number> = { eye: 6, high: 2, low: 2 };
/** How far above the candidate the ground cast starts, and how far it searches down (m). */
const GROUND_PROBE_LIFT = 25;
const GROUND_PROBE_DROP = 60;
/** Window samples probed per candidate — start, quarters, end. */
const WINDOW_SAMPLES = 5;

/** The default survey thresholds — one table, so a field round tunes numbers and never a street. */
export const SURVEY_DEFAULTS: SurveyOptions = { maxDist: 70, minCoverage: 0.8, minDwell: 0.8 };

/** Start a survey over `candidates`, judged against the car positions the shot window is predicted to hold. */
export function createSurvey(
  candidates: readonly StationCandidate[],
  samples: readonly (readonly [number, number, number])[],
  options: SurveyOptions = SURVEY_DEFAULTS,
): StationSurvey {
  return {
    at: 0,
    candidates,
    casts: 0,
    grounded: false,
    hits: 0,
    near: 0,
    options,
    rejected: { dwell: 0, ground: 0, sight: 0 },
    sample: 0,
    samples,
    station: null,
  };
}

/**
 * Where the car will be `seconds` from the point `fromIndex` on the driven line, walking the route's own
 * per-vertex target speeds.
 *
 * `speedScale` is how well the car is actually KEEPING those speeds, measured live. It is not a nicety: the
 * autopilot cruises about 15 % under target (096/02 measured 10.2 m/s against 12), and over an eight-second
 * horizon that put a surveyed station 19.5 m from where the car really was (096/04's first field run). The
 * scale is a measurement of this car on this route, never a fitted constant.
 */
export function predictAlong(
  points: readonly { position: readonly [number, number, number]; speed: number }[],
  fromIndex: number,
  seconds: number,
  speedScale = 1,
): { index: number; position: [number, number, number] } {
  const last = points.length - 1;
  if (last < 1) {
    const only = points[0]?.position ?? [0, 0, 0];

    return { index: 0, position: [only[0], only[1], only[2]] };
  }
  let index = Math.min(Math.max(0, fromIndex), last);
  let remaining = Math.max(0, seconds);
  while (index < last && remaining > 0) {
    const whole = Math.floor(index);
    const a = points[whole].position;
    const b = points[whole + 1].position;
    const segment = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (segment === 0) {
      index = whole + 1;
      continue;
    }
    // A vertex speed of zero would make the walk never finish; the route's own floor is well above this.
    const speed = Math.max(0.5, points[whole].speed * speedScale);
    const time = (segment * (1 - (index - whole))) / speed;
    if (time >= remaining) {
      const at = Math.min(last, index + (remaining * speed) / segment);

      return { index: at, position: pointAt(points, at) };
    }
    remaining -= time;
    index = whole + 1;
  }
  // The loop ends when the road runs out OR the horizon does — a zero horizon must answer with where the car
  // IS, not where the route ends.
  const at = Math.min(last, index);

  return { index: at, position: pointAt(points, at) };
}

/**
 * Candidate stations around the driven line at `atIndex`: both sides, every offset, one height drawn per
 * candidate from the seeded stream. Order is seeded too (D9) — the survey takes the first that passes, so
 * the order IS the preference.
 *
 * Every number is derived from the road: the offsets are measured off the line the car will drive and the
 * heights off whatever ground is under them. Nothing is written against a place.
 */
export function stationCandidates(
  points: readonly { position: readonly [number, number, number] }[],
  atIndex: number,
  random: () => number,
  laterals: readonly number[] = STATION_LATERALS,
): StationCandidate[] {
  const last = points.length - 1;
  if (last < 1) {
    return [];
  }
  const at = Math.min(Math.max(0, atIndex), last);
  const centre = pointAt(points, at);
  const whole = Math.min(last - 1, Math.floor(at));
  const ahead = points[whole + 1].position;
  const behind = points[whole].position;
  // The line's own direction here, and the right of it — the same convention the route's lane offset uses.
  const dx = ahead[0] - behind[0];
  const dy = ahead[1] - behind[1];
  const length = Math.hypot(dx, dy) || 1;
  const right: [number, number] = [dy / length, -dx / length];

  const candidates: StationCandidate[] = [];
  for (const lateral of laterals) {
    for (const side of [1, -1]) {
      const kind = pickKind(random);
      const heights = STATION_HEIGHTS[kind];
      const height = heights[Math.min(heights.length - 1, Math.floor(random() * heights.length))];
      candidates.push({
        height,
        kind,
        lateral: lateral * side,
        position: [centre[0] + right[0] * lateral * side, centre[1] + right[1] * lateral * side, centre[2]],
      });
    }
  }

  return shuffle(candidates, random);
}

/**
 * Spend up to `maxCasts` on the survey and say how many were actually used.
 *
 * One candidate at a time, one cast at a time: the ground snap first (a candidate with no ground under it is
 * over a void and is dropped), then the window samples one by one. A candidate passes on COVERAGE — a share
 * of clear samples, not an all-rays gate — and on dwell, so a station the car is only near for a moment is
 * rejected here rather than cut away from live.
 *
 * Returns 0 forever once the survey has a station or has run out of candidates, so a caller may step it
 * unconditionally.
 */
export function stepSurvey(survey: StationSurvey, probes: StationProbes, maxCasts: number): number {
  let spent = 0;
  while (spent < maxCasts && survey.station === null && survey.at < survey.candidates.length) {
    const candidate = survey.candidates[survey.at];
    if (!survey.grounded) {
      const from: [number, number, number] = [
        candidate.position[0],
        candidate.position[1],
        candidate.position[2] + GROUND_PROBE_LIFT,
      ];
      const ground = probes.groundBelow(from, GROUND_PROBE_DROP);
      spent += 1;
      survey.casts += 1;
      if (ground === null) {
        survey.rejected.ground += 1;
        nextCandidate(survey);
        continue;
      }
      candidate.position[2] = ground + candidate.height;
      survey.grounded = true;
      continue;
    }
    const target = survey.samples[survey.sample];
    const distance = Math.hypot(
      target[0] - candidate.position[0],
      target[1] - candidate.position[1],
      target[2] - candidate.position[2],
    );
    if (probes.pathClear(candidate.position, target)) {
      survey.hits += 1;
    }
    if (distance <= survey.options.maxDist) {
      survey.near += 1;
    }
    spent += 1;
    survey.casts += 1;
    survey.sample += 1;
    if (survey.sample < survey.samples.length) {
      continue;
    }
    const coverage = survey.hits / survey.samples.length;
    const dwell = survey.near / survey.samples.length;
    if (dwell < survey.options.minDwell) {
      survey.rejected.dwell += 1;
    } else if (coverage < survey.options.minCoverage) {
      survey.rejected.sight += 1;
    } else {
      survey.station = { coverage, kind: candidate.kind, position: candidate.position };

      return spent;
    }
    nextCandidate(survey);
  }

  return spent;
}

/** The predicted car positions a shot window will hold — start, quarters, end, lifted to body centre. */
export function windowSamples(
  points: readonly { position: readonly [number, number, number]; speed: number }[],
  fromIndex: number,
  startsIn: number,
  seconds: number,
  speedScale = 1,
): [number, number, number][] {
  const samples: [number, number, number][] = [];
  for (let step = 0; step < WINDOW_SAMPLES; step += 1) {
    const at = startsIn + (seconds * step) / (WINDOW_SAMPLES - 1);
    const { position } = predictAlong(points, fromIndex, at, speedScale);
    samples.push([position[0], position[1], position[2] + CAR_CENTRE_LIFT]);
  }

  return samples;
}

/** Move to the next candidate and clear everything the last one accumulated. */
function nextCandidate(survey: StationSurvey): void {
  survey.at += 1;
  survey.grounded = false;
  survey.hits = 0;
  survey.near = 0;
  survey.sample = 0;
}

/** A weighted seeded draw over the height classes. */
function pickKind(random: () => number): StationKind {
  const kinds: StationKind[] = ['eye', 'high', 'low'];
  const total = kinds.reduce((sum, kind) => sum + STATION_KIND_WEIGHTS[kind], 0);
  let ticket = random() * total;
  for (const kind of kinds) {
    ticket -= STATION_KIND_WEIGHTS[kind];
    if (ticket < 0) {
      return kind;
    }
  }

  return 'eye';
}

/** The position at a FRACTIONAL index along the line. */
function pointAt(
  points: readonly { position: readonly [number, number, number] }[],
  at: number,
): [number, number, number] {
  const last = points.length - 1;
  const whole = Math.min(last, Math.max(0, Math.floor(at)));
  const next = Math.min(last, whole + 1);
  const fraction = at - whole;
  const a = points[whole].position;
  const b = points[next].position;

  return [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction, a[2] + (b[2] - a[2]) * fraction];
}

/** Fisher-Yates on the seeded stream — the pick ORDER is part of what `?seed=` reproduces. */
function shuffle<T>(items: T[], random: () => number): T[] {
  for (let at = items.length - 1; at > 0; at -= 1) {
    const swap = Math.floor(random() * (at + 1));
    [items[at], items[swap]] = [items[swap], items[at]];
  }

  return items;
}
