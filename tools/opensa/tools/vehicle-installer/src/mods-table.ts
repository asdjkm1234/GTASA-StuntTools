/**
 * `data/vehicle-mods.txt` — the slots a mod took over, written down before the build forgets them.
 *
 * The installer knows the set while it works and used to discard it: once the rows are merged, a mod car is
 * indistinguishable from a stock one anywhere downstream. Video mode reads this at runtime and drives a
 * player's own cars ONLY (096/06, D10 as revised 2026-08-03); the format is documented by
 * `@opensa/renderware`'s `vehicle-mods.parser`, which reads it back, and in `docs/contracts/vehicles.md`.
 */
import { join } from 'node:path';

/** Where the ledger lands in the built game dir — the same `data/` route `vehicle-features.txt` travels. */
export const MODS_TABLE = join('data', 'vehicle-mods.txt');

/**
 * One lowercased slot name per line, sorted, so a rebuild is byte-identical.
 *
 * An EMPTY set still produces a file: "this build looked and found no mod cars" and "this build predates the
 * ledger" read the same downstream, and only one of them is a thing a diagnosis wants to tell apart.
 */
export function formatModTable(models: ReadonlySet<string>): string {
  return [
    '# OpenSA mod-car ledger — one vehicle slot per line, written by vehicle-installer for every slot a mod',
    '# took over. Read at RUNTIME by video mode: name one drivable slot here and every scene drives a mod car,',
    '# never a stock one. Nothing else reads it — a missing or misspelled file costs that and nothing more.',
    ...[...models].map((model) => model.toLowerCase()).sort((a, b) => a.localeCompare(b, 'en')),
    '',
  ].join('\n');
}
