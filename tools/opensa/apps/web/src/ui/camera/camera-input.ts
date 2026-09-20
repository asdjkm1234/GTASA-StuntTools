/**
 * Look-input dampening (plan 080/02, behaviour #11): raw pointer deltas feel cheap because a flick lands as
 * one hard step. This spreads each flick over a few frames WITHOUT losing any of it.
 *
 * The distinction that matters: dampened ≠ laggy. Every pixel the player moved is eventually applied — the
 * pending pool only redistributes it in time — so the total rotation of a gesture equals the total mouse
 * travel exactly, as it does with raw input. `camera-input.test.ts` asserts that conservation.
 */
import { damp } from '@opensa/math';

/** Unapplied pointer travel, in pixels. Owned by the rig state, stepped in place. */
export interface LookInputState {
  pendingX: number;
  pendingY: number;
}

export function createLookInput(): LookInputState {
  return { pendingX: 0, pendingY: 0 };
}

/**
 * Add this frame's raw deltas to the pool and release the damped share of it.
 *
 * `smoothTime` is the pool's half-life-ish constant in seconds (lambda = 1/smoothTime): 0 releases
 * everything immediately — raw pointer input, which is what the debug slider at 0 gives.
 */
export function releaseLook(
  state: LookInputState,
  rawX: number,
  rawY: number,
  smoothTime: number,
  dt: number,
): { x: number; y: number } {
  state.pendingX += rawX;
  state.pendingY += rawY;
  if (smoothTime <= 0 || dt <= 0) {
    const whole = { x: state.pendingX, y: state.pendingY };
    state.pendingX = 0;
    state.pendingY = 0;

    return whole;
  }
  // damp(0, pending, …) IS the released share — the same exponential the rig channels use, so the input
  // damper is frame-rate independent for free.
  const lambda = 1 / smoothTime;
  const x = damp(0, state.pendingX, lambda, dt);
  const y = damp(0, state.pendingY, lambda, dt);
  state.pendingX -= x;
  state.pendingY -= y;

  return { x, y };
}
