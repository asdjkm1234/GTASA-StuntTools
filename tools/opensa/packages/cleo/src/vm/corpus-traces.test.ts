import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { decodeScript } from '../core/decode';
import { CORPUS_TRACE_RUNS, corpusTrace } from './corpus-traces';

/**
 * The trace-snapshot regression (plan 097/07 decision 6): a handler/atlas change that moves any
 * script's host-call story fails here. Regenerate deliberately with
 * `npx tsx scripts/debug/cleo-trace-fixtures.ts` and review the diff — the diff IS the behaviour
 * change.
 */
const CORPUS = 'fixtures/original/cleo';
const TRACES = 'fixtures/custom/cleo-traces';

describe.skipIf(!existsSync(CORPUS) || !existsSync(TRACES))('corpus trace snapshots', () => {
  describe('positive cases', () => {
    it.each(CORPUS_TRACE_RUNS.map((run) => run.name))('reproduces the committed %s trace byte for byte', (name) => {
      const run = CORPUS_TRACE_RUNS.find((candidate) => candidate.name === name);
      if (!run) {
        throw new Error(`no trace run named ${name}`);
      }
      const script = decodeScript(new Uint8Array(readFileSync(`${CORPUS}/${name}.cs`)));

      expect(corpusTrace(run, script)).toBe(readFileSync(`${TRACES}/${name}.txt`, 'utf8'));
    });
  });
});
