/**
 * Corpus trace snapshots (plan 097/07 decision 6): every supported script's headless HOST-CALL
 * story, byte-for-byte reproducible — the physics-CI philosophy applied to scripts. The committed
 * fixtures live in `fixtures/custom/cleo-traces/`; `scripts/debug/cleo-trace-fixtures.ts` regenerates
 * them and `corpus-traces.test.ts` fails when a handler/atlas change moves any story.
 *
 * Everything nondeterministic is pinned HERE, shared by the test and the generator: the per-script
 * host options mirror `corpus.test.ts` (which cars exist, door ratios) and the runner random is a
 * seeded LCG (windfarm rolls 0208 GENERATE_RANDOM_FLOAT_IN_RANGE for its turbine headings).
 */
import type { DecodedScript } from '../core/decode';
import type { RecordingHostOptions } from './recording-host';

import { createRecordingHost } from './recording-host';
import { ScriptRunner } from './runner';

export interface CorpusTraceRun {
  readonly frames: number;
  readonly host: RecordingHostOptions;
  readonly name: string;
}

/** One run per corpus script — the host setups are the ones the VM corpus tests prove out. */
export const CORPUS_TRACE_RUNS: readonly CorpusTraceRun[] = [
  { frames: 60, host: {}, name: 'cardoor-bus' },
  { frames: 60, host: {}, name: 'cardoor-coach' },
  { frames: 60, host: {}, name: 'ferris' },
  { frames: 60, host: { cars: [{ handle: 257, model: 544 }] }, name: 'firela' },
  { frames: 60, host: { cars: [{ handle: 257, model: 432 }] }, name: 'rhino' },
  { frames: 60, host: { cars: [{ handle: 513, model: 582 }], doorAngleRatio: 0.5 }, name: 'vandoor' },
  { frames: 60, host: {}, name: 'windfarm' },
];

/** Fixture head size: enough story to review, bounded for git (vandoor alone produces ~118 000
 *  calls in 60 frames — a WAIT-less probe loop). The footer keeps the TOTAL, so a change that only
 *  moves the volume still fails the snapshot. */
const TRACE_HEAD = 400;

/** Run one corpus script headless and return its host-call story (one call per line). */
export function corpusTrace(run: CorpusTraceRun, script: DecodedScript): string {
  const host = createRecordingHost(run.host);
  const runner = new ScriptRunner({ host, random: seededRandom(0x097) });
  runner.spawn(script, run.name);
  for (let frame = 0; frame < run.frames; frame += 1) {
    runner.tick(1000 / 60);
  }
  const lines = [...host.calls, ...runner.faults.map((fault) => `! fault ${fault.thread}: ${fault.message}`)];
  const shown = lines.slice(0, TRACE_HEAD);
  if (lines.length > shown.length) {
    shown.push(`… ${lines.length - shown.length} more calls (${lines.length} total)`);
  }

  return `${shown.join('\n')}\n`;
}

/** mulberry32 — a tiny deterministic stand-in for Math.random (same seed, same story). */
function seededRandom(seed: number): () => number {
  let state = seed;

  return (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
