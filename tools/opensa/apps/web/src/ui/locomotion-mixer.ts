/**
 * Locomotion clip mixing bookkeeping (plan 088/02): which clip plays, the crossfade on every switch,
 * the walk↔run normalized-phase carry, and the pop-free retarget when a fade is interrupted. Pure
 * state — the caller drives `IfpSampler` with the returned pose — so all of it is testable without
 * a GPU. `captureHold` tells the caller to freeze the sampler's on-screen pose (`holdPose()`) BEFORE
 * sampling this frame: an interrupted fade (or a scripted-clip handback) fades from that frozen pose
 * instead of popping to the new source.
 */

export interface MixerFrame {
  /** Call `sampler.holdPose()` before sampling — a hold-fade starts from the on-screen pose. */
  captureHold: boolean;
  pose: MixerPose;
}

/** Tuning hooks (088/03 rate sync, 088/04 one-shots + per-transition fades). All optional. */
export interface MixerOptions {
  /** Crossfade seconds for a from→to switch. Default: {@link DEFAULT_FADE_SECONDS}. */
  fadeFor?: (from: number, to: number) => number;
  /** Clips that HOLD their last frame instead of looping (launch/land — a looping land re-crouches). */
  oneShot?: ReadonlySet<number>;
  /** Playback rate of a clip at the current speed (cycle-speed sync). Default: real time. */
  rateOf?: (clip: number, speed: number) => number;
}

/** How the caller should sample this frame. */
export type MixerPose =
  | { alpha: number; from: number; fromTime: number; kind: 'blend'; to: number; toTime: number }
  | { alpha: number; kind: 'hold'; to: number; toTime: number }
  | { clip: number; kind: 'single'; time: number };

/** Crossfade length between locomotion clips (per-transition overrides via {@link MixerOptions}). */
export const DEFAULT_FADE_SECONDS = 0.2;

/** A one-shot holds just SHORT of its duration — at exactly `duration` the sampler's wrap rewinds to 0. */
const ONE_SHOT_HOLD_EPSILON = 1e-3;

export class LocomotionMixer {
  private active: number;
  private fade: null | { duration: number; elapsed: number; from: number; fromTime: number; hold: boolean } = null;
  private readonly fadeFor: (from: number, to: number) => number;
  private readonly oneShot: ReadonlySet<number>;
  private pendingHold = false;
  private readonly rateOf: (clip: number, speed: number) => number;
  private time = 0;

  constructor(
    /** Clip durations by index (0 = unresolved clip — never phase-carried). */
    private readonly durations: readonly number[],
    /** Cyclic gait clips (walk/run/…) that carry normalized phase across a switch — legs stay in step. */
    private readonly cyclic: ReadonlySet<number>,
    initial: number,
    options: MixerOptions = {},
  ) {
    this.active = initial;
    this.fadeFor = options.fadeFor ?? ((): number => DEFAULT_FADE_SECONDS);
    this.oneShot = options.oneShot ?? new Set();
    this.rateOf = options.rateOf ?? ((): number => 1);
  }

  /** Hand control back after a scripted clip: fade from the sampler's held pose into `clip`. */
  restartFromHold(clip: number): void {
    this.active = clip;
    this.time = 0;
    this.fade = { duration: DEFAULT_FADE_SECONDS, elapsed: 0, from: clip, fromTime: 0, hold: true };
    this.pendingHold = true;
  }

  /** Advance one frame toward `wanted` and describe what to sample; `speed` drives the cycle-speed sync. */
  update(wanted: number, dt: number, speed = 0): MixerFrame {
    if (wanted !== this.active) {
      this.beginFade(wanted);
    }
    this.time += dt * this.rateOf(this.active, speed);
    const captureHold = this.pendingHold;
    this.pendingHold = false;
    const { fade } = this;
    const activeTime = this.clockOf(this.active, this.time);
    if (!fade) {
      return { captureHold, pose: { clip: this.active, kind: 'single', time: activeTime } };
    }
    fade.elapsed += dt; // the ALPHA clock is wall time — only the cycle clocks are rate-scaled
    fade.fromTime += dt * this.rateOf(fade.from, speed); // the outgoing cycle keeps advancing under the fade
    const alpha = fade.elapsed / fade.duration;
    if (alpha >= 1) {
      this.fade = null;

      return { captureHold, pose: { clip: this.active, kind: 'single', time: activeTime } };
    }
    const pose: MixerPose = fade.hold
      ? { alpha, kind: 'hold', to: this.active, toTime: activeTime }
      : {
          alpha,
          from: fade.from,
          fromTime: this.clockOf(fade.from, fade.fromTime),
          kind: 'blend',
          to: this.active,
          toTime: activeTime,
        };

    return { captureHold, pose };
  }

  private beginFade(wanted: number): void {
    // A switch mid-fade retargets from the CURRENT blended (on-screen) pose, frozen via holdPose —
    // fading from either original clip alone would pop by the other's residual contribution.
    const interrupted = this.fade !== null;
    const fromDuration = this.durations[this.active] ?? 0;
    const toDuration = this.durations[wanted] ?? 0;
    const carryPhase = this.cyclic.has(this.active) && this.cyclic.has(wanted) && fromDuration > 0 && toDuration > 0;
    const startTime = carryPhase ? ((this.time % fromDuration) / fromDuration) * toDuration : 0;
    this.fade = {
      duration: this.fadeFor(this.active, wanted),
      elapsed: 0,
      from: this.active,
      fromTime: this.time,
      hold: interrupted,
    };
    this.pendingHold ||= interrupted;
    this.active = wanted;
    this.time = startTime;
  }

  /** A one-shot clip's clock parks on its last frame; a cyclic clip's clock runs (the sampler wraps it). */
  private clockOf(clip: number, time: number): number {
    if (!this.oneShot.has(clip)) {
      return time;
    }
    const duration = this.durations[clip] ?? 0;

    return duration > 0 ? Math.min(time, duration - ONE_SHOT_HOLD_EPSILON) : time;
  }
}
