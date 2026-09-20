/**
 * Scripted driving (plan 081/01): a timeline that drives the car the way a player would, so the same lap can
 * be run again next month and compared number for number.
 *
 * It is an {@link InputState} and nothing else — the vehicle systems consume it unchanged, which is the whole
 * point: a capture measures the REAL driving path (`drive()`'s ramps, its steer slew, its reverse seeding),
 * not a test double that bypasses them. A neutral source contributes nothing to a {@link CombinedInput}
 * (zero move, no actions), so the host can leave one installed for good and it only speaks while a scene runs.
 *
 * Keyframes HOLD: each one's values stay in force until the next takes over, and nothing is interpolated. A
 * slalom is "full left, then full right" — an interpolated version of it would be a different manoeuvre, and
 * a scene has to be describable in words to be reproducible.
 */
import type { Action, InputState, LookDelta, MoveVector } from '../input/input-state';

/** One instant of the timeline: what is held from `t` until the next keyframe. */
export interface DriveKeyframe {
  /** Actions held from here on. `jump` is brake/handbrake, `enterExit` works the door. Omitted = none. */
  readonly actions?: readonly Action[];
  /** Movement intent held from here on: `x` = steer right, `y` = throttle (negative = brake/reverse). */
  readonly move?: MoveVector;
  /** Seconds from the start of the timeline. */
  readonly t: number;
}

/** A repeatable driving scenario: where the car starts, what it is told to do, and for how long. */
export interface PhysScene {
  /** Seconds of telemetry captured once the car starts driving (the timeline's own clock). */
  readonly durationS: number;
  /** Spawn heading (rad about GTA +Z, 0 = facing +Y) — the road's own heading from the path graph. */
  readonly heading: number;
  readonly key: string;
  /** Spawn spot (native GTA Z-up). The car is ground-snapped from here, so z is a hint, not a promise. */
  readonly position: readonly [number, number, number];
  readonly timeline: readonly DriveKeyframe[];
  /** What this scene is FOR, in words — a ledger row that cannot explain itself is not evidence. */
  readonly what: string;
}

const NEUTRAL: MoveVector = { x: 0, y: 0 };

export class ScriptedDriveSource implements InputState {
  /** Seconds since {@link play}; 0 while nothing is playing. */
  get time(): number {
    return this.elapsed;
  }
  private elapsed = 0;
  private timeline: readonly DriveKeyframe[] = [];

  constructor(timeline: readonly DriveKeyframe[] = []) {
    this.timeline = timeline;
  }

  /** Advance the timeline's own clock. Driven by the FIXED step, never by wall time — a capture that
   *  sampled real time would replay differently on a slower machine, which is the one thing it must not do. */
  advance(dt: number): void {
    if (this.timeline.length > 0) {
      this.elapsed += dt;
    }
  }

  consumeLook(): LookDelta {
    return { x: 0, y: 0 };
  }

  consumeZoom(): number {
    return 0;
  }

  isActive(action: Action): boolean {
    return this.current()?.actions?.includes(action) ?? false;
  }

  move(): MoveVector {
    return this.current()?.move ?? NEUTRAL;
  }

  /** Start (or restart) a timeline from t = 0. Keyframes must be in ascending `t`. */
  play(timeline: readonly DriveKeyframe[]): void {
    this.timeline = timeline;
    this.elapsed = 0;
  }

  /** Go quiet: the source stops contributing anything, and the player has the car back. */
  stop(): void {
    this.timeline = [];
    this.elapsed = 0;
  }

  /** The keyframe in force now — the last one whose `t` has passed. */
  private current(): DriveKeyframe | undefined {
    let held: DriveKeyframe | undefined;
    for (const keyframe of this.timeline) {
      if (keyframe.t > this.elapsed) {
        break;
      }
      held = keyframe;
    }

    return held;
  }
}
