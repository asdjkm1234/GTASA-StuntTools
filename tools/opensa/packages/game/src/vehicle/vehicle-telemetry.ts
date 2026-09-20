/**
 * Vehicle telemetry (plan 081/01): the instrument every later 081 plan tunes against, and the slip/speed
 * channel plan 080/05 (camera drift framing) consumes.
 *
 * Nothing here touches physics. The step's RAW readings come in as plain data ({@link VehicleSample} — the
 * caller reads them off the body and the raycast controller), the math is pure, and the result is one
 * {@link TelemetryFrame} per fixed step. That is what makes a baseline reproducible: the same sample sequence
 * always produces the same frames, in a unit test as in a scripted drive.
 *
 * Conventions, all GTA space (Z up, cars face +Y, +X is the car's right):
 * - **pitch** is positive NOSE UP. The chain's braking complaint ("the nose lifts instead of diving") is a
 *   sign on this channel, which is why it is the one number the baseline ledger must show.
 * - **roll** is positive with the RIGHT side down.
 * - **slip angle** is positive when the tail slides so the car points LEFT of where it travels.
 * - **g** is net acceleration (Δv/dt) in the body frame, in g. Gravity is NOT added: a car resting on its
 *   springs reads 0 vertical, a car in free fall reads −1.
 */
import type { VehicleWheelPlacement } from '../interfaces/world-adapter.interface';
import type { VehicleWheelReading } from '../physics/physics-world';

/** How slow (m/s) counts as "not really moving": below this the slip channels report 0 rather than noise. */
const SLIP_SPEED_FLOOR = 0.5;

/** How close to the car's centre line (m) a hub must sit to count as straddled — see {@link wheelCornerLabels}. */
const CENTRELINE_EPSILON = 0.05;

const GRAVITY = 9.81;

/** The car's planar motion against its own axes — see {@link planarMotion}. */
export interface PlanarMotion {
  /** Yaw about +Z (rad). */
  readonly heading: number;
  /** Where it travels vs where it points (rad), positive when the car points LEFT of its path. */
  readonly slipAngle: number;
  /** Signed forward speed (m/s). */
  readonly speed: number;
  /** Sideways speed (m/s), positive toward the car's right. */
  readonly speedLateral: number;
}

/** One fixed step of the active vehicle, everything derived. */
export interface TelemetryFrame {
  /** Total brake force applied this step (N), as `drive()` set it. */
  readonly brake: number;
  /** Total engine force applied this step (N), signed (negative = reverse). */
  readonly engineForce: number;
  /** The gearbox's gear this step: 0 = reverse, 1…n forward. */
  readonly gear: number;
  /** Net acceleration in the body frame, in g: lateral (+ = to the car's right). */
  readonly gLat: number;
  /** Longitudinal (+ = forward). */
  readonly gLong: number;
  /** Vertical (+ = up). Excludes gravity — see the module note. */
  readonly gVert: number;
  /** The LEVER is up. Its own channel because the handbrake sends NO brake force — it locks the rear axle
   *  inside the physics layer — so a reader watching `brake` alone cannot see it at all. */
  readonly handbrake: boolean;
  /** Yaw about +Z (rad). */
  readonly heading: number;
  /** Nose-up angle (rad), positive UP. */
  readonly pitch: number;
  /** Where the car WAS, world (GTA) space. Carried so a capture can say where something happened: a lap
   *  that reports a 100 g spike and cannot name the spot cannot say whether it hit a kerb or a wall. */
  readonly position: readonly [number, number, number];
  /** Right-side-down angle (rad). */
  readonly roll: number;
  /** Body slip angle (rad): where the car travels vs where it points. 0 under {@link SLIP_SPEED_FLOOR}. */
  readonly slipAngle: number;
  /** Mean longitudinal slip ratio over the wheels in contact — see {@link WheelFrame.slipRatio}. */
  readonly slipRatio: number;
  /** Signed forward speed (m/s), negative in reverse. */
  readonly speed: number;
  /** Sideways speed (m/s), positive toward the car's right. */
  readonly speedLateral: number;
  /** Front-wheel steer angle applied this step (rad). */
  readonly steer: number;
  /** Seconds since the capture started. */
  readonly t: number;
  /** Throttle input this step, −1..1. */
  readonly throttle: number;
  readonly wheels: readonly WheelFrame[];
  /** Yaw rate (rad/s) — the number a spin shows before the slip angle does. */
  readonly yawRate: number;
}

