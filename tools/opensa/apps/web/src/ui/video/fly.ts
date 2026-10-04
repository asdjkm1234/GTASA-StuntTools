/**
 * The flythrough scene's flight plan (plan 096/07 task B): five aerial passes over one neighbourhood.
 *
 * A fly scene is five cameras like every other scene (D1 as revised, user 2026-07-31) — five distinct
 * passes over the SAME bounded stretch of city, each with its own height, side offset and lens, cut between.
 * It is not one long drone move: fifty seconds of unbroken travel is a shot an editor cuts anyway, and five
 * passes are what makes the region read.
 *
 * **Everything stays within {@link FLY_MAX_EXTENT} of the anchor, and that is the load-bearing rule here.**
 * Streaming follows the PLAYER (`driver.update(playerEngine)`), not the camera, and the player stands on the
 * ground at the route start for the whole scene. A flight that wandered past the ring would film the empty
 * world 094 exists to make impossible — so the route is TRIMMED to the cap before a single pass is planned,
 * and the caller asserts it.
 *
 * Pure: the clearance probe arrives as a function, like `stations.ts`, so the lift-and-retry rule is
 * testable without a physics world. GTA Z-up throughout — the scene converts at the boundary.
 */
import type { Random } from '@opensa/game/paths/rng';
import type { Route } from '@opensa/game/paths/route-builder';
import type { BenchKeyframe } from '@opensa/game/perf/bench';

import { pickWeighted } from '@opensa/game/paths/rng';
import { samplePath } from '@opensa/game/perf/bench';

/** How far from the anchor any part of a flight may travel (m).
 *
 * The HD ring is 380 u around the PLAYER (`streaming.ts`), and the player never leaves the route start
 * during a fly scene. 350 keeps the far end of the furthest pass inside it with a margin for the route's own
 * meander between two sampled points. */
export const FLY_MAX_EXTENT = 350;

/** How long one aerial pass plays (s) — the same clip every riding shot gets, so a fly scene is exactly as
 *  long as any other five-camera scene. */
export const FLY_PASS_SECONDS = 10;

/** Passes per fly scene — five cameras, like every scene (D1). */
export const FLY_PASSES = 5;

/** Ground line a single pass travels in its clip (m) — its speed follows from this and {@link
 *  FLY_PASS_SECONDS}: 120 m in 10 s is 12 m/s, a brisk drone rather than an aircraft. Fast enough that the
 *  city moves through frame, slow enough that a 40 m-high pass does not strobe over the rooftops. */
const PASS_GROUND_METRES = 120;

/** Height a blocked pass is lifted by before it is re-probed (m), and how many times that is tried. */
const CLEARANCE_LIFT = 10;
const CLEARANCE_TRIES = 2;

/** Radius the staging clearance is probed with (m) — a drone-sized ball, not a ray: a pass that threads a
 *  gap narrower than this reads as a near-miss on camera even when a ray calls it clear. */
export const CLEARANCE_RADIUS = 2;

/** Eye keyframes per pass. Eight over 120 m is a sample every ~17 m: fine enough that the smoothed line
 *  cannot cut a corner the probe did not look at, coarse enough that a pass costs ~7 casts to clear. */
const PASS_KEYFRAMES = 8;

/** Passes over the same neighbourhood must not all be the same pass — see {@link AERIAL_PRESETS}. */
export interface AerialPreset {
  /** Vertical field of view (rad). */
  readonly fovYRad: number;
  /** Height above the ground line where the pass BEGINS (m). */
  readonly fromHeight: number;
  /** Side offset from the ground line (m, right of travel) — a track past the street rather than over it. */
  readonly lateral: number;
  /** How far along the ground line ahead of the eye the look point travels (m). */
  readonly lead: number;
  readonly name: string;
  /** …and where it ENDS: equal heights are a level pass, unequal ones a climb or a descent. */
  readonly toHeight: number;
  readonly weight: number;
}

/** One planned pass: what it looks like, and the keyframes it flies. */
export interface FlyPass {
  /** Metres this pass was lifted by the staging clearance check (0 when it was clear as planned). */
  lifted: number;
  readonly path: readonly BenchKeyframe[];
  readonly preset: AerialPreset;
  readonly seconds: number;
}

