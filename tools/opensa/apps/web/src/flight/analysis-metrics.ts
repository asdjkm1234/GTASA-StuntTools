/**
 * Derived flight metrics for the replay analysis HUD.
 *
 * Everything here is computed ONCE per track from the recorded samples and their own timestamps, so the
 * numbers do not depend on the replay clock, the render rate or the scrub position. The parent can pause,
 * scrub or run at 4x and the reported ground speed / g-force / angular rate stay identical.
 *
 * Deliberate sources:
 * - ground speed and climb rate are position/time derivatives (NOT the recorded `vx/vy/vz`, which is what
 *   the requirement asks for and which also survives files where velocity was not captured);
 * - g-force is the velocity/time derivative plus gravity, expressed in g (level flight = 1.0);
 * - angular rate is the quaternion difference between neighbouring samples, in the body frame.
 */
import type { FlightRow, FlightTrack } from './csv';
import { conjugate, quatMultiply, rotateVec, type Quat, type Vec3 } from './math';

const GRAVITY = 9.80665;
const RAD_TO_DEG = 180 / Math.PI;
const DEFAULT_DT = 0.04;

export type AttitudeSource = 'orientation';

/** One derived frame. Angles are degrees, rates are degrees/second, speeds are world units (metres)/second. */
export interface FlightMetrics {
  readonly s: number;
  readonly model: number;
  readonly altitude: number;
  readonly groundSpeed: number;
  readonly climbRate: number;
  readonly airSpeed: number;
  readonly heading: number;
  readonly pitch: number;
  readonly roll: number;
  readonly throttle: number;
  readonly brake: number;
  readonly health: number;
  readonly gForce: number;
  readonly angularRate: number;
  readonly rollRate: number;
  readonly pitchRate: number;
  readonly yawRate: number;
}

export interface FlightAnalysisBounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface FlightAnalysis {
  readonly track: FlightTrack;
  readonly rows: readonly FlightMetrics[];
  readonly bounds: FlightAnalysisBounds;
  readonly duration: number;
  readonly maxGroundSpeed: number;
  readonly maxAltitude: number;
  readonly minAltitude: number;
  readonly maxGForce: number;
  readonly maxAngularRate: number;
  readonly attitudeSource: AttitudeSource;
}

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));

const subtract = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const length3 = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);

function centralIndices(count: number, index: number): { prev: number; next: number } {
  return { prev: index > 0 ? index - 1 : index, next: index < count - 1 ? index + 1 : index };
}

/** Position-based velocity at a row (the ground-speed source) — independent of recorded `vx/vy/vz`. */
function positionVelocity(rows: readonly FlightRow[], index: number): Vec3 {
  const { prev, next } = centralIndices(rows.length, index);
  const dt = rows[next].s - rows[prev].s;
  if (dt <= 0) {
    return [0, 0, 0];
  }

  return [
    (rows[next].pos[0] - rows[prev].pos[0]) / dt,
    (rows[next].pos[1] - rows[prev].pos[1]) / dt,
    (rows[next].pos[2] - rows[prev].pos[2]) / dt,
  ];
}

/** Acceleration from the recorded velocity when it was captured, else from the position derivative. */
function accelerationAt(rows: readonly FlightRow[], index: number, useRecordedVelocity: boolean): Vec3 {
  const { prev, next } = centralIndices(rows.length, index);
  const dt = rows[next].s - rows[prev].s;
  if (dt <= 0) {
    return [0, 0, 0];
  }
  const a: Vec3 = useRecordedVelocity
    ? [
      (rows[next].velocity[0] - rows[prev].velocity[0]) / dt,
      (rows[next].velocity[1] - rows[prev].velocity[1]) / dt,
      (rows[next].velocity[2] - rows[prev].velocity[2]) / dt,
    ]
    : [
      (positionVelocity(rows, next)[0] - positionVelocity(rows, prev)[0]) / dt,
      (positionVelocity(rows, next)[1] - positionVelocity(rows, prev)[1]) / dt,
      (positionVelocity(rows, next)[2] - positionVelocity(rows, prev)[2]) / dt,
    ];

  return a;
}

/** Body-frame angular velocity (rad/s) from the rotation taking `prev` to `next`. */
function angularVelocity(prev: Quat, next: Quat, dt: number): Vec3 {
  if (dt <= 0) {
    return [0, 0, 0];
  }
  let dq = quatMultiply(conjugate(prev), next);
  if (dq[3] < 0) {
    dq = [-dq[0], -dq[1], -dq[2], -dq[3]];
  }
  const w = clamp(dq[3], -1, 1);
  const angle = 2 * Math.acos(w);
  const sinHalf = Math.sqrt(Math.max(0, 1 - w * w));
  const axis: Vec3 = sinHalf < 1e-6 ? [0, 0, 0] : [dq[0] / sinHalf, dq[1] / sinHalf, dq[2] / sinHalf];
  const rate = angle / dt;

  return [axis[0] * rate, axis[1] * rate, axis[2] * rate];
}

function attitude(q: Quat): { heading: number; pitch: number; roll: number } {
  const forward = rotateVec(q, [0, 1, 0]);
  const up = rotateVec(q, [0, 0, 1]);
  const right = rotateVec(q, [1, 0, 0]);
  // Engine local axes: X=right, Y=forward, Z=up. Heading 0 = north (−Z), increasing clockwise (east).
  const heading = (Math.atan2(forward[0], -forward[2]) * RAD_TO_DEG + 360) % 360;
  const pitch = Math.asin(clamp(forward[1], -1, 1)) * RAD_TO_DEG;
  // Positive roll = right wing down.
  const roll = Math.atan2(-right[1], up[1]) * RAD_TO_DEG;

  return { heading, pitch, roll };
}

