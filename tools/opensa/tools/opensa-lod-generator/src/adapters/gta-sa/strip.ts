import type { ImgArchive } from '@opensa/renderware/archive/img-archive';

import { stripBinaryIpl } from '@opensa/map-placement/ipl-binary-strip';
import { stripTextIpl } from '@opensa/map-placement/ipl-text-strip';
import { openArchive } from '@opensa/renderware/archive/img-archive';
import { datChildUrl } from '@opensa/renderware/archive/resolve-paths';
import { parseGtaDat } from '@opensa/renderware/parsers/text/gta-dat.parser';
import { parseIde, parseTimedObjects } from '@opensa/renderware/parsers/text/ide.parser';
import { isInterior } from '@opensa/renderware/parsers/text/interior';
import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { isLodModel } from '@opensa/renderware/parsers/text/lod';
import { editArchive, writeImgFile } from '@opensa/tool-kit/archive/img';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

type GtaDat = ReturnType<typeof parseGtaDat>;

/**
 * Strip the stock far-LOD layer from a finished build — the cell-LODs replace it, so the old per-object LODs are
 * dead weight. Removes their instances from the text IPLs and the binary streams in `models/gta3.img` (repairing
 * the shared text↔binary `lod`-index space), then deletes fully-unplaced models' `.dff`/`.txd` from `gta3.img`.
 *
 * Two complementary rules pick what goes (mirroring `resolve.ts`, which decides what gets *baked*):
 *
 * - **By name**: `lod*`-named models placed in the *exterior* world and never inside an interior. The name alone
 *   is unreliable — `LODCJ_SLOT_BANK` is a casino-*interior* prop, so any `lod*` name with an interior placement
 *   is kept whole. Standalone exterior LODs (never pointed at — `LODmcstraps_LAe2`) *are* stripped.
 * - **By IPL `lod`-index target** (per instance, any name): rows some instance's `lod` field points at are the
 *   far-LOD stand-ins the cells replace — this catches renamed/underscored LODs the name rule misses
 *   (`lod_conhoos2`, `lodcepalcst02`, `nw_lodbit_18`), which otherwise stay in the engine's LOD bucket and
 *   z-fight the cell-LODs. Only the *targeted rows* are removed — a dual-role model's standalone placements
 *   survive, and its DFF/TXD is deleted **only when no placement of it survives anywhere**.
 *
 * The cell-LOD `lods.*` assets are `lod*`-named too, so they're skipped. IDE defs are left as-is. Returns the
 * removed counts.
 */
export function stripOldLods(
  buildDir: string,
  exclude: ReadonlySet<string> = new Set(),
): { entries: number; instances: number } {
  const dat = parseGtaDat(readFileSync(join(buildDir, 'data', 'gta.dat'), 'utf8'));
  const imgPath = join(buildDir, 'models', 'gta3.img');
  const archive = openArchive(readBytes(imgPath));

  const idToModel = idToModelMap(buildDir, dat);
  const { interiorModels, lodExterior } = classifyPlacements(buildDir, dat, archive, idToModel);
  const isOldLod = (name: string): boolean => {
    const model = name.toLowerCase();

    // Sibling generators' LODs (lod-trees/lod-procobj) are `lod*`-named too but must survive — they're the far
    // representation for content opensa-lod deliberately doesn't bake into cells.
    return lodExterior.has(model) && !interiorModels.has(model) && !exclude.has(model);
  };
  const lodIds = new Set([...idToModel].filter(([, model]) => isOldLod(model)).map(([id]) => id));
  const binaryTargets = collectBinaryTargets(archive);

  // Text IPLs first: each area's removal map is the LOD-index space its binary streams point into. Track which
  // models lost target rows and which models still have surviving placements (guards the DFF/TXD deletion).
  const maps = new Map<string, Int32Array>();
  const strippedTargets = new Set<string>();
  const survivors = new Set<string>();
  let instances = 0;
  for (const iplPath of dat.ipl) {
    const file = datChildUrl(buildDir, iplPath);
    if (iplPath.toLowerCase().endsWith('.zon') || isCellLodFile(iplPath) || !existsSync(file)) {
      continue;
    }
    const result = stripOneTextIpl(file, binaryTargets.get(areaKey(iplPath)), {
      exclude,
      isOldLod,
      strippedTargets,
      survivors,
    });
    if (result.removed > 0) {
      maps.set(areaKey(iplPath), result.map);
      instances += result.removed;
    }
  }

  // Binary streams inside gta3.img: drop lod* insts + remap survivors' `lod` via the area map (binary instances
  // are never lod-targets themselves — the index space is the text list); then delete the DFF/TXD entries of
  // models that no longer have any placement.
  const img = editArchive(archive);
  instances += stripBinaryStreams(archive, img, { idToModel, lodIds, maps, survivors });
  let entries = 0;
  for (const name of archive.names) {
    const model = name.replace(/\.[^.]+$/, '').toLowerCase();
    const dead = isOldLod(model) || (strippedTargets.has(model) && !survivors.has(model));
    if (/\.(?:dff|txd)$/i.test(name) && dead && img.delete(name)) {
      entries += 1;
    }
  }
  writeImgFile(img, imgPath);

  return { entries, instances };
}

/** Area key shared by a text IPL and its binary streams: `countrye.ipl` & `countrye_stream3.ipl` → `countrye`. */
function areaKey(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;

  return base
    .replace(/_stream\d+\.ipl$/i, '')
    .replace(/\.ipl$/i, '')
    .toLowerCase();
}

