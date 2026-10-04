/**
 * Frame-rate-independent smoothing (plan 080/01). The camera steps in the VARIABLE-rate part of the host
 * loop, so a smoothing term must land in the same place whether the frame took 4 ms or 40 ms — a per-frame
 * lerp constant does not, it just makes the camera lazier on a fast machine.
 *
 * Two primitives, because they ease differently:
 * - {@link damp} carries one number of state and starts moving IMMEDIATELY, settling softly (pitch, FOV,
 *   distance).
 * - {@link smoothDamp} carries a velocity, so it eases IN as well as out — the "massy" feel (yaw catch-up,
 *   position lag, look-ahead).
 */
import { clamp, euclideanModulo, lerp } from './math-utils';

const TWO_PI = Math.PI * 2;
/** Below this a smooth time is meaningless (it would divide by ~0) — one frame at 10 kHz. */
const MIN_SMOOTH_TIME = 1e-4;

/** Shortest signed angle from `current` to `target`, in [−π, π) — so a spring never unwinds the long way. */
export const angleDelta = (current: number, target: number): number =>
  euclideanModulo(target - current + Math.PI, TWO_PI) - Math.PI;

/** Velocity carried between {@link smoothDamp} calls. Caller-owned, so this module stays stateless. */
export interface SmoothDampRef {
  velocity: number;
}

/**
 * Exponential approach: `current` moves a fixed FRACTION of the remaining error per second, so N steps of
 * dt land where one step of N·dt does.
 *
 * `lambda` is per second and reads as a half-life: `t½ = ln2 / λ` (λ = 7 ⇒ half the error gone every 0.1 s).
 * `λ = Infinity` snaps (the legacy-parity setting), `λ ≤ 0` never moves.
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  // A NaN lambda (a slider mid-edit) would poison the whole rig — it stands still instead.
  if (dt <= 0 || lambda <= 0 || Number.isNaN(lambda)) {
    return current;
  }

  return lambda === Number.POSITIVE_INFINITY ? target : lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** {@link damp} over an angle: the error is wrapped first, so π−ε → −π+ε is a short hop, not a full lap. */
export function dampAngle(current: number, target: number, lambda: number, dt: number): number {
  return damp(current, current + angleDelta(current, target), lambda, dt);
}

/**
 * Critically damped spring (the Unity / Game Programming Gems form): reaches `target` in about `smoothTime`
 * seconds without overshooting, easing at BOTH ends.
 *
 * `ref.velocity` is stepped in place — one ref per channel, owned by the rig state. `maxSpeed` caps how fast
 * the value may travel (units per second); pass `Infinity` for no cap.
 *
 * Only APPROXIMATELY frame-rate independent (the exponential is a rational approximation) — its tests pin how
 * approximate, so a regression is visible.
 */
export function smoothDamp(
  current: number,
  target: number,
  ref: SmoothDampRef,
  smoothTime: number,
  maxSpeed: number,
  dt: number,
): number {
  if (dt <= 0) {
    return current;
  }
  const time = Math.max(MIN_SMOOTH_TIME, smoothTime);
  const omega = 2 / time;
  const x = omega * dt;
  const decay = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const maxDelta = maxSpeed * time;
  const error = clamp(current - target, -maxDelta, maxDelta);
  // The goal the clamped error implies — with an uncapped speed this is `target` itself.
  const goal = current - error;
  const temp = (ref.velocity + omega * error) * dt;
  ref.velocity = (ref.velocity - omega * temp) * decay;
  const output = goal + (error + temp) * decay;
  // Overshoot guard: crossing the target means the discrete step outran the spring — land ON it instead.
  if (target - current > 0 === output > target) {
    ref.velocity = 0;

    return target;
  }

  return output;
}

/** {@link smoothDamp} over an angle: wraps the error into [−π, π) first (see {@link angleDelta}). */
export function smoothDampAngle(
  current: number,
  target: number,
  ref: SmoothDampRef,
  smoothTime: number,
  maxSpeed: number,
  dt: number,
): number {
  return smoothDamp(current, current + angleDelta(current, target), ref, smoothTime, maxSpeed, dt);
}
