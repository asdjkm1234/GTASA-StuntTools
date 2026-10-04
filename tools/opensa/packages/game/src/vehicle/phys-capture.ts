/**
 * What a scripted lap REPORTS (plan 081/01) — the `[phys]` capture's numbers, derived from the frames.
 *
 * The summary exists so a ledger row can be read without replaying anything: the peak nose-up angle while the
 * brakes were on, the roll a slalom reached, whether the car ever went over, how long it was in the air. Every
 * later 081 plan is judged by moving these numbers, so they are computed once, here, and the same function
 * runs over a BEFORE capture and an AFTER one.
 *
 * The peaks are taken over EVERY frame while the series a capture prints is thinned — a spike must survive
 * the thinning as a number even when its sample is dropped from the curve.
 */
import type { TelemetryFrame } from './vehicle-telemetry';

const RAD_TO_DEG = 180 / Math.PI;
const MS_TO_KMH = 3.6;
/** Below this speed (m/s) the car counts as stopped — the end of a braking distance. */
const STOPPED_SPEED = 0.4;
/** Past this roll (deg) the car is on its side or its roof; the chain's flip complaint made measurable. */
const FLIP_ROLL_DEG = 90;

/** Steer (rad) above which the wheel counts as turned — under this it is slew noise around centre. */
const STEER_ON = 0.02;
/** A step must be held at least this long to have a settled value worth measuring. */
const MIN_HOLD_S = 1.5;
/** The steady window opens this long after the step — past the transient of any car worth measuring. */
const SETTLE_FROM_S = 0.3;
/** …and closes here. Short on purpose: a held corner leaves a two-lane street in about two seconds. */
const SETTLE_TO_S = 1;
/** How far the yaw may swing across that window, as a share of its median, and still count as steady. */
const STEADY_SPREAD = 0.35;

/** A signed channel's extremes over the capture. */
export interface PhysRange {
  readonly max: number;
  readonly min: number;
}

export interface PhysSummary {
  /**
   * The LONGEST unbroken stretch with no wheel in contact (s), and how much the nose turned during it (deg,
   * positive = up) — the pair that makes a jump readable (plan 081/06 §1).
   *
   * `airborneS` alone cannot: it is a TOTAL, so a lap that skipped over a crest in a dozen 40 ms hops reports
   * the same second of air as one that flew. Air control is only handed over after a debounce, so the total
   * says nothing about whether the driver ever had any — measured on the `crest-jump` lap, 1.13 s of total
   * air was fragments, of which the longest single flight was a fifth of a second.
   *
   * Null when the lap never left the ground at all, so "no jump" cannot read as "a jump with no rotation".
   * `atS` says WHERE in the lap it was: two runs of a chaotic scene can pick different flights, and comparing
   * a crest launch against a landing bounce is how a jump A/B reads backwards.
   */
  readonly air: null | { atS: number; pitchDeg: number; seconds: number };
  /** Seconds with NO wheel in contact — the crest scene's air time. */
  readonly airborneS: number;
  /** Braking: distance and time from the first braked frame to a stop. Null when the lap never braked to
   *  a halt (nothing to measure is not the same as a zero). */
  readonly brake: null | { distanceM: number; fromKmh: number; seconds: number };
  /**
   * MEAN body pitch while the car is actually decelerating (deg) — **negative is the nose DOWN**, which is
   * what "does it dive" asks. Null when the lap never braked hard.
   *
   * `pitchUnderBrakeDeg` beside it is the PEAK nose-up, and it answers a different question badly: it fires
   * at the instant the brake goes on, before the nose has had time to come down, so a car that dives 2.6°
   * can still report +1.65° there. Both are kept — the peak is what the whole BEFORE record was measured
   * with, and comparability matters more than tidiness.
   */
  readonly diveDeg: null | number;
  /** Captured length (s) and frame count — a lap that ended early is not comparable to one that did not. */
  readonly durationS: number;
  /** Whether the car ever passed {@link FLIP_ROLL_DEG}, and how fast it was going when it first did. */
  readonly flip: null | { atKmh: number; atS: number };
  readonly frames: number;
  readonly gLat: PhysRange;
  readonly gLong: PhysRange;
  readonly gVert: PhysRange;
  readonly pitchDeg: PhysRange;
  /** Peak nose-up angle (deg) while the brakes were applied — THE number the braking complaint is about.
   *  Null when the lap never braked. */
  readonly pitchUnderBrakeDeg: null | number;
  readonly rollDeg: PhysRange;
  /** Largest body slip angle reached (deg, absolute) — how sideways the lap ever got. */
  readonly slipMaxDeg: number;
  /** The first held steering step in the lap, if it had one — see {@link StepResponse}. */
  readonly step: null | StepResponse;
  /**
   * WHAT the lap drove on (plan 081/10): the share of wheel-on-ground samples per SA surface id, ids as
   * keys. Empty when nothing reported a surface — a world without materials, or a lap spent entirely in the
   * air. Shares are of the KNOWN samples, so `{ "1": 1 }` means "every wheel that touched anything touched
   * tarmac", not "the car never left the ground".
   */
  readonly surfaces: Readonly<Record<number, number>>;
  /** Seconds from the first moving frame to 100 km/h; null when the car never got there. */
  readonly timeTo100S: null | number;
  /** Top forward speed (km/h). */
  readonly topSpeedKmh: number;
  /** Net heading change over the lap (deg, signed) — a u-turn should read ~180, a handbrake turn its
   *  rotation. Integrated from yaw rate, so it counts the whole spin rather than the shortest way round. */
  readonly turnedDeg: number;
}

