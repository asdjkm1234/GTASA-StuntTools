import { ideRefs } from '@opensa/game-build/partition';
import { SA_TREE_MODELS } from '@opensa/map-placement/vegetation';
import { parseTimedObjects } from '@opensa/renderware/parsers/text/ide.parser';
import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { isLodModel } from '@opensa/renderware/parsers/text/lod';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { LodLink, ResolveResult } from '../../core/types';
import type { Archive } from './io';

/** Curated SA vegetation roster (lowercased) — trees get impostors from lod-trees-generator, not HD clones. */
const TREE_MODELS = new Set(SA_TREE_MODELS);

/**
 * TXD atlases owned by the sibling LOD generators (lod-trees, lod-procobj). Their LODs are already final products —
 * sa-lod must NOT re-clone them (doing so overwrites their DFF and repoints their TXD to a `salod*` clone that lacks
 * the right textures → in-game null-deref when the LOD binds its dictionary; see `lod-detection-name-vs-target`).
 */
const GENERATED_LOD_TXDS = new Set(['lod_procobj', 'lodtrees']);

interface Instance {
  lod: number;
  model: string;
}

interface ModelDef {
  /** The def's IDE draw distance (0 when the IDE row had none). */
  draw: number;
  id: number;
  txd: string;
}

/** Area key shared by a text IPL and its binary streams: `countrye.ipl` & `countrye_stream3.ipl` → `countrye`. */
export function areaKey(name: string): string {
  return (name.split(/[\\/]/).pop() ?? name)
    .replace(/_stream\d+\.ipl$/i, '')
    .replace(/\.ipl$/i, '')
    .toLowerCase();
}

/**
 * Resolve every HD→LOD relationship from the IPL `lod` field — the ground-truth pairing (name matching is
 * unreliable; see the `lod-detection-name-vs-target` memory). Two link sources share **one per-area index space**
 * (the `ipl-lod-index-coupling` memory):
 *
 * - **text IPLs** (`data/maps/**`): `inst.lod ≥ 0` indexes the *same file's* instance list;
 * - **binary streams** (`<area>_streamN.ipl` inside `gta3.img`): `inst.lod` indexes the **companion text IPL**
 *   (paired by area key `<area>`).
 *
 * Returns links aggregated per `(hdModel, lodModel)` with an instance count, each carrying the LOD's id + txd from
 * its IDE def (reused verbatim on the clone — a drop-in, no new id). Read-only reuse of the engine parsers.
 */