/**
 * The five shapes a pass can take (096/07 B).
 *
 * Every height sits in the 15-40 m band the plan fixed: below it the pass is in among the first-floor
 * awnings, above it San Andreas reads as a map rather than a city. The band is the whole reason the presets
 * differ in HEIGHT PROFILE rather than in altitude alone — a descent and a climb over the same street are
 * two shots, two level passes at 24 and 26 m are one shot filmed twice.
 */
export const AERIAL_PRESETS: readonly AerialPreset[] = [
  {
    // Low and level down the line of the street — the pass that shows what a place looks like from a car's
    // world rather than a map's.
    fovYRad: (55 * Math.PI) / 180,
    fromHeight: 18,
    lateral: 0,
    lead: 60,
    name: 'low-pass',
    toHeight: 18,
    weight: 3,
  },
  {
    // High and level: the block, its roofs, and how the street sits in it.
    fovYRad: (50 * Math.PI) / 180,
    fromHeight: 34,
    lateral: 0,
    lead: 90,
    name: 'high-crane',
    toHeight: 34,
    weight: 2,
  },
  {
    // Coming down: starts on the skyline and ends at street height, which is the establishing shot's own
    // grammar — the wide plate resolving into a place.
    fovYRad: (52 * Math.PI) / 180,
    fromHeight: 40,
    lateral: 0,
    lead: 75,
    name: 'descend',
    toHeight: 22,
    weight: 3,
  },
  {
    // Off to one side, level: the street in profile, buildings passing between the camera and the line.
    fovYRad: (45 * Math.PI) / 180,
    fromHeight: 25,
    lateral: 35,
    lead: 40,
    name: 'side-track',
    toHeight: 25,
    weight: 2,
  },
  {
    // …and the reverse of `descend`: the place, then the city it sits in. A good scene closer.
    fovYRad: (52 * Math.PI) / 180,
    fromHeight: 20,
    lateral: 0,
    lead: 70,
    name: 'climb-out',
    toHeight: 38,
    weight: 2,
  },
];

/** What {@link stepFlight} produced for one rendered frame. */
export interface FlyFrame {
  /** A DECLARED discontinuity: the frame this pass began on. */
  cut: boolean;
  eye: [number, number, number];
  fovYRad: number;
  /** Which pass is playing — the scene's ledger counts by name. */
  name: string;
  target: [number, number, number];
}

/** The running flight: which pass, how far into it, and what the live guard has had to do about it. */
export interface FlyState {
  /** True once the last pass has run out — the scene reads this exactly as it reads `director.done`. */
  done: boolean;
  elapsed: number;
  /** The next frame is the first of a pass, and must be declared to the `[cam] jump` watchdog. */
  fresh: boolean;
  /** Probes the live guard has fired, and how many came back blocked — the scene's ledger. */
  guardHits: number;
  /** Seconds until the next live clearance probe — see {@link GUARD_SECONDS}. */
  guardIn: number;
  guardProbes: number;
  index: number;
  /** Metres of extra altitude the guard has actually applied so far (eased). */
  lift: number;
  /** …and what it is easing TOWARDS. The gap between the two is the whole of the continuous response. */
  liftTarget: number;
  readonly passes: readonly FlyPass[];
}

/** How often the live guard probes ahead of the eye (s) — a discrete verdict, so it is asked rarely and
 *  never per frame; the RESPONSE to it is what has to be continuous. */
const GUARD_SECONDS = 1;

/** How far ahead of the eye it probes, in seconds of flight — far enough that the eased lift has landed
 *  before the obstacle arrives ({@link GUARD_EASE} × this must exceed {@link GUARD_LIFT}). */
const GUARD_LOOKAHEAD_SECONDS = 3;

/** Altitude a blocked probe asks for (m), and how fast that is actually given (m/s).
 *
 * The rate is the point. A hard 10 m step would be exactly the discrete dodge the multiray postmortem is
 * about — the eye jumping because a boolean flipped. At 8 m/s the whole lift is spread over more than a
 * second of flight, which reads as the drone climbing over something. */
const GUARD_LIFT = 10;
const GUARD_EASE = 8;