/**
 * The transient after a STEERING STEP — the channel the loudest complaint is about.
 *
 * "The car turns instantly, it just changes its direction vector" is a statement about the time between
 * asking for a corner and getting one, and no peak or total can express it. A real car answers a step of
 * lock in a few tenths of a second, overshooting slightly and settling; a car with no transient answers
 * within a frame or two and has no settling to describe.
 */
export interface StepResponse {
  /** When the wheel was turned (s into the capture) — where to look in the series. */
  readonly atS: number;
  /**
   * Whether the car actually HELD a steady corner: the settle window has to be a real fraction of the peak.
   *
   * False means the manoeuvre broke away — it spun, stopped or went over during the hold — and then
   * `yawRiseS`, `yawSettledDegS` and `yawOvershoot` describe a crash, not a response. The four BEFORE cars
   * all reported false on a 0.35 step, which is the complaint restated: there is no steady state to reach.
   */
  readonly settled: boolean;
  /** Body slip angle once settled (deg, absolute). A car that never slips reports ≈0 here. */
  readonly slipSettledDeg: number;
  /** Forward speed at the step (km/h). A transient at 40 km/h is not the same manoeuvre as one at 120. */
  readonly speedAtStepKmh: number;
  /** Peak yaw rate over the hold, as a multiple of the settled one. 1.0 = it never overshot. */
  readonly yawOvershoot: number;
  /**
   * Seconds from the step to 90 % of the settled yaw rate — **the number the complaint is about**. Near
   * zero means the car simply rotated; a road car takes a few tenths.
   */
  readonly yawRiseS: number;
  /** Settled yaw rate (deg/s, absolute) — what the car eventually does with that much lock. */
  readonly yawSettledDegS: number;
}

/** Derive the lap's numbers. An empty capture summarises to zeros rather than throwing — a scene that
 *  produced nothing is a result the runner must be able to print and a reader must be able to see. */
export function summarisePhysFrames(frames: readonly TelemetryFrame[]): PhysSummary {
  if (frames.length === 0) {
    return EMPTY;
  }
  const braked = frames.filter((frame) => frame.brake > 0);
  const flip = frames.find((frame) => Math.abs(frame.roll * RAD_TO_DEG) >= FLIP_ROLL_DEG) ?? null;

  return {
    air: longestFlight(frames),
    airborneS: round(integrate(frames, (frame) => (frame.wheels.some((wheel) => wheel.contact) ? 0 : 1))),
    brake: brakingRun(frames),
    diveDeg: dive(frames),
    durationS: round(frames[frames.length - 1].t - frames[0].t),
    flip: flip === null ? null : { atKmh: round(flip.speed * MS_TO_KMH), atS: round(flip.t) },
    frames: frames.length,
    gLat: range(frames.map((frame) => frame.gLat)),
    gLong: range(frames.map((frame) => frame.gLong)),
    gVert: range(frames.map((frame) => frame.gVert)),
    pitchDeg: range(frames.map((frame) => frame.pitch * RAD_TO_DEG)),
    pitchUnderBrakeDeg:
      braked.length === 0 ? null : round(Math.max(...braked.map((frame) => frame.pitch * RAD_TO_DEG))),
    rollDeg: range(frames.map((frame) => frame.roll * RAD_TO_DEG)),
    slipMaxDeg: round(Math.max(...frames.map((frame) => Math.abs(frame.slipAngle * RAD_TO_DEG)))),
    step: stepResponse(frames),
    surfaces: surfaceShares(frames),
    timeTo100S: timeToSpeed(frames, 100),
    topSpeedKmh: round(Math.max(...frames.map((frame) => frame.speed * MS_TO_KMH))),
    turnedDeg: round(integrate(frames, (frame) => frame.yawRate * RAD_TO_DEG)),
  };
}

