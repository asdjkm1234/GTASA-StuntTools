import type { PerfCapture } from './perf-monitor';

/**
 * Deterministic benchmark harness (plan 063). A scene = a streaming anchor (player teleport), fixed
 * hour/weather, and a camera path flown over a fixed duration while the {@link PerfMonitor} captures.
 * Implemented as a {@link Plugin} because plugins tick AFTER `cameraController.update` — the runner can own
 * the camera each frame without touching the controller.
 */

/** What the runner needs from the game (canvas-host wires the real methods in). */
export interface BenchKeyframe {
  /** World-space point the camera looks at. */
  look: Vec3Tuple;
  /** World-space camera position. */
  pos: Vec3Tuple;
}

export interface BenchReport extends PerfCapture {
  /** EMA GPU pass timings (ms) snapshotted at the end of the run, when the timer is available. */
  gpuMs?: Readonly<Record<string, number>>;
  key: string;
}

export interface BenchScene {
  /** Player teleport target — the streaming/collision anchor the camera path must stay near. */
  anchor: Vec3Tuple;
  /** Road-car population around the anchor (074 bench realism): cars from `vehicles.ide` (type `car`)
   *  scattered on the path-node road graph. `spacing` is the density knob — cities run dense (~30),
   *  the countryside sparse (~90). Omit for scenes with no reachable roads (the ocean). */
  cars?: { radius: number; spacing: number };
  /** Timed run length, seconds. */
  durationS: number;
  /** Game hour (fractional ok). */
  hour: number;
  key: string;
  /** Camera keyframes flown start→end over the duration (≥ 2). */
  path: readonly BenchKeyframe[];
  /** Weather index (timecyc weather id). */
  weather: number;
}

export type Vec3Tuple = readonly [number, number, number];

/** Settle margin before sampling starts — lets shader compiles/GPU uploads of the fresh ring drain. */

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const lerpVec = (a: Vec3Tuple, b: Vec3Tuple, t: number): Vec3Tuple => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

export function samplePath(path: readonly BenchKeyframe[], t: number): BenchKeyframe {
  if (path.length === 1) {
    return path[0];
  }
  const clamped = Math.min(1, Math.max(0, t));
  const scaled = clamped * (path.length - 1);
  const index = Math.min(path.length - 2, Math.floor(scaled));
  const local = scaled - index;
  const from = path[index];
  const to = path[index + 1];

  return { look: lerpVec(from.look, to.look, local), pos: lerpVec(from.pos, to.pos, local) };
}
