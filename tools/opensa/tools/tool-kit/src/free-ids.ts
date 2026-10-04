/**
 * Model ids for content the game never had — allocated over a BUILT tree, deterministically.
 *
 * The window and the determinism are both decisions, not conveniences (central plan 102, the user's call
 * 2026-08-19):
 *
 * - **19 001–19 999.** SA's map allocators stop at 19 000 (`docs/edge-cases/sa-formats.md`) and FLA's DFF
 *   range ends at 19 999, so this window belongs to added content alone and the two never meet. Measured on
 *   the built tree the day it was chosen: **0 ids in use there, 999 free**, against a demand of 161.
 * - **Split in two, 2026-08-20.** Two tools allocate out of it and one runs FIRST: `vehicle-installer`
 *   during the mod install, `add-vehicles` several stages later. Sharing one "lowest free id" pool meant a
 *   vehicle mod's borrowed tuning parts sat BELOW the fleet and moved all 115 cars up by however many parts
 *   the fleet happened to borrow — a renumber every time such a mod is added or removed, in a file whose
 *   header calls an id a promise. So a replacement car's derived parts allocate from the TOP
 *   ({@link MOD_PART_ID_WINDOW}) and the added fleet keeps the bottom, and neither depends on the other's
 *   size. Both refuse loudly when full rather than growing into each other.
 * - **Deterministic, and a LEDGER wins over order.** A parked car and a ModelVariations entry land in the
 *   SAVE (`docs/gta-sa-original/fla-id-limits-are-part-of-the-savefile.md`), so an id that moved between two
 *   builds is a save that spawns the wrong car. Ids are handed out in the caller's order, skipping whatever
 *   the tree already uses — but a slot the ledger already knows keeps ITS id whatever the order became.
 *   Deleting the ledger is the only way to renumber, and the tool that owns it says so.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The id window ADDED CARS and their own tuning parts are allocated from — see the header. */
export const ADDED_ID_WINDOW: IdWindow = { first: 19_001, last: 19_799 };

/**
 * Where a REPLACEMENT car's derived tuning parts go: the top of the same range, so their count can never
 * shift the added fleet below them (see the header). 200 ids against a demand of 11 on the original's fleet.
 */
export const MOD_PART_ID_WINDOW: IdWindow = { first: 19_800, last: 19_999 };

/** Where a built tree keeps IDE files: the game's own data, plus whatever modloader adds. */
const IDE_ROOTS: readonly string[] = ['data', 'modloader'];

export interface AllocateIdsOptions {
  /** Slots that already own an id (a previous run's ledger) — each keeps it, wherever it now sorts. */
  readonly ledger?: ReadonlyMap<string, number>;
  /** The slots to allocate for, in the order they should be numbered. */
  readonly slots: readonly string[];
  /** Ids the built tree already defines — every IDE row of it (see {@link usedModelIds}). */
  readonly used: ReadonlySet<number>;
  readonly window?: IdWindow;
}

/** A closed id range, both ends inclusive. */
export interface IdWindow {
  readonly first: number;
  readonly last: number;
}

/**
 * Assign one id per slot: a ledger id first, else the lowest free id in the window. Refuses a ledger id
 * outside the window (it was allocated by other rules and nothing here can honour it) and a window with
 * fewer free ids than slots, naming both counts.
 */
export function allocateIds(options: AllocateIdsOptions): Map<string, number> {
  const window = options.window ?? ADDED_ID_WINDOW;
  const ledger = options.ledger ?? new Map<string, number>();
  const assigned = new Map<string, number>();
  const taken = new Set(options.used);
  const strays = [...ledger].filter(([, id]) => id < window.first || id > window.last);
  if (strays.length > 0) {
    throw new Error(
      `the ledger holds ${strays.length} id(s) outside the ${window.first}–${window.last} window ` +
        `(${strays.map(([slot, id]) => `${slot}=${id}`).join(', ')}). Nothing here can honour them: fix the ` +
        `window or delete the ledger, knowing that renumbering breaks existing saves`,
    );
  }
  // A ledger id IS in the tree after the run that wrote it, and it stays taken — for its own slot.
  for (const slot of options.slots) {
    const own = ledger.get(slot);
    if (own !== undefined) {
      assigned.set(slot, own);
      taken.add(own);
    }
  }
  let next = window.first;
  for (const slot of options.slots) {
    if (assigned.has(slot)) {
      continue;
    }
    while (next <= window.last && taken.has(next)) {
      next += 1;
    }
    if (next > window.last) {
      throw new Error(
        `the ${window.first}–${window.last} id window is exhausted: ${options.slots.length} slot(s) to ` +
          `place, ${assigned.size} placed. Free ids there, or lift the window against FLA's DFF range`,
      );
    }
    assigned.set(slot, next);
    taken.add(next);
    next += 1;
  }

  return assigned;
}

/**
 * Every model id defined by an IDE the built tree carries — `data/**` and `modloader/**`, because the game
 * loads both and an id it already uses is an id we may not hand out. Read fresh on every run: a mod that
 * starts using the window shows up here first.
 */
export function usedModelIds(gameDir: string): Set<number> {
  const ids = new Set<number>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.name.toLowerCase().endsWith('.ide')) {
        for (const line of readFileSync(path, 'latin1').split(/\r?\n/)) {
          const row = /^\s*(\d+)\s*,/.exec(line);
          if (row) {
            ids.add(Number(row[1]));
          }
        }
      }
    }
  };
  for (const root of IDE_ROOTS) {
    const path = join(gameDir, root);
    if (existsSync(path)) {
      walk(path);
    }
  }

  return ids;
}
