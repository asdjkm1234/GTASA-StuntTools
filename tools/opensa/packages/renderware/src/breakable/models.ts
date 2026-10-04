/**
 * Which models SA lets you smash — the SECOND half of the gate (the first is the DFF's own RW Breakable
 * shatter mesh). Shared, because the converter decides at BUILD time which triangles to record as smashable
 * and the runtime decides at HIT time whether a prop may break: if the two disagree, a prop either takes a hit
 * that does nothing, or has ranges recorded that can never fire.
 */
import type { ObjectDatEntry } from '../parsers/text/object-dat.parser';

import { ColDamageEffect, parseObjectDat } from '../parsers/text/object-dat.parser';

/** object.dat collision-damage effects that SHATTER a prop. `none`/`changeModel` are not a shatter. */
const BREAKABLE_EFFECTS = new Set<number>([
  ColDamageEffect.breakable,
  ColDamageEffect.breakableThenRemoved,
  ColDamageEffect.changeThenSmash,
  ColDamageEffect.smashCompletely,
]);

/** The same, straight from the file text. Absent file → an empty set: the shatter-mesh gate still stands. */
export function breakableModelsFromText(objectDatText: null | string): Set<string> {
  return objectDatText === null ? new Set() : breakableModelsOf(parseObjectDat(objectDatText));
}

/** Models a parsed object.dat marks as smashable (lowercased). */
export function breakableModelsOf(objectDat: ReadonlyMap<string, ObjectDatEntry>): Set<string> {
  const models = new Set<string>();
  for (const [name, entry] of objectDat) {
    if (BREAKABLE_EFFECTS.has(entry.colDamageEffect)) {
      models.add(name);
    }
  }

  return models;
}