/**
 * Scan every placement (text IPLs + binary streams) and bucket each model: `interiorModels` = placed in any
 * interior; `lodExterior` = `lod*`-named with at least one exterior placement. A stock LOD to strip is then
 * `lodExterior − interiorModels` (so a dual-role `lod*` name with any interior use is kept whole).
 */
function classifyPlacements(
  buildDir: string,
  dat: GtaDat,
  archive: ImgArchive,
  idToModel: ReadonlyMap<number, string>,
): { interiorModels: Set<string>; lodExterior: Set<string> } {
  const interiorModels = new Set<string>();
  const lodExterior = new Set<string>();
  const note = (model: string | undefined, interior: number): void => {
    if (!model) {
      return;
    }
    if (isInterior(interior)) {
      interiorModels.add(model);
    } else if (isLodModel(model)) {
      lodExterior.add(model);
    }
  };

  for (const iplPath of dat.ipl) {
    const file = datChildUrl(buildDir, iplPath);
    if (iplPath.toLowerCase().endsWith('.zon') || isCellLodFile(iplPath) || !existsSync(file)) {
      continue;
    }
    for (const inst of parseIpl(readFileSync(file, 'utf8'))) {
      note(inst.modelName.toLowerCase(), inst.interior);
    }
  }
  for (const name of archive.names) {
    if (!name.toLowerCase().endsWith('.ipl')) {
      continue;
    }
    for (const inst of parseBinaryIpl(toArrayBuffer(new Uint8Array(archive.get(name) ?? new ArrayBuffer(0))))) {
      note(idToModel.get(inst.id), inst.interior);
    }
  }

  return { interiorModels, lodExterior };
}

/** Per-area target indices contributed by the binary streams (their `lod` points into the companion text IPL). */
function collectBinaryTargets(archive: ImgArchive): Map<string, Set<number>> {
  const byArea = new Map<string, Set<number>>();
  for (const name of archive.names) {
    if (!name.toLowerCase().endsWith('.ipl')) {
      continue;
    }
    for (const inst of parseBinaryIpl(archive.get(name) ?? new ArrayBuffer(0))) {
      if (inst.lod >= 0) {
        let targets = byArea.get(areaKey(name));
        if (!targets) {
          targets = new Set();
          byArea.set(areaKey(name), targets);
        }
        targets.add(inst.lod);
      }
    }
  }

  return byArea;
}

/** Object id → model name (lowercased) from every gta.dat IDE except our own `lods.ide`. */
function idToModelMap(buildDir: string, dat: GtaDat): Map<number, string> {
  const map = new Map<number, string>();
  for (const idePath of dat.ide) {
    const file = datChildUrl(buildDir, idePath);
    if (isCellLodFile(idePath) || !existsSync(file)) {
      continue;
    }
    const text = readFileSync(file, 'utf8');
    for (const def of [...parseIde(text), ...parseTimedObjects(text)]) {
      map.set(def.id, def.modelName.toLowerCase());
    }
  }

  return map;
}

/** Our own cell-LOD data files (`lods.ide` / `lods.ipl`) — they're `lod*`-named, so must be skipped by the strip. */
function isCellLodFile(path: string): boolean {
  return /(?:^|[\\/])lods\.(?:ide|ipl)$/i.test(path);
}

function readBytes(path: string): Uint8Array {
  const buffer = readFileSync(path);

  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

/** Strip lod-id instances from every binary stream, remapping survivors' `lod` and noting surviving models. */
function stripBinaryStreams(
  archive: ImgArchive,
  img: ReturnType<typeof editArchive>,
  state: {
    idToModel: ReadonlyMap<number, string>;
    lodIds: ReadonlySet<number>;
    maps: ReadonlyMap<string, Int32Array>;
    survivors: Set<string>;
  },
): number {
  let removed = 0;
  for (const name of archive.names) {
    if (!name.toLowerCase().endsWith('.ipl')) {
      continue;
    }
    const bytes = new Uint8Array(archive.get(name) ?? new ArrayBuffer(0));
    for (const inst of parseBinaryIpl(toArrayBuffer(bytes))) {
      const model = state.idToModel.get(inst.id);
      if (model && !state.lodIds.has(inst.id)) {
        state.survivors.add(model);
      }
    }
    const result = stripBinaryIpl(bytes, (id) => !state.lodIds.has(id), state.maps.get(areaKey(name)) ?? null);
    if (result.changed) {
      img.set(name, result.bytes);
      removed += result.removed;
    }
  }

  return removed;
}

/** Strip one text IPL in place: name-rule LODs + lod-index target rows (see {@link stripOldLods}). */
function stripOneTextIpl(
  file: string,
  binaryTargets: ReadonlySet<number> | undefined,
  rules: {
    exclude: ReadonlySet<string>;
    isOldLod: (name: string) => boolean;
    strippedTargets: Set<string>;
    survivors: Set<string>;
  },
): { map: Int32Array; removed: number } {
  const text = readFileSync(file, 'utf8');
  const rows = parseIpl(text);
  const targets = new Set<number>(binaryTargets ?? []);
  for (const row of rows) {
    if (row.lod >= 0 && row.lod < rows.length) {
      targets.add(row.lod);
    }
  }
  const result = stripTextIpl(text, (_id, name, row) => {
    const model = name.toLowerCase();
    if (rules.isOldLod(model)) {
      return false;
    }
    if (targets.has(row) && !rules.exclude.has(model) && !isInterior(rows[row]?.interior ?? 0)) {
      rules.strippedTargets.add(model);

      return false;
    }
    rules.survivors.add(model);

    return true;
  });
  if (result.removed > 0) {
    writeFileSync(file, result.text);
  }

  return result;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
