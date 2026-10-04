/** Whole-run aggregate a benchmark capture produces (plan 063 harness). */
export interface PerfCapture {
  avgDrawCalls: number;
  avgMs: number;
  avgTriangles: number;
  fps: number;
  frames: number;
  p95Ms: number;
}

/** Rolling-window frame statistics for the perf HUD (plan 063). */
export interface PerfStats {
  /** Mean frame duration over the window, milliseconds. */
  avgMs: number;
  /** `renderer.info.render.calls` of the last sampled frame. */
  drawCalls: number;
  /** Frames per second derived from `avgMs`. */
  fps: number;
  /** `renderer.info.memory.geometries`. */
  geometries: number;
  /** 95th-percentile frame duration over the window, milliseconds. */
  p95Ms: number;
  /** Compiled shader programs alive. */
  programs: number;
  /** `renderer.info.memory.textures`. */
  textures: number;
  /** `renderer.info.render.triangles` of the last sampled frame. */
  triangles: number;
}

/** HUD stats window, seconds — long enough for a stable p95, short enough to react to toggles. */

/**
 * Frame-time + `renderer.info` sampler (plan 063). Two independent consumers:
 * - the debug-overlay perf HUD reads {@link stats} over a rolling {@link WINDOW_S} window (`enabled` is set
 *   only while the panel is open — a hidden HUD costs nothing);
 * - the benchmark harness wraps a run in {@link beginCapture}/{@link endCapture} for whole-run aggregates.
 */
export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) {
    return 0;
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);

  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}
