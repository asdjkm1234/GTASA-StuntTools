/**
 * The autopilot (096/02): a closed-loop {@link InputState} that drives a 096/01 route the way a calm driver
 * would — pure pursuit on the driven line for the wheel, a PI on the route's own per-vertex target speeds for
 * the pedals, and nothing the player's own path does not already do.
 *
 * It is a SIBLING of `ScriptedDriveSource`, never a change to the driving path: it emits a `move` vector and
 * the same `drive()` a player feeds turns that into engine force, brake and a slewed steering angle. Neutral
 * while idle, so the host can leave one installed for good and it only speaks while a scene runs.
 *
 * Two things make it a controller and not a reaction — both the 080/081 lesson that a SLEWED actuator cannot
 * be chased with gain (`STEER_RATE` is 1.2 rad/s, and the granted lock shrinks with speed):
 *  - the lookahead grows with speed, so the wheel is asked for the angle the car is about to need;
 *  - the command is then recomputed against the pose the car will HAVE once the wheels finish slewing to it.
 *
 * Everything it needs about the car arrives through two thin accessors, so it couples to no system: where the
 * car is, and what its steering can currently do ({@link SteeringModel} — `move.x` is a SHARE of a lock that
 * changes every step, not an angle).
 */
import type { InputState, LookDelta, MoveVector } from '../input/input-state';
import type { Route, RoutePoint } from '../paths/route-builder';
import type { SteeringModel } from './steering';

/** What the autopilot needs to know about the car it is driving — supplied at construction, never imported. */
export interface PathFollowDeps {
  /** The driven car's pose right now, or null when nobody is driving. */
  pose(): null | VehiclePose;
  /** The driven car's live steering model, or null when nobody is driving. */
  steering(): null | SteeringModel;
}

/** Where a run stands: nothing asked · driving · at the last vertex · wedged and reporting it. */
export type PathFollowState = 'arrived' | 'following' | 'idle' | 'stuck';

export interface VehiclePose {
  /** Yaw about GTA +Z (rad), 0 = facing +Y; INCREASING heading turns LEFT. */
  readonly heading: number;
  /** World position, native GTA Z-up. */
  readonly position: readonly [number, number, number];
  /** Signed forward speed (m/s). */
  readonly speed: number;
}

/** How close to the final vertex counts as done (m) — a route ends at a junction, not at a parking space. */
const ARRIVE_M = 8;
/** The deceleration the speed plan brakes at (m/s²) — calm, and well inside what the brakes can do. */
const BRAKE_DECEL = 3;
/** Extra bearing per metre of lateral offset (rad/m). Small on purpose: pure pursuit does the real work, and
 *  a strong cross-track term is exactly the gain that makes a slewed wheel weave. */
const CROSS_GAIN = 0.05;
/** Ceiling on that term (rad) — a car shoved off the line still turns back at a driver's angle, not a jerk. */
const CROSS_MAX = 0.15;
/** How far the cursor may walk in one step (vertices) — a teleport must not drag it along the whole route. */
const CURSOR_STEP_MAX = 32;
/** Below this the command is dither on a straight, not steering. */
const DEADBAND = 0.02;
/** Ceiling on the lead time (s): past it the prediction is guessing at a pose two corners away. */
const LEAD_MAX_S = 0.4;
const LOOKAHEAD_MAX = 25;
const LOOKAHEAD_MIN = 6;
/** Seconds of travel the pursuit aims ahead — the anticipation, and the one knob that trades cut for wobble. */
const LOOKAHEAD_TIME = 0.9;
/** The speed plan always looks at least this far ahead (m), so a stopped car still sees the corner it is on. */
const MIN_HORIZON = 10;
/** A chord shorter than this is the route's own last metre; treat it as this long rather than divide by ~0. */
const MIN_CHORD = 1;
/** How long the run may make no progress under throttle before it is called wedged (s). */
const STUCK_SECONDS = 3;
/** The integral that removes the standing error a proportional pedal alone leaves on a long straight. */
const THROTTLE_I = 0.08;
const THROTTLE_I_MAX = 1;
/** Pedal per m/s of speed error. Deliberately gentle: the bicycle sweep moved corner-entry speed by only
 *  0.4 m/s between gains of 0.5 and 1.2, so gain buys almost nothing here and a twitchy pedal costs the
 *  calm-cruise look. What actually brakes early is the horizon, not this. */
const THROTTLE_P = 0.8;

const NEUTRAL: MoveVector = { x: 0, y: 0 };

export class PathFollowSource implements InputState {
  private cursor = 0;
  private readonly deps: PathFollowDeps;
  /** Signed lateral offsets from the line, one per step since {@link follow} — the acceptance instrument. */
  private errors: number[] = [];
  private integral = 0;
  private lastHeading = 0;
  private moveVector: MoveVector = NEUTRAL;
  private phase: PathFollowState = 'idle';
  /** The furthest vertex the run has reached — the stuck test's only signal (see {@link advance}). */
  private reached = 0;
  private route: null | Route = null;
  private stuckFor = 0;

