/**
 * Which models a RECT actually places — the denominator a district convert should be paying, not the map's
 * whole catalogue.
 *
 * `packMapObjects` walks every model the IDEs name (~14 000 on the stock game), because for a full-map build
 * that IS the working set. For a district it is not: a 2×2-cell rect places a few hundred, and the rest are
 * converted, planned and written for a world this pak does not contain. On a phone that is the difference
 * between a convert measured in minutes and one measured in hours.
 *
 * The cut is safe in the direction that matters. A model left unconverted keeps its `.dff` in the archive, so
 * the runtime falls back to parsing it rather than failing to find it — the same contract the `--vehicles` /
 * `--peds` subsets already rely on. What it does NOT keep is a converted texture: an unconverted model still
 * carries its ORIGINAL (BC) dictionary, so on a device without BC anything that reaches for one would fail.
 * For a district pak nothing does, because nothing outside the rect is placed in it — which is exactly why
 * this is keyed on placement rather than on a name list somebody maintains.
 */
import type { IdeObjectDef, IplInstance } from '@opensa/renderware/parsers/text/types';

import { normalizedRect } from './convert';

export interface PlacedModelDefs {
  readonly catalog: ReadonlyMap<number, IdeObjectDef>;
  readonly instances: readonly IplInstance[];
  readonly timedCatalog?: ReadonlyMap<number, IdeObjectDef>;
}

/**
 * Lowercased names of every model placed inside `rect` (inclusive GTA cell coords, `cellSize` units each).
 *
 * The id is resolved through the same two catalogues `packMapObjects` iterates, so the result is a SUBSET of
 * its universe and can be used to skip directly. An instance whose id is in neither still contributes its own
 * `modelName`: the map placed it, and dropping it here on a bookkeeping mismatch would be the one failure
 * this is not allowed to have.
 */
export function placedModelNames(
  defs: PlacedModelDefs,
  rect: readonly [number, number, number, number],
  cellSize: number,
): Set<string> {
  const [x0, y0, x1, y1] = normalizedRect(rect);
  const minX = x0 * cellSize;
  const minY = y0 * cellSize;
  const maxX = (x1 + 1) * cellSize;
  const maxY = (y1 + 1) * cellSize;
  const names = new Set<string>();

  for (const instance of defs.instances) {
    const [ix, iy] = instance.position;
    if (ix < minX || ix >= maxX || iy < minY || iy >= maxY) {
      continue;
    }
    const def = defs.catalog.get(instance.id) ?? defs.timedCatalog?.get(instance.id);
    names.add((def?.modelName ?? instance.modelName).toLowerCase());
  }

  return names;
}