/** The raw step readings the sampler turns into a frame. Assembled by the caller from the body + controller. */
export interface VehicleSample {
  readonly brake: number;
  readonly engineForce: number;
  readonly gear: number;
  readonly handbrake: boolean;
  /** Linear velocity, world (GTA) space. */
  readonly linvel: readonly [number, number, number];
  /** Body orientation `[x, y, z, w]`. */
  readonly orientation: readonly [number, number, number, number];
  /** Body position, world (GTA) space. */
  readonly position: readonly [number, number, number];
  readonly steer: number;
  /** The SA surface id under each wheel, aligned with {@link VehicleSample.wheels} — a PARALLEL array
   *  because the wheel readings come back from Rapier verbatim and this one is ours (081/10). */
  readonly surfaces?: readonly (null | number)[];
  readonly throttle: number;
  readonly wheels: readonly VehicleWheelReading[];
}

/** One wheel's derived state. */
export interface WheelFrame {
  /** Suspension travel used, 0 (hanging) .. 1 (bottomed out). */
  readonly compression: number;
  readonly contact: boolean;
  /** Tyre force along the wheel this step (N·s, Rapier's impulse) — drive/brake grip actually delivered. */
  readonly forwardImpulse: number;
  /** Suspension force carried (N) — the corner's normal load. */
  readonly load: number;
  /** Tyre force across the wheel (N·s) — cornering grip actually delivered. */
  readonly sideImpulse: number;
  /**
   * Longitudinal slip ratio: `(wheelSurfaceSpeed − groundSpeed) / max(|groundSpeed|, floor)`. Positive =
   * the wheel is spinning faster than the road (wheelspin), negative = locked/dragging under brakes. 0
   * while the wheel is off the ground or the car is barely moving.
   */
  readonly slipRatio: number;
  /** WHAT the wheel is standing on: the SA surface id (081/10), or null in the air / on collision that
   *  carries no material. Reported only — nothing in the physics reads it yet. */
  readonly surface: null | number;
}

/**
 * The rolling capture: the last `capacity` frames, oldest first. A ring rather than a growing array because
 * a capture runs for minutes at 60 Hz and only the tail is ever read.
 */
export class TelemetryRing {
  get size(): number {
    return this.buffer.length;
  }
  private readonly buffer: TelemetryFrame[] = [];
  private readonly capacity: number;

  private next = 0;

  constructor(capacity: number) {
    this.capacity = Math.max(1, Math.floor(capacity));
  }

  clear(): void {
    this.buffer.length = 0;
    this.next = 0;
  }

  /** Every frame held, oldest → newest. */
  frames(): readonly TelemetryFrame[] {
    if (this.buffer.length < this.capacity) {
      return [...this.buffer];
    }

    return [...this.buffer.slice(this.next), ...this.buffer.slice(0, this.next)];
  }

  /** The newest frame, or null before the first push. */
  latest(): null | TelemetryFrame {
    if (this.buffer.length === 0) {
      return null;
    }

    return this.buffer[(this.next - 1 + this.buffer.length) % this.buffer.length];
  }

  push(frame: TelemetryFrame): void {
    if (this.buffer.length < this.capacity) {
      this.buffer.push(frame);
      this.next = this.buffer.length % this.capacity;

      return;
    }
    this.buffer[this.next] = frame;
    this.next = (this.next + 1) % this.capacity;
  }
}

/**
 * The stateful half: holds the previous sample, the clock and the ring. Disabled by default and inert then —
 * a disabled sampler does no math and keeps no history, so a shipped build pays nothing for it.
 */
export class VehicleTelemetry {
  enabled = false;

  private elapsed = 0;
  private previous: null | VehicleSample = null;
  private readonly ring: TelemetryRing;

  constructor(capacity = 600) {
    this.ring = new TelemetryRing(capacity);
  }

  frames(): readonly TelemetryFrame[] {
    return this.ring.frames();
  }

  latest(): null | TelemetryFrame {
    return this.ring.latest();
  }

