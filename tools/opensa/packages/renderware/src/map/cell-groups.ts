import type { IdeObjectDef, IplInstance, MapDefinitions } from '../parsers/text';
import type { GridCell, WorldGrid } from './world-grid';

import { modelKey } from '../archive';
import { cellKey } from './world-grid';

/**
 * Grouping one cell's IPL instances by model+txd — pure data, no renderer.
 *
 * Extracted from the three-era `build-region`/`build-cell` in plan 074/13 phase 5c: `opensa-pack`'s
 * welder consumes `cellGroups` to decide what a converted cell contains, so this logic had to outlive
 * the builders it happened to share a file with.
 */

/** One model+txd group: the IDE def plus every IPL instance that places it. */
export interface RegionMeshData {
  def: IdeObjectDef;
  instances: IplInstance[];
}

export function addToGroup(groups: Map<string, RegionMeshData>, def: IdeObjectDef, instance: IplInstance): void {
  const key = modelKey(def);
  let group = groups.get(key);
  if (!group) {
    group = { def, instances: [] };
    groups.set(key, group);
  }
  group.instances.push(instance);
}

/** Group one cell's HD (`lod=false`) or LOD (`lod=true`) instances by model+txd. */
export function cellGroups(defs: MapDefinitions, cell: GridCell, lod: boolean): Map<string, RegionMeshData> {
  const groups = new Map<string, RegionMeshData>();
  for (const instance of lod ? cell.lod : cell.hd) {
    const def = defs.catalog.get(instance.id) ?? defs.timedCatalog?.get(instance.id);
    if (def) {
      addToGroup(groups, def, instance);
    }
  }

  return groups;
}

/** Unique model names one cell's build needs (plan 060 Phase 5) — the parse worker preparses these. */
export function cellModelNames(defs: MapDefinitions, grid: WorldGrid, cx: number, cy: number, lod: boolean): string[] {
  const cell = grid.get(cellKey(cx, cy));
  if (!cell) {
    return [];
  }
  const names = new Set<string>();
  for (const group of cellGroups(defs, cell, lod).values()) {
    names.add(group.def.modelName);
  }

  return [...names];
}
