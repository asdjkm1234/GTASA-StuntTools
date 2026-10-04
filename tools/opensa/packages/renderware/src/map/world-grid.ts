import type { IplInstance, MapDefinitions } from '../parsers/text';

import { isInterior } from '../parsers/text';

/** One grid cell's placed instances, split into full-detail (HD) and LOD. */
export interface GridCell {
  cx: number;
  cy: number;
  hd: IplInstance[];
  lod: IplInstance[];
}

/** Exterior instances bucketed into square cells, keyed by `cellKey`. */
export type WorldGrid = Map<string, GridCell>;

/**
 * Bucket the map's exterior instances into a square grid of the given cell size,
 * splitting each cell into HD (full-detail) and LOD lists. An instance is a LOD iff
 * it is a **LOD target** — `instance.isLod`, set by {@link resolveMap} from the IPL
 * `lod` index (the authoritative test; the `lod`-name prefix is only a heuristic and
 * mis-buckets name-mismatched LODs like `nw_lodbit_18` and base geometry named `lod*`).
 * Instances with no catalog def are skipped (they can't be rendered). Exterior vs
 * interior is decided by {@link isInterior} — the real interior id is the low byte
 * of the IPL `interior` field (`value & 0xFF`), so `interior === 0` was too strict
 * (it dropped exterior objects whose area code is a multiple of 256). **Timed
 * (`tobj`) instances go into BOTH lists**: the LOD generator deliberately does not
 * bake them into cell LODs (a baked lit window would glow at noon — the bake has no
 * hour gate), so the real hour-gated instance must render at LOD range too; HD and
 * LOD cells are mutually exclusive per cell, so nothing double-renders. Pure data —
 * the streaming layer turns cells into meshes.
 *
 * **`alwaysOnLods`** (plan 087, gostown trees): lod-TARGET models (lowercased) that ARE the content —
 * a TC pattern places a stub HD (`fakebit01`, draw 65) whose lod link points at the real geometry
 * (`LODEnsemble*` forests, draw 2000). Bucketing those targets lod-only would hide every forest inside
 * the HD ring (and the cell bake never sees them — it bakes the stub). Listed models go into BOTH
 * lists, exactly like timed instances (per-cell level exclusivity keeps it single-rendered).
 */
export function buildWorldGrid(defs: MapDefinitions, cellSize: number, alwaysOnLods?: ReadonlySet<string>): WorldGrid {
  const grid: WorldGrid = new Map();
  for (const instance of defs.instances) {
    const timed = defs.timedCatalog?.has(instance.id) ?? false;
    const def = defs.catalog.get(instance.id) ?? (timed ? defs.timedCatalog?.get(instance.id) : undefined);
    if (!def || isInterior(instance.interior)) {
      continue;
    }
    const [cx, cy] = instanceCell(instance.position, cellSize);
    const key = cellKey(cx, cy);
    let cell = grid.get(key);
    if (!cell) {
      cell = { cx, cy, hd: [], lod: [] };
      grid.set(key, cell);
    }
    if (timed || (instance.isLod && alwaysOnLods?.has(def.modelName.toLowerCase()) === true)) {
      cell.hd.push(instance);
      cell.lod.push(instance);
    } else {
      (instance.isLod ? cell.lod : cell.hd).push(instance);
    }
  }

  return grid;
}

/** Stable string key for a cell coordinate. */
export function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

/** The grid cell a position falls in (X/Y plane; Z ignored). */
export function instanceCell(position: readonly [number, number, number], cellSize: number): [number, number] {
  return [Math.floor(position[0] / cellSize), Math.floor(position[1] / cellSize)];
}
