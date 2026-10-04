/**
 * Compare two sets of `[phys]` captures (plan 081/01) — the `bench-compare` twin for driving.
 *
 *   npx tsx scripts/phys-compare.ts <before> <after> [--determinism]
 *
 * Each input is either a raw harness log (lines starting `[phys] {…}`) or a JSON array of captures, so the
 * sweep log can be handed over as-is. Captures pair up by `car` + scene `key`.
 *
 * Two modes, because the same diff answers two different questions:
 * - default — a TUNING comparison: print every summary delta and the largest per-signal series deviation.
 *   Change is the point here, so nothing fails.
 * - `--determinism` — the same build run twice: any signal outside {@link DETERMINISM_BANDS} is a failure,
 *   because a scene that does not replay cannot be a baseline for anything.
 */
import type { Capture } from './lib/phys-captures';

import { loadCaptureMap } from './lib/phys-captures';

/** How far a signal may move between two runs of the SAME build before the scene is not repeatable.
 *  Absolute, in each summary field's own unit. Everything not listed falls back to {@link DEFAULT_BAND}. */
const DETERMINISM_BANDS: Record<string, number> = {
  airborneS: 0.1,
  durationS: 0.05,
  pitchUnderBrakeDeg: 0.2,
  slipMaxDeg: 1,
  timeTo100S: 0.1,
  topSpeedKmh: 1,
  turnedDeg: 2,
};
const DEFAULT_BAND = 0.5;

/** Largest absolute deviation per column over the rows both captures have. */
function compareSeries(baseline: Capture, candidate: Capture): void {
  const rows = Math.min(baseline.series.length, candidate.series.length);
  if (rows === 0) {
    return;
  }
  const worst = baseline.columns.map((column, index) => {
    let max = 0;
    for (let row = 0; row < rows; row += 1) {
      max = Math.max(max, Math.abs((candidate.series[row][index] ?? 0) - (baseline.series[row][index] ?? 0)));
    }

    return `${column} ${max.toFixed(3)}`;
  });
  const note = baseline.series.length === candidate.series.length ? '' : ` (over ${rows} shared rows)`;
  console.log(`  series max |Δ|${note}: ${worst.join(' · ')}`);
}

/** Print every scalar summary field; in determinism mode, fail the ones outside their band. */
function compareSummaries(baseline: Capture, candidate: Capture, determinism: boolean): boolean {
  let failed = false;
  for (const [field, before] of Object.entries(baseline.summary)) {
    const after = candidate.summary[field];
    for (const [label, a, b] of scalarPairs(field, before, after)) {
      const delta = b - a;
      const band = DETERMINISM_BANDS[field] ?? DEFAULT_BAND;
      const out = determinism && Math.abs(delta) > band;
      failed = failed || out;
      const arrow = `${a.toFixed(2).padStart(9)} → ${b.toFixed(2).padStart(9)}`;
      console.log(
        `  ${label.padEnd(22)} ${arrow}  (${delta >= 0 ? '+' : ''}${delta.toFixed(2)})${out ? ` ❌ > ${band}` : ''}`,
      );
    }
  }

  return failed;
}

function main(): void {
  const args = process.argv.slice(2);
  const determinism = args.includes('--determinism');
  const [beforePath, afterPath] = args.filter((arg) => !arg.startsWith('--'));
  if (!beforePath || !afterPath) {
    console.error('usage: npx tsx scripts/phys-compare.ts <before> <after> [--determinism]');
    process.exitCode = 2;

    return;
  }
  const before = loadCaptureMap([beforePath]);
  const after = loadCaptureMap([afterPath]);
  let failed = false;

  for (const [id, candidate] of after) {
    const baseline = before.get(id);
    if (!baseline) {
      console.log(`\n${id}: only in the second capture — nothing to compare`);
      continue;
    }
    console.log(`\n=== ${id} ===`);
    failed = compareSummaries(baseline, candidate, determinism) || failed;
    compareSeries(baseline, candidate);
  }
  for (const id of before.keys()) {
    if (!after.has(id)) {
      console.log(`\n${id}: MISSING from the second capture`);
      failed = true;
    }
  }
  if (determinism) {
    console.log(failed ? '\n❌ scenes did NOT replay within their bands' : '\n✅ every scene replayed in band');
    process.exitCode = failed ? 1 : 0;
  }
}

/**
 * Flatten one summary field into comparable `[label, before, after]` rows: plain numbers pass through, the
 * nested groups (`brake`, `flip`, the g/angle ranges) expand one row per member, and a field that is null on
 * either side is skipped — "the lap never braked" is not a zero and must not be diffed as one.
 */
function scalarPairs(field: string, before: unknown, after: unknown): [string, number, number][] {
  if (typeof before === 'number' && typeof after === 'number') {
    return [[field, before, after]];
  }
  if (before === null || after === null || typeof before !== 'object' || typeof after !== 'object') {
    return [];
  }
  const rows: [string, number, number][] = [];
  for (const [member, value] of Object.entries(before as Record<string, unknown>)) {
    const other = (after as Record<string, unknown>)[member];
    if (typeof value === 'number' && typeof other === 'number') {
      rows.push([`${field}.${member}`, value, other]);
    }
  }

  return rows;
}

main();
