/**
 * Seeded route builder over the road graph (096/01, decisions D5/D8/D15): walk the game's own nodes into a
 * long, gently-curving run of roughly the length a fragment will drive, then hand back a DRIVABLE polyline —
 * lane-offset to the right, corners cut to a radius a car can hold, one target speed per vertex from the
 * local curvature. Pure: the same graph + seed always yields the same route (D9).
 *
 * No coordinate is ever hand-placed — every number here derives from the node data or from a constraint the
 * caller states, so the builder works the same in Los Santos and in the desert.
 */
import type { Random } from './rng';
import type { RouteGraph } from './route-graph';

import { pickWeighted } from './rng';

export interface Route {
  /** Achieved length along {@link points} (m) — under target in sparse areas; the caller shortens the scene. */
  length: number;
  /** Sharpest junction turn taken (degrees) — the acceptance ceiling is `maxTurnDeg`. */
  maxTurnDeg: number;
  /** Tightest corner of the smoothed line (m); Infinity for a perfectly straight route. */
  minCurveRadius: number;
  /** Centreline node indices in travel order. */
  nodes: readonly number[];
  /** What the car drives: lane-offset, corner-smoothed, with a target speed at every vertex. */
  points: readonly RoutePoint[];
  /** Why the walk ended. */
  stop: RouteStop;
  /** Turn taken at each interior centreline node (degrees) — the straightness histogram's input. */
  turnsDeg: readonly number[];
}

export interface RouteConstraints {
  /** Speed the straights are driven at (m/s). Default 12 — a calm cruise (D8). */
  cruiseSpeed?: number;
  /** Arc length the local radius is measured over (m). Default 8 — see {@link withSpeeds}. */
  curvatureBaseline?: number;
  /** Region containment (D15): a node outside the scene's region ends the route instead of crossing. */
  inRegion?: (x: number, y: number) => boolean;
  /** Offset to the RIGHT of travel (m). Default 2.5 — the `road-cars.ts` convention (nodes mark road centre). */
  laneOffset?: number;
  /** Lateral acceleration ceiling the target speeds respect (m/s²). Default 2.5 — calm, not a track lap. */
  latAccelMax?: number;
  /** Junction turns above this are rejected outright (degrees). Default 35 (D5). */
  maxTurnDeg?: number;
  /** Turn allowed to ACCUMULATE over `turnWindow` metres (degrees). Default 45 — see {@link walkRoute}. */
  maxWindowTurnDeg?: number;
  /** Turns under this are strongly preferred (degrees). Default 15 (D5: long straights, gentle curves). */
  preferTurnDeg?: number;
  /** Spacing of the driven line's vertices (m). Default 2 — uniform, so the follower's lookahead is an index. */
  sampleStep?: number;
  /** How much road to gather (m) — the sequencer derives it from the fragment duration and cruise speed. */
  targetLength: number;
  /** Distance the accumulated turn is measured over (m). Default 25. */
  turnWindow?: number;
}

export interface RoutePoint {
  position: readonly [number, number, number];
  /** Target speed here (m/s): `min(cruise, sqrt(latAccelMax × radius))`. */
  speed: number;
}

/** Why a walk ended: road ran out · only region-leaving road left · only road too sharp to take · done. */
export type RouteStop = 'dead-end' | 'region' | 'target' | 'too-tight';

type Point = readonly [number, number, number];

/** One candidate hop out of the current node. */
interface StepOption {
  /** Whether road remains beyond it — see the lookahead note in {@link walkRoute}. */
  continues: boolean;
  direction: readonly [number, number];
  distance: number;
  index: number;
  turnDeg: number;
}

const DEFAULTS = {
  cruiseSpeed: 12,
  curvatureBaseline: 8,
  laneOffset: 2.5,
  latAccelMax: 2.5,
  maxTurnDeg: 35,
  maxWindowTurnDeg: 45,
  preferTurnDeg: 15,
  sampleStep: 2,
  turnWindow: 25,
} as const;

/** Below this a hop is a duplicate node, not a road segment (the graph has coincident nodes at junctions). */
const MIN_SEGMENT = 0.5;

/** Spacing of the region-containment samples along a segment (m) — SA's zone boxes are far coarser. */
const REGION_SAMPLE = 5;

/**
 * Walk a route from `start`. Returns null when the start node itself is unusable (water, outside the region,
 * no usable link). A walk that runs out of road returns its BEST route with the length it achieved and
 * `stop` saying why — a short route is a fact for the caller, never a silent retry.
 */
