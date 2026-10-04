/**
 * What the driver may still do to a car that has left the ground — the original's own air control
 * (plan 081/06 §1).
 *
 * `CAutomobile::ProcessControl` (gta-reversed, `docs/links.md`) runs this on the PLAYER's car, and only once
 * every wheel has lost contact (`if (!pad || m_nNumContactWheels != 0 …) return`):
 *
 * ```cpp
 * float carWeightMult = 0.0007f;                       // 0.0025f for a monster truck
 * carWeightMult *= CStats::GetFatAndMuscleModifier(STAT_MOD_DRIVING_SKILL);
 * carWeightMult *= std::min(1.0f, 3000.0f / m_fTurnMass) * m_fTurnMass;
 *
 * if (pad->GetHandBrake()) {                           // YAW
 *     float dotTurnUp = DotProduct(m_vecTurnSpeed, GetUp());
 *     if (dotTurnUp < 0.02f && steerLeftRight < 0.0f || dotTurnUp > -0.02f && steerLeftRight > 0.0f)
 *         ApplyTurnForce(GetRight() * steerLeftRight * carWeightMult * CTimer::GetTimeStep(),
 *                        m_vecCentreOfMass + GetForward());
 * } else if (!pad->GetAccelerate()) {                  // ROLL
 *     … ApplyTurnForce(GetRight() * steerLeftRight * …, m_vecCentreOfMass + GetUp());
 * }
 * if (!pad->GetAccelerate()) {                         // PITCH
 *     … ApplyTurnForce(GetUp() * steerUpDown * …, m_vecCentreOfMass + GetForward());
 * }
 * ```
 *
 * and `CPhysical::ApplyTurnForce` ends in `m_vecTurnSpeed += CrossProduct(point, force) / m_fTurnMass`. The
 * lever arm is a UNIT body axis, so the whole thing collapses to an angular-velocity change of
 * `0.0007 × min(1, 3000 / turnMass) × input × timeStep` about an axis that falls out of the cross product —
 * which is why the code below builds the axis with a cross product too, rather than trusting a hand-derived
 * sign. **The turn mass cancels below 3000**: every ordinary car gets the same authority, and only the heavy
 * ones (a fire truck's 20 000) get proportionally less.
 *
 * Three deliberate differences from the original, each with its reason:
 *
 * - **Our pitch axis IS the throttle axis.** The original reads a separate `GetSteeringUpDown` and gates
 *   pitch on `!GetAccelerate()`; on this engine W/S is the only forward/back control there is, so keeping
 *   that gate would make pitch unreachable. The throttle is inert in the air anyway (a wheel with no load
 *   gets no engine force), so W/S is free to mean "nose up / nose down" there. Roll keeps its gate.
 * - **No driving-skill modifier.** `CStats` does not exist here; SA's own value for a fully-skilled player
 *   is 1.0, so this is the skilled-driver case.
 * - **Gravity.** This engine runs 9.81 where SA runs 20, so the same jump lasts about twice as long and the
 *   same angular acceleration buys about twice the rotation. The law is shipped at the original's strength
 *   and `?airCtl=<×>` scales it, because a fitted constant here would be guessing what the field wants.
 */
import type { Vec3 } from '../interfaces/world-adapter.interface';

/** The original's physics rate: a game unit of time is 1/50 s. Same constant as the steering limiter's. */
const SA_STEP = 1 / 50;
/**
 * The original's `0.0007f`, converted out of game units.
 *
 * SA integrates in frames of 1/50 s and stores `m_vecTurnSpeed` in radians per frame, so the per-frame
 * increment `0.0007 × timeStep` becomes an angular ACCELERATION of `0.0007 / (1/50)² = 1.75 rad/s²` per unit
 * of stick. (A monster truck authors `0.0025f` — 6.25 rad/s²; nothing in this engine is one yet.)
 */
const AIR_ANGULAR_ACCEL = 0.0007 / (SA_STEP * SA_STEP);
/**
 * The original's `0.02f` rate gate, in radians per second (`0.02 / (1/50)` = 1 rad/s).
 *
 * Read it as the original wrote it: the driver may not push an axis that is ALREADY turning fast the other
 * way. On yaw that works out as a genuine cap (the handbrake torque is negative about `up`, so the gate
 * closes once the car spins the way the stick asks); on pitch and roll the torque is positive about its axis,
 * so the same test blocks fighting an existing tumble instead. The asymmetry is the original's — kept rather
 * than tidied, because "tidying" it would silently change what a jump does.
 */