/** Thin a capture to about `hz` samples per second, keeping the first and last frame. */
export function thinFrames(frames: readonly TelemetryFrame[], hz: number): readonly TelemetryFrame[] {
  if (frames.length <= 2 || hz <= 0) {
    return frames;
  }
  const period = 1 / hz;
  const kept: TelemetryFrame[] = [frames[0]];
  // Against a RUNNING target, not the last kept stamp: chasing the last one lets each rounding-up compound,
  // and a 60 Hz capture thinned "to 20 Hz" quietly comes out at 15. EPSILON covers the step's own float
  // error (3 × 1/60 is 0.049999…, which a bare `>=` reads as short of a 0.05 period).
  const EPSILON = 1e-9;
  let nextAt = frames[0].t + period;
  for (const frame of frames.slice(1, -1)) {
    if (frame.t + EPSILON >= nextAt) {
      kept.push(frame);
      nextAt += period;
    }
  }
  kept.push(frames[frames.length - 1]);

  return kept;
}

/** Integrate a per-frame value over the capture's own timestamps (never an assumed step). */
function integrate(frames: readonly TelemetryFrame[], value: (frame: TelemetryFrame) => number): number {
  let total = 0;
  for (let index = 1; index < frames.length; index += 1) {
    total += value(frames[index]) * (frames[index].t - frames[index - 1].t);
  }

  return total;
}

/**
 * The lap's longest single flight and what the nose did during it — see {@link PhysSummary.air}.
 *
 * The pitch delta is taken between the first and last airborne frame of that stretch, in the body's own
 * pitch channel: a jump the driver never touched reads whatever the launch gave it, and holding W or S should
 * move it by degrees. Wrapping is not a concern — a car that rotates past ±90° in one flight has a different
 * problem, and the roll/flip channels report that one.
 */
function longestFlight(frames: readonly TelemetryFrame[]): null | { atS: number; pitchDeg: number; seconds: number } {
  const flying = (frame: TelemetryFrame): boolean => !frame.wheels.some((wheel) => wheel.contact);
  let best: null | { end: number; start: number } = null;
  let start = -1;
  for (let index = 0; index <= frames.length; index += 1) {
    const airborne = index < frames.length && flying(frames[index]);
    if (airborne && start < 0) {
      start = index;
    } else if (!airborne && start >= 0) {
      const end = index - 1;
      if (best === null || frames[end].t - frames[start].t > frames[best.end].t - frames[best.start].t) {
        best = { end, start };
      }
      start = -1;
    }
  }
  if (best === null) {
    return null;
  }

  return {
    atS: round(frames[best.start].t),
    pitchDeg: round((frames[best.end].pitch - frames[best.start].pitch) * RAD_TO_DEG),
    seconds: round(frames[best.end].t - frames[best.start].t),
  };
}

/**
 * The first HELD steering step in the lap, measured.
 *
 * The step is found in the data, not taken from the scene: the first frame where the wheel goes from centred
 * to turned and STAYS turned for {@link MIN_HOLD_S}. The settled values are the mean over the last
 * {@link SETTLE_FROM_S}..{@link SETTLE_TO_S} after it. Null when the lap has no such step (a straight-line or
 * full-lock scene), because an unmeasurable transient is not a zero.
 */
function stepResponse(frames: readonly TelemetryFrame[]): null | StepResponse {
  const turned = (index: number): boolean => Math.abs(frames[index].steer) > STEER_ON;
  let start = -1;
  for (let index = 1; index < frames.length; index += 1) {
    if (turned(index) && !turned(index - 1)) {
      start = index;
      break;
    }
  }
  if (start === -1) {
    return null;
  }
  let end = start;
  while (end + 1 < frames.length && turned(end + 1)) {
    end += 1;
  }
  const holdS = frames[end].t - frames[start].t;
  if (holdS < MIN_HOLD_S) {
    return null;
  }
  const stepAt = frames[start].t;
  // The window is JUST AFTER the step, not at the end of the hold. A sustained corner drives the car off a
  // two-lane street within a couple of seconds, and the first capture proved it: the response was clean and
  // the tail of the hold was a kerb strike, a spin and a bounce backwards. The response is what this
  // measures, so it is read where the response lives.
  const window = frames.filter((frame) => frame.t >= stepAt + SETTLE_FROM_S && frame.t <= stepAt + SETTLE_TO_S);
  if (window.length < 3) {
    return null;
  }
  const yaws = window.map((frame) => Math.abs(frame.yawRate * RAD_TO_DEG));
  // MEDIAN, not mean: one collision sample inside the window would drag a mean anywhere.
  const yawSettled = median(yaws);
  const spread = yawSettled === 0 ? Infinity : (Math.max(...yaws) - Math.min(...yaws)) / yawSettled;
  const transient = frames.filter((frame) => frame.t >= stepAt && frame.t <= stepAt + SETTLE_TO_S);
  const peak = Math.max(...transient.map((frame) => Math.abs(frame.yawRate * RAD_TO_DEG)));
  const reached = transient.find((frame) => Math.abs(frame.yawRate * RAD_TO_DEG) >= yawSettled * 0.9);

  return {
    atS: round(stepAt),
    // A steady corner holds its yaw rate. A window that swings by more than this around its own median is a
    // car that hit something, spun or went over, and every other field here then describes that.
    settled: spread <= STEADY_SPREAD,
    slipSettledDeg: round(median(window.map((frame) => Math.abs(frame.slipAngle * RAD_TO_DEG)))),
    speedAtStepKmh: round(frames[start].speed * MS_TO_KMH),
    yawOvershoot: yawSettled === 0 ? 0 : round(peak / yawSettled),
    yawRiseS: round((reached?.t ?? window[window.length - 1].t) - stepAt),
    yawSettledDegS: round(yawSettled),
  };
}

