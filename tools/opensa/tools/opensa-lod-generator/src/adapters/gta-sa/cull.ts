import type { ModelSource } from '@opensa/lod-common/model-source';
import type { LodView } from '@opensa/lod-common/view';

import { clumpBoundingRadius } from '@opensa/lod-common/bounds';
import { subtendsAtLeast } from '@opensa/lod-common/view';

import type { Cell } from '../../core/types';

export interface CullResult {
  cells: Cell[];
  /** Instances dropped for being under the pixel threshold at the view's closest LOD distance. */
  culledInstances: number;
  /** Distinct models all of whose instances were culled or kept-by-size — informational, for the report. */
  culledModels: number;
}

/**
 * Screen-size instance cull (plan 003, Track 1): drop from every cell the instances whose model bounding
 * diameter covers fewer than `minPixels` on screen at the closest distance a cell-LOD is rendered
 * (`view.minDistance` = the engine's HD ring). A sub-pixel object is invisible at every LOD distance, so
 * removing it whole cannot hole the far view — it just stops spending cell triangles on bins/poles/wires.
 * Models that fail to load are kept (the merge skips them anyway). Radius is measured once per model.
 *
 * High-poly street-furniture replacement mods (a 22k-tri ELECTRICA traffic light placed 729×) are NOT
 * auto-gated here — they are excluded explicitly via `lod-exclude.json` → `config.excludeItems` (user
 * decision: an explicit curated list over a density heuristic).
 */
export function cullTinyInstances(
  cells: readonly Cell[],
  source: ModelSource,
  view: LodView,
  minPixels: number,
): CullResult {
  const keepByModel = new Map<string, boolean>();
  const keep = (model: string): boolean => {
    let kept = keepByModel.get(model);
    if (kept === undefined) {
      const clump = source.load(model);
      kept = clump ? subtendsAtLeast(view, clumpBoundingRadius(clump), minPixels) : true;
      keepByModel.set(model, kept);
    }

    return kept;
  };

  let culledInstances = 0;
  const out: Cell[] = [];
  for (const cell of cells) {
    const instances = cell.instances.filter((instance) => keep(instance.model));
    culledInstances += cell.instances.length - instances.length;
    if (instances.length > 0) {
      out.push({ cx: cell.cx, cy: cell.cy, instances });
    }
  }

  return {
    cells: out,
    culledInstances,
    culledModels: [...keepByModel.values()].filter((kept) => !kept).length,
  };
}
