/**
 * LOD-generator CLI. Takes `--game <path>` (a game-data dir: `gta.dat` + `data/` + `models/`). Without `--out` it
 * assembles the cell grid and prints a sizing report (Phase 0). With `--out <path>` it bakes every cell (merge →
 * decimate → normals → per-cell DFF/TXD) and emits a drop-in build under that directory. `--strip-lods` then
 * removes the stock `lod*` building LODs from that build (the cell-LODs replace them). The bake runs on
 * `--workers <n>` threads (default: half the cores; `1` = sequential). `--exclude <file.json>` (an array of
 * model names, e.g. mods-src/lod-exclude.json) keeps the listed models out of the cells entirely. Usage:
 * `tsx opensa-lod-generator/src/cli.ts --game <path> [--cell <size>] [--out <path>] [--strip-lods]
 * [--workers <n>] [--exclude <file.json>]`. Paths are relative to the current working directory (absolute
 * paths pass through).
 */
import { readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';

import { createGtaSaLodAdapter } from './adapters/gta-sa';
import { buildOpensaLods } from './build';
import { printSummary, summarizeCells } from './core';
import { config } from './lod.config';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fromCwd(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

async function main(): Promise<void> {
  const gameArg = argValue('--game');
  if (!gameArg) {
    throw new Error(
      'usage: tsx opensa-lod-generator/src/cli.ts --game <path> [--cell <size>] [--out <path>] [--strip-lods]',
    );
  }

  const gameDir = fromCwd(gameArg);
  if (!statSync(gameDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`--game must be a game-data directory: ${gameDir}`);
  }
  const label = basename(gameDir);

  const cellSize = Number(argValue('--cell') ?? config.cellSize);
  const adapter = createGtaSaLodAdapter(label, gameDir, { ...config, cellSize });
  const cells = adapter.resolveCells();
  printSummary(label, cellSize, summarizeCells(cells));

  const outArg = argValue('--out');
  if (outArg !== undefined) {
    const workersArg = argValue('--workers');
    const excludeArg = argValue('--exclude');
    const excludeItems = excludeArg
      ? (JSON.parse(readFileSync(fromCwd(excludeArg), 'utf8')) as string[]).map((name) => name.toLowerCase())
      : undefined;
    // `--holes <file.json>`: hole-fill models exempt from the reduction tracks (merged verbatim) —
    // the same per-game list pmb reads from mods-src/<id>/lod-holes.json.
    const holesArg = argValue('--holes');
    const holeFillModels = holesArg
      ? (JSON.parse(readFileSync(fromCwd(holesArg), 'utf8')) as string[]).map((name) => name.toLowerCase())
      : undefined;
    await buildOpensaLods({
      cellSize,
      config: {
        ...(workersArg !== undefined ? { workers: Number(workersArg) } : {}),
        ...(excludeItems ? { excludeItems } : {}),
        ...(holeFillModels ? { holeFillModels } : {}),
      },
      gameDir,
      outDir: fromCwd(outArg),
      stripLods: process.argv.includes('--strip-lods'),
    });
    console.log(`→ ${fromCwd(outArg)}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
