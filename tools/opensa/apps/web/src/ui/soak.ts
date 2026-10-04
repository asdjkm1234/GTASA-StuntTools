/**
 * Soak mode (plan 074/10 pre-flip ③, criteria from 074/05): `?soak=<minutes>` cycles the bench scenes
 * until the deadline and self-judges STABILITY over time — flat heap/residency lines, bounded late
 * creates and long tasks, no frame-time degradation. Speed is the bench's question, not the soak's:
 * every check compares the run against itself (first vs last quarter), so the verdict is display- and
 * browser-independent. One `[soak] {json}` line per leg + a final verdict line the harness reads;
 * the same verdict lands on the HUD for the semi-automated Safari flow (open the tab, read it off).
 */
import type { BenchScene } from '@opensa/game/perf/bench';

export interface SoakCheck {
  readonly detail: string;
  readonly pass: boolean;
}

/** What the soak runner needs from the game host (the engine host wires its bench-leg closures in). */
export interface SoakHost {
  /** The timed camera flight over the scene path, sampling frames (the bench leg's measure window). */
  flyLeg(scene: BenchScene): Promise<{ lateCreates: number; samples: readonly { frameMs: number }[] }>;
  /** The bench road-car population — soak runs over the same streets as the sweeps. */
  registerRoadCars(scenes: readonly BenchScene[]): void;
  /** Residency snapshot at leg end (GPU ledger + streamed cells). */
  sample(): { cells: number; residencyMb: number; textureMb: number };
  /** Progress/verdict line for the HUD (always called with non-empty text). */
  setStatus(text: string): void;
  /** Teleport + ring settle + warmup — everything OUTSIDE the measure window. */
  settleAt(scene: BenchScene): Promise<void>;
}

/** One scene leg's aggregate — the soak's sampling unit (~15 s of steady flight + one ring turnover). */
export interface SoakInterval {
  readonly avgMs: number;
  /** Streamed cells at leg end. */
  readonly cells: number;
  readonly frames: number;
  /** JS heap at leg end, MB — null where `performance.memory` is unavailable (non-Chromium). */
  readonly heapMb: null | number;
  /** Late-create delta over the leg (074/21 P3 honesty metric). */
  readonly lateCreates: number;
  /** Long tasks (>50 ms) observed during the steady leg — null where the observer is unsupported. */
  readonly longTasks: null | number;
  readonly p95Ms: number;
  /** Total GPU residency at leg end, MB. */
  readonly residencyMb: number;
  readonly scene: string;
  /** Frames over the slow threshold inside the leg. */
  readonly slowFrames: number;
  /** Seconds since soak start at leg end. */
  readonly t: number;
  /** Texture-ledger bucket at leg end, MB (the plan-21 accumulation watch). */
  readonly textureMb: number;
}

export interface SoakVerdict {
  readonly checks: Readonly<Record<string, SoakCheck>>;
  readonly verdict: 'FAIL' | 'PASS';
}

/** Minimum legs for quarter statistics to mean anything. */
const MIN_INTERVALS = 8;

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const median = (values: readonly number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.floor(sorted.length / 2)];
};

const quarter = <T>(intervals: readonly T[], which: 'first' | 'last'): readonly T[] => {
  const size = Math.max(1, Math.ceil(intervals.length / 4));

  return which === 'first' ? intervals.slice(0, size) : intervals.slice(-size);
};

const readHeapMb = (): null | number => {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;

  return memory?.usedJSHeapSize ? Math.round(memory.usedJSHeapSize / 1048576) : null;
};

