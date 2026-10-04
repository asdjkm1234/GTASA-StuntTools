import { ideRefs } from '@opensa/game-build/partition';
import { SA_TREE_MODELS } from '@opensa/map-placement/vegetation';
import { OPEN_SCRIPT_IPL } from '@opensa/renderware/map/resolve-map';
import { parseTimedObjects } from '@opensa/renderware/parsers/text/ide.parser';
import { isInterior } from '@opensa/renderware/parsers/text/interior';
import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Cell, CellInstance } from '../../core/types';
import type { Archive } from './io';

import { cellKey, cellOf } from '../../core/grid';

/** Tree models (lowercased) — baked into impostors by `lod-trees-generator`, so excluded from the cell merge
 *  (decimated alpha foliage looks bad and duplicates the impostors' far-LOD). */
const TREE_MODELS = new Set(SA_TREE_MODELS);

/** What an IDE id resolves to: model/txd names (lowercased) + the `anim` row's IFP name when it is one. */
interface IdRef {
  anim?: string;
  model: string;
  txd: string;
}

/** Highest object id across every IDE under the game's data folder — cell-LOD ids start at +1 (no collision). */
export function maxObjectId(gameDir: string): number {
  let max = 0;
  for (const file of walk(join(gameDir, 'data')).filter((path) => path.toLowerCase().endsWith('.ide'))) {
    for (const [id] of ideRefs(readFileSync(file, 'utf8'))) {
      max = Math.max(max, id);
    }
  }

  return max;
}

/**
 * Assemble the exterior map instances into the square cell grid (Phase 0). Read-only reuse of the engine's
 * IDE/IPL parsers — the same data the runtime grid is built from. Interiors and trees (handled by
 * `lod-trees-generator`) are dropped; HD models are baked, and so are `lod*` models that are **base geometry**
 * (nothing points at them) — instances that are IPL **LOD targets** are skipped (their HD is baked instead).
 * See {@link collectInstances}.
 */
export function resolveCells(
  gameDir: string,
  archives: readonly Archive[],
  cellSize: number,
  exclude: ReadonlySet<string> = new Set(),
): Cell[] {
  const dataDir = join(gameDir, 'data');
  const idToModel = buildIdMap(dataDir);
  const cells = new Map<string, Cell>();
  for (const instance of collectInstances(dataDir, archives, idToModel, exclude)) {
    const [cx, cy] = cellOf(instance.position, cellSize);
    const key = cellKey(cx, cy);
    let cell = cells.get(key);
    if (!cell) {
      cell = { cx, cy, instances: [] };
      cells.set(key, cell);
    }
    cell.instances.push(instance);
  }

  return [...cells.values()];
}

/** Area key shared by a text IPL and its binary streams: `countrye.ipl` & `countrye_stream3.ipl` → `countrye`. */
function areaKey(name: string): string {
  return (name.split(/[\\/]/).pop() ?? name)
    .replace(/_stream\d+\.ipl$/i, '')
    .replace(/\.ipl$/i, '')
    .toLowerCase();
}

/**
 * Binary-stream instances grouped by area key (their `lod` field indexes the companion text IPL).
 * Areas with NO companion text IPL are **script-gated groups** (LOAD_IPL-toggled: `barriers1`/`barriers2`
 * roadblocks, `carter`/`crack` mission pieces) — the engine loads only {@link OPEN_SCRIPT_IPL} of them, so
 * the bake must too: baking a closed group paints its props (the bridge roadblocks) into the far LODs.
 */
function binaryInstancesByArea(
  archives: readonly Archive[],
  registered: ReadonlySet<string>,
): Map<string, ReturnType<typeof parseBinaryIpl>> {
  const open = new Set<string>(OPEN_SCRIPT_IPL);
  const byArea = new Map<string, ReturnType<typeof parseBinaryIpl>>();
  const skipped: string[] = [];
  for (const archive of archives) {
    for (const name of archive.names.filter((entry) => entry.endsWith('.ipl'))) {
      const area = areaKey(name);
      if (!registered.has(area) && !open.has(area)) {
        skipped.push(area);
        continue;
      }
      const buffer = archive.get(name);
      if (buffer) {
        byArea.set(area, [...(byArea.get(area) ?? []), ...parseBinaryIpl(buffer)]);
      }
    }
  }
  if (skipped.length > 0) {
    console.log(`  script-gated binary IPLs excluded from the bake: ${[...new Set(skipped)].sort().join(', ')}`);
  }

  return byArea;
}

