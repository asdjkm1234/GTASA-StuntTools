/**
 * The additive motion layer (plan 080/06, behaviours #7 and #8): bob, the landing dip, impact shake and the
 * sprint FOV kick. It is the LAST transform before the camera is drawn — small numbers, big perceived
 * quality, and the layer most likely to make someone ill.
 *
 * Its ground rules, all load-bearing:
 *
 * - **Additive, bounded, and NO ROLL.** Roll is the fastest route to motion sickness and GTA V uses none on
 *   foot. Offsets are capped at {@link MOTION_CAP}, well inside collision's sphere radius, so the layer can
 *   never push the eye through a surface and needs no casts of its own.
 * - **Eye and look point move TOGETHER** for bob and shake. Moving the eye alone would swing the aim, which
 *   is the nauseating version of the same effect. Only the landing dip moves them differently — the look
 *   point dips HALF as far, so the frame pitches down a whisker and reads as knees bending.
 * - **Phase-continuous.** The bob phase accumulates by DISTANCE TRAVELLED, so the frequency tracks stride
 *   for free and freezes when the player stops; the amplitude damps in and out. Nothing restarts, so
 *   crossing walk↔run pops nothing.
 * - **`reducedMotion` zeroes the layer outright** — one flag, one tab toggle, and every effect also has its
 *   own scale for a lighter touch.
 */
import type { CameraConfig } from '@opensa/game';

import { clamp, damp, smoothDamp, type SmoothDampRef } from '@opensa/math';

/** The hard cap on the summed offset (m). Below the floor guard's 0.3 m margin and collision's 0.35 m sphere,
 *  so the layer can never breach a surface — but high enough that a landing can actually be SEEN at a 7 m
 *  orbit, which 0.15 was not (field round 2: "jumping on foot, nothing happens"). */
export const MOTION_CAP = 0.25;

/** How fast the bob amplitude follows the gait (per second) — fast enough to feel immediate, slow enough
 *  that stopping fades rather than cuts. */
const BOB_LAMBDA = 6;
/** The lateral (figure-eight) swing as a fraction of the vertical bob. */
const BOB_LATERAL_SHARE = 0.6;
/** How long the landing dip takes to recover (seconds). */
const DIP_TIME = 0.32;
/** The deepest a landing may dip the eye (m), whatever the fall. */
const DIP_CAP = 0.25;
/** Shake amplitude half-life-ish decay (seconds). */
const SHAKE_DECAY = 0.3;
/** How fast the shake noise is sampled (Hz) — jitter, not a wobble. */
const SHAKE_HZ = 15;
/** The most a shake alone may offset the camera (m). */
const SHAKE_CAP = 0.1;
const TAU = Math.PI * 2;
/** The speed band over which the sprint FOV kick comes in, as a multiple of the run gait. The sprint gait is
 *  10 u/s against a 7 u/s run, so a band that only completes at 1.4x would arrive exactly at top speed and
 *  never read as anything. */
const SPRINT_BAND = 1.2;

/** What the host measured this frame. Everything the layer reacts to arrives as data — it observes nothing. */
export interface MotionInput {
  /** Off the ground: bob damps out, because a jump arc is already motion. */
  airborne: boolean;
  dt: number;
  /** Peak vehicle contact force this frame (N), 0 when nothing was hit. */
  impact: number;
  /** The vertical impact speed (units/s) of a landing that STARTED this frame, else 0. Plan 088's
   *  `Locomotion.fallSpeed` at the landing edge — the controller has a real landing state, so the camera
   *  does not have to guess the edge from a velocity sign. */
  landing: number;
  mode: 'fly' | 'foot' | 'vehicle';
  /** The framed object's planar speed (units/s). */
  speed: number;
}

/**
 * The layer's output for one frame.
 *
 * `lateral`/`vertical` are METRES in the camera's screen plane and world up; `fov` is a TARGET contribution
 * in radians — it joins the director's FOV target and eases through the existing damp, which is what makes
 * the sprint kick come and go slowly instead of snapping with the gait.
 */
