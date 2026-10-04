/**
 * Bench harness (plan 074/11): deterministic scripted cameras + a warmup/measure loop + a downloadable JSON
 * record. Numbers are comparable across engine versions ONLY because the scene scripts and the collection
 * windows are pinned here — do not tweak them casually (that invalidates the committed series).
 */
import type { CameraState, EngineStats } from '@opensa/engine';

export const BENCH_WARMUP_FRAMES = 120;
export const BENCH_MEASURE_FRAMES = 600;

/** Per-scene measure-window overrides (default {@link BENCH_MEASURE_FRAMES}). */
export const BENCH_SCENE_MEASURE: Record<string, number> = {
  city: 3600, // ~30 s at 120 Hz — the full-city traverse needs the long window
  map: 9000, // ~75 s at 120 Hz — the whole-map tour (LS → LV → SF → LS, ~14 k units at ~190 u/s)
  teleport: 1800, // 6 jumps × 300 frames — streaming teardown/rebuild stress
};

/** Whole-map tour waypoints in ENGINE coords (x, height, z = −gtaY): LS beach → downtown → east LS →
 *  countryside north → the LV strip → west LV → the long desert crossing → SF downtown → SF south →
 *  countryside east → back to LS. Pairs with `?src=pak-map`. Altitude clears the route's terrain. */
const MAP_TOUR: readonly [number, number, number][] = [
  [800, 120, 1900],
  [1600, 120, 1600],
  [2500, 120, 1500],
  [2500, 140, -300],
  [2000, 120, -900],
  [2100, 120, -2300],
  [1000, 140, -2000],
  [-1700, 180, -1200],
  [-1980, 140, -500],
  [-2200, 140, 400],
  [-1000, 200, 800],
  [400, 140, 1500],
];

/** Cumulative arc lengths over {@link MAP_TOUR} — constant ground speed along the whole route. */
const MAP_TOUR_LENGTHS: number[] = [0];
for (let index = 1; index < MAP_TOUR.length; index += 1) {
  const [ax, ay, az] = MAP_TOUR[index - 1];
  const [bx, by, bz] = MAP_TOUR[index];
  MAP_TOUR_LENGTHS.push(MAP_TOUR_LENGTHS[index - 1] + Math.hypot(bx - ax, by - ay, bz - az));
}

export type BenchCameraScript = (frame: number, context: BenchContext) => CameraState;

export interface BenchContext {
  aspect: number;
  focus: readonly [number, number, number];
  radius: number;
}

/** Position + look-ahead direction at arc-length parameter t ∈ [0, 1] of the tour. */
function mapTourAt(t: number): { eye: [number, number, number]; forward: [number, number, number] } {
  const distance = t * MAP_TOUR_LENGTHS[MAP_TOUR_LENGTHS.length - 1];
  let segment = 1;
  while (segment < MAP_TOUR_LENGTHS.length - 1 && MAP_TOUR_LENGTHS[segment] < distance) {
    segment += 1;
  }
  const [ax, ay, az] = MAP_TOUR[segment - 1];
  const [bx, by, bz] = MAP_TOUR[segment];
  const span = MAP_TOUR_LENGTHS[segment] - MAP_TOUR_LENGTHS[segment - 1] || 1;
  const local = Math.min(1, Math.max(0, (distance - MAP_TOUR_LENGTHS[segment - 1]) / span));
  const forwardLength = Math.hypot(bx - ax, by - ay, bz - az) || 1;

  return {
    eye: [ax + (bx - ax) * local, ay + (by - ay) * local, az + (bz - az) * local],
    forward: [(bx - ax) / forwardLength, (by - ay) / forwardLength, (bz - az) / forwardLength],
  };
}

/** Pinned scenes. `orbit` = the M0 baseline; `close` = fill/A2C zoom; `drive` = the streaming stress
 *  (focus translates through the district — pairs with the M1 streaming driver). */
