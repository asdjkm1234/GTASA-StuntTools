/**
 * `tuning_new_parts.txt` — a vehicle mod's NEW tuning parts (plan 009).
 *
 * A mod that ships parts the game never had (`spl_b_lr_bl.dff` for the blade) needs three things the
 * `carmods.dat` `mods` line alone cannot give it: an IDE row per part (`1194, spl_b_lr_bl, blade, 100, 0`,
 * the `veh_mods.ide` shape), a shop that sells it (`data/shopping.dat` `section shops` → `section carmod2` →
 * `item spl_b_lr_bl`) and a price (`section prices` → `section CarMods` → `spl_b_lr_bl  SAVST  respect 0
 * sexy 0  1000`). The file carries all three, in blocks:
 *
 *   1194, spl_b_lr_bl, blade, 100, 0            ← bare IDE rows, anywhere outside a block
 *   shops.carmod2|exh_lr_bl2                    ← "<top>.<section>|<anchor>": insert AFTER the anchor line
 *   item spl_b_lr_bl
 *   end
 *   prices.CarMods|exh_lr_bl2
 *   spl_b_lr_bl   SAVST   respect 0   sexy 0   1000
 *   end
 *
 * Without the IDE rows the real game DIES loading `carmods.dat`: `CVehicleModelInfo::LoadVehicleUpgrades`
 * looks every token up by name and calls `SetupVehicleUpgradeFlags` on the result without a null check
 * (`0x4C4576`, read at `+0x12` of a null `this` — the crash that opened this file, 2026-08-17). Which is
 * also why `assertCarmodsModels` exists beside this: a token no IDE row names is refused at BUILD time.
 *
 * Every write is idempotent — a row/item/price already present under its name is left as it is — so a
 * rebake over the same mod changes nothing the install did not.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const TUNING_PARTS_FILE = 'tuning_new_parts.txt';

/** Where the upgrade parts' IDE rows live in a game tree (stock ids 1000–1193). */
export const VEH_MODS_IDE = join('data', 'maps', 'veh_mods', 'veh_mods.ide');
const SHOPPING_DAT = join('data', 'shopping.dat');

export interface TuningInsert {
  /** The line whose first token (or `item <token>`) the new lines go after — inside the section. */
  readonly after: string;
  /** The lines to insert, verbatim (`item x` for shops, a price row for prices). */
  readonly lines: readonly string[];
  /** Nested section name under `top` (`carmod2`, `CarMods`), matched case-insensitively. */
  readonly section: string;
  readonly top: 'prices' | 'shops';
}

export interface TuningParts {
  readonly ideRows: readonly string[];
  readonly inserts: readonly TuningInsert[];
  readonly warnings: readonly string[];
}

const BLOCK_HEADER = /^(shops|prices)\.([^|\s]+)\|(\S+)$/i;
const IDE_ROW = /^\d+\s*,\s*([^,\s]+)/;

/** Add the rows to `veh_mods.ide`'s `objs` section — replace by NAME, refuse an id another name owns. */
export function applyIdeRows(outPath: string, rows: readonly string[]): string[] {
  const warnings: string[] = [];
  const path = join(outPath, VEH_MODS_IDE);
  if (!existsSync(path)) {
    return [`${TUNING_PARTS_FILE}: ${VEH_MODS_IDE} is not in the tree — ${rows.length} IDE row(s) not written`];
  }
  const owners = ideModelNames(outPath);
  const lines = readFileSync(path, 'latin1').split(/\r?\n/);
  const objsEnd = sectionEnd(lines, 'objs');
  if (objsEnd === -1) {
    return [`${TUNING_PARTS_FILE}: ${VEH_MODS_IDE} has no objs…end section — rows not written`];
  }
  const additions: string[] = [];
  for (const row of rows) {
    const [idText, name] = row.split(',').map((field) => field.trim());
    const id = Number(idText);
    const owner = [...owners].find(([, ownerId]) => ownerId === id)?.[0];
    if (owner !== undefined && owner !== name.toLowerCase()) {
      warnings.push(`${TUNING_PARTS_FILE}: id ${id} already belongs to '${owner}' — row for '${name}' not written`);
      continue;
    }
    const existing = lines.findIndex((line) => {
      const match = IDE_ROW.exec(line.trim());

      return match !== null && match[1].toLowerCase() === name.toLowerCase();
    });
    if (existing !== -1) {
      lines[existing] = row;
    } else {
      additions.push(row);
    }
  }
  lines.splice(objsEnd, 0, ...additions);
  writeFileSync(path, lines.join('\n'), 'latin1');

  return warnings;
}

