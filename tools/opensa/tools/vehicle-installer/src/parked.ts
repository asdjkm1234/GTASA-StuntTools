/**
 * `parked.txt` — where a car stands parked, for **Parked Maker 3.0.2** (mod `47` of the `sa` layer).
 *
 *   35 35 2495.98 -1673.15 13.25 0.00
 *
 * The mod ships no readme; its script states the shape itself — it reads each `[Cars]` row with
 * `%i %i %i %f %f %f %f`, so a row is `<model id> <colour1> <colour2> <x> <y> <z> <angle>`. A `parked.txt`
 * carries that line WITHOUT the id, because the id is ours to fill in: the slot's for a replacement car,
 * the allocated one for an added car (add-vehicles 003).
 *
 * The rows are written into the built `cleo/Parked Car Maker.ini` under `[Cars]`, numbered from the highest
 * key present, idempotent by the whole value (id + line). It needs FLA's `Accept any ID for car generator`
 * (ON in the reference install) for anything above the stock id range to spawn at all.
 *
 * **The budget is reported, not rationed** — see `docs/gta-sa-original/car-generators-500-and-the-map-1045.md`:
 * a row here is created through CLEO and holds one of the 500 car-generator slots for the whole session,
 * while the map's 1045 records come and go with their IPL stream. What share of 500 the resident map
 * generators want has never been measured, so a percentage here would be a guess. Our rows alone reaching
 * the limit is the one unambiguous failure, and that one refuses.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ideModelNames } from './tuning-parts';

export const PARKED_FILE = 'parked.txt';

/** Parked Maker's own ini, inside the built game dir. */
export const PARKED_INI = join('cleo', 'Parked Car Maker.ini');

/** FLA's ini, read for the car-generator limit it applies. */
const FLA_INI = 'fastman92limitAdjuster_GTASA.ini';

/** What FLA's ini states as the game's own number, and what its log confirms it applies when commented. */
const DEFAULT_CAR_GENERATORS = 500;

/** `<colour1> <colour2> <x> <y> <z> <angle>` — the script's row minus the id it does not author. */
const PARKED_COLUMNS = 6;

/** Apply a mod folder's `parked.txt` (if it ships one) to the built game dir. Returns warnings. */
export function applyVehicleParked(
  folderPath: string,
  entries: readonly string[],
  outPath: string,
  model: string | undefined,
  /**
   * The model id, when the CALLER knows it. An ADDED car's `vehicles.ide` row is written beside its models
   * for Mod Loader to merge, not into `data/` — so looking the id up in the tree's IDE files finds nothing
   * and the car is parked nowhere, silently but for one warning. `tools/add-vehicles` passes it here.
   */
  modelId?: number,
): string[] {
  const file = entries.find((name) => name.toLowerCase() === PARKED_FILE);
  if (!file) {
    return [];
  }
  const rows = readFileSync(join(folderPath, file), 'latin1')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith(';') && !line.startsWith('#'));
  if (rows.length === 0) {
    return [`${PARKED_FILE}: no rows — the car is parked nowhere`];
  }
  if (model === undefined) {
    return [`${PARKED_FILE}: the folder ships no model to look an id up for — ${rows.length} row(s) not written`];
  }
  const id = modelId ?? ideModelNames(outPath).get(model.toLowerCase());
  if (id === undefined) {
    return [`${PARKED_FILE}: no IDE row in the tree defines '${model}' — ${rows.length} row(s) not written`];
  }
  const path = join(outPath, PARKED_INI);
  if (!existsSync(path)) {
    return [
      `${PARKED_FILE}: ${PARKED_INI} is not in the tree — Parked Maker 3.0.2 is not in this build; ` +
        `${rows.length} row(s) not written`,
    ];
  }
  const warnings: string[] = [];
  const valid = rows.filter((row) => {
    if (row.split(/\s+/).length === PARKED_COLUMNS) {
      return true;
    }
    warnings.push(
      `${PARKED_FILE}: "${row}" has ${row.split(/\s+/).length} columns, Parked Maker reads ` +
        `${PARKED_COLUMNS} after the id (colour, colour, x, y, z, angle) — row dropped`,
    );

    return false;
  });
  if (valid.length === 0) {
    return warnings;
  }
  const text = readFileSync(path, 'latin1');
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  for (const row of valid) {
    mergeParkedRow(lines, `${id} ${row}`);
  }
  writeFileSync(path, lines.join(newline), 'latin1');
  const held = countParkedRows(lines);
  assertCarGeneratorBudget(outPath, held);
  console.log(`vehicle-installer: parked → ${PARKED_INI} (${held} row(s) of ${carGeneratorLimit(outPath)} slots)`);

  return warnings;
}

