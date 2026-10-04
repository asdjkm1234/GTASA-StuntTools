/**
 * Draw a frame when something changed, and not otherwise (201/4-01).
 *
 * A game's loop runs flat out because a game is always moving. A dispatch map is **idle for most of a
 * shift**, on a phone that runs hot and goes flat, and nothing in the engine knew the difference: the
 * console redrew a static city sixty times a second to show a queue that changed once a minute.
 *
 * **"Nothing changed" is a STATE this reads, never an event it can miss** — the trap the restrictions
 * already name in another form ([a framing decision taken on a threshold gets retaken next
 * frame](../../../../docs/restrictions/architecture.md)). Every wake compares the whole picture's inputs
 * against the ones the last DRAWN frame used; a signal that arrives while the loop is asleep is still there
 * when it looks, because it is a value rather than a notification. Waking on input only makes the answer
 * arrive sooner — it is never how the answer is found.
 *
 * **The latency budget, named before it was built:** the first frame after an operator's input is presented
 * in the next animation frame — one frame at the display's rate, not one idle period. That is what
 * {@link RenderGate.wake} is for: a pointer, a wheel or a key re-arms the fast schedule in its own handler,
 * so the idle period never sits between a thumb and the picture. A map that saves battery and feels sticky
 * under the thumb has failed.
 *
 * **What idle means for the world.** While nothing changes the picture is frozen — the palms stop swaying
 * and the scrollers stop scrolling, because the frame that would advance them is the frame we are choosing
 * not to spend. Nothing is CUT (the [protected list](../../../../docs/plans/201-dispatch-console/1-the-map-profile/protected-list.md)
 * is about what the build and the frame carry, not about a still map), and the first input resumes all of
 * it. If a field verdict says a frozen world reads as a hung one, the lever is an idle RATE rather than an
 * idle stop — recorded rather than assumed.
 */
import type { MapPose } from '../map/map-camera';
import type { Operations, Selection } from '../ops/types';

/**
 * Everything the picture depends on, gathered once a wake. Values only: two frames with equal signals are
 * two frames that would draw the same pixels.
 */
export interface FrameSignals {
  /** Drawing-buffer size, so a resize redraws even when nothing else moved. */
  readonly canvas: number;
  /** Cells created since boot (a running total) — the world is still filling in. */
  readonly created: number;
  /** Cells evicted since boot — geometry left the picture. */
  readonly evicted: number;
  /** The world hour the environment is showing. */
  readonly hour: number;
  /** The board, by identity: it is replaced whole on every tick and never mutated. */
  readonly ops: Operations;
  /** Cells still in flight — the picture is not finished while this is above zero. */
  readonly pending: number;
  readonly pose: MapPose;
  readonly selection: Selection;
  /** The sketch store's revision (201/7-05) — a tap that adds a point changes the picture. */
  readonly sketch: number;
}

export class RenderGate {
  /** Frames this gate has skipped since boot — the number `idle draws → 0` is read off. */
  get idleFrames(): number {
    return this.skipped;
  }
  private forced = true;
  private last: FrameSignals | null = null;

  private skipped = 0;

  /** Whether the frame that is about to run must draw. Records the signals when it says yes. */
  shouldDraw(signals: FrameSignals): boolean {
    if (!this.forced && this.last !== null && same(this.last, signals)) {
      this.skipped += 1;

      return false;
    }
    this.forced = false;
    this.last = signals;

    return true;
  }

  /**
   * Draw the next frame whatever the signals say. For an input the loop cannot see as a value — a pointer
   * going down before it has moved anything — and for a host that has changed something the signals do not
   * cover (a new bindings table, a projection swap).
   */
  wake(): void {
    this.forced = true;
  }
}

function same(a: FrameSignals, b: FrameSignals): boolean {
  return (
    a.ops === b.ops &&
    a.selection === b.selection &&
    a.canvas === b.canvas &&
    a.hour === b.hour &&
    a.sketch === b.sketch &&
    a.pending === b.pending &&
    a.created === b.created &&
    a.evicted === b.evicted &&
    a.pose.at[0] === b.pose.at[0] &&
    a.pose.at[1] === b.pose.at[1] &&
    a.pose.height === b.pose.height &&
    a.pose.pitch === b.pose.pitch &&
    a.pose.yaw === b.pose.yaw &&
    a.pose.projection === b.pose.projection
  );
}