const AIR_RATE_LIMIT = 0.02 / SA_STEP;
/** `min(1, 3000 / turnMass)`: below this authored yaw inertia every car turns in the air alike. */
const TURN_MASS_REFERENCE = 3000;

export interface AirControlInput {
  /** Throttle held? The original's `GetAccelerate` — it suppresses ROLL (see the module note on pitch). */
  accelerating: boolean;
  /** Live angular velocity (world, rad/s) — the rate gates read it. */
  angular: Vec3;
  basis: CarBasis;
  /** Handbrake up? Then the steering yaws the car instead of rolling it, exactly as the original does. */
  handbrake: boolean;
  /** Pitch input, −1…1 — positive noses UP (W). */
  pitch: number;
  /** Field scale on the whole law (`?airCtl`); 1 is the original's strength. */
  scale: number;
  /** Steering input, −1…1 — positive is to the car's right, the same sign the wheels take. */
  steer: number;
  /** Fixed step (s). */
  step: number;
  /** Authored `fTurnMass` (kg·m²). */
  turnMass: number;
}

/** The car's world-space axes (unit vectors), straight off its body rotation. */
export interface CarBasis {
  forward: Vec3;
  right: Vec3;
  up: Vec3;
}

/**
 * The angular-velocity change (world, rad/s) this step's inputs earn a car that is off the ground — the
 * original adds it straight to `m_vecTurnSpeed`, so the caller adds it straight to the body's.
 *
 * Returns null when nothing applies (no input, or every axis gated), so a caller can skip the write.
 */
export function airAttitudeDelta(input: AirControlInput): null | Vec3 {
  const { accelerating, angular, basis, handbrake, pitch, scale, steer, step, turnMass } = input;
  const authority =
    AIR_ANGULAR_ACCEL * Math.min(1, TURN_MASS_REFERENCE / Math.max(turnMass, 1)) * step * Math.max(scale, 0);
  if (authority <= 0) {
    return null;
  }
  const delta: Vec3 = [0, 0, 0];
  // Handbrake YAWS (force to the side, applied ahead of the centre of mass); off the throttle the same stick
  // ROLLS instead (the same side force, applied above it). One or the other, never both — the original's
  // `else if`.
  if (handbrake) {
    addTurn(delta, basis.forward, basis.right, basis.up, steer, angular, authority);
  } else if (!accelerating) {
    addTurn(delta, basis.up, basis.right, basis.forward, steer, angular, authority);
  }
  // PITCH: an upward force ahead of the centre of mass. See the module note — this engine does not gate it
  // on the throttle, because on this control scheme the throttle IS the pitch axis.
  addTurn(delta, basis.forward, basis.up, basis.right, pitch, angular, authority);

  return delta[0] === 0 && delta[1] === 0 && delta[2] === 0 ? null : delta;
}

/**
 * A car's world axes from its body rotation `[x, y, z, w]` — the columns of the rotation matrix, in the
 * game's own frame (X right, Y forward, Z up). The original reads `GetRight()`/`GetForward()`/`GetUp()` off
 * its matrix for exactly this.
 */
export function carBasis(q: readonly [number, number, number, number]): CarBasis {
  const [x, y, z, w] = q;

  return {
    forward: [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
    right: [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
    up: [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)],
  };
}

/**
 * One `ApplyTurnForce`: a force along `axis` applied at `lever` (both unit body axes), gated on how fast the
 * car already turns about `gate`. The rotation axis comes out of the cross product, never out of a
 * hand-derived sign.
 */
function addTurn(
  out: Vec3,
  lever: Vec3,
  axis: Vec3,
  gate: Vec3,
  input: number,
  angular: Vec3,
  authority: number,
): void {
  if (input === 0) {
    return;
  }
  const rate = dot(angular, gate);
  if (!((rate < AIR_RATE_LIMIT && input < 0) || (rate > -AIR_RATE_LIMIT && input > 0))) {
    return;
  }
  const scaled = input * authority;
  out[0] += (lever[1] * axis[2] - lever[2] * axis[1]) * scaled;
  out[1] += (lever[2] * axis[0] - lever[0] * axis[2]) * scaled;
  out[2] += (lever[0] * axis[1] - lever[1] * axis[0]) * scaled;
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