  /** Drop the history and the clock — a new car, a new scenario, or the capture being switched on. */
  reset(): void {
    this.elapsed = 0;
    this.previous = null;
    this.ring.clear();
  }

  /** Fixed step: derive a frame, keep it, return it. Null while disabled. */
  step(sample: VehicleSample, dt: number): null | TelemetryFrame {
    if (!this.enabled) {
      return null;
    }
    this.elapsed += dt;
    const frame = computeFrame(sample, this.previous, dt, this.elapsed);
    // COPY the vectors, never keep the caller's arrays. `EnterableVehicle.orientation` is one long-lived
    // array the physics system overwrites in place every step, so holding the reference made `previous` and
    // `sample` the same numbers — and every rate derived from orientation read exactly 0. It cost a whole
    // sweep to notice: a u-turn capture reported `turnedDeg` 0.00 while the car was visibly going round.
    this.previous = {
      ...sample,
      linvel: [...sample.linvel],
      orientation: [...sample.orientation],
      position: [...sample.position],
    };
    this.ring.push(frame);

    return frame;
  }
}

/**
 * Turn one step's raw readings into a frame.
 *
 * `previous` is the sample from the step before (null on the first step — the rate channels then read 0,
 * which is honest: one sample cannot show a rate). `dt` is the fixed step in seconds.
 */
export function computeFrame(
  sample: VehicleSample,
  previous: null | VehicleSample,
  dt: number,
  t: number,
): TelemetryFrame {
  const forward = rotate(sample.orientation, 0, 1, 0);
  const right = rotate(sample.orientation, 1, 0, 0);
  const up = rotate(sample.orientation, 0, 0, 1);
  const motion = planarMotion(sample.orientation, sample.linvel);
  const { speed } = motion;
  const wheels = sample.wheels.map((wheel, index) =>
    wheelFrame(wheel, previous?.wheels[index] ?? null, speed, dt, sample.surfaces?.[index] ?? null),
  );
  const contacting = wheels.filter((wheel) => wheel.contact);

  return {
    brake: sample.brake,
    engineForce: sample.engineForce,
    gear: sample.gear,
    gLat: bodyAccel(sample, previous, dt, right),
    gLong: bodyAccel(sample, previous, dt, forward),
    gVert: bodyAccel(sample, previous, dt, up),
    handbrake: sample.handbrake,
    heading: motion.heading,
    pitch: Math.asin(clampUnit(forward[2])),
    // COPIED, never aliased: the caller hands the car's live position array, and a frame that kept the
    // reference would report the whole lap at wherever the car ended up (the same trap that made every
    // orientation-derived rate read 0 — see `step`).
    position: [sample.position[0], sample.position[1], sample.position[2]],
    // atan2 of the right axis against the up axis IS the roll about forward; negated so right-down is positive.
    roll: -Math.atan2(right[2], up[2]),
    slipAngle: motion.slipAngle,
    slipRatio: contacting.length === 0 ? 0 : mean(contacting.map((wheel) => wheel.slipRatio)),
    speed,
    speedLateral: motion.speedLateral,
    steer: sample.steer,
    t,
    throttle: sample.throttle,
    wheels,
    yawRate: previous === null ? 0 : yawRate(previous.orientation, sample.orientation, dt),
  };
}

/**
 * Where the car POINTS against where it TRAVELS — the whole of the slip channel, and the only part of a frame
 * a consumer outside a capture needs.
 *
 * Split out because the camera reads it every rendered frame (plan 080/05 drift framing) while a telemetry
 * CAPTURE is off: the ring and the derived per-wheel channels are the expensive half, this is four dot
 * products. One implementation means the camera and a capture can never disagree about which way a slide is
 * pointing.
 */
export function planarMotion(
  orientation: readonly [number, number, number, number],
  linvel: readonly [number, number, number],
): PlanarMotion {
  const forward = rotate(orientation, 0, 1, 0);
  const right = rotate(orientation, 1, 0, 0);
  const [vx, vy] = linvel;
  const speed = vx * forward[0] + vy * forward[1];
  const speedLateral = vx * right[0] + vy * right[1];

  return {
    heading: Math.atan2(-forward[0], forward[1]),
    // Below the floor a "slip angle" is just velocity noise being amplified by an atan2 near the origin.
    slipAngle: Math.hypot(vx, vy) < SLIP_SPEED_FLOOR ? 0 : Math.atan2(speedLateral, Math.abs(speed)),
    speed,
    speedLateral,
  };
}

