import { datChildUrl, iplBasename } from '@opensa/renderware/archive/resolve-paths';
import { parseIde, parseTimedObjects } from '@opensa/renderware/parsers/text/ide.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * **Is every placed model defined by the time its `inst` row is read?**
 *
 * `CFileLoader::LoadLevel` walks `gta.dat` line by line: an `IDE` line loads object definitions THERE, an `IPL`
 * line loads placements THERE. A definition listed further down does not exist yet for a row read earlier, and
 * the game refuses the row (`GTA_ERROR_ATTEMPT_TO_LOAD_OBJECT_INSTANCE_WITH_UNDEFINED_ID` — the reference
 * install has it enabled). Nothing else in the build sees it: every other check asks whether a placed id is
 * defined ANYWHERE, which it is. This one compares two POSITIONS in `gta.dat`.
 *
 * The class is ours to create: the installer appends a mod's IDE and IPL refs at the end, and the IPL slot fold
 * then moves the mod's `inst` rows into stock hosts chosen by capacity — a host that sits 65 lines earlier.
 * `docs/open-issues/mod-inst-rows-folded-before-their-ide.md`.
 *
 * **Text IPLs only, and that is not a gap.** A `<area>_streamN.ipl` in the archives is streamed by distance
 * long after the level load has read every `IDE` line, so its records cannot be early.
 */

export interface DatOrderReport {
  /** Text `inst` rows examined. */
  readonly checked: number;
  /** One entry per (id, placing IPL), worst first. */
  readonly late: LateDefinition[];
}

/** One id placed by an IPL that `gta.dat` lists BEFORE the IDE defining it. */
export interface LateDefinition {
  /** How many rows of {@link placedBy} place this id. */
  readonly count: number;
  /** The IDE that defines it, as `gta.dat` spells the path. */
  readonly definedBy: string;
  /** That IDE's 1-based line in `gta.dat` — always greater than {@link placedLine}. */
  readonly definedLine: number;
  readonly id: number;
  readonly modelName: string;
  /** The IPL placing it (file name). */
  readonly placedBy: string;
  /** That IPL's 1-based line in `gta.dat`. */
  readonly placedLine: number;
}

/** One directive of `gta.dat`, with the line it sits on. */
interface DatEntry {
  readonly kind: 'IDE' | 'IPL';
  readonly line: number;
  readonly path: string;
}

/** One id's definition: where `gta.dat` reads it, and what it is called. */
interface Definition {
  readonly line: number;
  readonly modelName: string;
  readonly path: string;
}

/** Resolve every text `inst` row of a game tree against the `gta.dat` position of the IDE defining its model. */
export function checkDefinitionOrder(gameDir: string): DatOrderReport {
  const entries = readDatEntries(readFileSync(join(gameDir, 'data', 'gta.dat'), 'utf8'));
  const defined = readDefinitions(gameDir, entries);
  const late = new Map<string, LateDefinition>();
  let checked = 0;
  for (const entry of entries) {
    for (const row of placementsOf(gameDir, entry)) {
      checked += 1;
      const def = defined.get(row);
      // An id defined NOWHERE is a different defect (`dangling-models` owns it) — this check is about order only.
      if (def && def.line > entry.line) {
        recordLate(late, row, def, entry);
      }
    }
  }

  return { checked, late: [...late.values()].sort((a, b) => b.count - a.count) };
}

/** One line per finding, for a guard's error text or a script's output. */
export function formatLateDefinition(row: LateDefinition): string {
  return (
    `${row.modelName} (id ${row.id}) — ${row.count} row(s) in ${row.placedBy} at gta.dat line ${row.placedLine}, ` +
    `defined by ${row.definedBy} at line ${row.definedLine}`
  );
}

/** The ids an entry's text IPL places, in row order — empty for anything that is not one we can read. */
function placementsOf(gameDir: string, entry: DatEntry): number[] {
  if (entry.kind !== 'IPL' || entry.path.toLowerCase().endsWith('.zon')) {
    return [];
  }
  const file = datChildUrl(gameDir, entry.path);

  return existsSync(file) ? parseIpl(readFileSync(file, 'utf8')).map((row) => row.id) : [];
}

/** The `IDE`/`IPL` directives of a `gta.dat`, in file order, 1-based lines (other directives are not placements). */
function readDatEntries(text: string): DatEntry[] {
  const entries: DatEntry[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const match = /^(IDE|IPL)\s+(\S.*)$/i.exec(raw.trim());
    if (match) {
      entries.push({ kind: match[1].toUpperCase() as 'IDE' | 'IPL', line: index + 1, path: match[2].trim() });
    }
  });

  return entries;
}

/** Where `gta.dat` first defines each id — the FIRST wins, whatever a later IDE redefines it to. */
function readDefinitions(gameDir: string, entries: readonly DatEntry[]): Map<number, Definition> {
  const defined = new Map<number, Definition>();
  for (const entry of entries) {
    const file = entry.kind === 'IDE' ? datChildUrl(gameDir, entry.path) : null;
    if (!file || !existsSync(file)) {
      continue;
    }
    const text = readFileSync(file, 'utf8');
    for (const def of [...parseIde(text), ...parseTimedObjects(text)]) {
      if (!defined.has(def.id)) {
        defined.set(def.id, { line: entry.line, modelName: def.modelName, path: entry.path });
      }
    }
  }

  return defined;
}

/** Fold one late placement into the report, keyed by (id, placing IPL) so its rows count as one finding. */
function recordLate(late: Map<string, LateDefinition>, id: number, def: Definition, entry: DatEntry): void {
  const placedBy = `${iplBasename(entry.path)}.ipl`;
  const key = `${id}|${placedBy}`;
  const seen = late.get(key);
  late.set(
    key,
    seen
      ? { ...seen, count: seen.count + 1 }
      : {
          count: 1,
          definedBy: def.path,
          definedLine: def.line,
          id,
          modelName: def.modelName,
          placedBy,
          placedLine: entry.line,
        },
  );
}
