/**
 * The drivetrain — a translation of the original game's own transmission (plan 081/04).
 *
 * What stood here before was `engineForce = mass × engineAccel × 0.28`, one number, constant from a standing
 * start to the speed limiter. It moved the car and it had no character: no gears, no falling thrust, nothing
 * to hear or feel in the acceleration. Worse, it had no air drag at all, so the ONLY thing stopping any car
 * was a hard speed cap — a 6.5 t fire truck pulled 7.6 m/s² at 140 km/h exactly as it did at walking pace.
 *
 * The original does none of that, and it is not complicated — it is `cTransmission::InitGearRatios` and
 * `cTransmission::CalculateDriveAcceleration` (gta-reversed, `docs/links.md`), translated here line for line:
 *
 * - **Gears split the speed range** into bands, with hysteresis (change-up at 2/3 of a band, change-down at
 *   0.42) so the box does not hunt at a band edge.
 * - **Thrust falls with the gear.** First gear pulls 4× what top gear pulls — `1 + 3 × (1 − (g−1)/(n−1))²` —
 *   which is what makes a car feel like it has a gearbox rather than a linear motor.
 * - **`engineInertia` shapes each shift.** The original tracks how far through its band the car is and damps
 *   the thrust by the CHANGE in that fraction, so crossing into a new gear costs a moment of push. That is
 *   the "breathing" in SA acceleration, and it comes free with the formula.
 * - **Thrust stops at the gear ceiling.** The original also carries a short taper just above each gear's own
 *   ceiling; it is translated here for fidelity, but it is worth knowing that the way the bands are built
 *   makes it unreachable — every gear's change-up point sits BELOW its ceiling, so the box always shifts
 *   before the taper could bite, and the reverse case is cut off by the same guard that ends this function.
 *   What actually limits a car is drag against the falling top-gear thrust.
 * - **Air drag is what limits top speed**: `a = dragMult × v² / 2000` (`CPhysical::ApplyAirResistance` with
 *   `airResistance = dragMult / 2000`). The engine pulls until drag matches it. `fMaxVelocity` is only the
 *   upper bound of a SEARCH for that balance point — see {@link buildGearbox}.
 *
 * Units are SI throughout (m, m/s, m/s²). The original works in "game units" of metres per 1/50 s, and every
 * conversion constant that implies is named below rather than pre-multiplied into a magic number.
 */
import type { VehicleHandling } from '../interfaces/world-adapter.interface';

/** What one step of the drivetrain produced. */
export interface DriveOutput {
  /** Longitudinal acceleration the engine asks for (m/s², signed). */
  readonly accel: number;
  /** The gear it ended in — write it back to the state. */
  readonly gear: number;
}

/** The gearbox's live state. Two of the three fields exist only to shape shifts — see {@link driveAcceleration}. */
export interface DrivetrainState {
  /** How far through its band the car was last step (the original's `a6`). */
  bandFraction: number;
  /** Current gear: 0 = reverse, 1…count forward. */
  gear: number;
  /** The smoothed thrust factor carried between steps (the original's `a7`). */
  thrustFactor: number;
}

/** A car's gearbox, built once from its handling row. */
export interface Gearbox {
  /** Number of forward gears (`nNumberOfGears`). */
  readonly count: number;
  /** The drag-limited top speed on the flat (m/s) — what the car actually does, not what its row claims. */
  readonly flatTop: number;
  /** Reverse first, then gears 1…count. */
  readonly gears: readonly TransmissionGear[];
  /** The gear ceiling (m/s): `flatTop × 1.2`, the original's `m_MaxVelocity` — a car going downhill may
   *  exceed its flat top, and the top gear's band has to have somewhere to put it. */
  readonly maxSpeed: number;
  /** Top reverse speed (m/s, negative). */
  readonly reverseSpeed: number;
}

/** One gear's speed band (m/s). Index 0 of a {@link Gearbox} is reverse, so these can be negative. */
export interface TransmissionGear {
  /** Below this speed the box shifts down. */
  readonly changeDown: number;
  /** Above this speed the box shifts up. */
  readonly changeUp: number;
  /** The gear's ceiling — thrust fades to nothing within {@link GEAR_TAPER_SPEED} above it. */
  readonly maxSpeed: number;
}