/** Judge a finished soak run. Pure — thresholds are relative to the run itself wherever possible. */
export function judgeSoak(intervals: readonly SoakInterval[], plannedMinutes: number): SoakVerdict {
  const checks: Record<string, SoakCheck> = {};

  if (intervals.length < MIN_INTERVALS) {
    checks.coverage = {
      detail: `${intervals.length} legs < ${MIN_INTERVALS} minimum — run too short to judge`,
      pass: false,
    };

    return { checks, verdict: 'FAIL' };
  }
  checks.coverage = { detail: `${intervals.length} legs over ${plannedMinutes} min`, pass: true };

  const firstQ = quarter(intervals, 'first');
  const lastQ = quarter(intervals, 'last');
  const eventBudget = Math.max(3, Math.round(plannedMinutes / 5));

  // Heap flat: last-quarter mean within an absolute + relative allowance of the first-quarter mean.
  const heapFirst = firstQ.map((i) => i.heapMb).filter((v): v is number => v !== null);
  const heapLast = lastQ.map((i) => i.heapMb).filter((v): v is number => v !== null);
  if (heapFirst.length === 0 || heapLast.length === 0) {
    checks.heapFlat = { detail: 'performance.memory unavailable — skipped', pass: true };
  } else {
    const growth = mean(heapLast) - mean(heapFirst);
    const allowance = Math.max(200, 0.25 * mean(heapFirst));
    checks.heapFlat = {
      detail: `${mean(heapFirst).toFixed(0)} → ${mean(heapLast).toFixed(0)} MB (allowance ${allowance.toFixed(0)})`,
      pass: growth <= allowance,
    };
  }

  // Residency/texture plateau: the run's peak must NOT sit in the last quarter above every earlier peak —
  // monotonic growth to the end is the leak signature (the plan-21 texture accumulation had exactly it).
  const plateau = (label: string, values: readonly number[], lastValues: readonly number[]): SoakCheck => {
    const peakBefore = Math.max(...values.slice(0, values.length - lastValues.length));
    const peakLast = Math.max(...lastValues);
    const bound = peakBefore * 1.05 + 1;

    return {
      detail: `${label} peak before ${peakBefore.toFixed(0)} MB vs last quarter ${peakLast.toFixed(0)} MB`,
      pass: peakLast <= bound,
    };
  };
  checks.residencyFlat = plateau(
    'residency',
    intervals.map((i) => i.residencyMb),
    lastQ.map((i) => i.residencyMb),
  );
  checks.textureFlat = plateau(
    'texture',
    intervals.map((i) => i.textureMb),
    lastQ.map((i) => i.textureMb),
  );

  // Late creates: streaming honesty over the whole run (teleport grace is already inside the metric).
  const lateTotal = intervals.reduce((sum, i) => sum + i.lateCreates, 0);
  checks.lateBounded = { detail: `${lateTotal} late creates (budget ${eventBudget})`, pass: lateTotal <= eventBudget };

  // Long tasks during steady legs (settle windows are not counted).
  const longTaskValues = intervals.map((i) => i.longTasks).filter((v): v is number => v !== null);
  if (longTaskValues.length === 0) {
    checks.longTasksBounded = { detail: 'longtask observer unavailable — skipped', pass: true };
  } else {
    const total = longTaskValues.reduce((sum, value) => sum + value, 0);
    checks.longTasksBounded = { detail: `${total} long tasks (budget ${eventBudget})`, pass: total <= eventBudget };
  }

  // Frame degradation: last-quarter p95 median must stay near the first quarter's (relative, not absolute).
  const p95First = median(firstQ.map((i) => i.p95Ms));
  const p95Last = median(lastQ.map((i) => i.p95Ms));
  checks.frameStable = {
    detail: `p95 median ${p95First.toFixed(1)} → ${p95Last.toFixed(1)} ms`,
    pass: p95Last <= p95First * 1.5 + 1,
  };

  // Slow frames: bounded share across the whole run.
  const slowTotal = intervals.reduce((sum, i) => sum + i.slowFrames, 0);
  const frameTotal = intervals.reduce((sum, i) => sum + i.frames, 0);
  checks.slowBounded = {
    detail: `${slowTotal} slow of ${frameTotal} frames (${((100 * slowTotal) / Math.max(1, frameTotal)).toFixed(2)} %)`,
    pass: slowTotal <= Math.max(5, 0.005 * frameTotal),
  };

  const verdict = Object.values(checks).every((check) => check.pass) ? 'PASS' : 'FAIL';

  return { checks, verdict };
}

/** `?soak=<minutes>` — absent/NaN/non-positive → 0 (off). */
export function parseSoakMinutes(raw: null | string): number {
  const minutes = Number(raw);

  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
}

/** Run the soak loop to its deadline; emits the `[soak]` protocol and reports through the host's HUD. */
export async function runSoak(
  host: SoakHost,
  scenes: readonly BenchScene[],
  minutes: number,
  slowFrameMs: number,
): Promise<SoakVerdict> {
  // Long tasks (>50 ms) — Chromium-only; the judge skips the check where the observer is unsupported.
  let longTaskCount: null | number = null;
  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
    longTaskCount = 0;
    new PerformanceObserver((list) => {
      longTaskCount = (longTaskCount ?? 0) + list.getEntries().length;
    }).observe({ entryTypes: ['longtask'] });
  }
  host.registerRoadCars(scenes);
  const start = performance.now();
  const deadline = start + minutes * 60000;
  const intervals: SoakInterval[] = [];
  for (let leg = 0; performance.now() < deadline; leg += 1) {
    const scene = scenes[leg % scenes.length];
    await host.settleAt(scene);
    const longStart = longTaskCount;
    const { lateCreates, samples } = await host.flyLeg(scene);
    const sortedMs = samples.map((sample) => sample.frameMs).sort((a, b) => a - b);
    const interval: SoakInterval = {
      avgMs: Number(mean(sortedMs).toFixed(3)),
      frames: samples.length,
      heapMb: readHeapMb(),
      lateCreates,
      longTasks: longTaskCount === null ? null : longTaskCount - (longStart ?? 0),
      p95Ms: Number((sortedMs[Math.floor(sortedMs.length * 0.95)] ?? 0).toFixed(3)),
      scene: scene.key,
      slowFrames: sortedMs.filter((frameMs) => frameMs > slowFrameMs).length,
      t: Math.round((performance.now() - start) / 1000),
      ...host.sample(),
    };
    intervals.push(interval);
    // eslint-disable-next-line no-console -- the soak deliverable IS these JSON lines
    console.log('[soak]', JSON.stringify(interval));
    host.setStatus(
      `SOAK ${(interval.t / 60).toFixed(1)}/${minutes} min · leg ${leg + 1} ${scene.key} · ` +
        `late ${lateCreates} · residency ${interval.residencyMb} MB`,
    );
  }
  const verdict = judgeSoak(intervals, minutes);
  // eslint-disable-next-line no-console -- the soak verdict line the harness (or a human) reads
  console.log('[soak]', JSON.stringify({ legs: intervals.length, minutes, ...verdict }));
  host.setStatus(
    `SOAK VERDICT: ${verdict.verdict} (${intervals.length} legs / ${minutes} min) — ` +
      Object.entries(verdict.checks)
        .map(([name, check]) => `${name} ${check.pass ? 'ok' : 'FAIL'}`)
        .join(' · '),
  );

  return verdict;
}
