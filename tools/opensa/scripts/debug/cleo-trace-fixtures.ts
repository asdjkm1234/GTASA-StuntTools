import { CORPUS_TRACE_RUNS, corpusTrace, decodeScript } from '@opensa/cleo';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Regenerate the corpus trace snapshots (plan 097/07 decision 6): one committed host-call story
 * per supported script, byte-for-byte deterministic (seeded random, canned host — the run configs
 * live with the package in `corpus-traces.ts`, shared with the regression test).
 *
 * Run after a deliberate handler/atlas behaviour change, then REVIEW THE DIFF — it is the change:
 *   npx tsx scripts/debug/cleo-trace-fixtures.ts
 */
const CORPUS = 'fixtures/original/cleo';
// The SOURCE of the mirror (`fixtures-src` → `fixtures/custom`, `npm run test:fixtures`), not the mirror.
const TRACES = 'fixtures-src/cleo-traces';

mkdirSync(TRACES, { recursive: true });
for (const run of CORPUS_TRACE_RUNS) {
  const script = decodeScript(new Uint8Array(readFileSync(`${CORPUS}/${run.name}.cs`)));
  const trace = corpusTrace(run, script);
  writeFileSync(`${TRACES}/${run.name}.txt`, trace);
  writeFileSync(`fixtures/custom/cleo-traces/${run.name}.txt`, trace); // and the mirror, so the test sees it now
  console.log(`${TRACES}/${run.name}.txt — ${trace.split('\n').length - 1} lines`);
}