/** Insert the block's lines after its anchor inside `section <top>` → `section <section>` of shopping.dat. */
export function applyInsert(outPath: string, insert: TuningInsert): string[] {
  const path = join(outPath, SHOPPING_DAT);
  if (!existsSync(path)) {
    return [`${TUNING_PARTS_FILE}: ${SHOPPING_DAT} is not in the tree — ${insert.top}.${insert.section} not written`];
  }
  const lines = readFileSync(path, 'latin1').split(/\r?\n/);
  const range = nestedSection(lines, insert.top, insert.section);
  if (!range) {
    return [`${TUNING_PARTS_FILE}: shopping.dat has no section ${insert.top} → ${insert.section} — block not written`];
  }
  const keyOf = (line: string): string => {
    const tokens = line.trim().split(/\s+/);

    return (tokens[0]?.toLowerCase() === 'item' ? tokens[1] : tokens[0])?.toLowerCase() ?? '';
  };
  const present = new Set(lines.slice(range.start, range.end).map(keyOf));
  const fresh = insert.lines.filter((line) => !present.has(keyOf(line)));
  if (fresh.length === 0) {
    return [];
  }
  const warnings: string[] = [];
  let anchor = -1;
  for (let index = range.start; index < range.end; index += 1) {
    if (keyOf(lines[index]) === insert.after.toLowerCase()) {
      anchor = index;
    }
  }
  if (anchor === -1) {
    warnings.push(
      `${TUNING_PARTS_FILE}: ${insert.top}.${insert.section} has no line '${insert.after}' to insert after — appended at the section's end`,
    );
    anchor = range.end - 1;
  }
  const indent = /^\s*/.exec(lines[anchor])?.[0] ?? '\t\t';
  lines.splice(anchor + 1, 0, ...fresh.map((line) => `${indent}${line}`));
  writeFileSync(path, lines.join('\n'), 'latin1');

  return warnings;
}

/** Apply a mod folder's `tuning_new_parts.txt` (if it ships one) to the built game dir. Returns warnings. */
export function applyTuningParts(folderPath: string, entries: readonly string[], outPath: string): string[] {
  const file = entries.find((name) => name.toLowerCase() === TUNING_PARTS_FILE);
  if (!file) {
    return [];
  }
  const parts = parseTuningParts(readFileSync(join(folderPath, file), 'latin1'));
  const warnings = [...parts.warnings];
  if (parts.ideRows.length > 0) {
    warnings.push(...applyIdeRows(outPath, parts.ideRows));
  }
  for (const insert of parts.inserts) {
    warnings.push(...applyInsert(outPath, insert));
  }

  return warnings;
}

/**
 * Refuse a tree whose `carmods.dat` names a model no IDE row defines — the real game crashes on it at boot
 * (see the header). Called after every install/rebake, so the failure names the line instead of an address.
 *
 * `alsoDeclared` is for models the game learns about from somewhere this walk cannot see: an ADDED car's
 * `cars` row lives beside its models for Mod Loader to merge, not in a `data/*.ide`
 * (`tools/add-vehicles/src/loose-files.ts`), and without this it would read as an unknown token.
 */
