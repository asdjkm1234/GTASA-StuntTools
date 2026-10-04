/**
 * A bounded frame-time distribution: the shape of a window, in constant memory.
 *
 * The collector used to keep **every** `dt` in an array and, on every report, copy the whole thing and sort
 * it to take two percentiles. `InventoryPanel` asks for a report twice a second, so a two-hour session at
 * 30 drawn frames a second meant copying and sorting 216 000 numbers, 7 200 times, on the main thread — the
 * instrument growing into the frame budget it exists to measure, and worst in exactly the run
 * [4/02](../../../../docs/plans/201-dispatch-console/4-a-console-is-not-a-game/readme.md) was written to
 * take. A profiler that changes what it measures is not a profiler.
 *
 * So the samples are not kept. What is kept is a histogram — the standard answer, and the one this project
 * was already using by hand: every capture since 2026-08-22 has had its moving half derived from
 * `dtHistogramMs` in the row's own prose, because the report's own percentiles could not be trusted.
 *
 * **What that costs, stated rather than hidden:** a percentile is now a BIN's floor, so it is up to one bin
 * low and never high. What it buys: memory that does not depend on the run, a report that costs one pass
 * over at most {@link MAX_BINS} bins, and no allocation per frame. The count, the sum and the maximum stay
 * EXACT — they are running scalars, so the mean is not the average of the bins and a 16-second hitch is
 * still reported at its real length rather than as "at or above the tail".
 *
 * **The range is two resolutions, and the second one is there because a test caught it.** A single tail bin
 * at 100 ms is right for the SHAPE the histogram is read for — a vsync ladder lives between 14 and 70 — but
 * it is wrong for a percentile: the 2026-08-31 capture's `dtP95` was 108.4 ms, so a report taking p95 off
 * such a histogram would have said `100` and hidden how far past it the window actually ran. Above 100 the
 * bins are therefore 20 ms wide out to a second, which costs 45 more possible entries and keeps p95 and p99
 * meaningful through the range where a frame is slow rather than frozen. Past a second it saturates, and
 * that is a freeze rather than a frame — `maxMs` still carries its real length.
 *
 * The sub-100 half is bin-for-bin what every filed capture already carries, so nothing in the record has to
 * be re-read: what used to be one `[100, n]` entry is now several, ascending, in the same shape.
 */

/** Bin width below {@link COARSE_FROM_MS}, ms. Half a 60 Hz vsync interval: 16.7 and 33.3 land in different
 *  bins from their neighbours, which is the resolution the ladder is read at. */
export const BIN_MS = 2;
/** Above this a frame is slow rather than paced, and 20 ms of resolution is enough to place a percentile. */
export const COARSE_FROM_MS = 100;
/** Bin width from {@link COARSE_FROM_MS} to {@link BIN_TAIL_MS}. */
export const COARSE_BIN_MS = 20;
/** Everything at or above this lands in one tail bin: past a second it is a freeze, not a frame time. */
export const BIN_TAIL_MS = 1000;
/** The most bins any window can open — what makes this bounded, and what the memory claim is checked against. */
export const MAX_BINS = COARSE_FROM_MS / BIN_MS + (BIN_TAIL_MS - COARSE_FROM_MS) / COARSE_BIN_MS + 1;

export class FrameHistogram {
  /** How many samples went in. Exact. */
  get count(): number {
    return this.samples;
  }
  /** The largest sample, ms. Exact — never the tail bin's floor. */
  get maxMs(): number {
    return this.largest;
  }
  /** The mean, ms. Exact: taken from the running sum rather than from the bins. */
  get meanMs(): number {
    return this.samples === 0 ? 0 : this.total / this.samples;
  }
  /** Everything these samples account for, ms — how much of a window this population covers. */
  get totalMs(): number {
    return this.total;
  }
  private readonly counts = new Map<number, number>();
  private largest = 0;
  private samples = 0;
  private total = 0;

  add(ms: number): void {
    const bin = binOf(ms);
    this.counts.set(bin, (this.counts.get(bin) ?? 0) + 1);
    this.samples += 1;
    this.total += ms;
    this.largest = Math.max(this.largest, ms);
  }

  /** Counts per bin, ascending, empty bins omitted — the shape the filed captures already carry. */
  bins(): readonly (readonly [number, number])[] {
    return [...this.counts.entries()].sort((a, b) => a[0] - b[0]);
  }

  /**
   * The bin the `fraction` sample falls in, ms.
   *
   * The rank is the one the sorted-array percentile it replaces used — `round(fraction * (count - 1))` —
   * so the two agree to within a bin on the same data.
   */
  percentileMs(fraction: number): number {
    if (this.samples === 0) {
      return 0;
    }
    const rank = Math.min(this.samples - 1, Math.max(0, Math.round(fraction * (this.samples - 1))));
    let seen = 0;
    for (const [bin, count] of this.bins()) {
      seen += count;
      if (seen > rank) {
        return bin;
      }
    }

    return BIN_TAIL_MS;
  }
}

/** Which bin a sample lands in — the floor of its range, in the resolution that range is kept at. */
function binOf(ms: number): number {
  if (ms >= BIN_TAIL_MS) {
    return BIN_TAIL_MS;
  }
  if (ms >= COARSE_FROM_MS) {
    return Math.floor(ms / COARSE_BIN_MS) * COARSE_BIN_MS;
  }

  return Math.floor(ms / BIN_MS) * BIN_MS;
}