export function walkRoute(
  graph: RouteGraph,
  start: number,
  random: Random,
  constraints: RouteConstraints,
): null | Route {
  const config = { ...DEFAULTS, ...constraints };
  const inRegion = constraints.inRegion ?? ((): boolean => true);
  const usable = (index: number): boolean => {
    const node = graph.nodes[index];

    return !node.boats && inRegion(node.position[0], node.position[1]);
  };
  // D15 holds for the LINE, not just for the nodes: two nodes can both sit in San Fierro while the road
  // between them runs through the countryside for a quarter of the route (096/01 measured exactly that) —
  // and the player crossing a region border rewrites the weather over 6 s, mid-scene.
  const segmentStays = (from: Point, to: Point): boolean => {
    const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
    for (let at = REGION_SAMPLE; at < distance; at += REGION_SAMPLE) {
      const t = at / distance;
      if (!inRegion(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t)) {
        return false;
      }
    }

    return true;
  };
  if (start < 0 || start >= graph.nodes.length || !usable(start)) {
    return null;
  }
  const path = [start];
  const visited = new Set(path);
  const turnsDeg: number[] = [];
  /** The last `turnWindow` metres of travel, as (distance, turn) pairs — the accumulated-turn budget. */
  const recent: { distance: number; turnDeg: number }[] = [];
  let centrelineLength = 0;
  let heading: null | readonly [number, number] = null;
  let stop: RouteStop = 'target';
  while (centrelineLength < config.targetLength) {
    const current = path[path.length - 1];
    const remaining = config.targetLength - centrelineLength;
    // The per-junction ceiling alone does not make a route gentle: SA nodes sit as close as 2.7 m, so five
    // legal 25° turns in a row bend 125° inside ten metres (096/01 measured a 2 m "corner" that way). The
    // budget is what D5's "gentle curves" actually means.
    const spent = windowTurn(recent, config.turnWindow);
    const options: StepOption[] = stepOptions(
      graph,
      current,
      heading,
      visited,
      usable,
      segmentStays,
      config,
      remaining,
    ).filter((option) => spent + option.turnDeg <= config.maxWindowTurnDeg);
    if (options.length === 0) {
      stop = blockedBy(graph, current, visited, inRegion, segmentStays);
      break;
    }
    // The lookahead is a PREFERENCE, not a veto: at a branch it drops the hops that strand the route, but
    // when every option is a dead end the hop is still taken — more road, and the walk then stops for its
    // real reason instead of blaming the junction before it.
    const continuing = options.filter((option) => option.continues);
    const pool = continuing.length > 0 ? continuing : options;
    const pick = pickWeighted(
      random,
      pool.map((option) => 1 / (1 + (option.turnDeg / config.preferTurnDeg) ** 2)),
    );
    const chosen = pool[Math.max(0, pick)];
    if (heading !== null) {
      turnsDeg.push(chosen.turnDeg);
    }
    path.push(chosen.index);
    visited.add(chosen.index);
    centrelineLength += chosen.distance;
    heading = chosen.direction;
    recent.push({ distance: chosen.distance, turnDeg: chosen.turnDeg });
  }
  if (path.length < 2) {
    return null;
  }
  const built = drivablePoints(
    path.map((index) => graph.nodes[index].position),
    config,
  );
  // The player follows the DRIVEN line, and so does the city trigger: a road hugging a zone border stays
  // inside by its nodes while the 2.5 m lane offset sits 10 cm outside (096/01, San Fierro's y = −742.306
  // edge). Cut the route where that first happens rather than hand the sequencer a scene that changes region.
  const leaves = built.findIndex((point) => !inRegion(point.position[0], point.position[1]));
  const points = leaves === -1 ? built : built.slice(0, leaves);
  if (points.length < 2) {
    return null;
  }
  if (leaves !== -1) {
    stop = 'region';
  }

  return {
    length: polylineLength(points.map((point) => point.position)),
    maxTurnDeg: turnsDeg.length > 0 ? Math.max(...turnsDeg) : 0,
    minCurveRadius: minRadius(
      points.map((point) => point.position),
      Math.max(1, Math.round(config.curvatureBaseline / 2 / config.sampleStep)),
    ),
    nodes: path,
    points,
    stop,
    turnsDeg,
  };
}

/**
 * Why no candidate survived. The three reasons tune different things: `region` is the scene's own boundary,
 * `too-tight` means road was there and the turn rules refused it (the D5 knobs), `dead-end` means the graph
 * itself ran out. Collapsing them would hide which constraint is costing routes.
 */
