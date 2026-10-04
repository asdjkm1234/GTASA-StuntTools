/**
 * Reading `[phys]` captures (plan 081/01) — shared by `phys-compare.ts` (diff two runs) and
 * `phys-regression.ts` (gate a run against the committed pack). Both accept the same two shapes, because a
 * sweep is handed over either as the harness log it came out of or as the JSON array committed to
 * `docs/benchmarks/vehicle-physics/`.
 */
import { readFileSync } from 'node:fs';

export interface Capture {
  /** The in-air authority the driver had (081/06 §1) — the third dial a run states about itself. */
  readonly airControl?: Readonly<Record<string, number>>;
  readonly car: string;
  readonly columns: readonly string[];
  readonly key: string;
  readonly series: readonly (readonly number[])[];
  /** The self-description a capture carries: the speed-grip dials (081/09), the per-wheel springs the run was
   *  configured with, and the pose the car settled into. Optional — captures older than a field lack it. */
  readonly speedGrip?: Readonly<Record<string, number>>;
  readonly springs?: readonly Readonly<Record<string, number>>[];
  readonly stance?: Readonly<{
    mass?: number;
    weightOnGround?: number;
    wheels?: readonly Readonly<Record<string, boolean | number>>[];
  }>;
  readonly summary: Readonly<Record<string, unknown>>;
}

/** `car/key` — how a capture is paired with the same lap from another run. */
export function captureId(capture: Capture): string {
  return `${capture.car}/${capture.key}`;
}

/** Every capture in `paths`, keyed by {@link captureId}. A later file wins a duplicate id. */
export function loadCaptureMap(paths: readonly string[]): Map<string, Capture> {
  const entries = new Map<string, Capture>();
  for (const path of paths) {
    for (const capture of loadCaptures(path)) {
      entries.set(captureId(capture), capture);
    }
  }

  return entries;
}

/** Read one file: a raw harness log (the `[phys] {…}` lines are found inside it) or a JSON array. */
export function loadCaptures(path: string): Capture[] {
  const text = readFileSync(path, 'utf8');
  if (text.trimStart().startsWith('[')) {
    return JSON.parse(text) as Capture[];
  }
  const captures: Capture[] = [];
  for (const line of text.split('\n')) {
    const at = line.indexOf('[phys] {');
    if (at >= 0) {
      captures.push(JSON.parse(line.slice(at + '[phys] '.length)) as Capture);
    }
  }

  return captures;
}
