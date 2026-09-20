/**
 * How much of its lock a car may actually use — the original's own speed-sensitive steering limiter.
 *
 * `CAutomobile::ProcessControl` (gta-reversed, `docs/links.md`) does this to the player's car every step:
 *
 * ```cpp
 * steerAngle = adhesive * traction * 4.0f * 4.0f / (speedForward * speedForward);
 * steerAngle = std::min(steerAngle, 1.0f);
 * steerAngle = std::asin(steerAngle) / DegreesToRadians(m_fSteeringLock);
 * // …forced back to 1.0 when countersteering a slide, or with the handbrake up
 * m_fSteerAngle *= steerAngle;
 * ```
 *
 * Read it as physics rather than as a tuning curve: a tyre can hold `μ × g` of lateral acceleration, a turn
 * at speed `v` and radius `r` demands `v² / r`, so the tightest turn the tyres allow grows with the square of
 * speed — and the wheel angle that asks for exactly that is what the `asin` returns. **The car is prevented
 * from asking for more grip than it has.** That is the difference between a car and a cursor: without it,
 * full lock at 100 km/h is a request the tyres answer by letting go, which is the "the car just snaps round"
 * complaint in one line.
 *
 * Two exemptions, both the original's and both important: **countersteering** (steering into a slide the car
 * is already in) gets the full lock back, because that is how a driver saves it; so does the **handbrake**,
 * because a handbrake turn is a deliberate slide.
 *
 * It replaces two fitted constants — a flat 0.6 of the authored lock and a 0.6 falloff toward top speed —
 * neither of which knew anything about grip.
 */

/** The original's `4.0f * 4.0f`, in the same place. */
const LOCK_NUMERATOR = 16;
/** Its physics rate: a "game unit" of speed is one metre per this many seconds. */
const SA_STEP = 1 / 50;
/**
 * Surface adhesion — a tyre on tarmac, straight out of the game's own data.
 *
 * `g_surfaceInfos.GetAdhesiveLimit` reads `data/surface.dat`, a 6×6 matrix of adhesion GROUPS, and
 * `data/surfinfo.dat` says which group each surface belongs to. Both files ship in the build and both are
 * unambiguous: `WHEELBASE` (the surface the tyres are, per surface.dat's own header note) is in group
 * `RUBBER`, `TARMAC` is in group `ROAD`, and the Road×Rubber cell is **4.5**.
 *
 * It was **1.0** here for one build, because it was guessed rather than looked up — and since the limiter
 * divides by the square of speed, guessing it 4.5× low left a car with 4.5× less steering than the original
 * gives it. The field caught it immediately ("still hard to turn in at speed"). At 4.5 the limiter allows the
 * FULL authored lock below about 65 km/h and 9.4° of a 35° lock at 100 km/h.
 *
 * **Now a fallback, not the answer** (081/10 step 5): the caller passes the adhesion its front wheels are
 * actually standing on, read from `surface.dat` through the surface under each wheel. This constant is what
 * a world without those files gets — and it is the same 4.5, so nothing moves when they are missing.
 */
const ROAD_ADHESION = 4.5;
/** Below this speed the limiter is meaningless (the formula divides by v²) and the car gets its full lock. */
const MIN_LIMITED_SPEED = 0.01;
/**
 * Lateral speed (m/s) past which the car counts as SLIDING, for the countersteer exemption.
 *
 * The original's `0.05f` is in GAME UNITS PER FRAME — × 50 = **2.5 m/s**, a genuine slide. This constant
 * shipped as 0.05 in m/s: 50× too sensitive, so the ORDINARY outward body slip of any corner at speed
 * (~0.5–1.5 m/s at 1–3° of slip) tripped the exemption within ~0.1 s and handed the driver FULL LOCK — the
 * limiter was effectively disabled in every real corner. A full keyboard press at 100+ km/h then buried the
 * front wheels at 30° (3–6× past saturation, with the `fTractionLoss` penalty and the scrub drag of a
 * near-sideways tyre): the "barely steers at speed" plow that survived a 7× grip range, a 2× gravity change
 * and the 081/09 assist — none of which could matter while the front was drowned in its own steering angle.
 * The same unit-class bug as `ROAD_ADHESION = 1` and the `×0.001` before it; found by the `sweeper` capture
 * showing `steer` at the FULL granted lock 0.2 s into a 1°-slip corner (081/09 ledger, 2026-07-27).
 */
