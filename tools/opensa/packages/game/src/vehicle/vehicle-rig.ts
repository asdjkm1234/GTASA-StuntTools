import type { AxleSetup, VehicleHandling, VehicleWheelPlacement } from '../interfaces/world-adapter.interface';
import type { VehicleHandle } from './vehicle-handle';

/** Smoothing rate (1/s) for the drawn suspension travel — a raycast length jitters by millimetres on a
 *  trimesh, and drawn raw it reads as a vibrating wheel (plan 081/06 §3.5). Runs in the FIXED step (this
 *  class is updated there), so the response is frame-rate independent. */
const LIFT_SMOOTHING = 25;
/**
 * How much an INDEPENDENT wheel leans per metre it stands proud of its axle partner (rad/m) — the one
 * fitted number in this file, and it is fitted to real suspensions rather than to a car.
 *
 * A road car's independent geometry gains roughly a degree of negative camber per 40 mm of compression;
 * 0.44 rad/m is that. It applies to the wheel's travel RELATIVE TO ITS AXLE PARTNER, not to an absolute rest
 * length: the rig is fed hub offsets, whose rest value is the standing pose of a car it does not know. The
 * price is stated plainly — a symmetric bump (both wheels compressing together) draws no camber here where a
 * real wishbone would gain some. In a corner, which is what the field brief is about, the two are the same.
 *
 * The original's own rule for these flags is NOT in the reversed source (nothing in gta-reversed reads
 * `AXLE_*`), so this is ours until it is; the solid-axle rule below needs no constant at all.
 */
const INDEPENDENT_CAMBER_GAIN = 0.44;
/** Below this track width (m) the two wheels are effectively in the same place and the solid-axle tilt would
 *  blow up. A model that authors it has no axle to speak of. */
const MIN_TRACK = 0.1;
/** The original's physics rate: a game unit of time is 1/50 s. Same constant as the steering limiter's. */
const SA_STEP = 1 / 50;
/**
 * What a wheel with NOTHING under it does — the original's own rule, and the reason a car on a ramp spins
 * its driven wheels while the rest free-wheel to a stop.
 *
 * `CAutomobile::ProcessCarWheelPair` ends with this, per wheel, when `m_WheelCounts[i] <= 0` (no contact
 * that frame):
 *
 * ```cpp
 * if (driveWheels && acceleration != 0.0f) {
 *     if (acceleration > 0.0f) { if (m_wheelSpeed[i] <  1.0f) m_wheelSpeed[i] -= 0.1f;  }
 *     else                     { if (m_wheelSpeed[i] > -1.0f) m_wheelSpeed[i] += 0.05f; }
 * } else {
 *     m_wheelSpeed[i] *= 0.95f;
 * }
 * m_wheelRotation[i] += CTimer::GetTimeStep() * m_wheelSpeed[i];
 * ```
 *
 * The signs are the same as ours (forward roll is negative), and the `±1.0` test is the original's usual
 * shape: not a cap on how fast the wheel may spin, but a refusal to push against a wheel already spinning
 * hard the other way. Converted out of game units: **250 rad/s² forward, 125 rad/s² backward**, and the gate
 * sits at 50 rad/s. Only DRIVEN wheels spin up; every other airborne wheel decays at 0.95 per 1/50 s.
 */
const AIR_SPIN_UP = 0.1 / (SA_STEP * SA_STEP);
const AIR_SPIN_UP_REVERSE = 0.05 / (SA_STEP * SA_STEP);
const AIR_SPIN_GATE = 1 / SA_STEP;
const AIR_SPIN_DECAY = 0.95;
/**
 * How fast retractable headlights travel, in fractions of their arc per second — 0.7 s from parked to up.
 *
 * The one number here the game does not supply: SA has no pop-up animation at all (the ZR-350's pod is a
 * plain `misc_a` component the original never moves), so there is no timing to reproduce, only a real motor
 * to be plausible against — those take about a second. Stated as a visual choice, not a measurement.
 */
const POPUP_SPEED = 1 / 0.7;