export function assertCarmodsModels(gameDir: string, alsoDeclared: ReadonlySet<string> = new Set()): void {
  const path = join(gameDir, 'data', 'carmods.dat');
  // No `veh_mods.ide` = not a bootable game tree (gta.dat loads it; every upgrade part lives there) — a data
  // fixture of the four vehicle files, where the check would fail every token for the wrong reason.
  if (!existsSync(path) || !existsSync(join(gameDir, VEH_MODS_IDE))) {
    return;
  }
  const names = ideModelNames(gameDir);
  const missing: string[] = [];
  const declared = (token: string): boolean => names.has(token) || alsoDeclared.has(token);
  let section = '';
  for (const [index, raw] of readFileSync(path, 'latin1').split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    if (['link', 'mods', 'wheel'].includes(line.toLowerCase())) {
      section = line.toLowerCase();
      continue;
    }
    if (line.toLowerCase() === 'end') {
      section = '';
      continue;
    }
    if (section === '') {
      continue;
    }
    const tokens = line.split(/[\s,]+/).filter((token) => token !== '');
    if (section === 'wheel') {
      tokens.shift(); // the wheel-set number
    }
    for (const token of tokens) {
      if (!declared(token.toLowerCase())) {
        missing.push(`line ${index + 1} (${section}): '${token}' in "${line}"`);
      }
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `carmods.dat names ${missing.length} model(s) no IDE row defines — the real game crashes loading it ` +
        `(CVehicleModelInfo::LoadVehicleUpgrades, null model info). Ship the part's IDE row in the mod's ` +
        `${TUNING_PARTS_FILE}, or drop the token from its carmods line:\n  ${missing.join('\n  ')}`,
    );
  }
}

/**
 * Every model name an IDE row in the tree defines, lowercased — what `carmods.dat` tokens must resolve to.
 * Scans `data/**\/*.ide`; the game's own lookup is by name across every loaded IDE, and so is this.
 */
export function ideModelNames(gameDir: string): Map<string, number> {
  const names = new Map<string, number>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.toLowerCase().endsWith('.ide')) {
        for (const line of readFileSync(path, 'latin1').split(/\r?\n/)) {
          const row = /^\s*(\d+)\s*,\s*([^,\s]+)/.exec(line);
          if (row) {
            names.set(row[2].toLowerCase(), Number(row[1]));
          }
        }
      }
    }
  };
  const data = join(gameDir, 'data');
  if (existsSync(data)) {
    walk(data);
  }

  return names;
}

/** Parse the file's blocks. Lines that are neither an IDE row, a block header nor inside a block are warned about. */
export function parseTuningParts(text: string): TuningParts {
  const ideRows: string[] = [];
  const inserts: TuningInsert[] = [];
  const warnings: string[] = [];
  let open: null | { after: string; lines: string[]; section: string; top: 'prices' | 'shops' } = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    if (open) {
      if (line.toLowerCase() === 'end') {
        inserts.push(open);
        open = null;
      } else {
        open.lines.push(line);
      }
      continue;
    }
    const header = BLOCK_HEADER.exec(line);
    if (header) {
      open = { after: header[3], lines: [], section: header[2], top: header[1].toLowerCase() as 'prices' | 'shops' };
      continue;
    }
    if (IDE_ROW.test(line)) {
      ideRows.push(line);
      continue;
    }
    warnings.push(`${TUNING_PARTS_FILE}: line not understood (not an IDE row, not a block): ${line}`);
  }
  if (open) {
    warnings.push(`${TUNING_PARTS_FILE}: block ${open.top}.${open.section} has no 'end' — dropped`);
  }

  return { ideRows, inserts, warnings };
}

/** [first line after `section <name>`, index of its `end`) for a section nested one level under `section <top>`. */
function nestedSection(lines: readonly string[], top: string, name: string): null | { end: number; start: number } {
  let depth = 0;
  let inTop = false;
  let start = -1;
  for (const [index, raw] of lines.entries()) {
    const line = raw.trim();
    const section = /^section\s+(\S+)/i.exec(line);
    if (section) {
      depth += 1;
      if (depth === 1) {
        inTop = section[1].toLowerCase() === top;
      } else if (depth === 2 && inTop && section[1].toLowerCase() === name.toLowerCase()) {
        start = index + 1;
      }
      continue;
    }
    if (/^end\b/i.test(line)) {
      if (depth === 2 && start !== -1) {
        return { end: index, start };
      }
      depth = Math.max(0, depth - 1);
    }
  }

  return null;
}

/** Index of the `end` closing `<name>` in an IDE file, or -1. */
function sectionEnd(lines: readonly string[], name: string): number {
  const start = lines.findIndex((line) => line.trim().toLowerCase() === name);
  if (start === -1) {
    return -1;
  }

  return lines.findIndex((line, at) => at > start && line.trim().toLowerCase() === 'end');
}
