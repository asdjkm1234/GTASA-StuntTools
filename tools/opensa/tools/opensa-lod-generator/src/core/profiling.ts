/** Plain-data form of a profiler's state — structured-clone friendly. */
export interface ProfileSnapshot {
  cells: { label: string; total: number }[];
  stages: [string, { calls: number; total: number }][];
}

/**
 * Per-stage wall-time profiler for the cell bake (measure-first before optimizing — the bake grew to 15+ min
 * on mod-heavy maps and the split merge / decimate / visibility-cull / encode was unknown). Aggregates stage
 * totals across every cell plus the per-cell total, and prints one compact table at the end of the run. Pure
 * (the clock is injected for tests); overhead is two `now()` calls per stage per cell — negligible next to the
 * raycasts it measures.
 */
export interface StageProfiler {
  /** Wrap one whole cell: everything timed inside lands in the per-cell total under `label`. */
  cell<T>(label: string, fn: () => T): T;
  /** Fold another profiler's snapshot in (aggregating across worker threads). */
  merge(snapshot: ProfileSnapshot): void;
  /** The report table: stage totals (share, calls) + the slowest cells. */
  report(topCells?: number): string;
  /** Plain-data snapshot (postMessage-able from a worker). */
  serialize(): ProfileSnapshot;
  /** Time one named stage (inside or outside a cell). */
  time<T>(stage: string, fn: () => T): T;
}

export function createStageProfiler(now: () => number = () => performance.now()): StageProfiler {
  const stages = new Map<string, { calls: number; total: number }>();
  const cells: { label: string; total: number }[] = [];

  const time = <T>(stage: string, fn: () => T): T => {
    const started = now();
    try {
      return fn();
    } finally {
      const entry = stages.get(stage) ?? { calls: 0, total: 0 };
      entry.calls += 1;
      entry.total += now() - started;
      stages.set(stage, entry);
    }
  };

  return {
    cell<T>(label: string, fn: () => T): T {
      const started = now();
      try {
        return fn();
      } finally {
        cells.push({ label, total: now() - started });
      }
    },
    merge(snapshot: ProfileSnapshot): void {
      for (const [stage, { calls, total }] of snapshot.stages) {
        const entry = stages.get(stage) ?? { calls: 0, total: 0 };
        entry.calls += calls;
        entry.total += total;
        stages.set(stage, entry);
      }
      cells.push(...snapshot.cells);
    },
    report(topCells = 5): string {
      const grand = [...stages.values()].reduce((sum, stage) => sum + stage.total, 0);
      const lines = [...stages.entries()]
        .sort((a, b) => b[1].total - a[1].total)
        .map(
          ([stage, { calls, total }]) =>
            `    ${stage.padEnd(20)} ${seconds(total).padStart(8)}  ${percent(total, grand).padStart(5)}  ×${calls}`,
        );
      const slowest = [...cells]
        .sort((a, b) => b.total - a.total)
        .slice(0, topCells)
        .map((cell) => `    ${cell.label.padEnd(20)} ${seconds(cell.total).padStart(8)}`);

      return [
        `  profile — stages (total ${seconds(grand)}):`,
        ...lines,
        ...(slowest.length > 0 ? [`  profile — slowest cells:`, ...slowest] : []),
      ].join('\n');
    },
    serialize(): ProfileSnapshot {
      return { cells: [...cells], stages: [...stages.entries()] };
    },
    time,
  };
}

function percent(part: number, whole: number): string {
  return whole > 0 ? `${((100 * part) / whole).toFixed(1)}%` : '—';
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