/**
 * Refuse a tree whose parked rows alone reach FLA's car-generator array — every row is created through CLEO
 * and holds its slot for the whole session, so at the limit the map's own generators get none. That is the
 * only unambiguous number: what share the RESIDENT map generators want has never been measured here, so a
 * threshold below the limit would be a fitted constant standing in for a measurement (the count is logged
 * on every run instead).
 */
export function assertCarGeneratorBudget(outPath: string, rows: number): void {
  const limit = carGeneratorLimit(outPath);
  if (rows >= limit) {
    throw new Error(
      `${PARKED_INI} holds ${rows} [Cars] row(s) against FLA's car-generator limit of ${limit}. Every row is ` +
        `created through CLEO and holds its slot for the whole session, so the map's own generators would ` +
        `have none left. Raise 'Car generators' in ${FLA_INI} or ship fewer parked cars ` +
        `(docs/gta-sa-original/car-generators-500-and-the-map-1045.md).`,
    );
  }
}

/** How many `N=<value>` rows the `[Cars]` section holds. */
export function countParkedRows(lines: readonly string[]): number {
  return carsSection(lines).filter((line) => parseRow(line) !== null).length;
}

/** Add the row to `[Cars]` under the next free key, unless the exact value is already there. */
export function mergeParkedRow(lines: string[], value: string): void {
  const section = carsSection(lines);
  let highest = -1;
  for (const line of section) {
    const row = parseRow(line);
    if (row === null) {
      continue;
    }
    if (row.value === value) {
      return;
    }
    highest = Math.max(highest, row.key);
  }
  const header = lines.findIndex((line) => line.trim().toLowerCase() === '[cars]');
  if (header === -1) {
    lines.push('[Cars]', `${highest + 1}=${value}`);

    return;
  }
  let at = header + 1;
  while (at < lines.length && !/^\s*\[/.test(lines[at])) {
    at += 1;
  }
  // Past the section's last row, but above any trailing blank lines it ends with.
  while (at > header + 1 && lines[at - 1].trim() === '') {
    at -= 1;
  }
  lines.splice(at, 0, `${highest + 1}=${value}`);
}

/** `Car generators = N` from the built FLA ini; commented or absent = the 500 its log says it applies. */
function carGeneratorLimit(outPath: string): number {
  const path = join(outPath, FLA_INI);
  if (!existsSync(path)) {
    return DEFAULT_CAR_GENERATORS;
  }
  for (const line of readFileSync(path, 'latin1').split(/\r?\n/)) {
    const match = /^\s*Car generators\s*=\s*(\d+)/i.exec(line);
    if (match) {
      return Number(match[1]);
    }
  }

  return DEFAULT_CAR_GENERATORS;
}

/** The lines between `[Cars]` and the next section header (or the end of the file). */
function carsSection(lines: readonly string[]): string[] {
  const start = lines.findIndex((line) => line.trim().toLowerCase() === '[cars]');
  if (start === -1) {
    return [];
  }
  const rest = lines.slice(start + 1);
  const next = rest.findIndex((line) => /^\s*\[/.test(line));

  return next === -1 ? rest : rest.slice(0, next);
}

/** `0=19773 35 35 …` → its key and value. */
function parseRow(line: string): null | { key: number; value: string } {
  const match = /^\s*(\d+)\s*=(.*)$/.exec(line);
  const value = match?.[2].trim() ?? '';

  return match === null || value === '' ? null : { key: Number(match[1]), value };
}
