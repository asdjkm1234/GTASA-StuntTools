/**
 * Named spans for work that runs BETWEEN frames (plan 091 phase 2).
 *
 * `dt` spans rAF-start to rAF-start, so a frame's length includes everything the browser did after the last
 * loop returned: promise continuations, worker handlers, GC. No timer placed inside the loop can see that
 * half, and it is exactly where a resolved vehicle spawn or a cell's collider build is paid. So the work
 * times ITSELF into a named span, and the loop DRAINS the totals at the top of the next frame — the frame
 * that actually paid for them.
 *
 * Two rules, both load-bearing:
 *
 * - **Wrap synchronous segments only.** Timing across an `await` would measure the wait as well as the work,
 *   and two overlapping waits would each claim the same milliseconds. A sync segment cannot overlap another,
 *   so the totals can never exceed the gap they are attributed to.
 * - **Never wrap work the frame loop already times.** A span inside the loop body would be subtracted twice
 *   (once as its block, once as a span) and push the residual negative.
 *
 * The recorder is shared ({@link frameSpans}) rather than threaded through every constructor: it is an
 * instrument, not state — the systems that pay this cost (the vehicle spawn chain in the app, the collision
 * streamer in the game layer, the engine's own loaders) sit in three different packages and none of them
 * owns the frame loop.
 */

/** One drain: the milliseconds each span accumulated since the last drain, and their total. */
export interface FrameSpanTotals {
  /** Span name → self-time in milliseconds, descending. Empty on a frame that paid for nothing. */
  readonly byName: readonly (readonly [string, number])[];
  readonly totalMs: number;
}

export class FrameSpans {
  /** Time already claimed by spans nested INSIDE each open span — subtracted so a name gets its self-time. */
  private readonly nested: number[] = [];
  private totalMs = 0;
  private readonly totals = new Map<string, number>();

  /** Add a segment somebody else timed (for callers that already keep their own stopwatch). */
  add(name: string, ms: number): void {
    this.totals.set(name, (this.totals.get(name) ?? 0) + ms);
    this.totalMs += ms;
  }

  /** Take everything recorded since the last drain and reset. Called once per frame, at the top. */
  drain(): FrameSpanTotals {
    const byName = [...this.totals.entries()].sort((a, b) => b[1] - a[1]);
    const totals: FrameSpanTotals = { byName, totalMs: this.totalMs };
    this.totals.clear();
    this.totalMs = 0;

    return totals;
  }

  /** Time one SYNCHRONOUS segment into `name`. Nested spans keep their own time; the outer one loses it. */
  measure<T>(name: string, run: () => T): T {
    const started = performance.now();
    this.nested.push(0);
    try {
      return run();
    } finally {
      const elapsed = performance.now() - started;
      const inner = this.nested.pop() ?? 0;
      this.add(name, Math.max(0, elapsed - inner));
      if (this.nested.length > 0) {
        this.nested[this.nested.length - 1] += elapsed;
      }
    }
  }
}

/** The one recorder the running game uses — see the note above on why it is shared. */
export const frameSpans = new FrameSpans();

/**
 * The spans of one frame as a log fragment: `vehicle-spawn:previon 18.0 · cell-collision 31.0 · unattributed 14.1`.
 *
 * Spans named `class:detail` (one per car model, say) COLLAPSE into their class once there is more than one:
 * `vehicle-osm ×44 36.3 (worst majestic 4.0)`. A boot frame opens ninety of them, and ninety names is a line
 * nobody reads — the class total is what a decision is made on, and the worst member is kept so a single
 * dominating asset still shows itself. Nothing is truncated: every span lands in exactly one class.
 *
 * `unattributed` is always last and always printed — it is GC plus everything nobody wrapped, and a report
 * that hides it is a tidy breakdown of the half it can see.
 */
export function formatFrameSpans(totals: FrameSpanTotals, unattributedMs: number): string {
  const classes = new Map<string, { count: number; ms: number; worst: string; worstMs: number }>();
  for (const [name, ms] of totals.byName) {
    const colon = name.indexOf(':');
    const key = colon === -1 ? name : name.slice(0, colon);
    const detail = colon === -1 ? name : name.slice(colon + 1);
    const entry = classes.get(key) ?? { count: 0, ms: 0, worst: detail, worstMs: 0 };
    entry.count += 1;
    entry.ms += ms;
    if (ms > entry.worstMs) {
      entry.worst = detail;
      entry.worstMs = ms;
    }
    classes.set(key, entry);
  }
  const parts = [...classes.entries()]
    .filter(([, entry]) => entry.ms >= 0.05)
    .sort((a, b) => b[1].ms - a[1].ms)
    .map(([key, entry]) =>
      entry.count === 1
        ? `${key === entry.worst ? key : `${key}:${entry.worst}`} ${entry.ms.toFixed(1)}`
        : `${key} ×${entry.count} ${entry.ms.toFixed(1)} (worst ${entry.worst} ${entry.worstMs.toFixed(1)})`,
    );

  return [...parts, `unattributed ${unattributedMs.toFixed(1)}`].join(' · ');
}