/** The original's physics rate: one "game unit" of speed is one metre per this many seconds. */
const SA_STEP = 1 / 50;
/** `fMaxVelocity` is km/h (the file's own legend says so, and `VELOCITY_CONST` confirms it). */
const KMH_TO_MS = 1 / 3.6;
/** `CalculateDriveAcceleration`'s literal `0.4f` on the engine term. */
const DRIVE_FORCE_FRACTION = 0.4;
/** First gear pulls `1 + GEAR_BOOST` times what top gear pulls. (The 1G/2G handling flags raise this to 4
 *  and 5; those flags are not parsed yet, so every car gets the default 3 — noted, not silently dropped.) */
const GEAR_BOOST = 3;
/** Reverse gets a flat multiplier instead of a band position. */
const REVERSE_SPEED_MULTIPLIER = 4.5;
/** Thrust fades to zero within this much (m/s) above a gear's ceiling — the original's `0.05f` game units. */
const GEAR_TAPER_SPEED = 0.05 / SA_STEP;
/** How much of last step's thrust factor carries over (`TRANSMISSION_SMOOTHER_FRAC`). */
const INERTIA_SMOOTHER = 0.85;
/** The floor under the inertia damping — a shift costs thrust, never all of it. */
const MIN_THRUST_FACTOR = 0.1;
/** Airborne wheels: the engine revs freely and pushes almost nothing (`TRANSMISSION_FREE_ACCELERATION`). */
const FREE_ACCELERATION = 0.1;
/** `CVehicle::GetDefaultAirResistance` — drag deceleration is `dragMult × v² / DRAG_DIVISOR`. */
const DRAG_DIVISOR = 2000;
/** Below this the row means "no meaningful drag", and the original switches to a different curve. */
const DRAG_EPSILON = 0.01;
/** The search accepts a speed once drag has eaten this share of the engine's pull. */
const ENGINE_LIMIT_DIVISOR = 6;
/** The gear ceiling sits this far above the flat top (`m_MaxVelocity = maxVelocity * 1.2f`). */
const GEAR_CEILING = 1.2;
/** Reverse tops out at this share of the flat top… */
const REVERSE_SHARE = 0.3;
/** …but never less than this (m/s) — the original's `-0.2f` game units. */
const MIN_REVERSE_SPEED = 0.2 / SA_STEP;
/** The search walks down in these steps (the original's `0.01f` game units). */
const SEARCH_STEP = 0.01 / SA_STEP;
/** Four-wheel drive splits the engine four ways, everything else two. */
const DRIVE_DIVISOR_4WD = 4;
const DRIVE_DIVISOR_2WD = 2;

/**
 * Build a car's gearbox from its handling row.
 *
 * The interesting part is that **`fMaxVelocity` is not the top speed**. The original walks DOWN from it until
 * air drag has eaten a sixth of the engine's pull, and calls the speed it lands on the flat top — so a car
 * with a big number and a draggy body never sees that number, while a slippery one reaches its row exactly.
 * The walk is reproduced rather than solved in closed form, because the second branch (rows with almost no
 * drag) is a different curve and the discretisation is part of the answer.
 */
export function buildGearbox(handling: VehicleHandling): Gearbox {
  const authored = handling.maxVelocity * KMH_TO_MS;
  const engineLimit = handling.engineAccel / ENGINE_LIMIT_DIVISOR;
  let flatTop = authored;
  while (flatTop > 0) {
    flatTop -= SEARCH_STEP;
    if (handling.dragMult >= DRAG_EPSILON) {
      if (dragDeceleration(handling.dragMult, flatTop) <= engineLimit) {
        break;
      }
      continue;
    }
    // The near-zero-drag branch, in the original's own units: drag as a per-step velocity multiplier.
    const gameSpeed = flatTop * SA_STEP;
    const decel = (1 - 1 / (gameSpeed * gameSpeed * handling.dragMult + 1)) * gameSpeed;
    if (decel / (SA_STEP * SA_STEP) <= engineLimit) {
      break;
    }
  }
  flatTop = Math.max(flatTop, SEARCH_STEP);

  return {
    count: handling.gears,
    flatTop,
    gears: gearBands(flatTop * GEAR_CEILING, handling.gears, -Math.max(flatTop * REVERSE_SHARE, MIN_REVERSE_SPEED)),
    maxSpeed: flatTop * GEAR_CEILING,
    reverseSpeed: -Math.max(flatTop * REVERSE_SHARE, MIN_REVERSE_SPEED),
  };
}