export const BENCH_SCENES: Record<string, BenchCameraScript> = {
  city(frame, { aspect, focus, radius }) {
    // FULL-CITY diagonal traverse (pairs with `?src=pak-ls`): corner-to-corner across the loaded district
    // at ~135 u/s, low altitude — the long-haul streaming + draw-distance stress. Deterministic by frame.
    const total = BENCH_WARMUP_FRAMES + BENCH_SCENE_MEASURE.city;
    const t = Math.min(1, frame / total);
    const span = radius * 0.9;
    const x = focus[0] - span + t * span * 2;
    const z = focus[2] + span - t * span * 2;
    const eye: [number, number, number] = [x, focus[1] + 60, z];

    return camera(aspect, eye, [x + 80, focus[1] + 20, z - 80]);
  },
  close(frame, { aspect, focus, radius }) {
    // Far → close zoom onto the district centre over the run (fill-rate + alpha inspection distances).
    const t = frame / (BENCH_WARMUP_FRAMES + BENCH_MEASURE_FRAMES);
    const r = radius * (1 - t * 0.96) + 8;
    const angle = 0.8;

    return camera(
      aspect,
      [focus[0] + Math.cos(angle) * r, focus[1] + r * 0.35 + 3, focus[2] + Math.sin(angle) * r],
      focus,
    );
  },
  drive(frame, { aspect, focus, radius }) {
    // Street-height translation across the district at ~drive speed (frame-indexed → deterministic).
    const speed = 0.9; // engine units per frame ≈ 54 u/s at 60 fps
    const x = focus[0] - radius + frame * speed;
    const eye: [number, number, number] = [x, focus[1] + 18, focus[2] + 40];

    return camera(aspect, eye, [x + 60, focus[1] + 4, focus[2] - 20]);
  },
  map(frame, { aspect }) {
    // WHOLE-MAP drive-style tour (pairs with `?src=pak-map`): LS → LV → SF → LS along pinned waypoints at
    // constant ~190 u/s — the cross-city streaming stress (ring turnover in every region, ocean legs
    // included). Absolute coords; the district focus/radius context is ignored on purpose.
    const total = BENCH_WARMUP_FRAMES + BENCH_SCENE_MEASURE.map;
    const { eye, forward } = mapTourAt(Math.min(1, frame / total));

    return camera(aspect, eye, [eye[0] + forward[0] * 150, eye[1] + forward[1] * 150 - 30, eye[2] + forward[2] * 150]);
  },
  orbit(frame, { aspect, focus, radius }) {
    const angle = frame * 0.003;

    return camera(
      aspect,
      [focus[0] + Math.cos(angle) * radius, focus[1] + radius * 0.42, focus[2] + Math.sin(angle) * radius],
      focus,
    );
  },
  teleport(frame, { aspect, focus, radius }) {
    // M1 stress: jump between district corners every 300 frames — full ring teardown + rebuild each hop.
    // The revisit pattern (corner 0 recurs) is exactly what caught the requested-mark lifecycle bug.
    const CORNERS: [number, number][] = [
      [-0.8, -0.8],
      [0.8, -0.8],
      [0.8, 0.8],
      [-0.8, 0.8],
      [0, 0],
      [-0.8, -0.8],
    ];
    const hop = Math.min(CORNERS.length - 1, Math.floor(frame / 300));
    const [ox, oz] = CORNERS[hop];
    const eye: [number, number, number] = [focus[0] + ox * radius, focus[1] + 90, focus[2] + oz * radius + 60];

    return camera(aspect, eye, [eye[0], focus[1] + 10, eye[2] - 120]);
  },
  whip(frame, { aspect, focus, radius }) {
    // M1 stress: fast 360° spins at street height — frustum churn, promote/demote storms at the ring edges.
    const angle = frame * 0.06; // ~full turn every 105 frames
    const eye: [number, number, number] = [focus[0], focus[1] + 25, focus[2]];

    return camera(aspect, eye, [
      focus[0] + Math.cos(angle) * radius * 0.6,
      focus[1] + 10 + Math.sin(frame * 0.013) * 30,
      focus[2] + Math.sin(angle) * radius * 0.6,
    ]);
  },
};

export interface BenchRecord {
  /** Converter metrics of the measured pak (074/11: tool regressions ride the same record). */
  converter?: { aoMs?: number; cells: number; pakMb: number; sunVisMs?: number; timedObjects?: number };
  date: string;
  draws: { avg: number; max: number };
  env: { adapter: string; dpr: number; height: number; search: string; width: number };
  frameMs: { avg: number; max: number; p50: number; p95: number };
  gpuPassMs: { avg: number; max: number; p95: number };
  heapMb: number;
  measuredFrames: number;
  residencyMb: number;
  scene: string;
  submitMs: { avg: number; max: number; p95: number };
}

/** Collects per-frame samples after warmup; `finish()` computes the record. */
export class BenchCollector {
  get currentFrame(): number {
    return this.frame;
  }
  /** True while more frames are needed. */
  get running(): boolean {
    return this.frame < BENCH_WARMUP_FRAMES + this.measureFrames;
  }

