import type { OptimizerPasses } from '@opensa/map-optimizer/run';

import { argValue, fromCwd } from '@opensa/tool-kit/cli';
import { parseBuildTarget } from '@opensa/tool-kit/target';
/**
 * perfect-map-builder CLI. Chains every map tool into one build and splits it into the `sa` (real game) and
 * `opensa` LOD targets. Usage:
 *   tsx tools/perfect-map-builder/src/cli.ts --game <path> --in <mods-src> [--out <path>]
 *     --out            output build dir. Defaults to `./build/original` — the ONE canonical build every dev
 *                      surface reads (the lab, the harness and the object-viewer's AFTER side all mount
 *                      `./build/original/opensa`). Pass it only to build somewhere else.
 *     --until <stage>  stop after a stage (mods|vehicles|peds|optimize|trees|procobj|sa|opensa|pack) and KEEP
 *                      every intermediate build under `<out>/.work-<target>` — for step-by-step in-game
 *                      debugging.
 *                      The list is the pipeline ORDER and the stop point is INCLUSIVE, so every stage at or
 *                      before it runs: `--until pack` still builds the `sa` target, since `sa` precedes it.
 *                      `--until lod` runs the WHOLE pipeline (both sa + opensa) while keeping every step.
 *                      `--until opensa` stops at the LOD build, leaving `opensa/` in GAME format; a full run
 *                      (or `--until pack`) converts it, and `opensa/` is then our own format — bootable by
 *                      the own engine, not by the real game.
 *     --exclude <a,b>  SKIP the named stages and run everything else (repeatable; comma-separated). This is
 *                      the TARGET directive, where `--until` is the stop point: `--exclude sa` builds only
 *                      our target (the `build:game:<id>:opensa` scripts), `--exclude vehicles,peds,opensa`
 *                      builds only the real game's (`build:game:original:sa`). Excluding `opensa` drops
 *                      `pack` with it; excluding `pack` alone leaves `opensa/` in GAME format. An excluded
 *                      stage leaves whatever an earlier run wrote in its place — only the run's own
 *                      `<out>/.work-<target>` is cleared (plan 005) — so the two targets can be rebuilt
 *                      independently in the same `--out`, each with its own `report-<target>.json`.
 *     --target <host>  the host this build is FOR (sa|opensa) — it picks every knob whose right value is a
 *                      fact about the host: limits, particle policy, procobj density. Omitted, it is DERIVED
 *                      from `--exclude` (`--exclude sa` builds for opensa; a run that builds BOTH targets
 *                      shares one common chain and so resolves to `sa`, the host that still has ceilings).
 *                      `--target opensa` without `--exclude sa` is refused: the shared chain cannot carry a
 *                      profile the real game could not run.
 *     --procobj-density <n>  scatter density cutoff for the procobj stage: 1 = vanilla, max 3 (the scatter's
 *                      candidate ceiling). The knob 07/04's perf budgets sweep — the run prints the density
 *                      it built at, so a capture states its own configuration.
 *     --procobj-max <n>  raise the placed-object safety cap with the density (default 20000). Without it a
 *                      high-density run measures the CAP — the build prints CAP DROPPED when it binds.
 *     --keep-work      keep the intermediate `.work-<target>` builds even on a full run.
 *     --bake-collision write every cell's COLLISION into the pak (plan 200/3-01), so the browser never parses
 *                      a COL for a cell the bake covers. Costs build time; OFF by default, because it is the
 *                      A/B switch — the runtime reads the bake when it is there and parses COL when it is
 *                      not, so the SAME tree built twice, one flag apart, is what the claim is measured on.
 *     --resume         re-enter a FAILED run at its last finished step (plan 006): reads
 *                      `<out>/.work-<target>/resume.json`; refused if the sources, the flags or the code
 *                      changed since that run. Same flags as the run being resumed.
 *     --no-<pass>      disable a map-optimizer pass to bisect it: --no-weld-seams | --no-textures.
 * A `broken-prelight.json` at the mods-src root (or inside its `mods/` subfolder) is the map-optimizer
 * prelight FORCE list: the statistical pass runs map-wide and the listed models are additionally forced past
 * the skip-guards (same entry format as `--prelit-force` — see the map-optimizer README).
 * A `lod-exclude.json` (same locations; a JSON array of model names) keeps the listed models out of BOTH LOD
 * targets — the tool for high-poly street-furniture replacement mods that would explode the cell bake.
 * A FULL build needs a bigger heap: the opensa cell bake holds the (mod-grown, ~1.3 GB) gta3.img + merged cells
 * in memory — run with `NODE_OPTIONS=--max-old-space-size=12288` or the opensa stage dies mid-resolve with no
 * output (the classic "hung with no progress bar" OOM).
 * Paths are relative to the current working directory (absolute paths pass through). See `docs/plans/001`.
 */