/** A fresh gearbox state: first gear, nothing carried over. */
export function createDrivetrainState(): DrivetrainState {
  return { bandFraction: 0, gear: 1, thrustFactor: 1 };
}

/** Air drag as a deceleration (m/s², positive) at this speed. Mass-free: it is an acceleration in the
 *  original too, applied straight to the velocity. */
export function dragDeceleration(dragMult: number, speed: number): number {
  return (dragMult * speed * speed) / DRAG_DIVISOR;
}

/**
 * One step of the drivetrain: shift if the speed has left the current gear's band, then work out what the
 * engine pulls (m/s²). `state` is MUTATED — the shift shaping is a running quantity, not a pure function of
 * the current speed, and pretending otherwise would cost the very effect it exists for.
 *
 * `throttle` is −1…1 (the original's gas pedal); `grounded` is whether the driven wheels can push at all.
 */
export function driveAcceleration(
  box: Gearbox,
  handling: VehicleHandling,
  state: DrivetrainState,
  input: { grounded: boolean; speed: number; step: number; throttle: number },
): DriveOutput {
  const { grounded, speed, step, throttle } = input;
  if (speed < box.reverseSpeed || speed > box.maxSpeed) {
    return { accel: 0, gear: state.gear };
  }
  let gear = state.gear;
  let shaped = grounded;
  // The original re-shifts inside one call until it finds a gear that can pull, and after the first pass it
  // drops the shift shaping (`a6`/`a7` go null) — so a car that has to hunt gets the raw thrust.
  for (let guard = 0; guard <= box.count + 1; guard++) {
    const gearBand = box.gears[gear];
    if (speed > gearBand.changeUp) {
      if (gear === 0 && throttle <= 0) {
        return thrust(box, handling, state, { gear, shaped, speed, step, throttle });
      }
      gear = Math.min(gear + 1, box.count);
    } else if (speed >= gearBand.changeDown || gear === 0 || (gear === 1 && throttle >= 0)) {
      return thrust(box, handling, state, { gear, shaped, speed, step, throttle });
    } else {
      gear = Math.max(gear - 1, 0);
    }
    shaped = false;
  }

  return { accel: 0, gear };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * Airborne (or mid-hunt): the engine revs against nothing. The original does NOT damp the thrust here — it
 * only winds the band fraction forward so that the wheels landing again cost a beat of thrust, which is
 * exactly what dropping a revving car onto its wheels should feel like.
 */
function freeRev(handling: VehicleHandling, state: DrivetrainState, input: { step: number; throttle: number }): number {
  state.bandFraction = Math.min(
    state.bandFraction +
      ((Math.abs(input.throttle) / handling.engineInertia) * input.step * FREE_ACCELERATION) / SA_STEP,
    1,
  );
  state.thrustFactor = MIN_THRUST_FACTOR;

  return 1;
}

/** `InitGearRatios`, verbatim: bands with change-up at 2/3 and change-down at 0.42 of the band below. */
function gearBands(maxSpeed: number, count: number, reverseSpeed: number): TransmissionGear[] {
  const halfBand = (0.5 * maxSpeed) / count;
  const topBand = maxSpeed - halfBand;
  const bands: { changeDown: number; changeUp: number; maxSpeed: number }[] = Array.from({ length: count + 1 }, () => ({
    changeDown: 0,
    changeUp: 0,
    maxSpeed: 0,
  }));
  for (let i = 1; i <= count; i++) {
    bands[i].maxSpeed = (i * topBand) / count + halfBand;
    const span = bands[i].maxSpeed - bands[i - 1].maxSpeed;
    if (i >= count) {
      bands[i].changeUp = maxSpeed;
    } else {
      bands[i + 1].changeDown = 0.42 * span + bands[i - 1].maxSpeed;
      bands[i].changeUp = 0.6667 * span + bands[i - 1].maxSpeed;
    }
  }
  bands[0] = { changeDown: reverseSpeed, changeUp: -0.01 / SA_STEP, maxSpeed: reverseSpeed };
  bands[1] = { ...bands[1], changeDown: -0.01 / SA_STEP };

  return bands;
}

/** `1 + 3 × (1 − (g−1)/(n−1))²` for a forward gear; the flat reverse multiplier for gear 0. */
function gearMultiplier(box: Gearbox, gear: number): number {
  if (box.count === 1) {
    return 1;
  }
  if (gear < 1) {
    return REVERSE_SPEED_MULTIPLIER;
  }
  const position = 1 - (gear - 1) / (box.count - 1);

  return position * position * GEAR_BOOST + 1;
}

/**
 * The shift shaping, grounded: how far the car is through its gear's band, damped by the CHANGE in that
 * fraction since last step. Crossing a band edge makes the fraction jump backwards, the damping bites, and
 * the thrust dips for a moment — that dip is the whole point, and it is `engineInertia`'s only job here.
 *
 * The original takes the raw per-frame delta at its own 50 Hz. Ours is scaled to that rate so the dip has
 * the same depth whatever fixed step this engine runs at.
 */
function shapeThrust(
  box: Gearbox,
  handling: VehicleHandling,
  state: DrivetrainState,
  input: { gear: number; speed: number; step: number },
): number {
  const { gear, speed, step } = input;
  const bandStep = box.maxSpeed / box.count / 3;
  let position = 0;
  let span = 0;
  if (gear >= 1) {
    const band = box.gears[gear];
    position = gear === 1 ? bandStep + speed : speed - band.changeDown;
    span = gear === 1 ? bandStep + box.gears[1].changeUp : band.changeUp - band.changeDown;
  } else {
    position = bandStep - speed;
    span = bandStep - box.gears[0].changeDown;
  }
  const fraction = span === 0 ? 0 : position / span;
  const change = (fraction - state.bandFraction) * (SA_STEP / step);
  const damped = clamp(1 - change * handling.engineInertia, MIN_THRUST_FACTOR, 1);
  state.bandFraction = fraction;
  state.thrustFactor = damped * (1 - INERTIA_SMOOTHER) + INERTIA_SMOOTHER * state.thrustFactor;

  return state.thrustFactor;
}

/** Thrust fades to nothing within {@link GEAR_TAPER_SPEED} above the gear's ceiling — vestigial in the
 *  original (see the file header) and kept only so this stays a translation rather than an interpretation. */
function taper(box: Gearbox, gear: number, speed: number): number {
  const ceiling = box.gears[gear].maxSpeed;
  const over = ceiling >= 0 ? speed - ceiling : ceiling - speed;
  if (over <= 0) {
    return 1;
  }

  return 1 - Math.min(over / GEAR_TAPER_SPEED, 1);
}

/** The thrust for a gear that can pull: gear multiplier × engine, shaped by inertia, tapered at the ceiling. */
function thrust(
  box: Gearbox,
  handling: VehicleHandling,
  state: DrivetrainState,
  input: { gear: number; shaped: boolean; speed: number; step: number; throttle: number },
): DriveOutput {
  const { gear, shaped, speed, step, throttle } = input;
  const divisor = handling.drive === '4' ? DRIVE_DIVISOR_4WD : DRIVE_DIVISOR_2WD;
  const engine = (gearMultiplier(box, gear) * handling.engineAccel * DRIVE_FORCE_FRACTION * throttle) / divisor;
  const factor = shaped
    ? shapeThrust(box, handling, state, { gear, speed, step })
    : freeRev(handling, state, { step, throttle });

  return { accel: engine * factor * taper(box, gear, speed), gear };
}
