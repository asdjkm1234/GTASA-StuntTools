/**
 * Write a {@link DerivedTuning} into a built tree — the other half of `tuning-derive.ts`.
 *
 * Per part: its `veh_mods.ide` row with the allocated id in place of `<:id>`, the shop item and the price
 * cloned right after the stock part's own (so the mod shop lists it where the player expects that part to
 * be), and a `link` for every stock pair both of whose sides the car re-models. Returns the ledger rows the
 * caller records: a part id is in the save, so it is a promise exactly like a car's.
 *
 * Both callers write through here — `tools/add-vehicles` for an added car's re-modelled parts, and this
 * tool's own install for a replacement car's borrowed ones (014).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { DerivedTuning } from './tuning-derive';

import { type LedgerRow } from './ledger';
import { mergeCarmodsLink } from './merge';
import { ID_PLACEHOLDER } from './settings';
import { applyIdeRows, applyInsert } from './tuning-parts';

export interface InstallDerivedTuningOptions {
  readonly derived: DerivedTuning;
  /** The BUILT tree the rows are merged into. */
  readonly gameDir: string;
  /** Derived part name → the model id allocated for it. A part with none is reported, not installed. */
  readonly ids: ReadonlyMap<string, number>;
  /** The source folder's name — what a warning and a ledger row say the part came from. */
  readonly source: string;
}

export function installDerivedTuning(options: InstallDerivedTuningOptions): {
  rows: LedgerRow[];
  warnings: string[];
} {
  const { derived, gameDir, ids, source } = options;
  const warnings: string[] = [];
  if (derived.rows.length === 0) {
    return { rows: [], warnings };
  }
  const rows: LedgerRow[] = [];
  const ideRows: string[] = [];
  for (const { from, name, row } of derived.rows) {
    const id = ids.get(name);
    if (id === undefined) {
      warnings.push(`${source}: no id was allocated for '${name}' — the part is not installed`);
      continue;
    }
    ideRows.push(row.split(ID_PLACEHOLDER).join(String(id)));
    rows.push({ bases: [from], folder: source, id, kind: 'part', slot: name });
  }
  warnings.push(...applyIdeRows(gameDir, ideRows).map((warning) => `${source}: ${warning}`));
  for (const entry of derived.shop) {
    warnings.push(
      ...applyInsert(gameDir, {
        after: entry.after,
        lines: [`item ${entry.item}`],
        section: entry.section,
        top: 'shops',
      }),
      ...applyInsert(gameDir, { after: entry.after, lines: [entry.price], section: 'CarMods', top: 'prices' }),
    );
  }
  if (derived.links.length > 0) {
    const path = join(gameDir, 'data', 'carmods.dat');
    let text = readFileSync(path, 'latin1');
    for (const [left, right] of derived.links) {
      text = mergeCarmodsLink(text, left, right);
    }
    writeFileSync(path, text, 'latin1');
  }

  return { rows, warnings };
}
