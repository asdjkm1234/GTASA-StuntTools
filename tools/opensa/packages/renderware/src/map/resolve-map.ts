import type { AssetFileSystem } from '../archive';
import type { IdeObjectDef, IplCarGenerator, IplInstance, MapDefinitions } from '../parsers/text';

import { iplBasename, normalizeDatPath } from '../archive';
import {
  parseBinaryCarGenerators,
  parseBinaryIpl,
  parseGtaDat,
  parseIde,
  parseIpl,
  parseTimedObjects,
  parseTxdParents,
} from '../parsers/text';

/** Path of `gta.dat` within the asset file system (loose, packed by relative path). */
const GTA_DAT = 'data/gta.dat';

/**
 * Basename of opensa-lod-generator's per-cell LOD placement file (`data/maps/lods.ipl`). Its `lod_<cx>_<cy>`
 * instances are the cell **far-LOD** layer, but they're standalone (`lod -1`) — nothing points at them, so the
 * index-based LOD-target test never flags them. We flag them explicitly so the world grid buckets them as LOD
 * (rendered as the far layer, not always-on HD-overlapping geometry).
 */
const CELL_LOD_IPL = 'lods';

/**
 * The script-gated standalone binary IPL groups the engine treats as ALWAYS OPEN (the map ships fully
 * unlocked — no story gates): `truthsfarm` stays; `barriers1`/`barriers2` roadblocks and the mission-state
 * `carter`/`crack` pieces stay OFF. Single source of truth shared by the runtime (`extraIpl` in canvas-host)
 * and by `opensa-lod-generator`, whose cell bake must include exactly the same groups — baking a closed
 * group paints its props (the bridge roadblocks) into the far LODs permanently.
 */
export const OPEN_SCRIPT_IPL = ['truthsfarm'] as const;

export interface ResolveMapOptions {
  /**
   * Extra standalone binary IPL groups (basenames, no extension). These are the script-gated placement
   * groups vanilla toggles via LOAD_IPL/REMOVE_IPL (plan 042): `truthsfarm` (Truth's weed farm),
   * `barriers1`/`barriers2` (the SF/LV unlock roadblocks), `carter`/`crack` (mission-state crack-palace
   * pieces). They're not in gta.dat and carry no `_stream` suffix. Missing files are skipped.
   * Pass {@link OPEN_SCRIPT_IPL} for the standard fully-open world.
   */
  extraIpl?: readonly string[];
}

/**
 * Resolve a whole map (framework-agnostic) from the asset file system: parse gta.dat, merge all IDE
 * object definitions into a catalog, and concatenate all IPL instances (text + the binary `_stream`
 * IPLs + configured standalone groups). Missing IDE/IPL files are skipped rather than aborting the map.
 */
export function resolveMap(fs: AssetFileSystem, options: ResolveMapOptions = {}): MapDefinitions {
  const datText = fs.getText(GTA_DAT);
  if (datText === null) {
    throw new Error(`${GTA_DAT} not found in the asset file system`);
  }
  const dat = parseGtaDat(datText);

  const catalog: MapDefinitions['catalog'] = new Map();
  const timedCatalog = new Map<number, IdeObjectDef>();
  const txdParents = new Map<string, string>();
  for (const idePath of dat.ide) {
    const text = fs.getText(normalizeDatPath(idePath));
    if (text === null) {
      continue;
    }
    for (const def of parseIde(text)) {
      catalog.set(def.id, def);
    }
    for (const def of parseTimedObjects(text)) {
      timedCatalog.set(def.id, def);
    }
    for (const [child, parent] of parseTxdParents(text)) {
      txdParents.set(child, parent); // later IDEs win, like the catalog
    }
  }

  const instances: IplInstance[] = [];
  const carGenerators: IplCarGenerator[] = [];
  for (const iplPath of dat.ipl) {
    if (iplPath.toLowerCase().endsWith('.zon')) {
      continue; // .ZON = zone definitions, not object placement (no inst, no streams)
    }
    const text = fs.getText(normalizeDatPath(iplPath));
    const textInstances = text !== null ? parseIpl(text) : [];
    // Full-detail placement lives in the matching binary stream IPLs (bare `<base>_streamN.ipl`).
    const streamInstances: IplInstance[] = [];
    loadBinaryStreams(fs, iplBasename(iplPath), streamInstances, carGenerators);
    // Flag LOD-target instances before flattening — the `lod` index is per-area (text file + its companion
    // binary streams share one index space; see the `ipl-lod-index-coupling` memory).
    markLodTargets(textInstances, streamInstances);
    // opensa-lod-generator's cell far-LODs (`lods.ipl`) are standalone (`lod -1`), so the target test above never
    // flags them — mark them here so they bucket as LOD (far layer), not always-on HD overlap. See CELL_LOD_IPL.
    markCellLods(iplBasename(iplPath), textInstances);
    instances.push(...textInstances, ...streamInstances);
  }

  // Standalone script-gated groups (plan 042) — the configured "world state" extras (bare `<name>.ipl`).
  for (const name of options.extraIpl ?? []) {
    const buffer = fs.get(`${name.toLowerCase()}.ipl`);
    if (buffer !== null) {
      instances.push(...parseBinaryIpl(buffer));
      carGenerators.push(...parseBinaryCarGenerators(buffer));
    }
  }

  return { carGenerators, catalog, imgDirs: dat.img.map(normalizeDatPath), instances, timedCatalog, txdParents };
}

/** Load the contiguous `<base>_stream{0,1,…}.ipl` binary streams that exist, collecting INST + CARS records. */
function loadBinaryStreams(
  fs: AssetFileSystem,
  basename: string,
  instances: IplInstance[],
  carGenerators: IplCarGenerator[],
): void {
  let index = 0;
  let buffer = fs.get(`${basename}_stream${index}.ipl`);
  while (buffer !== null) {
    instances.push(...parseBinaryIpl(buffer));
    carGenerators.push(...parseBinaryCarGenerators(buffer));
    index += 1;
    buffer = fs.get(`${basename}_stream${index}.ipl`);
  }
}

/** Flag a cell far-LOD file's instances (opensa-lod's `lods.ipl`) as LOD — they're standalone (`lod -1`) so the
 *  index target test can't; without this they'd bucket as always-on HD. No-op for any other IPL. */
function markCellLods(iplBase: string, textInstances: IplInstance[]): void {
  if (iplBase !== CELL_LOD_IPL) {
    return;
  }
  for (const instance of textInstances) {
    instance.isLod = true;
  }
}

/**
 * Mark every LOD-target instance (`isLod`) within one area. Both a text IPL's own `lod` field and its companion
 * binary streams' `lod` fields index the **text** instance list (targets never live in a binary stream), so both
 * mark into `textInstances`. This is the authoritative LOD classification (vs the `lod`-name heuristic).
 */
function markLodTargets(textInstances: IplInstance[], streamInstances: IplInstance[]): void {
  const mark = (lod: number): void => {
    if (lod >= 0 && lod < textInstances.length) {
      textInstances[lod].isLod = true;
    }
  };
  for (const instance of textInstances) {
    mark(instance.lod);
  }
  for (const instance of streamInstances) {
    mark(instance.lod);
  }
}
