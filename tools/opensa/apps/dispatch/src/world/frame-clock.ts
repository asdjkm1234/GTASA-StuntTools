/**
 * What the console is allowed to say about its own frame rate.
 *
 * Since [201/4-01](../../../../docs/plans/201-dispatch-console/4-a-console-is-not-a-game/readme.md) the loop
 * wakes on a timer when nothing has changed and draws nothing (`IDLE_WAKE_MS`, 100 ms). So the interval
 * between two loop passes is not a frame time, and a mean over the last sixty of them is not a frame rate.
 * The readout was exactly that — `1000 / mean(dt)` over every pass, drawn or skipped — which reads **10 fps**
 * after a second of rest and then climbs back over the next sixty frames as the idle samples are pushed out
 * of the window. Every number in it was a real measurement; none of them described the frame the operator
 * was looking at, and a status bar that is wrong while the map is still is wrong exactly when it is read.
 *
 * So this counts what was DRAWN, and it separates the two questions a status bar answers:
 *
 * - **`fps` is a count**, never a reciprocal: how many frames were drawn in the last second. On a console
 *   that renders on demand this is genuinely low while nothing moves, and that is the truth — the frames
 *   were not drawn.
 * - **`frameMs` is the interval between two CONSECUTIVE drawn frames**, which is the only interval a frame
 *   time can be measured over. The one that follows a skipped wake spans the rest and is dropped rather
 *   than averaged in, and the median is reported rather than the mean so a single hitch does not move it.
 *
 * `cpuMs` is not here: the loop body's cost is measured directly in `boot.ts` and needs no window, and it
 * is the number that still means something when the map has drawn one frame in a second and there is no
 * interval to take at all.
 */

/**
 * What the interval before a drawn frame IS, and this module is its one owner.
 *
 * `consecutive` — the previous loop pass drew too, so the gap is a frame time. `after-rest` — the previous
 * pass was skipped by the render gate, so the gap is mostly its 100 ms idle wait and describes the
 * scheduler rather than the frame. The status bar and the capture collector both need this answer, and two
 * copies of it would be two consoles disagreeing about one loop.
 */
export type FrameIntervalKind = 'after-rest' | 'consecutive';

/** What the status bar reads. `frameMs` is 0 when the window holds no consecutive pair to measure. */
export interface FrameRate {
  readonly fps: number;
  readonly frameMs: number;
}

/** The window both numbers are taken over. One second: what "per second" means, and what a glance covers. */
const WINDOW_MS = 1000;

/** One drawn frame. `dtMs` is null when the interval before it spanned an idle wake or the boot. */
interface Drawn {
  readonly atMs: number;
  readonly dtMs: null | number;
}

export class FrameClock {
  private readonly drawn: Drawn[] = [];
  /** Whether the previous loop pass drew. False at boot: the first interval is measured against page load. */
  private previousDrew = false;

  /**
   * A loop pass that drew a frame.
   *
   * @param atMs when the pass started, on the monotonic clock.
   * @param dtMs the interval since the previous pass — counted as a frame time only when that pass drew too.
   * @returns which kind that interval was, for whoever else has to know (the capture collector does).
   */
  drew(atMs: number, dtMs: number): FrameIntervalKind {
    const kind: FrameIntervalKind = this.previousDrew ? 'consecutive' : 'after-rest';
    this.drawn.push({ atMs, dtMs: kind === 'consecutive' ? dtMs : null });
    this.previousDrew = true;
    this.trim(atMs);

    return kind;
  }

  /** Both numbers as of now, with anything older than the window dropped first. */
  read(nowMs: number): FrameRate {
    this.trim(nowMs);
    const intervals = this.drawn.map((frame) => frame.dtMs).filter((dt): dt is number => dt !== null);

    return { fps: this.drawn.length, frameMs: median(intervals) };
  }

  /** A loop pass the render gate skipped. The next interval spans it, so it is not a frame time. */
  skipped(): void {
    this.previousDrew = false;
  }

  private trim(nowMs: number): void {
    while (this.drawn.length > 0 && nowMs - this.drawn[0].atMs > WINDOW_MS) {
      this.drawn.shift();
    }
  }
}

/** The median of an unsorted list, 0 when empty. An even count takes the lower of the two middles — this is
 *  a readout rather than a statistic, and interpolating between two frame times invents one that never ran. */
function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.floor((sorted.length - 1) / 2)];
}
