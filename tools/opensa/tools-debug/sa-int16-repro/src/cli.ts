import { argValue, fromCwd } from '@opensa/tool-kit/cli';
import { statSync } from 'node:fs';

import { inflate } from './inflate';

/**
 * SA int16 "ghost barriers" repro dial. Copies a built SA game dir and inflates its total permanent text-IPL row
 * count across (or below) 2^15 to reproduce the int16 building-pool truncation on demand — the pass/fail oracle
 * for the perfect-map ASI project (tools-debug/sa-int16-repro/docs/reproducing-the-int16-bug.md). Usage:
 *   tsx tools-debug/sa-int16-repro/src/cli.ts --game ./build/original/sa --out ./NO_COMMIT/repro-33k --rows 33000
 *     --rows <N>            target TOTAL text rows map-wide (33000 → expect bug; 32000 → expect clean)
 *     --model-id/-name      override the harvested dummy model (default: first valid stock id in the build)
 *     --allow-slot-overflow force past 39 text-IPL slots (entangles IplEntityIndexArrays — breaks isolation)
 * Paths resolve against the cwd. Drop the resulting `--out` into the Wine install; see the tool README.
 */
function main(): void {
  const gameArg = argValue('--game');
  const outArg = argValue('--out');
  const rowsArg = argValue('--rows');
  if (!gameArg || !outArg || !rowsArg) {
    throw new Error('usage: tsx tools-debug/sa-int16-repro/src/cli.ts --game <built-sa-dir> --out <dir> --rows <N>');
  }

  const gamePath = fromCwd(gameArg);
  if (!statSync(gamePath, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`--game must be a directory: ${gamePath}`);
  }
  const targetRows = Number(rowsArg);
  if (!Number.isInteger(targetRows) || targetRows <= 0) {
    throw new Error(`--rows must be a positive integer: ${rowsArg}`);
  }

  const modelIdArg = argValue('--model-id');
  const modelNameArg = argValue('--model-name');
  const model = modelIdArg && modelNameArg ? { id: Number(modelIdArg), name: modelNameArg } : undefined;

  inflate({
    allowSlotOverflow: process.argv.includes('--allow-slot-overflow'),
    gamePath,
    model,
    outPath: fromCwd(outArg),
    targetRows,
  });
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