/**
 * Lift each pass until its own line is clear, and say which ones could not be cleared.
 *
 * The rule is deliberately blunt — probe consecutive eye keyframes, lift the WHOLE pass by
 * {@link CLEARANCE_LIFT} on any hit, try again — because this is a staging decision behind the overlay,
 * where a discrete verdict is exactly the right tool (the same division `stations.ts` draws: occlusion picks
 * and cuts, it never steers). Lifting the whole pass rather than the blocked segment keeps the line smooth;
 * a local bulge around one tower is the discrete dodge the multiray postmortem warns about.
 *
 * A pass that is still blocked after {@link CLEARANCE_TRIES} is REJECTED, not flown at whatever height it
 * reached: the one thing worse than an aerial shot that misses the city is one that flies through it.
 */
export function clearFlight(
  passes: readonly FlyPass[],
  clear: (from: readonly [number, number, number], to: readonly [number, number, number]) => boolean,
): { casts: number; passes: FlyPass[] } {
  let casts = 0;
  const flown: FlyPass[] = [];
  for (const pass of passes) {
    let path = pass.path;
    let lifted = 0;
    for (let attempt = 0; attempt <= CLEARANCE_TRIES; attempt += 1) {
      let blocked = false;
      for (let index = 0; index + 1 < path.length && !blocked; index += 1) {
        casts += 1;
        blocked = !clear(path[index].pos, path[index + 1].pos);
      }
      if (!blocked) {
        flown.push({ ...pass, lifted, path });
        break;
      }
      if (attempt === CLEARANCE_TRIES) {
        break; // rejected: it never cleared, and it is not flown at "nearly clear"
      }
      lifted += CLEARANCE_LIFT;
      path = liftPath(path, CLEARANCE_LIFT);
    }
  }

  return { casts, passes: flown };
}

/** Start a flight over the passes that survived clearance. */
export function createFlight(passes: readonly FlyPass[]): FlyState {
  return {
    done: passes.length === 0,
    elapsed: 0,
    fresh: true,
    guardHits: 0,
    guardIn: GUARD_SECONDS,
    guardProbes: 0,
    index: 0,
    lift: 0,
    liftTarget: 0,
    passes,
  };
}

/**
 * Plan a fly scene's five passes over `route`.
 *
 * Each pass takes its own seeded WINDOW of the same route, so the five overlap over one neighbourhood
 * instead of walking a thousand metres of city the streaming ring will never hold. Distinct presets are
 * drawn without replacement for the same reason the shot list is: five slots spent on two shapes shows the
 * place twice and the other three not at all.
 */
export function planFlight(route: Route, random: Random, anchor: readonly [number, number, number]): FlyPass[] {
  const line = trimToExtent(route, anchor);
  const spacing = spacingOf(line);
  const span = Math.max(2, Math.round(PASS_GROUND_METRES / spacing));
  const used = new Set<string>();
  const passes: FlyPass[] = [];
  for (let pass = 0; pass < FLY_PASSES; pass += 1) {
    // Without replacement, exactly as `planShots` deals a scene's cameras: a shape already in this scene is
    // out of the draw. With five presets and five passes that deals all of them, in a seeded order.
    const weights = AERIAL_PRESETS.map((entry) => (used.has(entry.name) ? 0 : entry.weight));
    const preset = AERIAL_PRESETS[Math.max(0, pickWeighted(random, weights))];
    used.add(preset.name);
    const start = Math.floor(random() * Math.max(1, line.length - span));
    passes.push({
      lifted: 0,
      path: passPath(line, start, span, preset),
      preset,
      seconds: FLY_PASS_SECONDS,
    });
  }

  return passes;
}

/**
 * One rendered frame: where the eye is on the current pass, and what it is looking at.
 *
 * Sampled by NORMALISED time over uniformly-spaced keyframes, which is what makes the speed constant — the
 * keyframes come off a route resampled at a fixed step, so equal time is equal distance. `samplePath` is the
 * bench camera's own sampler (096/07 task B says to reuse it, and this is the whole of that reuse).
 */