function blockedBy(
  graph: RouteGraph,
  current: number,
  visited: ReadonlySet<number>,
  inRegion: (x: number, y: number) => boolean,
  segmentStays: (from: Point, to: Point) => boolean,
): RouteStop {
  const from = graph.nodes[current].position;
  let refused = false;
  for (const link of graph.nodes[current].links) {
    const node = graph.nodes[link];
    if (visited.has(link) || node.boats) {
      continue;
    }
    if (!inRegion(node.position[0], node.position[1]) || !segmentStays(from, node.position)) {
      return 'region';
    }
    refused = true; // in region, reachable — so it was the turn ceiling or the turn budget that dropped it
  }

  return refused ? 'too-tight' : 'dead-end';
}

/** Circumradius of three points in the ground plane; Infinity when they are collinear. */
function curveRadius(a: Point, b: Point, c: Point): number {
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
  const ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const area = Math.abs(cross) / 2;
  if (area < 1e-6 || ab < 1e-6 || bc < 1e-6) {
    return Infinity;
  }

  return (ab * bc * ca) / (4 * area);
}

/**
 * Centreline → what the car drives: lane offset first (it moves the corners), two corner-cutting passes, then
 * a UNIFORM resample. Uniform spacing is not cosmetic — SA nodes sit anywhere from 2.7 m to 23 m apart, and
 * reading curvature off unevenly spaced points reported 2 m "hairpins" on a road whose sharpest junction was
 * 32° (096/01 measurement). It also makes the follower's lookahead an index instead of a search.
 */
function drivablePoints(
  centreline: readonly Point[],
  config: Required<Omit<RouteConstraints, 'inRegion'>>,
): RoutePoint[] {
  const offset = laneOffsetLine(centreline, config.laneOffset);
  const maxCut = config.laneOffset * 2;
  const smoothed = smoothCorners(smoothCorners(offset, maxCut), maxCut);
  const sampled = resample(smoothed, config.sampleStep);

  return withSpeeds(sampled, config);
}

/** Whether `index`, entered along `direction`, has at least one onward link inside the turn ceiling. */
function hasContinuation(
  graph: RouteGraph,
  index: number,
  direction: readonly [number, number],
  visited: ReadonlySet<number>,
  usable: (candidate: number) => boolean,
  config: Required<Omit<RouteConstraints, 'inRegion'>>,
): boolean {
  const from = graph.nodes[index].position;
  for (const link of graph.nodes[index].links) {
    if (link === index || visited.has(link) || !usable(link)) {
      continue;
    }
    const to = graph.nodes[link].position;
    const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (distance < MIN_SEGMENT) {
      continue;
    }
    if (turnBetween(direction, normalize(to[0] - from[0], to[1] - from[1])) <= config.maxTurnDeg) {
      return true;
    }
  }

  return false;
}

/** Shift every vertex to the right of local travel: right = (fy, −fx) for forward f (GTA +Z up). */
function laneOffsetLine(centreline: readonly Point[], offset: number): Point[] {
  return centreline.map((point, index) => {
    const before = centreline[Math.max(0, index - 1)];
    const after = centreline[Math.min(centreline.length - 1, index + 1)];
    const [fx, fy] = normalize(after[0] - before[0], after[1] - before[1]);

    return [point[0] + fy * offset, point[1] - fx * offset, point[2]] as const;
  });
}

/** Smallest radius over the line, measured over `span` samples either side — the tightest corner to hold. */
function minRadius(points: readonly Point[], span: number): number {
  let smallest = Infinity;
  for (let index = span; index < points.length - span; index += 1) {
    smallest = Math.min(smallest, curveRadius(points[index - span], points[index], points[index + span]));
  }

  return smallest;
}

function normalize(x: number, y: number): readonly [number, number] {
  const length = Math.hypot(x, y);

  return length < 1e-6 ? [0, 1] : [x / length, y / length];
}

function polylineLength(points: readonly Point[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1]);
  }

  return total;
}

/** Re-space a polyline at a constant step, keeping the last vertex. Degenerate lines are returned as-is. */
function resample(points: readonly Point[], step: number): Point[] {
  const total = polylineLength(points);
  if (points.length < 2 || total < step) {
    return [...points];
  }
  const out: Point[] = [points[0]];
  let index = 1;
  let walked = 0;
  let segmentStart = points[0];
  for (let at = step; at < total; at += step) {
    while (index < points.length) {
      const segment = Math.hypot(points[index][0] - segmentStart[0], points[index][1] - segmentStart[1]);
      if (walked + segment >= at) {
        const t = segment < 1e-6 ? 0 : (at - walked) / segment;
        out.push([
          segmentStart[0] + (points[index][0] - segmentStart[0]) * t,
          segmentStart[1] + (points[index][1] - segmentStart[1]) * t,
          segmentStart[2] + (points[index][2] - segmentStart[2]) * t,
        ]);
        break;
      }
      walked += segment;
      segmentStart = points[index];
      index += 1;
    }
  }
  out.push(points[points.length - 1]);

  return out;
}

