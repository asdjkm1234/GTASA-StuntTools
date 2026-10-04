import { parseCarcols } from '@opensa/renderware/parsers/text/carcols.parser';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { PaletteColor } from './settings';

/** FLA's ini, read for the vehicle-colour table size it would apply. */
const FLA_INI = 'fastman92limitAdjuster_GTASA.ini';

/** What FLA's ini states as the game's own `CVehicleModelInfo::ms_vehicleColourTable` length. */
const STOCK_VEHICLE_COLOURS = 128;

/**
 * Append a vehicle's custom colours to `carcols.dat`'s `col` section and return the `newN → id` mapping. The id of
 * each new colour is its position in the palette (the engine indexes `col` by line order), continuing from the
 * current palette length — so colours from successive vehicles accumulate (127, 128, then 129, …). The appended
 * `col` line has its `newN` token rewritten to the assigned id (the `# 127` comment). No-op for an empty palette
 * or a file without a `col` section.
 *
 * **A colour already in the palette is REUSED, not appended again.** Until 2026-08-19 every re-run added the
 * same rows once more and re-pointed the car at the new ids: the shipping build carries three such twins
 * (`spinnaker blue solid` at 131 AND 138, `coral red` at 132 AND 139, `jlf beige` at 134 AND 137) and the
 * palette grew by 5 on every `--rebake` of the cars that author colours. Nothing said so, and the palette is
 * a FIXED-SIZE table in the game (`docs/gta-sa-original/vehicle-colour-table-128.md`), so the growth was
 * walking a real ceiling. A colour is "the same" when its RGB and its description both match — the id in the
 * comment is ours and is ignored.
 */
export function addPaletteColors(
  carcolsText: string,
  palette: readonly PaletteColor[],
): { idByName: Map<string, number>; text: string } {
  const idByName = new Map<string, number>();
  if (palette.length === 0) {
    return { idByName, text: carcolsText };
  }
  const eol = carcolsText.includes('\r\n') ? '\r\n' : '\n';
  const lines = carcolsText.split(/\r?\n/);
  const colEnd = sectionEnd(lines, 'col');
  if (colEnd < 0) {
    return { idByName, text: carcolsText };
  }

  const existing = new Map(paletteRows(lines).map(({ id, key }) => [key, id]));
  let next = parseCarcols(carcolsText).palette.length;
  const colLines: string[] = [];
  for (const color of palette) {
    const key = colorKey(replaceWord(color.line, color.name, ''));
    const already = existing.get(key);
    if (already !== undefined) {
      idByName.set(color.name, already);
      continue;
    }
    idByName.set(color.name, next);
    colLines.push(replaceWord(color.line, color.name, String(next)));
    existing.set(key, next);
    next += 1;
  }
  lines.splice(colEnd, 0, ...colLines);

  return { idByName, text: lines.join(eol) };
}

/** Replace each symbolic colour name (`newN`) in a carcols line with its assigned numeric id. */
export function resolveColorRefs(line: string, idByName: ReadonlyMap<string, number>): string {
  let out = line;
  for (const [name, id] of idByName) {
    out = replaceWord(out, name, String(id));
  }

  return out;
}

/**
 * Report a `carcols.dat` whose `col` palette is longer than the colour table the game will hold it in.
 *
 * The table is a FIXED array (`Vehicle colors (128)` by FLA's own ini, which is COMMENTED OUT in the
 * reference install, so 128 is what runs). Stock ships 127 rows; the shipping build already carries 140,
 * and 115 added cars take it to 160 — see `docs/gta-sa-original/vehicle-colour-table-128.md`.
 *
 * **Warned, not refused**, and deliberately: the overflow is inferred from the adjuster's stated default,
 * not from a disassembly, and the build it would refuse is one the user plays every day. Raising
 * `Vehicle colors` in the FLA ini is the fix; confirming the array size is what would turn this into a
 * hard guard.
 */
export function vehicleColourWarnings(gameDir: string): string[] {
  const path = join(gameDir, 'data', 'carcols.dat');
  if (!existsSync(path)) {
    return [];
  }
  const rows = paletteRows(readFileSync(path, 'latin1').split(/\r?\n/));
  const limit = vehicleColourLimit(gameDir);
  if (rows.length <= limit) {
    return [];
  }
  const twins = rows.length - new Set(rows.map(({ key }) => key)).size;

  return [
    `carcols.dat holds ${rows.length} palette colours against a table of ${limit}` +
      (twins > 0 ? ` (${twins} of them duplicates of another row)` : '') +
      `. Raise 'Vehicle colors' in ${FLA_INI}, or drop colours: past the table the loader writes into ` +
      `whatever follows it (docs/gta-sa-original/vehicle-colour-table-128.md)`,
  ];
}

/**
 * What makes two palette rows the same colour: the RGB triple plus the description, with the leading id
 * token of the comment dropped (that number is assigned by us) and whitespace collapsed — the authored line
 * and the row it became must compare equal.
 */
function colorKey(line: string): string {
  const hash = line.indexOf('#');
  const rgb = (hash < 0 ? line : line.slice(0, hash)).split(',').map((cell) => cell.trim());
  const words = (hash < 0 ? '' : line.slice(hash + 1)).trim().split(/\s+/);
  const description = (/^\d+$/.test(words[0] ?? '') ? words.slice(1) : words).join(' ').toLowerCase();

  return `${rgb.join(',')}|${description}`;
}

/** The `col` rows of a carcols file, in order, with the id each holds by position. */
function paletteRows(lines: readonly string[]): { id: number; key: string }[] {
  const rows: { id: number; key: string }[] = [];
  let inSection = false;
  for (const line of lines) {
    const token = line.trim().toLowerCase();
    if (!inSection) {
      inSection = token === 'col';
      continue;
    }
    if (token === 'end') {
      break;
    }
    if (token !== '' && !token.startsWith('#')) {
      rows.push({ id: rows.length, key: colorKey(line) });
    }
  }

  return rows;
}

/** Replace `word` as a whole token (so `new1` never matches inside `new10`). */
function replaceWord(text: string, word: string, replacement: string): string {
  return text.replace(new RegExp(`\\b${word}\\b`, 'g'), replacement);
}

/** Index of the `end` that closes `<section>`, or -1 if the section is absent. */
function sectionEnd(lines: readonly string[], section: string): number {
  let inSection = false;
  for (let i = 0; i < lines.length; i += 1) {
    const token = lines[i].trim().toLowerCase();
    if (!inSection) {
      inSection = token === section;
    } else if (token === 'end') {
      return i;
    }
  }

  return -1;
}

/** `Vehicle colors = N` from the built FLA ini; commented or absent = the game's own 128. */
function vehicleColourLimit(gameDir: string): number {
  const path = join(gameDir, FLA_INI);
  if (!existsSync(path)) {
    return STOCK_VEHICLE_COLOURS;
  }
  for (const line of readFileSync(path, 'latin1').split(/\r?\n/)) {
    const match = /^\s*Vehicle colors\s*=\s*(\d+)/i.exec(line);
    if (match) {
      return Number(match[1]);
    }
  }

  return STOCK_VEHICLE_COLOURS;
}
