/**
 * `audio.txt` — a vehicle mod's own line of FLA's `data/gtasa_vehicleAudioSettings.cfg`, the file the
 * reference install reads because `Enable vehicle audio loader = 1` is ON.
 *
 *   106veh   9   -1  -1  0   0.7   1.0   -1   1.0   -1   0   13   1   -1   0.0
 *
 * Fifteen columns, the first of which is the MODEL NAME (`; A … O` in the file's own legend): vehicle type,
 * the engine-on/off sound ids, horn, door, radio, and so on. The loader is keyed by name, so a replacement
 * car keeps its stock line unless it ships this file — nothing is inherited here (a `(base)` slot's line is
 * add-vehicles 003's business, where the car has no stock line to keep).
 *
 * Merge: replace the row whose first token is the model, append when there is none. An added row lands in
 * the block the file itself sets aside (`; ----- added vehicles -----`, right before `;the end`), which is
 * where fastman92 says to put it. Idempotent — the same file merged twice writes the same bytes.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const AUDIO_FILE = 'audio.txt';

/** FLA's vehicle audio loader table, inside the built game dir. */
export const AUDIO_CFG = join('data', 'gtasa_vehicleAudioSettings.cfg');

/** The comment the stock file ends with; a new row goes above it, inside the "added vehicles" block. */
const END_MARKER = ';the end';

/**
 * Apply a mod folder's `audio.txt` (if it ships one) to the built game dir. Returns warnings.
 *
 * The row's first token is FORCED to this car's model when one is known: the loader is keyed by name, and an
 * author who copies a donor's line and forgets to rename it would otherwise re-point the DONOR's sound —
 * silently, at the car whose folder they were editing.
 */
export function applyVehicleAudio(
  folderPath: string,
  entries: readonly string[],
  outPath: string,
  model?: string,
): string[] {
  const file = entries.find((name) => name.toLowerCase() === AUDIO_FILE);
  if (!file) {
    return [];
  }
  const rows = readFileSync(join(folderPath, file), 'latin1')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith(';'));
  if (rows.length === 0) {
    return [`${AUDIO_FILE}: no rows — the car keeps its stock engine sound`];
  }
  const warnings: string[] = [];
  const retargeted = rows.map((row) => {
    const authored = row.split(/\s+/)[0];
    if (model === undefined || authored.toLowerCase() === model.toLowerCase()) {
      return row;
    }
    warnings.push(`${AUDIO_FILE}: the row names '${authored}' — written for '${model}', whose folder it is in`);

    return retarget(row, model);
  });

  return [...warnings, ...writeAudioRows(outPath, retargeted, AUDIO_FILE)];
}

/** Replace the row of this model in place, or insert it into the file's "added vehicles" block. */
export function mergeAudioRow(lines: string[], row: string): void {
  const model = row.split(/\s+/)[0].toLowerCase();
  const at = lines.findIndex((line) => isDataRow(line) && line.trim().split(/\s+/)[0].toLowerCase() === model);
  if (at !== -1) {
    lines[at] = row;

    return;
  }
  const end = lines.findIndex((line) => line.trim().toLowerCase() === END_MARKER);
  lines.splice(end === -1 ? lines.length : end, 0, row);
}

/** The audio row of `model` in a built tree, verbatim, or null when the table has none for it. */
export function readAudioRow(gameDir: string, model: string): null | string {
  const path = join(gameDir, AUDIO_CFG);
  if (!existsSync(path)) {
    return null;
  }
  const wanted = model.toLowerCase();
  for (const line of readFileSync(path, 'latin1').split(/\r?\n/)) {
    if (isDataRow(line) && line.trim().split(/\s+/)[0].toLowerCase() === wanted) {
      return line.trim();
    }
  }

  return null;
}

/** The same row under another model name, the authored spacing kept. */
export function retarget(row: string, model: string): string {
  return row.replace(/^\s*\S+/, model);
}

/**
 * Merge rows into the built table: replace by model, else insert into the block the file sets aside. A row
 * whose column count is not the table's own is DROPPED with both counts named — the loader would read it
 * past its end, into the next line's fields.
 */
export function writeAudioRows(outPath: string, rows: readonly string[], source = AUDIO_FILE): string[] {
  const path = join(outPath, AUDIO_CFG);
  if (!existsSync(path)) {
    return [
      `${source}: ${AUDIO_CFG} is not in the tree — fastman92's vehicle audio loader is not in this ` +
        `build; ${rows.length} row(s) not written`,
    ];
  }
  const warnings: string[] = [];
  const text = readFileSync(path, 'latin1');
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  // The shape the file itself states: the column count of its first data row.
  const columns = fieldCount(lines.find((line) => isDataRow(line)) ?? '');
  for (const row of rows) {
    if (columns > 0 && fieldCount(row) !== columns) {
      warnings.push(
        `${source}: '${row.split(/\s+/)[0]}' has ${fieldCount(row)} columns, the table has ${columns} — row dropped`,
      );
      continue;
    }
    mergeAudioRow(lines, row);
  }
  writeFileSync(path, lines.join(newline), 'latin1');

  return warnings;
}

/** Whitespace-separated field count of a row. */
function fieldCount(line: string): number {
  const trimmed = line.trim();

  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/** A line the loader reads: not blank, not a `;` comment. */
function isDataRow(line: string): boolean {
  const trimmed = line.trim();

  return trimmed !== '' && !trimmed.startsWith(';');
}
