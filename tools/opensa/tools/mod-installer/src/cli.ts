/**
 * mod-installer CLI. Layers GTA-SA mod folders onto a base game. Usage:
 *   tsx tools/mod-installer/src/cli.ts --game <path> --in <mods-dir> --out <path>
 *     --game  base game tree (gta.dat + data/ + models/gta3.img …)
 *     --in    folder of mods (each an immediate subfolder mirroring the game tree, with optional `gta3_img/` / `gta_int_img/`)
 *     --out   output install dir (wiped + rebuilt each run)
 *     --target <sa|opensa>  which layer of a LAYERED --in applies after `common/` (plan 011). Required for a
 *             layered folder, ignored for a flat one (there is no layer to pick)
 *   Mods are applied alphabetically: plain files overwrite, `gta3_img/`/`gta_int_img/` entries merge into `gta3.img`/`gta_int.img`,
 *   `<target>.merge` files EDIT their target data file (see docs/plans/006-merge-data-edits.md).
 *   All paths are relative to the current working directory (absolute paths pass through).
 */
import { parseBuildTarget } from '@opensa/tool-kit/target';
import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { install } from './install';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fromCwd(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function main(): void {
  const gameArg = argValue('--game');
  const inArg = argValue('--in');
  const outArg = argValue('--out');

  if (!gameArg || !inArg || !outArg) {
    throw new Error('usage: tsx tools/mod-installer/src/cli.ts --game <path> --in <mods-dir> --out <path>');
  }

  const gamePath = fromCwd(gameArg);
  const inPath = fromCwd(inArg);
  const outPath = fromCwd(outArg);

  if (!statSync(gamePath, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`--game must be a directory: ${gamePath}`);
  }
  if (!statSync(inPath, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`--in must be a directory: ${inPath}`);
  }

  install({ gamePath, inPath, outPath, target: parseBuildTarget(argValue('--target')) });
}

main();
