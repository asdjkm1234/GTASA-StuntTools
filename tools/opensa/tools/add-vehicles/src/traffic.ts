import type { LedgerRow } from '@opensa/vehicle-installer/ledger';

/**
 * Why an added car is ever SEEN — plan 004.
 *
 * Nothing in the game references a new model id: no `cargrp` row, no car generator, no mission. What puts it
 * on the street is **ModelVariations 10.7** (mod `11` of the `sa` layer), which swaps a spawning stock car
 * for one of the ids its section lists. So each added car is registered as a variation of the stock slot its
 * folder names as its base:
 *
 *   ### manana
 *   [410]
 *   Global=410,19001
 *
 * The base's own id comes first, so the stock car still spawns; every added car naming that base follows, by
 * id and in ascending order, so the list is a function of the fleet and not of the run.
 *
 * **The variation list goes in a section keyed by the base's ID, and that section carries NOTHING else.**
 * A section keyed by NAME is where a model's own appearance lives — its `paintjobN`, its tuning parts, its
 * `Trailers1`. Put an added id in there and the two models share one list: the field found a 1958 Pontiac
 * wearing the blade's continental-kit spare wheel, because `[blade]` said `Global=536,19110,…,spl_b_lr_bl`
 * ([the issue](../../../docs/open-issues/fixed/added-car-inherits-its-base-tuning.md)).
 *
 * This is the user's earlier tool's shape, and 004 dismissed it on a reading that turned out to be wrong —
 * that a model addressed twice (`[voodoo]` and `[412]`) would have one section overwrite the other. His
 * build ran that way in the field for a long time: `[towtruck]` keeps `Trailers1`/`Global=Trailers1` while
 * `[525]` carries `Global=525,19788`, and both hold. **Two sections, two subjects: what a model IS, and
 * what may be spawned in its place.** Writing ids into the id-keyed section also leaves a `Global=Trailers1`
 * reference alone by construction, which the name-keyed shape had to work around.
 */
import { mergeIniKeys, MODEL_VARIATIONS_INI, readIniKey } from '@opensa/vehicle-installer/model-variations';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The key whose value is the list of models the plugin may spawn in this slot's place. */
const GLOBAL_KEY = 'Global';

/**
 * The section's `Global` with our ids added, everything it already listed KEPT and in place.
 *
 * That "kept" is the whole point: eight of the fleet's own trucks author a `Global=Trailers1` — a reference
 * to the `Trailers1` key beside it — and `petro` and `towtruck` are ALSO the base of an added car. Writing
 * `Global` outright left `Trailers1` defined and referenced by nothing, which is a trailer behaviour that
 * silently stops happening. A token may be an id, a `paintjobN`, a part name or another key's name; we only
 * ever append ids that are not already in the list.
 */
export function extendGlobal(
  current: string | undefined,
  baseId: number,
  ids: readonly number[],
  /** Non-id tokens to add as well — `paintjob1`, a part name (plan 006's tuned traffic). */
  extra: readonly string[] = [],
): string {
  const tokens = (current ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter((token) => token !== '');
  for (const token of [baseId, ...ids].map(String).concat(extra)) {
    if (!tokens.includes(token)) {
      tokens.push(token);
    }
  }

  return tokens.join(',');
}

/**
 * Register every installed car as a variation of its base(s) in the built ModelVariations ini. Returns
 * warnings; refuses when the plugin is not in the build, because an added car nothing spawns is a car
 * nobody will ever see and that must not be silent.
 */
export function registerTraffic(
  gameDir: string,
  installed: readonly LedgerRow[],
  stockIds: ReadonlyMap<string, number>,
): string[] {
  if (installed.length === 0) {
    return [];
  }
  const path = join(gameDir, MODEL_VARIATIONS_INI);
  if (!existsSync(path)) {
    throw new Error(
      `${MODEL_VARIATIONS_INI} is not in the tree — ModelVariations 10.7 (mod 11 of the sa layer) is what ` +
        `puts an added car into traffic, and without it ${installed.length} car(s) would be installed and ` +
        `never seen`,
    );
  }
  const warnings: string[] = [];
  let text = readFileSync(path, 'latin1');
  for (const [base, ids] of variationsByBase(installed, warnings)) {
    const baseId = stockIds.get(base);
    if (baseId === undefined) {
      warnings.push(`no vehicles.ide row for base '${base}' — ${ids.length} car(s) not registered in traffic`);
      continue;
    }
    // Keyed by ID, and named in a comment so the file stays readable — the shape the user's own build used.
    const section = String(baseId);
    const global = extendGlobal(readIniKey(text, section, GLOBAL_KEY), baseId, ids);
    text = mergeIniKeys(text, section, new Map([[GLOBAL_KEY, global]]), `### ${base}`);
  }
  writeFileSync(path, text, 'latin1');

  return warnings;
}

/**
 * base slot → the added ids that vary it, ascending. A car naming several bases appears under each; a car
 * with no base at all is reported (the resolver already refuses one, so this is the belt).
 */
export function variationsByBase(installed: readonly LedgerRow[], warnings: string[]): Map<string, number[]> {
  const byBase = new Map<string, number[]>();
  for (const row of installed) {
    if (row.kind !== 'car') {
      continue;
    }
    if (row.bases.length === 0) {
      warnings.push(`${row.slot} names no base — it is installed but nothing will spawn it`);
      continue;
    }
    for (const base of row.bases) {
      byBase.set(base, [...(byBase.get(base) ?? []), row.id]);
    }
  }
  for (const ids of byBase.values()) {
    ids.sort((a, b) => a - b);
  }

  return new Map([...byBase].sort(([a], [b]) => a.localeCompare(b, 'en')));
}