export interface MotionOffset {
  fov: number;
  /** Sideways, applied to eye AND look point. */
  lateral: number;
  /** Applied to the EYE. */
  vertical: number;
  /** Applied to the LOOK POINT — the dip counts half here, everything else counts fully. */
  verticalTarget: number;
}

/** The layer's live state: two oscillators, a one-shot and a decaying shake. Stepped in place. */
export interface MotionState {
  /** Damped 0..1 gait scale — the amplitude envelope, so nothing pops when the speed crosses a threshold. */
  bobLevel: number;
  /** Bob phase in radians, accumulated by DISTANCE, never reset. */
  bobPhase: number;
  /** The live landing dip (m, negative = down). */
  dip: number;
  dipVelocity: SmoothDampRef;
  /** The live shake amplitude (m), decayed every step. */
  shakeAmplitude: number;
  /** Deterministic per-shake seed — no `Math.random`, so a shake replays identically in a test. */
  shakeSeed: number;
  /** Seconds the current shake has been running (the noise clock). */
  shakeTime: number;
}

export function createMotion(): MotionState {
  return {
    bobLevel: 0,
    bobPhase: 0,
    dip: 0,
    dipVelocity: { velocity: 0 },
    shakeAmplitude: 0,
    shakeSeed: 1,
    shakeTime: 0,
  };
}

/** Step every effect one frame and return the summed, capped offset. */
export function stepMotion(state: MotionState, input: MotionInput, config: CameraConfig): MotionOffset {
  if (config.reducedMotion) {
    // One flag, the whole layer: no accumulation either, so switching it back on starts from rest.
    reset(state);

    return { fov: 0, lateral: 0, vertical: 0, verticalTarget: 0 };
  }
  const bob = stepBob(state, input, config);
  const dip = stepDip(state, input, config);
  const shake = stepShake(state, input, config);
  // Cap the SUM: three effects that each respect the cap could still breach it together.
  const lateral = bob.lateral + shake.lateral;
  const vertical = bob.vertical + shake.vertical + dip;
  const scale = capScale(lateral, vertical);

  return {
    fov: sprintFov(input, config),
    lateral: lateral * scale,
    vertical: vertical * scale,
    // The dip is the one effect the look point does NOT follow fully — half of it is what pitches the frame.
    verticalTarget: (bob.vertical + shake.vertical + dip * 0.5) * scale,
  };
}

/** How much the offset must shrink to respect {@link MOTION_CAP}. */
function capScale(lateral: number, vertical: number): number {
  const magnitude = Math.hypot(lateral, vertical);

  return magnitude > MOTION_CAP ? MOTION_CAP / magnitude : 1;
}

/** Two-octave value noise in [−1, 1] — jittery like an impact, not a sine wobble. */
function noise(seed: number, t: number): number {
  return (octave(seed, t * SHAKE_HZ) + octave(seed ^ 0x5bf03635, t * SHAKE_HZ * 2) * 0.5) / 1.5;
}

/** One noise octave: a hashed value per lattice point, smoothstepped between. */
function octave(seed: number, t: number): number {
  const cell = Math.floor(t);
  const frac = t - cell;
  const ease = frac * frac * (3 - 2 * frac);

  return valueAt(seed, cell) * (1 - ease) + valueAt(seed, cell + 1) * ease;
}

function reset(state: MotionState): void {
  state.bobLevel = 0;
  state.bobPhase = 0;
  state.dip = 0;
  state.dipVelocity.velocity = 0;
  state.shakeAmplitude = 0;
  state.shakeTime = 0;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);

  return t * t * (3 - 2 * t);
}

/** The sprint FOV kick: a couple of degrees as the run tips into a sprint. Its only job is feeling faster. */
function sprintFov(input: MotionInput, config: CameraConfig): number {
  if (input.mode !== 'foot' || config.sprintFovKick <= 0 || config.lookAheadFullSpeed <= 0) {
    return 0;
  }
  const run = config.lookAheadFullSpeed;

  return config.sprintFovKick * smoothstep(run, run * SPRINT_BAND, input.speed);
}