export function resolveLodLinks(
  dataDir: string,
  gta3: Archive,
  exclude: ReadonlySet<string> = new Set(),
): ResolveResult {
  const idToModel = new Map<number, string>();
  const modelDef = new Map<string, ModelDef>();
  const timedModels = new Set<string>();
  readDefs(dataDir, idToModel, modelDef, timedModels);
  const textByArea = readTextAreas(dataDir);

  // A model whose DFF we'd replace must be used **only** as a LOD target — if it also has a standalone (non-target)
  // placement, cloning its DFF corrupts that placement (base-geometry / dual-role, see `lod-detection-name-vs-target`).
  const { placed, targeted } = analyzePlacements(textByArea, gta3, idToModel);
  const hasStandalone = (model: string): boolean => (placed.get(model) ?? 0) > (targeted.get(model) ?? 0);

  const counts = new Map<string, number>(); // `${hdModel}|${lodModel}`
  const excludedDualRole = new Set<string>();
  const excludedGenerated = new Set<string>();
  const excludedTimed = new Set<string>();
  const excludedVegetation = new Set<string>();
  let unresolved = 0;
  const link = (hd: string | undefined, lod: string | undefined): void => {
    if (!hd || !lod || isLodModel(hd)) {
      return;
    }
    if (exclude.has(hd) || exclude.has(lod)) {
      excludedGenerated.add(lod); // explicitly owned by a sibling generator (pipeline-supplied) — leave untouched

      return;
    }
    if (TREE_MODELS.has(hd) || TREE_MODELS.has(lod)) {
      excludedVegetation.add(lod); // trees get impostors, not HD clones — decimated/cloned foliage looks bad

      return;
    }
    const def = modelDef.get(lod);
    if (!def) {
      unresolved += 1; // the LOD target has no IDE def — can't clone it

      return;
    }
    if (GENERATED_LOD_TXDS.has(def.txd)) {
      excludedGenerated.add(lod); // already a finished LOD from lod-trees/lod-procobj — leave it untouched

      return;
    }
    if (timedModels.has(hd) && !timedModels.has(lod)) {
      // A timed (tobj) HD whose stock LOD is an UNTIMED neutral stand-in (Rockstar's `lodorlight_nt`-style):
      // cloning would bake the lit night/day appearance into an always-on model — Luxor lights at noon. Timed
      // HD → timed LOD pairs (the LV casino _dy/_nt sets) stay clonable; the game hour-gates them by IDE.
      excludedTimed.add(lod);

      return;
    }
    if (hasStandalone(lod)) {
      excludedDualRole.add(lod); // also placed standalone → leave stock (cloning would corrupt those placements)

      return;
    }
    const key = `${hd}|${lod}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };

  linkTextIpls(textByArea, link);
  linkBinaryIpls(gta3, textByArea, idToModel, link);

  const links: LodLink[] = [];
  for (const [key, count] of counts) {
    const [hdModel, lodModel] = key.split('|');
    const def = modelDef.get(lodModel)!;
    const hd = modelDef.get(hdModel);
    links.push({
      hdDrawDistance: hd?.draw ?? 0,
      hdModel,
      hdTxd: hd?.txd ?? '',
      instanceCount: count,
      lodId: def.id,
      lodModel,
      lodTxd: def.txd,
    });
  }

  return {
    excludedDualRole: excludedDualRole.size,
    excludedGenerated: excludedGenerated.size,
    excludedTimed: excludedTimed.size,
    // The screen-size skip runs in the adapter (it needs DFF radii) — see `createSaLodAdapter.resolvePairs`.
    excludedTiny: 0,
    excludedVegetation: excludedVegetation.size,
    links,
    unresolved,
  };
}

/** Recursively list every file under `dir`. */
export function walk(dir: string, out: string[] = []): string[] {
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

/**
 * Per-model total placements and how many of those placements are LOD **targets** (some instance's `lod` points to
 * them). A model with more placements than targets is placed standalone somewhere → not a pure LOD. Targets are
 * deduped by `(area, index)` since two HDs may point at the same instance.
 */
function analyzePlacements(
  textByArea: Map<string, Instance[]>,
  gta3: Archive,
  idToModel: Map<number, string>,
): { placed: Map<string, number>; targeted: Map<string, number> } {
  const placed = new Map<string, number>();
  const targetKeys = new Set<string>(); // `${area}#${index}` into the area's text instance list
  countTextPlacements(textByArea, placed, targetKeys);
  countBinaryPlacements(gta3, textByArea, idToModel, placed, targetKeys);

  const targeted = new Map<string, number>();
  for (const key of targetKeys) {
    const hash = key.lastIndexOf('#');
    const inst = textByArea.get(key.slice(0, hash))?.[Number(key.slice(hash + 1))];
    if (inst) {
      bump(targeted, inst.model);
    }
  }

  return { placed, targeted };
}

function bump(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function countBinaryPlacements(
  gta3: Archive,
  textByArea: Map<string, Instance[]>,
  idToModel: Map<number, string>,
  placed: Map<string, number>,
  targetKeys: Set<string>,
): void {
  for (const name of gta3.names) {
    const area = name.endsWith('.ipl') ? areaKey(name) : undefined;
    const companion = area ? textByArea.get(area) : undefined;
    const buffer = companion ? gta3.get(name) : null;
    if (!area || !companion || !buffer) {
      continue;
    }
    for (const inst of parseBinaryIpl(buffer)) {
      const model = idToModel.get(inst.id);
      if (model) {
        bump(placed, model);
      }
      if (inst.lod >= 0 && inst.lod < companion.length) {
        targetKeys.add(`${area}#${inst.lod}`);
      }
    }
  }
}

function countTextPlacements(
  textByArea: Map<string, Instance[]>,
  placed: Map<string, number>,
  targetKeys: Set<string>,
): void {
  for (const [area, list] of textByArea) {
    for (const inst of list) {
      bump(placed, inst.model);
      if (inst.lod >= 0 && inst.lod < list.length) {
        targetKeys.add(`${area}#${inst.lod}`);
      }
    }
  }
}

/** Binary stream LOD links: `inst.lod` indexes the companion text IPL (paired by area key). */
function linkBinaryIpls(
  gta3: Archive,
  textByArea: Map<string, Instance[]>,
  idToModel: Map<number, string>,
  link: (hd: string | undefined, lod: string | undefined) => void,
): void {
  for (const name of gta3.names) {
    if (!name.endsWith('.ipl')) {
      continue;
    }
    const companion = textByArea.get(areaKey(name));
    const buffer = companion ? gta3.get(name) : null;
    if (!companion || !buffer) {
      continue;
    }
    for (const inst of parseBinaryIpl(buffer)) {
      if (inst.lod >= 0 && inst.lod < companion.length) {
        link(idToModel.get(inst.id), companion[inst.lod]?.model);
      }
    }
  }
}

/** Text IPL LOD links: `inst.lod` indexes the same file's instance list. */
function linkTextIpls(
  textByArea: Map<string, Instance[]>,
  link: (hd: string | undefined, lod: string | undefined) => void,
): void {
  for (const instances of textByArea.values()) {
    for (const inst of instances) {
      if (inst.lod >= 0 && inst.lod < instances.length) {
        link(inst.model, instances[inst.lod]?.model);
      }
    }
  }
}

/** IDE model defs, keyed by both numeric id (for binary IPLs) and model name (for text IPLs + LOD lookup);
 *  `timedModels` collects the `tobj` (hour-gated) model names. */
function readDefs(
  dataDir: string,
  idToModel: Map<number, string>,
  modelDef: Map<string, ModelDef>,
  timedModels: Set<string>,
): void {
  for (const file of walk(dataDir).filter((path) => path.toLowerCase().endsWith('.ide'))) {
    const text = readFileSync(file, 'utf8');
    for (const [id, ref] of ideRefs(text)) {
      idToModel.set(id, ref.model);
      modelDef.set(ref.model, { draw: ref.drawDistance, id, txd: ref.txd });
    }
    for (const def of parseTimedObjects(text)) {
      timedModels.add(def.modelName.toLowerCase());
    }
  }
}

/** Each area's text IPL instance list (ordered) — the LOD-index space both link sources point into. */
function readTextAreas(dataDir: string): Map<string, Instance[]> {
  const textByArea = new Map<string, Instance[]>();
  for (const file of walk(dataDir)) {
    if (!file.toLowerCase().endsWith('.ipl') || /[/\\]interior[/\\]/i.test(file)) {
      continue;
    }
    const instances = parseIpl(readFileSync(file, 'utf8')).map((inst) => ({
      lod: inst.lod,
      model: inst.modelName.toLowerCase(),
    }));
    textByArea.set(areaKey(file), instances);
  }

  return textByArea;
}
