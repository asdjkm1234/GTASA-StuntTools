/**
 * Bench comparison (plan 074/11, ritual step 2):
 *
 *   npx tsx tools/opensa-pack/src/bench-compare.ts baseline.json candidate.json
 *
 * Prints deltas; exits 1 when frame p95 or GPU p95 regressed > 10 % (the gate) — a justified acceptance is a
 * written note in `bench/series.md`, not a silent merge.
 */
import { readFileSync } from 'node:fs';

interface Record {
  frameMs: { avg: number; max: number; p50: number; p95: number };
  gpuPassMs: { avg: number; max: number; p95: number };
  scene: string;
  submitMs: { avg: number; max: number; p95: number };
}

const GATE = 0.1;

function main(): void {
  const [baselinePath, candidatePath] = process.argv.slice(2);
  if (!baselinePath || !candidatePath) {
    console.error('usage: bench-compare <baseline.json> <candidate.json>');
    process.exitCode = 2;

    return;
  }
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as Record;
  const candidate = JSON.parse(readFileSync(candidatePath, 'utf8')) as Record;
  if (baseline.scene !== candidate.scene) {
    console.warn(`⚠ comparing different scenes: ${baseline.scene} vs ${candidate.scene}`);
  }

  let failed = false;
  const row = (name: string, before: number, after: number, gated: boolean): void => {
    const delta = before === 0 ? 0 : (after - before) / before;
    const mark = gated && delta > GATE ? ' ❌ REGRESSION' : delta < -0.05 ? ' ✅' : '';
    if (gated && delta > GATE) {
      failed = true;
    }
    console.log(
      `${name.padEnd(14)} ${before.toFixed(2).padStart(8)} → ${after.toFixed(2).padStart(8)} ms  (${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)} %)${mark}`,
    );
  };

  console.log(`scene: ${candidate.scene}`);
  row('frame p50', baseline.frameMs.p50, candidate.frameMs.p50, false);
  row('frame p95', baseline.frameMs.p95, candidate.frameMs.p95, true);
  row('frame max', baseline.frameMs.max, candidate.frameMs.max, false);
  row('submit p95', baseline.submitMs.p95, candidate.submitMs.p95, false);
  row('GPU p95', baseline.gpuPassMs.p95, candidate.gpuPassMs.p95, true);
  row('GPU max', baseline.gpuPassMs.max, candidate.gpuPassMs.max, false);

  if (failed) {
    console.error(`\ngate: >${GATE * 100} % regression on a gated metric — blocked (074/11 ritual)`);
    process.exitCode = 1;
  } else {
    console.log('\ngate: clean');
  }
}

main();