export function stepFlight(
  state: FlyState,
  dt: number,
  clear?: (from: readonly [number, number, number], to: readonly [number, number, number]) => boolean,
): FlyFrame | null {
  if (state.done) {
    return null;
  }
  const pass = state.passes[state.index];
  const cut = state.fresh;
  state.fresh = false;
  state.elapsed += dt;
  const t = Math.min(1, state.elapsed / pass.seconds);
  const at = samplePath(pass.path, t);
  // The guard: a discrete probe on its own slow clock, and a lift that eases towards what it asked for.
  state.guardIn -= dt;
  if (clear && state.guardIn <= 0) {
    state.guardIn = GUARD_SECONDS;
    state.guardProbes += 1;
    const ahead = samplePath(pass.path, Math.min(1, t + GUARD_LOOKAHEAD_SECONDS / pass.seconds));
    const from = lifted(at.pos, state.lift);
    if (!clear(from, lifted(ahead.pos, state.lift))) {
      state.guardHits += 1;
      state.liftTarget += GUARD_LIFT;
    }
  }
  state.lift = Math.min(state.liftTarget, state.lift + GUARD_EASE * dt);
  if (state.elapsed >= pass.seconds) {
    state.index += 1;
    state.elapsed = 0;
    state.fresh = true;
    state.done = state.index >= state.passes.length;
    // A cut is a new camera: the previous pass's climb is not inherited, and the next one flies the height
    // its own staging cleared it at.
    state.lift = 0;
    state.liftTarget = 0;
    state.guardIn = GUARD_SECONDS;
  }

  return {
    cut,
    eye: lifted(at.pos, state.lift),
    fovYRad: pass.preset.fovYRad,
    name: pass.preset.name,
    target: [at.look[0], at.look[1], at.look[2]],
  };
}

/** A point raised by `by` metres (GTA Z-up) — the guard's whole geometry. */
function lifted(at: readonly [number, number, number], by: number): [number, number, number] {
  return [at[0], at[1], at[2] + by];
}

/** Raise every keyframe's EYE, never its look point: a lifted pass looks further down, not further away. */
function liftPath(path: readonly BenchKeyframe[], by: number): BenchKeyframe[] {
  return path.map((frame) => ({ look: frame.look, pos: [frame.pos[0], frame.pos[1], frame.pos[2] + by] as const }));
}

/** The eye/look keyframes of one pass over `line`, starting at index `start` and spanning `span` points. */
function passPath(
  line: readonly (readonly [number, number, number])[],
  start: number,
  span: number,
  preset: AerialPreset,
): BenchKeyframe[] {
  const last = line.length - 1;
  const path: BenchKeyframe[] = [];
  for (let key = 0; key < PASS_KEYFRAMES; key += 1) {
    const t = key / (PASS_KEYFRAMES - 1);
    const index = Math.min(last, start + Math.round(t * span));
    const [x, y, z] = line[index];
    const [rx, ry] = rightOf(line, index);
    const height = preset.fromHeight + (preset.toHeight - preset.fromHeight) * t;
    // The look point travels the SAME ground line ahead of the eye — which is what reads as a flight along a
    // street rather than a camera staring at one spot while it drifts sideways.
    const ahead = line[Math.min(last, index + Math.round(preset.lead / Math.max(0.5, spacingOf(line))))];
    path.push({
      look: [ahead[0], ahead[1], ahead[2]],
      pos: [x + rx * preset.lateral, y + ry * preset.lateral, z + height],
    });
  }

  return path;
}

/** Unit right of travel at `index` — the side offset's direction, the route builder's own convention. */
function rightOf(line: readonly (readonly [number, number, number])[], index: number): [number, number] {
  const at = Math.min(line.length - 2, Math.max(0, index));
  const dx = line[at + 1][0] - line[at][0];
  const dy = line[at + 1][1] - line[at][1];
  const length = Math.hypot(dx, dy) || 1;

  return [dy / length, -dx / length];
}

/** Mean spacing of the line's vertices (m) — the builder resamples uniformly, so one number describes it. */
function spacingOf(line: readonly (readonly [number, number, number])[]): number {
  if (line.length < 2) {
    return 1;
  }
  const [fx, fy] = line[0];
  const [sx, sy] = line[1];

  return Math.max(0.5, Math.hypot(sx - fx, sy - fy));
}

/**
 * The route's opening stretch, cut at the first point further than {@link FLY_MAX_EXTENT} from the anchor.
 *
 * Cut at the FIRST one rather than filtering: a route that leaves the cap and comes back would otherwise
 * hand the planner a line with a hole in it, and a pass flown across that hole is a camera teleporting.
 */
function trimToExtent(
  route: Route,
  anchor: readonly [number, number, number],
): readonly (readonly [number, number, number])[] {
  const line: (readonly [number, number, number])[] = [];
  for (const point of route.points) {
    const [x, y, z] = point.position;
    if (Math.hypot(x - anchor[0], y - anchor[1]) > FLY_MAX_EXTENT) {
      break;
    }
    line.push([x, y, z]);
  }

  return line;
}
