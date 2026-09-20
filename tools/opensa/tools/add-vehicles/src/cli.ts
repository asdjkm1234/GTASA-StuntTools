/**
 * add-vehicles CLI. Installs ADDED vehicles — new model ids — into a BUILT `sa` tree, IN PLACE. Usage:
 *   tsx tools/add-vehicles/src/cli.ts --game <built sa tree> [--in <root>] [--only <slot,slot>] [--plan]
 *     --game  the BUILT `sa` tree the cars are added to (its `data/vehicles.ide` defines the base slots)
 *     --in    the added-vehicles root (default `mods-src/original/add-vehicles`)
 *     --only  narrow the run to these slots — ids are still allocated for the whole source, so a narrowed
 *             run can never hand one car the id a full run would give another
 *     --plan  resolve and report only; write nothing
 *
 * The tree is edited in place, like `vehicle-installer --rebake --kind sa`: an added car is added to a build
 * that already exists, so there is no source game to copy from and no output to wipe.
 */
import { statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import { addVehicles } from './install';
import { ADD_VEHICLES_DIR, resolveAddedVehicles } from './sources';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fromCwd(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function main(): void {
  const gameArg = argValue('--game');
  if (!gameArg) {
    throw new Error(
      `usage: tsx tools/add-vehicles/src/cli.ts --game <built sa tree> [--in <root>] [--only <slot,slot>] [--plan]`,
    );
  }
  const gamePath = fromCwd(gameArg);
  const inPath = fromCwd(argValue('--in') ?? join('mods-src', 'original', ADD_VEHICLES_DIR));
  for (const [flag, path] of [
    ['--game', gamePath],
    ['--in', inPath],
  ]) {
    if (!statSync(path, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error(`${flag} must be a directory: ${path}`);
    }
  }
  const only = argValue('--only')
    ?.split(',')
    .map((slot) => slot.trim().toLowerCase())
    .filter((slot) => slot !== '');

  if (process.argv.includes('--plan')) {
    const { plan, sources } = resolveAddedVehicles(inPath, gamePath);
    for (const skipped of plan.layersSkipped) {
      console.log(`add-vehicles: layer ${skipped} present but not applied (target sa)`);
    }
    for (const { by, replaced, slot } of plan.overrides) {
      console.log(`add-vehicles: ${by} replaces ${replaced} for slot '${slot}'`);
    }
    const selected = only ? sources.filter((source) => only.includes(source.slot)) : sources;
    for (const source of selected) {
      console.log(`add-vehicles: ${source.slot} (base ${source.bases.join(', ')}) — ${source.name}`);
    }
    console.log(`add-vehicles: ${selected.length} of ${sources.length} added car(s) resolved from ${inPath}`);

    return;
  }

  const report = addVehicles({ gamePath, inPath, ...(only ? { only } : {}) });
  report.warnings.forEach((warning) => console.warn(`add-vehicles: ${warning}`));
  for (const { bases, id, kind, slot } of report.installed) {
    console.log(`add-vehicles: ${slot} → id ${id} (${kind === 'part' ? 'part of' : 'base'} ${bases.join(', ')})`);
  }
  const cars = report.installed.filter(({ kind }) => kind === 'car').length;
  console.log(
    `add-vehicles: ${cars} car(s) and ${report.installed.length - cars} tuning part(s) installed into ` +
      `${gamePath}, ${report.skipped} car(s) skipped`,
  );
}

main();