/** Vertical bob at stride frequency, lateral at half — the figure-eight a walking head traces. */
function stepBob(state: MotionState, input: MotionInput, config: CameraConfig): { lateral: number; vertical: number } {
  // In a car the suspension already provides the life (and 02's vertical channel transmits a damped version
  // of it); a detached fly eye must sit exactly where it is dragged.
  const walking = input.mode === 'foot' && !input.airborne;
  const target = walking && config.lookAheadFullSpeed > 0 ? clamp(input.speed / config.lookAheadFullSpeed, 0, 1) : 0;
  state.bobLevel = damp(state.bobLevel, target, BOB_LAMBDA, input.dt);
  // Phase by DISTANCE, so the frequency tracks stride and a standing player's bob freezes rather than idling.
  // WRAPPED to one turn: the phase would otherwise grow without bound over a long session (a sprint adds
  // ~11 rad/s), and an ever-larger argument slowly costs `Math.sin` its precision. Wrapping is invisible —
  // the sine is periodic — and it is what makes the channel safe to leave running for hours.
  state.bobPhase = (state.bobPhase + input.speed * input.dt * config.bobCyclesPerMetre * Math.PI * 2) % TAU;
  const amplitude = config.bobAmplitude * state.bobLevel;

  return {
    lateral: Math.sin(state.bobPhase * 0.5) * amplitude * BOB_LATERAL_SHARE,
    vertical: Math.sin(state.bobPhase) * amplitude,
  };
}

/** The landing one-shot: drop on the touchdown frame, ease back over {@link DIP_TIME}. */
function stepDip(state: MotionState, input: MotionInput, config: CameraConfig): number {
  state.dip = smoothDamp(state.dip, 0, state.dipVelocity, DIP_TIME, Number.POSITIVE_INFINITY, input.dt);
  if (input.landing > 0 && config.landingDipFullSpeed > 0) {
    const depth = Math.min(DIP_CAP, config.landingDipScale * clamp(input.landing / config.landingDipFullSpeed, 0, 2));
    // A harder landing overrides a softer one still recovering; a softer one never interrupts it.
    state.dip = Math.min(state.dip, -depth);
    state.dipVelocity.velocity = 0;
  }

  return state.dip;
}

/** Impact shake: seeded two-octave noise, decaying. A stronger hit replaces a weaker one; else they sum. */
function stepShake(
  state: MotionState,
  input: MotionInput,
  config: CameraConfig,
): { lateral: number; vertical: number } {
  state.shakeAmplitude *= Math.exp(-input.dt / SHAKE_DECAY);
  // The noise clock only runs while there IS a shake; idling it would accumulate for the whole session.
  if (state.shakeAmplitude > 0) {
    state.shakeTime += input.dt;
  }
  if (input.impact > 0 && config.shakeImpactForce > 0 && config.shakeScale > 0) {
    const amplitude = Math.min(SHAKE_CAP, config.shakeScale * clamp(input.impact / config.shakeImpactForce, 0, 1));
    // Re-seed only when starting from silence. A real crash is not one contact — it is a burst of them over
    // several frames, and re-seeding (or restarting the noise clock) on each one pinned the sample near t=0,
    // which turned the jitter into a nearly STATIC offset. That is why a hard hit shook LESS than a light
    // one: the light tap was a single frame, so its clock actually ran.
    if (state.shakeAmplitude <= 0) {
      state.shakeSeed = (Math.imul(state.shakeSeed, 1664525) + 1013904223) >>> 0;
      state.shakeTime = 0;
    }
    state.shakeAmplitude = Math.min(SHAKE_CAP, Math.max(state.shakeAmplitude, amplitude));
  }
  if (state.shakeAmplitude <= 1e-5) {
    state.shakeAmplitude = 0;

    return { lateral: 0, vertical: 0 };
  }

  return {
    lateral: noise(state.shakeSeed, state.shakeTime) * state.shakeAmplitude,
    vertical: noise(state.shakeSeed ^ 0x27d4eb2d, state.shakeTime) * state.shakeAmplitude,
  };
}

/** A hashed value in [−1, 1] for one lattice point. Integer math only, so it is stable everywhere. */
function valueAt(seed: number, index: number): number {
  let h = (seed ^ Math.imul(index, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;

  return (((h ^ (h >>> 16)) >>> 0) / 0xffffffff) * 2 - 1;
}