/**
 * Which corner each wheel index is — `FL`, `RR`, and for a straddled wheel (a bike's) just `F`/`R`.
 *
 * A wheel index means nothing on its own: the order comes from the model's own hub dummies, so "wheel 2" is a
 * different corner on a different car. Every reader of a capture — the F2 tab, the `[phys]` JSON, a ledger
 * table — needs the same naming, so it is derived once here: the axle from the model's own front flag, the
 * side from the hub's x sign (the driver's side is −X).
 */
export function wheelCornerLabels(wheels: readonly VehicleWheelPlacement[]): string[] {
  return wheels.map((wheel) => {
    const axle = wheel.front ? 'F' : 'R';
    // A hub on the centre line (bike, quad's tail) has no side to report — pretending it does would print a
    // right wheel that no one can find on the car.
    if (Math.abs(wheel.connection[0]) < CENTRELINE_EPSILON) {
      return axle;
    }

    return `${axle}${wheel.connection[0] < 0 ? 'L' : 'R'}`;
  });
}

/** Net acceleration along a body axis, in g. */
function bodyAccel(
  sample: VehicleSample,
  previous: null | VehicleSample,
  dt: number,
  axis: readonly [number, number, number],
): number {
  if (previous === null || dt <= 0) {
    return 0;
  }
  const dx = sample.linvel[0] - previous.linvel[0];
  const dy = sample.linvel[1] - previous.linvel[1];
  const dz = sample.linvel[2] - previous.linvel[2];

  return (dx * axis[0] + dy * axis[1] + dz * axis[2]) / dt / GRAVITY;
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Rotate a model-space axis by the body quaternion `[x, y, z, w]`. */
function rotate(
  q: readonly [number, number, number, number],
  x: number,
  y: number,
  z: number,
): [number, number, number] {
  const [qx, qy, qz, qw] = q;
  // t = 2 * (q_vec × v), result = v + qw * t + q_vec × t
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);

  return [x + qw * tx + qy * tz - qz * ty, y + qw * ty + qz * tx - qx * tz, z + qw * tz + qx * ty - qy * tx];
}

/** How far the tyre's own surface speed has run away from the road's. */
function slipRatio(
  wheel: VehicleWheelReading,
  previous: null | VehicleWheelReading,
  groundSpeed: number,
  dt: number,
): number {
  if (previous === null || dt <= 0 || !wheel.contact || Math.abs(groundSpeed) < SLIP_SPEED_FLOOR) {
    return 0;
  }
  const surfaceSpeed = ((wheel.rotation - previous.rotation) / dt) * wheel.radius;

  return (surfaceSpeed - groundSpeed) / Math.abs(groundSpeed);
}

function wheelFrame(
  wheel: VehicleWheelReading,
  previous: null | VehicleWheelReading,
  groundSpeed: number,
  dt: number,
  surface: null | number,
): WheelFrame {
  // Rest length is full extension; the spring can only compress from there, up to its max travel.
  const travel = wheel.maxTravel > 0 ? (wheel.restLength - wheel.suspensionLength) / wheel.maxTravel : 0;

  return {
    compression: Math.min(1, Math.max(0, travel)),
    contact: wheel.contact,
    forwardImpulse: wheel.forwardImpulse,
    load: wheel.suspensionForce,
    sideImpulse: wheel.sideImpulse,
    slipRatio: slipRatio(wheel, previous, groundSpeed, dt),
    surface,
  };
}

/** Yaw rate from two orientations: the heading delta over dt, wrapped to the short way round. */
function yawRate(
  before: readonly [number, number, number, number],
  after: readonly [number, number, number, number],
  dt: number,
): number {
  if (dt <= 0) {
    return 0;
  }
  const from = rotate(before, 0, 1, 0);
  const to = rotate(after, 0, 1, 0);
  let delta = Math.atan2(-to[0], to[1]) - Math.atan2(-from[0], from[1]);
  delta = ((delta + Math.PI) % (2 * Math.PI)) - Math.PI;

  return (delta < -Math.PI ? delta + 2 * Math.PI : delta) / dt;
}