/** Analyse one track once; the parent caches the result and samples it per frame. */
export function analyzeTrack(track: FlightTrack): FlightAnalysis {
  const rows = track.rows;
  const count = rows.length;
  const useRecordedVelocity = rows.some((row) => length3(row.velocity) > 0.5);
  const metrics: FlightMetrics[] = [];

  let minAlt = Infinity;
  let maxAlt = -Infinity;
  let maxGround = 0;
  let maxG = 0;
  let maxAngular = 0;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < count; i += 1) {
    const row = rows[i];
    const { prev, next } = centralIndices(count, i);
    const dt = Math.max(1e-6, rows[next].s - rows[prev].s || DEFAULT_DT);
    const velocity = positionVelocity(rows, i);
    const groundSpeed = Math.hypot(velocity[0], velocity[1]);
    const climbRate = velocity[2];
    const acceleration = accelerationAt(rows, i, useRecordedVelocity);
    // Specific force = a − gravity (gravity = −9.80665 on GTA's +Z up axis); level flight = 1 g.
    const gForce = Math.hypot(acceleration[0], acceleration[1], acceleration[2] + GRAVITY) / GRAVITY;
    const omega = angularVelocity(rows[prev].orientation, rows[next].orientation, dt);
    const rollRate = omega[1] * RAD_TO_DEG;
    const pitchRate = omega[0] * RAD_TO_DEG;
    const yawRate = omega[2] * RAD_TO_DEG;
    const angularRate = Math.hypot(omega[0], omega[1], omega[2]) * RAD_TO_DEG;
    const angles = attitude(row.orientation);

    metrics.push({
      s: row.s,
      model: row.model,
      altitude: row.pos[2],
      groundSpeed,
      climbRate,
      airSpeed: length3(velocity),
      heading: angles.heading,
      pitch: angles.pitch,
      roll: angles.roll,
      throttle: row.throttle,
      brake: row.brake,
      health: row.health,
      gForce,
      angularRate,
      rollRate,
      pitchRate,
      yawRate,
    });

    minAlt = Math.min(minAlt, row.pos[2]);
    maxAlt = Math.max(maxAlt, row.pos[2]);
    maxGround = Math.max(maxGround, groundSpeed);
    maxG = Math.max(maxG, gForce);
    maxAngular = Math.max(maxAngular, angularRate);
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis], row.pos[axis]);
      max[axis] = Math.max(max[axis], row.pos[axis]);
    }
  }

  if (count === 0) {
    minAlt = 0;
    maxAlt = 0;
  }

  return {
    track,
    rows: metrics,
    bounds: { min, max },
    duration: track.duration,
    maxGroundSpeed: maxGround,
    maxAltitude: maxAlt,
    minAltitude: minAlt,
    maxGForce: maxG,
    maxAngularRate: maxAngular,
    attitudeSource: 'orientation',
  };
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  const delta = ((b - a + 540) % 360) - 180;

  return (a + delta * t + 360) % 360;
}

/** Sample precomputed metrics at `s` seconds (replay-time independent — pure interpolation). */
export function sampleAnalysis(analysis: FlightAnalysis, s: number): FlightMetrics | null {
  const rows = analysis.rows;
  if (rows.length === 0) {
    return null;
  }
  const clamped = clamp(s, 0, analysis.duration);
  if (clamped <= rows[0].s) {
    return rows[0];
  }
  const last = rows[rows.length - 1];
  if (clamped >= last.s) {
    return last;
  }
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].s <= clamped) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const a = rows[lo];
  const b = rows[hi];
  const t = (clamped - a.s) / Math.max(1e-6, b.s - a.s);

  return {
    s: clamped,
    model: a.model,
    altitude: lerp(a.altitude, b.altitude, t),
    groundSpeed: lerp(a.groundSpeed, b.groundSpeed, t),
    climbRate: lerp(a.climbRate, b.climbRate, t),
    airSpeed: lerp(a.airSpeed, b.airSpeed, t),
    heading: lerpAngle(a.heading, b.heading, t),
    pitch: lerp(a.pitch, b.pitch, t),
    roll: lerp(a.roll, b.roll, t),
    throttle: lerp(a.throttle, b.throttle, t),
    brake: lerp(a.brake, b.brake, t),
    health: lerp(a.health, b.health, t),
    gForce: lerp(a.gForce, b.gForce, t),
    angularRate: lerp(a.angularRate, b.angularRate, t),
    rollRate: lerp(a.rollRate, b.rollRate, t),
    pitchRate: lerp(a.pitchRate, b.pitchRate, t),
    yawRate: lerp(a.yawRate, b.yawRate, t),
  };
}

/** The final sample a track contributes to the endpoint heatmap: the last row with a usable pose. */
export function finalValidSample(track: FlightTrack): FlightRow | null {
  for (let i = track.rows.length - 1; i >= 0; i -= 1) {
    const row = track.rows[i];
    if (row.pos.every(Number.isFinite) && Number.isFinite(row.health) && Number.isFinite(row.model)) {
      return row;
    }
  }

  return track.rows.length > 0 ? track.rows[track.rows.length - 1] : null;
}