  private readonly draws: number[] = [];
  private frame = 0;
  private readonly frameMs: number[] = [];
  private readonly gpu: number[] = [];
  private lastStats: EngineStats | null = null;

  private readonly submit: number[] = [];

  constructor(private readonly measureFrames: number = BENCH_MEASURE_FRAMES) {}

  finish(scene: string, adapter: string, canvas: HTMLCanvasElement): BenchRecord {
    const heap = (performance as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;

    return {
      date: new Date().toISOString(),
      draws: { avg: avg(this.draws), max: Math.max(0, ...this.draws) },
      env: {
        adapter,
        dpr: window.devicePixelRatio,
        height: canvas.height,
        search: window.location.search,
        width: canvas.width,
      },
      frameMs: {
        avg: avg(this.frameMs),
        max: Math.max(0, ...this.frameMs),
        p50: percentile(this.frameMs, 50),
        p95: percentile(this.frameMs, 95),
      },
      gpuPassMs: { avg: avg(this.gpu), max: Math.max(0, ...this.gpu), p95: percentile(this.gpu, 95) },
      heapMb: Math.round(heap / (1024 * 1024)),
      measuredFrames: this.frameMs.length,
      residencyMb: Math.round((this.lastStats?.residencyBytes ?? 0) / (1024 * 1024)),
      scene,
      submitMs: { avg: avg(this.submit), max: Math.max(0, ...this.submit), p95: percentile(this.submit, 95) },
    };
  }

  sample(frameDtMs: number, stats: EngineStats): void {
    this.frame += 1;
    this.lastStats = stats;
    if (this.frame <= BENCH_WARMUP_FRAMES) {
      return;
    }
    this.frameMs.push(frameDtMs);
    this.submit.push(stats.submitMs);
    this.gpu.push(stats.gpuPassMs);
    this.draws.push(stats.drawsRecorded);
  }
}

export function downloadRecord(record: BenchRecord): void {
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `bench-${record.scene}-${record.date.slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

/** Trigger a JSON download of the record (the committed-series artifact). */
/** Converter metrics from the pak's `report.json` (best-effort — absent for the synthetic district). */
export async function fetchConverterMetrics(baseUrl: string): Promise<BenchRecord['converter']> {
  try {
    const response = await fetch(`${baseUrl}/report.json`);
    if (!response.ok) {
      return undefined;
    }
    const report = (await response.json()) as {
      ao?: null | { ms: number };
      cells: unknown[];
      pakBytes: number;
      sunVis?: null | { ms: number };
      timedObjects?: number;
    };

    return {
      ...(report.ao ? { aoMs: report.ao.ms } : {}),
      cells: report.cells.length,
      pakMb: Math.round(report.pakBytes / (1024 * 1024)),
      ...(report.sunVis ? { sunVisMs: report.sunVis.ms } : {}),
      ...(report.timedObjects !== undefined ? { timedObjects: report.timedObjects } : {}),
    };
  } catch {
    return undefined;
  }
}

export function formatRecord(record: BenchRecord): string {
  const f = record.frameMs;

  return (
    `BENCH ${record.scene} — DONE (${record.measuredFrames} frames)\n` +
    `frame       avg ${f.avg.toFixed(2)} p50 ${f.p50.toFixed(2)} p95 ${f.p95.toFixed(2)} max ${f.max.toFixed(1)} ms\n` +
    `submit CPU  avg ${record.submitMs.avg.toFixed(2)} p95 ${record.submitMs.p95.toFixed(2)} max ${record.submitMs.max.toFixed(2)} ms\n` +
    `GPU pass    avg ${record.gpuPassMs.avg.toFixed(2)} p95 ${record.gpuPassMs.p95.toFixed(2)} max ${record.gpuPassMs.max.toFixed(2)} ms\n` +
    `draws       avg ${record.draws.avg.toFixed(0)} max ${record.draws.max}\n` +
    `residency   ${record.residencyMb} MB · heap ${record.heapMb} MB\n` +
    `JSON downloaded — commit it per the 074/11 ritual`
  );
}

function avg(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function camera(aspect: number, eye: [number, number, number], target: readonly [number, number, number]): CameraState {
  return { aspect, eye, far: 10000, fovYRad: Math.PI / 3, near: 0.5, target, up: [0, 1, 0] };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