/**
 * The share of wheel-on-ground samples spent on each surface id. Counted per WHEEL per frame, not per frame:
 * a car with two wheels on tarmac and two on grass is on both, and that is exactly the state an off-road
 * grip change has to be read against.
 */
function surfaceShares(frames: readonly TelemetryFrame[]): Record<number, number> {
  const counts = new Map<number, number>();
  let total = 0;
  for (const frame of frames) {
    for (const wheel of frame.wheels) {
      if (wheel.surface === null) {
        continue;
      }
      counts.set(wheel.surface, (counts.get(wheel.surface) ?? 0) + 1);
      total += 1;
    }
  }
  const shares: Record<number, number> = {};
  for (const [surface, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    shares[surface] = round(count / total);
  }

  return shares;
}

/** Seconds from the first MOVING frame to `kmh`; null when the lap never got there. Measured from the
 *  moment the car actually starts rolling, so a lap that idles before its launch is not penalised. */
function timeToSpeed(frames: readonly TelemetryFrame[], kmh: number): null | number {
  const start = frames.find((frame) => frame.speed > STOPPED_SPEED);
  const reached = frames.find((frame) => frame.speed * MS_TO_KMH >= kmh);

  return start === undefined || reached === undefined ? null : round(reached.t - start.t);
}

const ZERO_RANGE: PhysRange = { max: 0, min: 0 };

const EMPTY: PhysSummary = {
  air: null,
  airborneS: 0,
  brake: null,
  diveDeg: null,
  durationS: 0,
  flip: null,
  frames: 0,
  gLat: ZERO_RANGE,
  gLong: ZERO_RANGE,
  gVert: ZERO_RANGE,
  pitchDeg: ZERO_RANGE,
  pitchUnderBrakeDeg: null,
  rollDeg: ZERO_RANGE,
  slipMaxDeg: 0,
  step: null,
  surfaces: {},
  timeTo100S: null,
  topSpeedKmh: 0,
  turnedDeg: 0,
};

/** Mean pitch over the frames where the car is really slowing (below {@link BRAKING_G}), or null. */
function dive(frames: readonly TelemetryFrame[]): null | number {
  const braking = frames.filter((frame) => frame.gLong < BRAKING_G && frame.brake > 0);

  return braking.length === 0 ? null : round(mean(braking.map((frame) => frame.pitch * RAD_TO_DEG)));
}

/** Longitudinal g below which the car counts as braking hard enough for its attitude to mean something. */
const BRAKING_G = -0.3;

/** The first braking run that actually reaches a stop: its distance, its time, and the speed it started at. */
function brakingRun(frames: readonly TelemetryFrame[]): null | { distanceM: number; fromKmh: number; seconds: number } {
  const start = frames.findIndex((frame) => frame.brake > 0 && frame.speed > STOPPED_SPEED);
  if (start === -1) {
    return null;
  }
  let distance = 0;
  for (let index = start + 1; index < frames.length; index += 1) {
    const dt = frames[index].t - frames[index - 1].t;
    distance += Math.abs(frames[index].speed) * dt;
    if (frames[index].speed <= STOPPED_SPEED) {
      return {
        distanceM: round(distance),
        fromKmh: round(frames[start].speed * MS_TO_KMH),
        seconds: round(frames[index].t - frames[start].t),
      };
    }
  }

  return null; // braked but never stopped inside the capture — not a distance anyone can compare
}

/** Arithmetic mean; 0 for an empty window. */
function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Middle value; 0 for an empty window. Used over the mean where one collision sample could drag it. */
function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function range(values: readonly number[]): PhysRange {
  return { max: round(Math.max(...values)), min: round(Math.min(...values)) };
}

/** Two decimals: a capture is compared against another capture, not read to float precision. */
function round(value: number): number {
  return Number(value.toFixed(2));
}