/** id → model/txd names (lowercased) from every IDE under the game's data folder. */
function buildIdMap(dataDir: string): Map<number, IdRef> {
  const map = new Map<number, IdRef>();
  for (const file of walk(dataDir).filter((path) => path.toLowerCase().endsWith('.ide'))) {
    for (const [id, ref] of ideRefs(readFileSync(file, 'utf8'))) {
      map.set(id, {
        ...(ref.anim !== undefined ? { anim: ref.anim } : {}),
        model: ref.model.toLowerCase(),
        txd: ref.txd,
      });
    }
  }

  return map;
}

/**
 * Every exterior, non-tree instance to bake into the cells: all HD models **plus** the `lod*` models that are
 * **base geometry** — i.e. no instance's IPL `lod` field points at them (e.g. the LA-east `lodlae2_lndhub*`
 * ground-fill plates SA ships only as `lod`-named). Instances that ARE **LOD targets** are skipped: their HD is
 * already baked, so baking the LOD too doubles the surface (coplanar z-fighting in the cell mesh — the
 * `lod_conhoos2` ↔ `conhoos2` / `lodcepalcst02` ↔ `ce_grndpalcst02` artifact). Targeting is the IPL-index
 * ground truth, NOT name matching (`hasHdTwin` misses underscored / renamed twins — see the
 * `lod-detection-name-vs-target` memory): text `inst.lod` indexes the same file's list; a binary stream's
 * `inst.lod` indexes its companion text IPL (same area key).
 */
function collectInstances(
  dataDir: string,
  archives: readonly Archive[],
  idToModel: Map<number, IdRef>,
  exclude: ReadonlySet<string>,
): CellInstance[] {
  const areas = readTextAreas(dataDir);
  const binary = binaryInstancesByArea(archives, new Set(areas.keys()));
  const timedModels = readTimedModels(dataDir);

  // Every (area, index) some instance's lod field points at — the far-LOD stand-ins whose HD we bake instead.
  const targeted = new Set<string>();
  const mark = (area: string, lodIndex: number): void => {
    if (lodIndex >= 0 && lodIndex < (areas.get(area)?.length ?? 0)) {
      targeted.add(`${area}#${lodIndex}`);
    }
  };
  for (const [area, list] of areas) {
    for (const instance of list) {
      mark(area, instance.lod);
    }
  }
  for (const [area, list] of binary) {
    for (const instance of list) {
      mark(area, instance.lod);
    }
  }

  const out: CellInstance[] = [];
  const push = (instance: ReturnType<typeof parseIpl>[number]): void => {
    if (isInterior(instance.interior)) {
      return; // real interior (low byte ≠ 0, non-world) — `interior > 0` dropped area-coded exteriors like 1024
    }
    const ref = idToModel.get(instance.id);
    const model = ref?.model ?? instance.modelName.toLowerCase();
    if (!model || TREE_MODELS.has(model) || exclude.has(model)) {
      return; // missing def, a tree (→ lod-trees), or owned by a sibling generator (lod-trees/lod-procobj)
    }
    if (timedModels.has(model)) {
      return; // tobj (lit windows / neon): baking it would glow round the clock — the engine renders the real
      // hour-gated instance at LOD range instead (world-grid puts timed instances into both layers)
    }
    out.push({
      ...(ref?.anim !== undefined ? { anim: ref.anim } : {}),
      model,
      position: instance.position,
      rotation: instance.rotation,
      txd: ref?.txd ?? '',
    });
  };
  for (const [area, list] of areas) {
    list.forEach((instance, index) => {
      if (!targeted.has(`${area}#${index}`)) {
        push(instance);
      }
    });
  }
  for (const list of binary.values()) {
    list.forEach(push); // binary instances are never targets (the lod index space is the text list)
  }

  return out;
}

/** Each area's text IPL instance list (ordered) — the LOD-index space both link sources point into. */
function readTextAreas(dataDir: string): Map<string, ReturnType<typeof parseIpl>> {
  const areas = new Map<string, ReturnType<typeof parseIpl>>();
  for (const file of walk(dataDir)) {
    if (file.toLowerCase().endsWith('.ipl') && !/[/\\]interior[/\\]/i.test(file)) {
      areas.set(areaKey(file), parseIpl(readFileSync(file, 'utf8')));
    }
  }

  return areas;
}

/** Every `tobj` (time-of-day) model name (lowercased) across the game's IDEs — excluded from the bake. */
function readTimedModels(dataDir: string): Set<string> {
  const models = new Set<string>();
  for (const file of walk(dataDir).filter((path) => path.toLowerCase().endsWith('.ide'))) {
    for (const def of parseTimedObjects(readFileSync(file, 'utf8'))) {
      models.add(def.modelName.toLowerCase());
    }
  }

  return models;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path, out);
    } else {
      out.push(path);
    }
  }

  return out;
}