/**
 * Cut every interior corner into two points (a capped Chaikin pass): the cut never exceeds a quarter of the
 * shorter adjacent segment, nor `maxCut` — a junction on a short block must not swallow the block.
 */
function smoothCorners(points: readonly Point[], maxCut: number): Point[] {
  if (points.length < 3) {
    return [...points];
  }
  const out: Point[] = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    out.push(towards(corner, previous, maxCut), towards(corner, next, maxCut));
  }
  out.push(points[points.length - 1]);

  return out;
}

/** Every link out of `current` that may be driven next, with its turn — the rejection rules of D5/D8/D15. */
function stepOptions(
  graph: RouteGraph,
  current: number,
  heading: null | readonly [number, number],
  visited: ReadonlySet<number>,
  usable: (index: number) => boolean,
  segmentStays: (from: Point, to: Point) => boolean,
  config: Required<Omit<RouteConstraints, 'inRegion'>>,
  remaining: number,
): StepOption[] {
  const from = graph.nodes[current].position;
  const options: StepOption[] = [];
  for (const link of graph.nodes[current].links) {
    if (visited.has(link) || !usable(link)) {
      continue;
    }
    const to = graph.nodes[link].position;
    const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
    if (distance < MIN_SEGMENT || !segmentStays(from, to)) {
      continue;
    }
    const direction = normalize(to[0] - from[0], to[1] - from[1]);
    const turnDeg = heading === null ? 0 : turnBetween(heading, direction);
    if (turnDeg > config.maxTurnDeg) {
      continue;
    }
    // One-step lookahead: does this hop leave road ahead? Irrelevant once it already completes the route.
    const continues = remaining - distance <= 0 || hasContinuation(graph, link, direction, visited, usable, config);
    options.push({ continues, direction, distance, index: link, turnDeg });
  }

  return options;
}

/** A point `min(maxCut, quarter of the segment)` from `from` toward `to`. */
function towards(from: Point, to: Point, maxCut: number): Point {
  const distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (distance < 1e-6) {
    return from;
  }
  const t = Math.min(maxCut, distance * 0.25) / distance;

  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t];
}

/** Unsigned angle between two unit ground vectors, in degrees. */
function turnBetween(a: readonly [number, number], b: readonly [number, number]): number {
  const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1]));

  return (Math.acos(dot) * 180) / Math.PI;
}

/** Turn accumulated over the trailing `window` metres; older entries are dropped as they fall out of it. */
function windowTurn(recent: { distance: number; turnDeg: number }[], window: number): number {
  let distance = 0;
  let turn = 0;
  for (let index = recent.length - 1; index >= 0; index -= 1) {
    if (distance >= window) {
      recent.splice(0, index + 1);
      break;
    }
    distance += recent[index].distance;
    turn += recent[index].turnDeg;
  }

  return turn;
}

/**
 * Target speed per vertex: `min(cruise, sqrt(latAccelMax × radius))`, where the radius is read over
 * `curvatureBaseline` metres of arc either side — a car's turn rate is a property of metres of road, not of
 * whatever spacing the node file happened to use. Vertices nearer the ends than the baseline inherit the
 * closest measured speed.
 */
function withSpeeds(points: readonly Point[], config: Required<Omit<RouteConstraints, 'inRegion'>>): RoutePoint[] {
  const span = Math.max(1, Math.round(config.curvatureBaseline / 2 / config.sampleStep));
  const speeds = points.map(() => config.cruiseSpeed);
  for (let index = span; index < points.length - span; index += 1) {
    const radius = curveRadius(points[index - span], points[index], points[index + span]);
    speeds[index] = Math.min(config.cruiseSpeed, Math.sqrt(config.latAccelMax * radius));
  }
  for (let index = span - 1; index >= 0; index -= 1) {
    speeds[index] = speeds[Math.min(span, points.length - 1)];
  }
  for (let index = points.length - span; index < points.length; index += 1) {
    speeds[index] = speeds[Math.max(0, points.length - span - 1)];
  }

  return points.map((position, index) => ({ position, speed: speeds[index] }));
}
