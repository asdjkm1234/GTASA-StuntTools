import { argValue, fromCwd } from '@opensa/tool-kit/cli';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { findArchivesWithEntry, patchImgEntry, readImgEntry } from '../lib/img-patch';
import { optimizeModel, type OptimizeVariant, printGeometryDiff, variantFromArgv } from '../lib/optimize-model';

/**
 * Run ONE model through the map-optimizer GEOMETRY chain (weld → degenerate → dedupe → prune → smooth-normals,
 * exactly `optimizer.config.ts` + `run.ts`'s addNormals/crease wiring) in memory, print what changed per
 * geometry (flags / TRISTRIP / NORMALS / PRELIT / triangles / vertices / bytes), write the DFF, and optionally
 * patch it straight into a built tree's archives (`scripts/lib/img-patch.ts`, seconds — no rebuild). The
 * instrument for the normals × repeat-texture × SkyGfx question in `docs/open-issues/fixed/sa-lod-visibility-budget.md`
 * rounds 9–10. Variants and what is NOT replayed: `scripts/lib/optimize-model.ts`.
 *
 * Run:
 *   npx tsx scripts/debug/model-optimize.ts <model…> --src game-src/original [--patch build/bisect-nomods/sa]
 *       [--out build/model-lab] [--no-add-normals | --strip-normals-after | --list-only | --restrip | --raw] [--crease <deg>]
 * `--src` is any game dir whose archives hold the model's PRE-optimizer bytes (`game-src/original`, or a
 * `--exclude optimize` build such as `build/bisect-nomods-noopt/sa`). `--patch` appends into every archive
 * of that tree carrying the name; `img-patch.ts restore <model>.dff --game <tree>` undoes it.
 * HD + its clone LOD in one go: `model-lab.ts`.
 */
interface Options {
  readonly crease: number | undefined;
  readonly out: string;
  readonly patch: string | undefined;
  readonly src: string;
  readonly targets: readonly string[];
  readonly variant: OptimizeVariant;
}

function main(): void {
  const options = parseArgs();
  mkdirSync(options.out, { recursive: true });
  for (const name of options.targets) {
    const archives = findArchivesWithEntry(options.src, `${name}.dff`);
    if (archives.length === 0) throw new Error(`${name}.dff is in no archive of ${options.src}`);
    // The last-registered archive is the one SA reads the model from.
    const source = readImgEntry(archives[archives.length - 1], `${name}.dff`);
    const result = optimizeModel(name, source, options.variant, options.crease);
    printGeometryDiff(`${name} [${options.variant}]`, source, result);
    const outPath = join(options.out, `${name}.${options.variant}.dff`);
    writeFileSync(outPath, result);
    console.log(`  → ${outPath}`);
    if (options.patch) {
      const targets = findArchivesWithEntry(options.patch, `${name}.dff`);
      if (targets.length === 0) throw new Error(`${name}.dff is in no archive of ${options.patch}`);
      for (const img of targets) {
        const { appendedAt } = patchImgEntry(img, `${name}.dff`, result);
        console.log(`  patched ${img} (appended at ${appendedAt})`);
      }
    }
  }
}

function parseArgs(): Options {
  const src = argValue('--src');
  if (!src) throw new Error('need --src <game dir with the pre-optimizer archives>');
  const flagValues = new Set([argValue('--crease'), argValue('--out'), argValue('--patch'), src]);
  const targets = process.argv.slice(2).filter((arg) => !arg.startsWith('--') && !flagValues.has(arg));
  if (targets.length === 0) throw new Error('usage: model-optimize.ts <model…> --src <dir> [--patch <dir>] …');
  const creaseArg = argValue('--crease');
  const patch = argValue('--patch');

  return {
    crease: creaseArg === undefined ? undefined : Number(creaseArg),
    out: fromCwd(argValue('--out') ?? 'build/model-lab'),
    patch: patch === undefined ? undefined : fromCwd(patch),
    src: fromCwd(src),
    targets: targets.map((name) => name.toLowerCase()),
    variant: variantFromArgv(),
  };
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