  constructor(deps: PathFollowDeps) {
    this.deps = deps;
  }

  /**
   * Compute this step's controls. Driven by the FIXED step, before anything reads the input — the same
   * contract the scripted timeline runs under, and for the same reason: a controller sampling wall time
   * would drive differently on a slower machine.
   */
  advance(dt: number): void {
    this.moveVector = NEUTRAL;
    const route = this.route;
    if (this.phase !== 'following' || route === null || dt <= 0) {
      return;
    }
    const pose = this.deps.pose();
    const steering = this.deps.steering();
    // Nobody is driving (or the car has no steering to command): go quiet, exactly like a released key. The
    // run is NOT failed — the scene owner decides what a car that vanished mid-drive means.
    if (pose === null || steering === null || steering.lockRad <= 0 || steering.wheelbase <= 0) {
      return;
    }
    const points = route.points;
    this.cursor = advanceCursor(points, this.cursor, pose.position);
    const final = points[points.length - 1].position;
    if (this.cursor >= points.length - 1 || planarDistance(final, pose.position) <= ARRIVE_M) {
      this.phase = 'arrived';

      return;
    }
    const yawRate = wrapAngle(pose.heading - this.lastHeading) / dt;
    this.lastHeading = pose.heading;
    const offset = lateralOffset(points[this.cursor].position, points[this.cursor + 1].position, pose);
    this.errors.push(offset);

    // The wheel. Pass one asks what the car needs now; the lead is how long the slew takes to deliver that,
    // and pass two asks the same question of the pose the car will be in by then.
    const lookahead = clamp(LOOKAHEAD_TIME * Math.abs(pose.speed), LOOKAHEAD_MIN, LOOKAHEAD_MAX);
    const aim = pointAhead(points, this.cursor, lookahead);
    const raw = wheelAngle(pose, aim, offset, steering.wheelbase);
    const lead = Math.min(LEAD_MAX_S, Math.abs(raw - steering.steerAngle) / steering.slewRate);
    const wanted = wheelAngle(predict(pose, yawRate, lead), aim, offset, steering.wheelbase);
    const steer = clamp(-wanted / steering.lockRad, -1, 1);

    // The pedals. The plan looks a braking distance ahead, so the car is already slow when the corner
    // arrives rather than braking in it (which is where a calm cruise turns into a slide).
    const target = targetSpeed(points, this.cursor, pose.speed);
    const error = target - pose.speed;
    const throttle = clamp(THROTTLE_P * error + this.integral, -1, 1);
    if (Math.abs(throttle) < 1) {
      this.integral = clamp(this.integral + THROTTLE_I * error * dt, -THROTTLE_I_MAX, THROTTLE_I_MAX);
    }

    // Wedged = making no PROGRESS under throttle, not "moving slowly under throttle". The first version
    // tested the speed, and a scene that started on an 18° Los Santos hill rolled BACKWARDS at 1-2 m/s under
    // full throttle for 13 s before it tripped — thirteen seconds of a car failing to climb, on camera. The
    // cursor only ever walks forward, so this one signal covers rolling back, spinning on the spot and
    // sitting against a wall.
    if (this.cursor > this.reached) {
      this.reached = this.cursor;
      this.stuckFor = 0;
    } else if (throttle > 0.5) {
      this.stuckFor += dt;
      if (this.stuckFor >= STUCK_SECONDS) {
        this.phase = 'stuck';

        return;
      }
    }
    this.moveVector = { x: Math.abs(steer) < DEADBAND ? 0 : steer, y: throttle };
  }

  consumeLook(): LookDelta {
    return { x: 0, y: 0 };
  }

  consumeZoom(): number {
    return 0;
  }

  /** Signed lateral offsets from the line since {@link follow} (m, positive = the line is to the car's left). */
  errorSamples(): readonly number[] {
    return this.errors;
  }

  /** Take the wheel on `route`. A route of fewer than two vertices is already arrived, never followed. */
  follow(route: Route): void {
    this.route = route;
    this.cursor = 0;
    this.reached = 0;
    this.errors = [];
    this.integral = 0;
    this.lastHeading = this.deps.pose()?.heading ?? 0;
    this.moveVector = NEUTRAL;
    this.phase = route.points.length >= 2 ? 'following' : 'arrived';
    this.stuckFor = 0;
  }

  /** No actions in v1: no handbrake, no jump, no door — the autopilot only steers and uses the pedals. */
  isActive(): boolean {
    return false;
  }

  move(): MoveVector {
    return this.moveVector;
  }

  /** How far along the route the car has come, 0..1 — what a scene reports while it runs. */
  progress(): number {
    const points = this.route?.points.length ?? 0;

    return points < 2 ? 0 : this.cursor / (points - 1);
  }

  state(): PathFollowState {
    return this.phase;
  }