/** What the rig needs to know about the car's suspension to LEAN its wheels (plan 081/06 §3). */
export interface VehicleRigSetup {
  /** The authored axle builds (`handling.cfg`'s `modelFlags`). */
  axles: { front: AxleSetup; rear: AxleSetup };
  /** `nDriveType` — which wheels the engine can spin when they have nothing under them. */
  drive: VehicleHandling['drive'];
  /** Wheel hubs in vehicle space, in the SAME order as the handle's wheels — the x sign says which side a
   *  wheel is on, and a pair's separation is the track width the solid-axle tilt divides by. */
  wheels: readonly VehicleWheelPlacement[];
}

/** One wheel's camber geometry, resolved at build time — see {@link resolveAxles}. */
interface ResolvedAxle {
  /** The pair's LEFT wheel index (its −X side) and its right one: `lift[left] − lift[right]` is the rise. */
  left: number;
  right: number;
  /** `REVERSE` on the authored axle — the model's wheel dummies are mirrored, so the lean flips. */
  sign: number;
  solid: boolean;
  /** Track width (m) — the solid tilt divides by it. */
  track: number;
}

/**
 * Animates a vehicle's wheels: rolls them from the travelled distance, steers the front pair, slides each
 * wheel with its suspension and LEANS it the way its axle is built (plan 081/06 §3).
 * Driving (speed + steer) is fed in via {@link setSpeed} / {@link setSteer}; the per-wheel physics offset
 * from the model hub via {@link setLift}.
 *
 * Pure arithmetic since B5 step 3 — it emits POSES through the {@link VehicleHandle}; turning them into
 * quaternions/matrices is the renderer's business.
 */
export class VehicleRig {
  /** How far the pop-up pods stand open, 0 (parked in the nose) … 1 (facing the road). The lamps read it:
   *  a pod car may not light until the pods are all the way up. */
  get popUpTravel(): number {
    return this.popUp;
  }
  /** Per-wheel drawn roll (rad) — per WHEEL since 081/06, because a wheel in the air no longer turns with
   *  the car (see {@link AIR_SPIN_UP}). */
  private readonly angle: number[];
  /** Per-wheel camber geometry, resolved ONCE (see {@link resolveAxles}) — this runs for every wheel of
   *  every live car on every fixed step, and none of it can change while the car exists. */
  private readonly axles: readonly (null | ResolvedAxle)[];
  /** Which wheels are touching anything. Empty until the physics feeds it — and then every wheel counts as
   *  grounded, which is what the rig did before it could tell. */
  private contacts: readonly boolean[] = [];
  /** Which wheels the engine turns (`nDriveType`); empty without a setup, and then nothing spins in the air. */
  private readonly driven: readonly boolean[];
  private readonly handle: VehicleHandle;
  /** Smoothed per-wheel hub offsets (m). Null until the first {@link setLift} SEEDS it — easing in from
   *  zero would visibly drop every car onto its suspension on spawn. */
  private lift: null | number[] = null;
  private liftTarget: number[] = [];

  /** Drawn pop-up-headlight travel, 0 (parked) … 1 (up), and where it is heading. */
  private popUp = 0;
  private popUpTarget = 0;
  private speed = 0;
  private steerAngle = 0;
  /** What the engine is pulling with (N, signed) — SA's `acceleration`, and the only thing that spins a
   *  wheel with nothing under it. Zero while coasting or braking, so a free wheel then just runs down. */
  private thrust = 0;
  /** Per-wheel roll RATE (rad/s). Kept across the transition so a wheel that spun up in the air does not
   *  snap to the car's speed the instant it lands — it is overwritten by the road, not reset. */
  private readonly wheelSpeed: number[];

  constructor(handle: VehicleHandle, setup: null | VehicleRigSetup = null) {
    this.handle = handle;
    this.axles = resolveAxles(handle, setup);
    this.angle = handle.wheels.map(() => 0);
    this.wheelSpeed = handle.wheels.map(() => 0);
    this.driven = setup ? handle.wheels.map((wheel) => driveReaches(setup.drive, wheel.front)) : [];
  }

