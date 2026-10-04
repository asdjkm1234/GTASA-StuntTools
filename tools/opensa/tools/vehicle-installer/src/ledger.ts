/**
 * `data/vehicle-adds.txt` — which added model holds which id, written by every run and read FIRST by the
 * next one. Added CARS are `tools/add-vehicles`' rows; a replacement car's derived tuning parts are this
 * tool's (014), and both tools share the file because they allocate out of the same id window.
 *
 * It exists because an id is not a build detail: a parked spot and a ModelVariations entry land in the
 * player's SAVE (`docs/gta-sa-original/fla-id-limits-are-part-of-the-savefile.md`), so an id that moved
 * between two builds is a save that spawns the wrong car — or nothing. Folder order alone cannot promise
 * that: renaming a folder, adding a car ahead of another, or dropping one all reshuffle it. The ledger
 * pins what has already been handed out, and only deleting it renumbers the fleet.
 *
 * One row per car, tab-separated, sorted by slot so a rebuild is byte-identical:
 *
 *   001veh  19001  car   manana  001veh - 1971 Chevrolet Vega - alfamodding (manana)
 *
 * A car's re-modelled TUNING PARTS are rows here too (`kind` = `part`, `bases` = the stock part they were
 * cloned from): a part id is stored in a save as part of the car's upgrades, so it may not move either.
 * A part row's `slot` is the DERIVED part name, which is why a naming-scheme change moves the row rather
 * than writing a new one — see {@link renameAddsRows}.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Where the ledger lives inside a built game dir. */
export const ADDS_LEDGER = join('data', 'vehicle-adds.txt');

/** One added model, as the ledger records it. */
export interface LedgerRow {
  /** The stock slot(s) it varies, comma-separated in the file. */
  readonly bases: readonly string[];
  /** The folder name it was installed from — for a human reading the file, never matched on. */
  readonly folder: string;
  readonly id: number;
  /** A car, or one of a car's re-modelled tuning parts — only cars go into traffic. */
  readonly kind: 'car' | 'part';
  readonly slot: string;
}

const HEADER = [
  '# OpenSA added vehicles: slot, model id, kind, base slot(s) or stock part, source folder.',
  '# Written by tools/add-vehicles.',
  '# The ID IS A PROMISE: parked cars and ModelVariations entries land in the save, so a slot listed here',
  '# keeps its id on every rebuild. Deleting this file renumbers the fleet and invalidates existing saves.',
];

/** The ids a previous run handed out, by slot. Missing file = nothing promised yet. */
export function readAddsLedger(gameDir: string): Map<string, number> {
  return new Map(readAddsRows(gameDir).map((row) => [row.slot, row.id]));
}

/**
 * Every added car this TREE knows about, not just the ones a run touched — what anything fleet-wide has to
 * read (the traffic registration in plan 004: a `--only` run must not drop the other 114 cars out of their
 * base's variation list).
 */
export function readAddsRows(gameDir: string): LedgerRow[] {
  const rows: LedgerRow[] = [];
  const path = join(gameDir, ADDS_LEDGER);
  if (!existsSync(path)) {
    return rows;
  }
  for (const line of readFileSync(path, 'latin1').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }
    const [slot, id, kind, bases, folder] = trimmed.split(/\t+/);
    if (slot && /^\d+$/.test(id ?? '')) {
      rows.push({
        bases: (bases ?? '').split(',').filter((base) => base !== ''),
        folder: folder ?? '',
        id: Number(id),
        kind: kind === 'part' ? 'part' : 'car',
        slot: slot.toLowerCase(),
      });
    }
  }

  return rows;
}

/**
 * Move ledger rows to new slot names, keeping their ids. `renames` is old name → new name.
 *
 * A part whose NAME changed because the derivation's naming scheme changed is the same part, and its id is
 * a promise already in somebody's save — so the row moves rather than the part being handed a fresh id and
 * the old row left reserving one forever. A rename whose target is already recorded is left alone: the row
 * under the new name is the newer statement.
 *
 * Returns what it moved, for the run to report.
 */
export function renameAddsRows(gameDir: string, renames: ReadonlyMap<string, string>): string[] {
  const path = join(gameDir, ADDS_LEDGER);
  if (!existsSync(path)) {
    return [];
  }
  const recorded = new Set(readAddsRows(gameDir).map((row) => row.slot));
  const moved: string[] = [];
  const lines = readFileSync(path, 'latin1')
    .split(/\r?\n/)
    .map((line) => {
      const [slot, ...rest] = line.trimEnd().split(/\t+/);
      const to = renames.get((slot ?? '').toLowerCase());
      if (to === undefined || rest.length === 0 || recorded.has(to)) {
        return line.trimEnd();
      }
      moved.push(`${slot} keeps id ${rest[0]} under its new name ${to}`);

      return [to, ...rest].join('\t');
    });
  if (moved.length > 0) {
    writeFileSync(path, lines.join('\n'), 'latin1');
  }

  return moved;
}

/**
 * Write the ledger for the cars this run installed, MERGED over what was there: a run narrowed with
 * `--only` speaks for its own cars and must not tell the next one that every other added car is unplaced.
 */
export function writeAddsLedger(gameDir: string, rows: readonly LedgerRow[]): void {
  const path = join(gameDir, ADDS_LEDGER);
  const kept = new Map<string, string>();
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'latin1').split(/\r?\n/)) {
      const slot = line.trim().split(/\t+/)[0];
      if (slot !== '' && !line.trim().startsWith('#')) {
        kept.set(slot.toLowerCase(), line.trimEnd());
      }
    }
  }
  for (const row of rows) {
    kept.set(row.slot.toLowerCase(), [row.slot, row.id, row.kind, row.bases.join(','), row.folder].join('\t'));
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    [...HEADER, ...[...kept.entries()].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([, line]) => line), ''].join(
      '\n',
    ),
    'latin1',
  );
}