import { statSync } from 'node:fs';

import { config as defaultConfig } from './config';
import { buildPerfectMap, parseExcludedStages, STAGE_NAMES, type StageName } from './pipeline';

/** The canonical build dir when `--out` is omitted — the single source every dev surface reads (plan 079). */
const DEFAULT_OUT = './build/original';

async function main(): Promise<void> {
  const gameArg = argValue('--game');
  const inArg = argValue('--in');
  const outArg = argValue('--out') ?? DEFAULT_OUT;
  if (!gameArg || !inArg) {
    throw new Error(
      'usage: tsx tools/perfect-map-builder/src/cli.ts --game <path> --in <mods-src> [--out <path>] ' +
        '[--target <sa|opensa>] [--until <stage>] [--exclude <stage,stage>] [--keep-work] [--no-<pass>] ' +
        '[--bake-collision]',
    );
  }

  const gamePath = fromCwd(gameArg);
  const inPath = fromCwd(inArg);
  for (const [flag, path] of [
    ['--game', gamePath],
    ['--in', inPath],
  ]) {
    if (!statSync(path, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`${flag} must be a directory: ${path}`);
    }
  }

  const until = argValue('--until');
  if (until !== undefined && !STAGE_NAMES.includes(until as StageName)) {
    throw new Error(`--until must be one of: ${STAGE_NAMES.join(' | ')}`);
  }

  const procobjDensity = numberArg('--procobj-density');
  const procobjMax = numberArg('--procobj-max');

  const optimizerPasses: Partial<OptimizerPasses> = {
    ...(process.argv.includes('--no-textures') ? { textures: false } : {}),
    ...(process.argv.includes('--no-weld-seams') ? { weldSeams: false } : {}),
  };

  // 200/3-01: bake the collision into the pak (the runtime reads it and falls back to COL without it), so
  // the same tree can produce both sides of the A/B by flipping one flag.
  const bakeCollision = process.argv.includes('--bake-collision');

  const { produced, stoppedEarly } = await buildPerfectMap({
    config: {
      optimizerPasses,
      ...(bakeCollision ? { pack: { ...defaultConfig.pack, bakeCollision: true } } : {}),
      ...(procobjDensity !== undefined ? { procobjDensity } : {}),
      ...(procobjMax !== undefined ? { procobjMax } : {}),
    },
    exclude: parseExcludedStages(process.argv),
    gamePath,
    inPath,
    keepWork: process.argv.includes('--keep-work'),
    outPath: fromCwd(outArg),
    resume: process.argv.includes('--resume'),
    target: parseBuildTarget(argValue('--target')),
    until: until as StageName | undefined,
  });

  console.log(stoppedEarly ? '\nstage builds (test each in-game):' : '\ndone:');
  for (const stage of produced) {
    console.log(`  ${stage.name.padEnd(9)} → ${stage.dir}`);
  }
}

/** A numeric flag, or undefined when absent. A typo has to fail loudly — `Number('x')` is NaN, and a NaN
 *  density silently keeps NOTHING (every `lottery < NaN` is false), i.e. an empty layer nobody asked for. */
function numberArg(flag: string): number | undefined {
  const raw = argValue(flag);
  if (raw === undefined) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${flag} must be a number: got '${raw}'`);
  }

  return value;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