  /** Which wheels are touching anything, from the raycast controller (plan 081/06 — the airborne spin). */
  setContacts(contacts: readonly boolean[]): void {
    this.contacts = contacts;
  }

  /** Per-wheel offset from the model hub (m, negative = dropped), from the physics suspension length. */
  setLift(values: readonly number[]): void {
    this.liftTarget = [...values];
    this.lift ??= [...values];
  }

  /** Whether this car's retractable headlights should be up — the same signal that lights its lamps. */
  setPopUpLights(open: boolean): void {
    this.popUpTarget = open ? 1 : 0;
  }

  /** Forward speed (units/s) that rolls the wheels. */
  setSpeed(speed: number): void {
    this.speed = speed;
  }

  /** Front-wheel steering angle (radians). */
  setSteer(angle: number): void {
    this.steerAngle = angle;
  }

  /** Engine force this step (N, signed) — only the DRIVEN car's, and only the drivetrain's own output. */
  setThrust(force: number): void {
    this.thrust = force;
  }

  update(delta: number): void {
    const blend = Math.min(1, LIFT_SMOOTHING * delta);
    if (this.lift !== null) {
      this.lift.forEach((current, index) => {
        (this.lift as number[])[index] = current + ((this.liftTarget[index] ?? current) - current) * blend;
      });
    }
    this.movePopUpLights(delta);
    this.handle.wheels.forEach((wheel, index) => {
      this.rollWheel(index, wheel.radius, delta);
      this.handle.setWheel(index, {
        camber: this.camberOf(index),
        lift: this.lift?.[index] ?? 0,
        spin: this.angle[index],
        steer: wheel.front ? this.steerAngle : 0,
      });
    });
  }

  /**
   * How far wheel `index` leans (rad, positive = its top toward the car's +X side), from the axle it is on.
   *
   * - **SOLID**: the axle is one beam, so both its wheels take the same tilt — `atan(Δlift / track)`, pure
   *   geometry with nothing fitted. This is the loud one: it is what a pickup's rear end does in a corner.
   * - **MCPHERSON / independent**: the wheel leans with its own travel relative to its partner, the
   *   compressed one gaining negative camber (top inward) — see {@link INDEPENDENT_CAMBER_GAIN}.
   * - **NOTILT**: zero. Bikes, and anything the artist froze.
   * - **REVERSE**: the sign flips, because the model's wheel dummies are mirrored.
   *
   * Zero whenever the car was built without a setup, or the wheel has no partner on its axle (a three-wheeler,
   * or a model whose dummies did not pair) — an unknown axle must not invent a lean.
   */
  private camberOf(index: number): number {
    const axle = this.axles[index];
    if (axle === null || this.lift === null) {
      return 0;
    }
    const { left, right, sign, solid, track } = axle;
    const rise = (this.lift[left] ?? 0) - (this.lift[right] ?? 0);
    if (solid) {
      // One beam: both wheels stay square to it, so relative to the BODY they take the body's own roll back
      // out — `atan(Δ / track)` is exactly that angle. A pickup's rear wheels stay upright while its body
      // leans over them, which is the thing the field brief's screenshot shows.
      return sign * Math.atan2(rise, track);
    }
    // Independent: each wheel leans with its travel relative to its partner — the compressed one takes its
    // top inward, the drooping one lets it out, which comes to the same angle about the car's forward axis
    // for both. Same direction as the solid rule and a fraction of its size: camber gain only PARTLY answers
    // a rolling body, where a solid axle answers it entirely.

    return sign * INDEPENDENT_CAMBER_GAIN * (rise / 2);
  }

  /** Ease the pop-up pods toward their target, and only speak to the handle when the pose actually moved —
   *  every car runs this every step, and most of them have no pods at all. */
  private movePopUpLights(delta: number): void {
    if (this.popUp === this.popUpTarget) {
      return;
    }
    const step = POPUP_SPEED * delta;
    this.popUp =
      this.popUpTarget > this.popUp
        ? Math.min(this.popUpTarget, this.popUp + step)
        : Math.max(this.popUpTarget, this.popUp - step);
    this.handle.setPopUpLights(this.popUp);
  }

