import type { ModelRef } from '@opensa/game-build/partition';
import type { ImgArchive } from '@opensa/renderware/archive/img-archive';

import { ideRefs, placedModels } from '@opensa/game-build/partition';
import { parseTimedObjects } from '@opensa/renderware/parsers/text/ide.parser';
import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

/** One placed instance: its (lowercased) model name + world transform, for the seam-weld pass (plan 016). */
export interface Placement {
  modelName: string;
  position: [number, number, number];
  rotation: [number, number, number, number];
}

/**
 * HD model → its LOD model (both lowercased), resolved from the **IPL lod-index** (ground truth), not names —
 * SA LOD names don't follow a reliable pattern (`carlshou1_LAe2` → `LOD1carlshou1_LAe`). An instance's `lod`
 * column indexes another inst row in its area's index space; that row's id → its IDE model is the LOD. Text
 * IPLs index their own rows; binary streams (in gta3.img) index their area's **companion text IPL** rows — the
 * shared per-area space. Interiors skipped. First mapping per HD model wins. Used by the compare server's `/lod`.
 */
export function lodModelMap(dataDir: string, gta3: ImgArchive): Map<string, string> {
  const idMap = ideIdMap(dataDir);
  const map = new Map<string, string>();
  const areaInsts = new Map<string, { id: number }[]>(); // area (text IPL basename) → its inst list = lod-index space
  const link = (hdId: number, lodId: number): void => {
    const hd = idMap.get(hdId);
    const lod = idMap.get(lodId);
    if (hd && lod && hd.model !== lod.model && !map.has(hd.model)) {
      map.set(hd.model, lod.model);
    }
  };

  // Text IPLs: within-file lod links, and record each area's inst list for the binary streams below.
  for (const file of walk(dataDir)) {
    if (!file.toLowerCase().endsWith('.ipl') || /[/\\]interior[/\\]/i.test(file)) {
      continue;
    }
    const instances = parseIpl(readFileSync(file, 'utf8'));
    areaInsts.set(
      basename(file)
        .toLowerCase()
        .replace(/\.ipl$/, ''),
      instances,
    );
    for (const instance of instances) {
      if (instance.lod >= 0 && instance.lod < instances.length) {
        link(instance.id, instances[instance.lod].id);
      }
    }
  }

  // Binary streams (gta3.img): an instance's lod indexes its area's companion text IPL inst list.
  for (const name of gta3.names) {
    if (!name.toLowerCase().endsWith('.ipl')) {
      continue;
    }
    const textInsts = areaInsts.get(
      name
        .toLowerCase()
        .replace(/_stream\d+\.ipl$/, '')
        .replace(/\.ipl$/, ''),
    );
    const buffer = gta3.get(name);
    if (!textInsts || !buffer) {
      continue;
    }
    for (const instance of parseBinaryIpl(buffer)) {
      if (instance.lod >= 0 && instance.lod < textInsts.length) {
        link(instance.id, textInsts[instance.lod].id);
      }
    }
  }

  return map;
}

/** model → txd (lowercased) from every IDE under the game's data folder — for the compare server (plan 019). */
export function modelTxdMap(dataDir: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const ref of ideIdMap(dataDir).values()) {
    map.set(ref.model, ref.txd);
  }

  return map;
}

/**
 * The unique DFF **models** and TXD **textures** the game's EXTERIOR map references (deduped, lowercased).
 * Reuses the build partition + IPL/IDE parsers read-only — the same logic the fetch build uses to
 * know what the map needs. Interiors are skipped (the optimizer targets the visible world).
 */
export function resolveMap(dataDir: string, gta3: ImgArchive): { models: string[]; txds: string[] } {
  const placed = placedModels(placedInstanceIds(dataDir, gta3), ideIdMap(dataDir));

  return { models: [...new Set(placed.models)], txds: [...new Set(placed.txds)] };
}

/**
 * Every exterior placement (loose text IPLs + binary streams inside gta3.img) with its world transform, model
 * name resolved from the IDE catalog by id — so names match the pipeline's asset names (lowercased). Interiors
 * are skipped (same as {@link resolveMap}). Reuses the IPL/IDE parsers read-only.
 */
export function resolvePlacements(dataDir: string, gta3: ImgArchive): Placement[] {
  const idMap = ideIdMap(dataDir);
  const placements: Placement[] = [];
  const push = (instance: {
    id: number;
    position: [number, number, number];
    rotation: [number, number, number, number];
  }): void => {
    const ref = idMap.get(instance.id);
    if (ref) {
      placements.push({ modelName: ref.model, position: instance.position, rotation: instance.rotation });
    }
  };
  for (const file of walk(dataDir)) {
    if (!file.toLowerCase().endsWith('.ipl') || /[/\\]interior[/\\]/i.test(file)) {
      continue;
    }
    for (const instance of parseIpl(readFileSync(file, 'utf8'))) {
      push(instance);
    }
  }
  for (const name of gta3.names) {
    if (name.endsWith('.ipl')) {
      const buffer = gta3.get(name);
      if (buffer) {
        for (const instance of parseBinaryIpl(buffer)) {
          push(instance);
        }
      }
    }
  }

  return placements;
}

/** The `tobj` (hour-gated) model names (lowercased) from every IDE — lit-window / neon night overlays. Their
 *  prelit IS the lighting design (bright by purpose, coplanar with the base building), so the world-context
 *  passes must neither judge nor touch them (plan 019 — night repair dimmed skyscraper windows). */
export function timedModels(dataDir: string): Set<string> {
  const timed = new Set<string>();
  for (const file of walk(dataDir).filter((path) => path.toLowerCase().endsWith('.ide'))) {
    for (const def of parseTimedObjects(readFileSync(file, 'utf8'))) {
      timed.add(def.modelName.toLowerCase());
    }
  }

  return timed;
}

/** id → {model, txd} (lowercased) from every IDE under the game's data folder. */
function ideIdMap(dataDir: string): Map<number, ModelRef> {
  const map = new Map<number, ModelRef>();
  for (const file of walk(dataDir).filter((path) => path.toLowerCase().endsWith('.ide'))) {
    for (const [id, ref] of ideRefs(readFileSync(file, 'utf8'))) {
      map.set(id, ref);
    }
  }

  return map;
}

/** All instance ids placed by the loose `.ipl` files (non-interior) + the binary IPLs inside gta3.img. */
function placedInstanceIds(dataDir: string, gta3: ImgArchive): number[] {
  const ids: number[] = [];
  for (const file of walk(dataDir)) {
    if (!file.toLowerCase().endsWith('.ipl') || /[/\\]interior[/\\]/i.test(file)) {
      continue;
    }
    for (const instance of parseIpl(readFileSync(file, 'utf8'))) {
      ids.push(instance.id);
    }
  }
  for (const name of gta3.names) {
    if (name.endsWith('.ipl')) {
      const buffer = gta3.get(name);
      if (buffer) {
        for (const instance of parseBinaryIpl(buffer)) {
          ids.push(instance.id);
        }
      }
    }
  }

  return ids;
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
