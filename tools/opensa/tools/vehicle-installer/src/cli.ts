/**
 * vehicle-installer CLI. Installs GTA-SA vehicle mod folders onto a base game. Usage:
 *   tsx tools/vehicle-installer/src/cli.ts --game <path> --in <vehicles-dir> --out <path>
 *     --game  base game tree (gta.dat + data/ + models/gta3.img …)
 *     --in    folder of vehicles (each an immediate subfolder: <model>.dff/.txd + <model>.settings.txt)
 *     --out   output install dir (wiped + rebuilt each run)
 *     --strip (optional, off by default) reduce gta3.img + the four data files to ONLY the installed vehicles
 *     --target sa|opensa  which layer of a LAYERED --in (common/sa/opensa) applies after common (plan 010)
 *
 * Or, against a game that is ALREADY BUILT (no full pipeline run):
 *   tsx tools/vehicle-installer/src/cli.ts --rebake <game> [--kind opensa|sa] [--only <model,model>]
 *                                                          [--target <dir>] [--in <dir>]
 *     re-merges every mod's settings into the built `data/*`, in place, and — `--kind opensa` (default) —
 *     re-converts its model into the archive's `<model>.osm`, or — `--kind sa` — replaces its raw `.dff`/`.txd`
 *     in the vehicles archive family. Defaults: --target build/<game>/<kind>, --in mods-src/<game>/vehicles.
 *   Per vehicle: dff/txd go into gta3.img (replace by name); settings merge into handling.cfg / vehicles.ide /
 *   carcols.dat (car/car4, alpha-sorted) / carmods.dat (mods, alpha-sorted).
 *   All paths are relative to the current working directory (absolute paths pass through).
 */
import { parseBuildTarget } from '@opensa/tool-kit/target';
import { statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { install } from './install';
import { rebakeVehicles } from './rebake';
import { rebakeVehiclesSa } from './rebake-sa';

/** Which built tree a rebake edits: a CONVERTED one (`.osm`) or a real-SA one (`.dff`/`.txd`). */
const REBAKE_KINDS = ['opensa', 'sa'] as const;
type RebakeKind = (typeof REBAKE_KINDS)[number];

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

  const rebakeArg = argValue('--rebake');
  if (rebakeArg !== undefined) {
    rebake(rebakeArg, rebakeKind(argValue('--kind')), inArg, argValue('--target'), argValue('--only'));

    return;
  }

  if (!gameArg || !inArg || !outArg) {
    throw new Error('usage: tsx tools/vehicle-installer/src/cli.ts --game <path> --in <vehicles-dir> --out <path>');
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

  const target = parseBuildTarget(argValue('--target'));
  install({ gamePath, inPath, outPath, strip: process.argv.includes('--strip'), ...(target ? { target } : {}) });
}

/**
 * `--rebake <game>`: re-run the vehicle half against the game ALREADY BUILT at `build/<game>/<kind>`, from
 * the mods at `mods-src/<game>/vehicles`. Both are the canonical layout and both can be overridden
 * (`--target`, `--in`); `--only a,b` narrows it to those models, which is the one-car turnaround.
 */
function rebake(
  game: string,
  kind: RebakeKind,
  inArg: string | undefined,
  targetArg: string | undefined,
  onlyArg: string | undefined,
): void {
  const targetPath = fromCwd(targetArg ?? join('build', game, kind));
  const inPath = fromCwd(inArg ?? join('mods-src', game, 'vehicles'));
  for (const [flag, path] of [
    ['--target', targetPath],
    ['--in', inPath],
  ] as const) {
    if (!statSync(path, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`${flag} must be a directory: ${path}`);
    }
  }

  const only = onlyArg
    ?.split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== '');
  // The rebake's kind IS the build target — a layered `--in` applies `common` + that layer.
  const options = { inPath, target: kind, targetPath, ...(only?.length ? { only } : {}) };
  const report = kind === 'sa' ? rebakeVehiclesSa(options) : rebakeVehicles(options);

  report.warnings.forEach((warning) => console.warn(`vehicle-installer: ${warning}`));
  for (const { error, model } of report.failed) {
    console.error(`vehicle-installer: ${model}: conversion FAILED — ${error}`);
  }
  for (const { model, reason } of report.refused) {
    console.error(`vehicle-installer: ${model}: REFUSED — ${reason}`);
  }
  for (const model of report.unplaced) {
    console.error(`vehicle-installer: ${model}: no archive in ${targetPath} took it`);
  }
  const bytes = report.rebaked.reduce((sum, entry) => sum + entry.bytes, 0);
  console.log(
    `vehicle-installer: rebaked ${report.rebaked.length} vehicle(s) into ${targetPath} ` +
      `(${(bytes / 1048576).toFixed(1)} MB of ${kind === 'sa' ? 'dff/txd' : '.osm'})` +
      (report.added.length > 0 ? `, ${report.added.length} NEW (${report.added.join(', ')})` : '') +
      (report.skipped.length > 0 ? `, ${report.skipped.length} skipped` : '') +
      (report.refused.length > 0 ? `, ${report.refused.length} refused` : '') +
      (report.failed.length > 0 ? `, ${report.failed.length} FAILED` : ''),
  );
}

function rebakeKind(value: string | undefined): RebakeKind {
  if (value === undefined) {
    return 'opensa';
  }
  if (!(REBAKE_KINDS as readonly string[]).includes(value)) {
    throw new Error(`--kind must be one of ${REBAKE_KINDS.join(', ')}: ${value}`);
  }

  return value as RebakeKind;
}

main();