  /**
   * Advance one wheel's drawn roll.
   *
   * On the ground the wheel turns with the CAR — its real planar displacement, which is immune to the phantom
   * velocity the raycast controller writes while resting, so parked cars keep their wheels still. Off the
   * ground it turns with the ENGINE instead, by the original's rule (see {@link AIR_SPIN_UP}) — which is the
   * whole point: a driven wheel with nothing under it spins up, and every other one runs down.
   */
  private rollWheel(index: number, radius: number, delta: number): void {
    // No contact data yet (a rig built without a setup, or before the first physics step) → treat the wheel
    // as grounded, which is exactly what this class did before it could tell the difference.
    const grounded = this.contacts.length === 0 || (this.contacts[index] ?? true);
    if (grounded) {
      this.wheelSpeed[index] = -this.speed / radius; // negative so a positive speed rolls the top forward
    } else if (this.driven[index] && this.thrust !== 0) {
      // The original's gate is not a speed cap: it refuses to push a wheel that already spins hard the other
      // way. Under a held throttle the wheel therefore keeps winding up, which is what a blurred wheel is.
      if (this.thrust > 0) {
        if (this.wheelSpeed[index] < AIR_SPIN_GATE) {
          this.wheelSpeed[index] -= AIR_SPIN_UP * delta;
        }
      } else if (this.wheelSpeed[index] > -AIR_SPIN_GATE) {
        this.wheelSpeed[index] += AIR_SPIN_UP_REVERSE * delta;
      }
    } else {
      this.wheelSpeed[index] *= Math.pow(AIR_SPIN_DECAY, delta / SA_STEP);
    }
    this.angle[index] += this.wheelSpeed[index] * delta;
  }
}

/** Whether the engine reaches this wheel — `nDriveType`, the same test `setVehicleControls` makes. */
function driveReaches(drive: VehicleHandling['drive'], front: boolean): boolean {
  return drive === '4' || (drive === 'F') === front;
}

/**
 * Resolve every wheel's camber geometry ONCE: which pair it belongs to, how wide that pair is, and which of
 * the two rules it takes. Null for a wheel that must not lean — no setup, a NOTILT axle, no partner on the
 * other side (a three-wheeler, or dummies that did not pair), or a track too narrow to divide by.
 *
 * It lives here rather than in `camberOf` because none of it can change while the car exists, and `camberOf`
 * runs for every wheel of every live car on every fixed step: the bench's 80 cars made that 0.4 µs per car
 * per step of pure re-derivation (081/07 §1's bench comparison).
 */
function resolveAxles(handle: VehicleHandle, setup: null | VehicleRigSetup): readonly (null | ResolvedAxle)[] {
  return handle.wheels.map((_, index) => {
    const wheel = setup?.wheels[index];
    if (!setup || !wheel) {
      return null;
    }
    const axle = handle.wheels[index].front ? setup.axles.front : setup.axles.rear;
    if (axle.type === 'notilt') {
      return null;
    }
    // The partner is the nearest wheel on the OTHER side of the car — by |Δy|, so a tandem rear axle pairs
    // with its own row rather than with the one behind it.
    let partner = -1;
    let nearest = Infinity;
    setup.wheels.forEach((candidate, other) => {
      if (other === index || Math.sign(candidate.connection[0]) === Math.sign(wheel.connection[0])) {
        return;
      }
      const distance = Math.abs(candidate.connection[1] - wheel.connection[1]);
      if (distance < nearest) {
        nearest = distance;
        partner = other;
      }
    });
    if (partner < 0) {
      return null;
    }
    const track = Math.abs(wheel.connection[0] - setup.wheels[partner].connection[0]);
    if (track < MIN_TRACK) {
      return null;
    }
    const toRight = wheel.connection[0] > setup.wheels[partner].connection[0];

    return {
      left: toRight ? partner : index,
      right: toRight ? index : partner,
      sign: axle.reverse ? -1 : 1,
      solid: axle.type === 'solid',
      track,
    };
  });
}