  /**
   * Go quiet and hand the car back.
   *
   * The route and the samples are KEPT: a scene stops the autopilot and then reports what it did, and the
   * first version cleared the route here — so every capture stated `progress: 0` for a run that had just
   * driven 400 m. {@link follow} is what clears them, at the start of the next run.
   */
  stop(): void {
    this.moveVector = NEUTRAL;
    this.phase = 'idle';
  }
}

/**
 * Walk the cursor forward while the next vertex is nearer than the current one.
 *
 * Strictly monotone and one vertex at a time ON PURPOSE: taking the nearest vertex inside a window would let
 * a route that loops back past the car (SA's grid streets do that well inside one route's length) hand the
 * cursor to a segment the car has not driven yet.
 */
function advanceCursor(
  points: readonly RoutePoint[],
  cursor: number,
  position: readonly [number, number, number],
): number {
  let at = cursor;
  let distance = planarDistance(points[at].position, position);
  for (let step = 0; step < CURSOR_STEP_MAX && at + 1 < points.length; step += 1) {
    const next = planarDistance(points[at + 1].position, position);
    if (next > distance) {
      break;
    }
    at += 1;
    distance = next;
  }

  return at;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Signed lateral offset of the segment from the car (m), positive when the line lies to the car's LEFT — the
 * cross-track error, and the sign the steering correction is added with.
 */
function lateralOffset(
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  pose: VehiclePose,
): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const span = Math.hypot(dx, dy);
  const t =
    span < 1e-6
      ? 0
      : clamp(((pose.position[0] - from[0]) * dx + (pose.position[1] - from[1]) * dy) / (span * span), 0, 1);
  const nearest: readonly [number, number] = [from[0] + dx * t, from[1] + dy * t];

  return leftOf(pose.heading, nearest[0] - pose.position[0], nearest[1] - pose.position[1]);
}

/** How far to the LEFT of the car's facing a world offset lies (m) — the cross product of forward with it. */
function leftOf(heading: number, dx: number, dy: number): number {
  return -Math.sin(heading) * dy - Math.cos(heading) * dx;
}

function planarDistance(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/**
 * The point `distance` metres further along the line. The route is resampled at a uniform step (096/01), so
 * this is an index walk from the cursor, never a search — which is also why the spacing is read off the line
 * instead of assumed.
 */
function pointAhead(
  points: readonly RoutePoint[],
  cursor: number,
  distance: number,
): readonly [number, number, number] {
  let walked = 0;
  for (let index = cursor + 1; index < points.length; index += 1) {
    walked += planarDistance(points[index - 1].position, points[index].position);
    if (walked >= distance) {
      return points[index].position;
    }
  }

  return points[points.length - 1].position;
}

/** Where the car will be in `lead` seconds at this speed and this yaw rate (a first-order carry-forward). */
function predict(pose: VehiclePose, yawRate: number, lead: number): VehiclePose {
  return {
    heading: pose.heading + yawRate * lead,
    position: [
      pose.position[0] - Math.sin(pose.heading) * pose.speed * lead,
      pose.position[1] + Math.cos(pose.heading) * pose.speed * lead,
      pose.position[2],
    ],
    speed: pose.speed,
  };
}

/**
 * The fastest the car may be going HERE and still meet every vertex inside the braking horizon at that
 * vertex's own target speed (`v² = u² + 2as`). The horizon is the distance the car needs to shed its speed,
 * so it grows with speed — a corner is seen from further out when there is further to brake from.
 */
function targetSpeed(points: readonly RoutePoint[], cursor: number, speed: number): number {
  const horizon = Math.max(MIN_HORIZON, (speed * speed) / (2 * BRAKE_DECEL));
  let target = points[cursor].speed;
  let travelled = 0;
  for (let index = cursor + 1; index < points.length && travelled < horizon; index += 1) {
    travelled += planarDistance(points[index - 1].position, points[index].position);
    target = Math.min(target, Math.sqrt(points[index].speed * points[index].speed + 2 * BRAKE_DECEL * travelled));
  }

  return target;
}

/**
 * Pure pursuit: the front-wheel angle whose arc passes through the aim point, plus the cross-track nudge.
 * Positive is a LEFT turn, the sign the car's own `steerAngle` carries.
 */
function wheelAngle(
  pose: VehiclePose,
  aim: readonly [number, number, number],
  offset: number,
  wheelbase: number,
): number {
  const dx = aim[0] - pose.position[0];
  const dy = aim[1] - pose.position[1];
  const chord = Math.max(MIN_CHORD, Math.hypot(dx, dy));
  const along = -Math.sin(pose.heading) * dx + Math.cos(pose.heading) * dy;
  const bearing = Math.atan2(leftOf(pose.heading, dx, dy), along) + clamp(CROSS_GAIN * offset, -CROSS_MAX, CROSS_MAX);

  return Math.atan(((2 * Math.sin(bearing)) / chord) * wheelbase);
}

/** An angle difference folded back into (−π, π] — a heading that crossed the wrap is not a spin. */
function wrapAngle(angle: number): number {
  return angle - 2 * Math.PI * Math.round(angle / (2 * Math.PI));
}