const SLIDE_SPEED = 0.05 / SA_STEP;

/**
 * The live steering model of the driven car (096/02) — what a controller needs to turn a wanted wheel angle
 * into the `move.x` a player would hold.
 *
 * It has to be REPORTED rather than recomputed: `move.x` is not an angle. `drive()` multiplies it by the
 * authored `fSteeringLock` **and** by {@link steerLimit}, which needs the adhesion under the front wheels
 * (four rays, once per step), the traction, the speed and the sway. A second copy of that outside the enter/
 * exit system would be a second adhesion probe and a second chance to disagree with the tyres.
 */
export interface SteeringModel {
  /** The lock the limiter granted on the last driven step (rad): `move.x = −1` asks for exactly this, LEFT. */
  readonly lockRad: number;
  /** How fast the front wheels slew toward the commanded angle (rad/s) — the lag a controller must lead. */
  readonly slewRate: number;
  /** Current front-wheel angle (rad); POSITIVE steers the car LEFT (`drive()` negates `move.x` into it). */
  readonly steerAngle: number;
  /** Front-to-rear hub span (m) — the bicycle model's wheelbase, off the car's own wheel placements. */
  readonly wheelbase: number;
}

/** The share of its authored lock the car may use, 0..1. */
export function steerLimit(input: {
  /**
   * The adhesion the FRONT wheels are standing on (`surface.dat`'s rubber row: 4.5 tarmac, 3.2 grass/dirt,
   * 3.0 sand, 2.8 wet). Defaults to tarmac.
   *
   * It must be the SAME number the tyres are given, or the limiter hands out angles the grip cannot answer —
   * which is the mechanism behind three field rounds of "it will not turn in" (081/09). On grass it now
   * grants ~29 % less lock, because the tyre there has ~29 % less to give.
   */
  adhesion?: number;
  /** Handbrake up? A handbrake turn is a slide on purpose. */
  handbrake: boolean;
  /** Authored `fSteeringLock`, in DEGREES — the original divides by it, so a car with more lock keeps less. */
  lockDeg: number;
  /** Forward speed (m/s). */
  speed: number;
  /** Current front-wheel angle (rad), signed the way the car steers. */
  steerAngle: number;
  /** Lateral speed (m/s) in the car's own frame — positive to the car's right. */
  swaySpeed: number;
  /** `fTractionMultiplier` — the tyre's grip, the same number the wheels are given. */
  traction: number;
}): number {
  const { adhesion = ROAD_ADHESION, handbrake, lockDeg, speed, steerAngle, swaySpeed, traction } = input;
  if (Math.abs(speed) <= MIN_LIMITED_SPEED || lockDeg <= 0) {
    return 1;
  }
  // Countersteering: the wheel points against the way the car is sliding. Give the driver everything.
  if (handbrake || (steerAngle < 0 && swaySpeed > SLIDE_SPEED) || (steerAngle > 0 && swaySpeed < -SLIDE_SPEED)) {
    return 1;
  }
  // The original works in game units, where `traction` has already been scaled by 0.001; carrying that
  // through leaves the SI form below, in which nothing is hidden: grip over speed squared.
  const gameSpeed = speed * SA_STEP;
  const limit = (adhesion * traction * 0.001 * LOCK_NUMERATOR) / (gameSpeed * gameSpeed);
  if (limit >= 1) {
    return 1;
  }

  return Math.min(1, Math.asin(limit) / ((lockDeg * Math.PI) / 180));
}
