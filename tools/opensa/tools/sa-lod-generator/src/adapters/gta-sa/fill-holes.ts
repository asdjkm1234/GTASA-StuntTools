import type { Vec3 } from '@opensa/lod-common/mesh';

import { ideRefs } from '@opensa/game-build/partition';
import { encodeColLibrary } from '@opensa/lod-common/encode-col';
import { patchGtaDat } from '@opensa/map-placement/ide';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { ADDED_ID_WINDOW } from '@opensa/tool-kit/free-ids';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Archives } from './io';

import { cloneKeepTypes, stripCloneTo } from './clone-2dfx';
import { areaKey, walk } from './resolve';

export interface FillInput {
  archives: Archives;
  /** The clone-TXD provider (shared with Phase 1): source HD txd → packed ½-res clone txd name, or `null`. */
  ensureTxd: (hdTxd: string) => null | string;
  holeLodDraw: number;
  /** Keep particle 2dfx on the hole-fill clones — **default true** since plan 010 (`--strip-particles` opts out);
   *  see {@link LodConfig.keepParticles}. */
  keepParticles: boolean;
  /** Curated HD models (lowercased) to give a far-LOD. */
  models: ReadonlySet<string>;
  /** The drop-in build's `data/` dir (IPLs/IDE/gta.dat edited in place). */
  outDataDir: string;
  /** The shared `gta3.img` editor (LOD DFFs + edited binary streams are packed here). */
  setImg: (name: string, bytes: Uint8Array) => void;
}

export interface FillStats {
  appended: number;
  filled: number;
  skipped: number;
}

/** A LOD to generate for a curated HD-without-LOD model (plan 003). */
interface HoleFill {
  /** Local AABB (from the HD DFF) — the bounds-only COL3 SA needs so the new streamed model has collision. */
  bounds: { max: Vec3; min: Vec3 };
  hdModel: string;
  hdTxd: string;
  lodId: number;
  lodModel: string;
}

/** Append rows to the `inst` section and set the `lod` column (col 10) of the given data rows; verbatim otherwise. */
export function applyTextEdits(text: string, appends: readonly string[], setLods: ReadonlyMap<number, number>): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  let inInst = false;
  let row = -1;
  for (const line of lines) {
    const token = line.trim().toLowerCase();
    if (inInst && token === 'end') {
      out.push(...appends);
      inInst = false;
    } else if (token === 'inst') {
      inInst = true;
    } else if (inInst && isRow(line)) {
      row += 1;
      out.push(setLod(line, setLods.get(row)));
      continue;
    }
    out.push(line);
  }

  return out.join(eol);
}

/**
 * Generate a far-LOD for each curated HD-without-LOD model (plan 003): a verbatim HD-clone DFF + ½-res TXD under a
 * new id, an IDE def with a high draw distance, and — for every placement — a leaf LOD instance appended to the
 * area's companion **text** IPL at the HD's transform, with the HD instance's `lod` pointed at it (text row or
 * binary stream record). Append-only, so the `lod`-index space is never disturbed (see `ipl-lod-index-coupling`).
 */
export function fillMissingLods(input: FillInput): FillStats {
  const { idToModel, maxId, modelDef } = readDefs(input.outDataDir);
  const { streamsByArea, textByArea } = readAreas(input.outDataDir, input.archives);
  const roles = placementRoles(textByArea, streamsByArea, input.archives, idToModel);

  const fills = assignFills(input, modelDef, roles, maxId);
  const byHd = new Map(fills.map((fill) => [fill.hdModel, fill]));
  writeIde(input, fills);
  // Each new LOD is a **new** streamed model — SA faults (`MODEL_DOES_NOT_HAVE_COLLISION_LOADED`) on any model
  // with no collision, so pack one bounds-only COL3 per model (named to it). SA auto-discovers `.col` in the IMG.
  if (fills.length > 0) {
    input.setImg(
      'salod-holes.col',
      encodeColLibrary(
        fills.map((fill) => fill.bounds),
        fills.map((fill) => fill.lodModel),
      ),
    );
  }

  let appended = 0;
  for (const [area, text] of textByArea) {
    appended += editArea(input, area, text, streamsByArea.get(area) ?? [], byHd, idToModel);
  }

  return { appended, filled: fills.length, skipped: input.models.size - fills.length };
}

/** Point a binary IPL stream's `lod` field (record → new companion-text index); returns a patched copy. */
export function linkBinaryLods(buffer: Uint8Array, links: ReadonlyMap<number, number>): Uint8Array {
  const bytes = buffer.slice();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const instOffset = view.getUint32(0x1c, true);
  for (const [record, lod] of links) {
    view.setInt32(instOffset + record * 40 + 36, lod, true);
  }

  return bytes;
}

/** Validate each curated model and assign it a new id + LOD name + clone TXD + packed HD-clone DFF. */
function assignFills(
  input: FillInput,
  modelDef: Map<string, { id: number; txd: string }>,
  roles: { hasOutLod: Set<string>; isTarget: Set<string> },
  maxId: number,
): HoleFill[] {
  const fills: HoleFill[] = [];
  let nextId = maxId;
  for (const hdModel of [...input.models].sort()) {
    const def = modelDef.get(hdModel);
    const dff = input.archives.get(`${hdModel}.dff`);
    if (!def || !dff || roles.hasOutLod.has(hdModel) || roles.isTarget.has(hdModel)) {
      continue; // not a valid HD-without-LOD (missing, or already a LOD) — skip + report
    }
    const txd = input.ensureTxd(def.txd);
    if (!txd) {
      continue; // no source atlas to downscale
    }
    nextId += 1;
    const lodModel = `salodh${String(fills.length).padStart(4, '0')}`;
    // Same as Phase 1's verbatim path: the shared policy decides what rides, applied subtractively so the
    // byte copy keeps every plugin our writers do not model.
    input.setImg(`${lodModel}.dff`, stripCloneTo(new Uint8Array(dff), cloneKeepTypes(input.keepParticles)));
    fills.push({ bounds: dffBounds(dff), hdModel, hdTxd: txd, lodId: nextId, lodModel });
  }

  return fills;
}

/** Local AABB over a DFF's vertices — the bounds for its (faces-less) COL3. */
function dffBounds(dff: ArrayBuffer): { max: Vec3; min: Vec3 } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let seen = false;
  try {
    for (const geometry of parseDff(dff).geometries) {
      const p = geometry.positions;
      for (let i = 0; i < p.length; i += 3) {
        seen = true;
        for (let a = 0; a < 3; a += 1) {
          min[a] = Math.min(min[a], p[i + a]);
          max[a] = Math.max(max[a], p[i + a]);
        }
      }
    }
  } catch {
    seen = false; // unparseable → zero bounds
  }

  return seen ? { max, min } : { max: [0, 0, 0], min: [0, 0, 0] };
}

/** Per-area: append a leaf LOD at each curated HD's transform and point that HD's `lod` (text row or stream record). */
function editArea(
  input: FillInput,
  area: string,
  text: { file: string; instances: ReturnType<typeof parseIpl> },
  streams: readonly string[],
  byHd: Map<string, HoleFill>,
  idToModel: Map<number, string>,
): number {
  const appends: string[] = [];
  let nextIdx = text.instances.length;
  const setLods = new Map<number, number>();

  for (const name of streams) {
    const buffer = input.archives.gta3.get(name);
    if (!buffer) {
      continue;
    }
    const links = new Map<number, number>();
    parseBinaryIpl(buffer).forEach((inst, record) => {
      const fill = byHd.get(idToModel.get(inst.id) ?? '');
      if (fill) {
        appends.push(instLine(fill, inst.position, inst.rotation, inst.interior));
        links.set(record, nextIdx);
        nextIdx += 1;
      }
    });
    if (links.size > 0) {
      input.setImg(name, linkBinaryLods(new Uint8Array(buffer), links));
    }
  }

  text.instances.forEach((inst, row) => {
    const fill = byHd.get(inst.modelName.toLowerCase());
    if (fill) {
      appends.push(instLine(fill, inst.position, inst.rotation, inst.interior));
      setLods.set(row, nextIdx);
      nextIdx += 1;
    }
  });

  if (appends.length > 0 || setLods.size > 0) {
    writeFileSync(text.file, applyTextEdits(readFileSync(text.file, 'utf8'), appends, setLods));
  }

  return appends.length;
}

/** An `inst` row placing the LOD at the HD's transform (`lod -1` — it is itself a leaf). */
function instLine(fill: HoleFill, pos: readonly number[], rot: readonly number[], interior: number): string {
  return `${fill.lodId}, ${fill.lodModel}, ${interior}, ${[...pos, ...rot].join(', ')}, -1`;
}

function isRow(line: string): boolean {
  const trimmed = line.trim();

  return trimmed !== '' && !trimmed.startsWith('#') && !Number.isNaN(Number(trimmed.split(',')[0]));
}

/** Models that already act as a LOD (have an outgoing `lod`, or are a target) — excluded from hole-filling. */
function placementRoles(
  textByArea: Map<string, { file: string; instances: ReturnType<typeof parseIpl> }>,
  streamsByArea: Map<string, string[]>,
  archives: Archives,
  idToModel: Map<number, string>,
): { hasOutLod: Set<string>; isTarget: Set<string> } {
  const hasOutLod = new Set<string>();
  const isTarget = new Set<string>();
  const note = (model: string | undefined, lod: number, list: ReturnType<typeof parseIpl>): void => {
    if (model && lod >= 0 && lod < list.length) {
      hasOutLod.add(model);
      isTarget.add(list[lod].modelName.toLowerCase());
    }
  };
  for (const { instances } of textByArea.values()) {
    for (const inst of instances) {
      note(inst.modelName.toLowerCase(), inst.lod, instances);
    }
  }
  for (const [area, list] of textByArea) {
    for (const name of streamsByArea.get(area) ?? []) {
      const buffer = archives.gta3.get(name);
      if (buffer) {
        for (const inst of parseBinaryIpl(buffer)) {
          note(idToModel.get(inst.id), inst.lod, list.instances);
        }
      }
    }
  }

  return { hasOutLod, isTarget };
}

/** Each area's companion text IPL (path + parsed instances) and its binary stream names. */
function readAreas(
  dataDir: string,
  archives: Archives,
): {
  streamsByArea: Map<string, string[]>;
  textByArea: Map<string, { file: string; instances: ReturnType<typeof parseIpl> }>;
} {
  const textByArea = new Map<string, { file: string; instances: ReturnType<typeof parseIpl> }>();
  for (const file of walk(dataDir)) {
    if (file.toLowerCase().endsWith('.ipl') && !/[/\\]interior[/\\]/i.test(file)) {
      textByArea.set(areaKey(file), { file, instances: parseIpl(readFileSync(file, 'utf8')) });
    }
  }
  const streamsByArea = new Map<string, string[]>();
  for (const name of archives.gta3.names) {
    if (name.endsWith('.ipl')) {
      const key = areaKey(name);
      streamsByArea.set(key, [...(streamsByArea.get(key) ?? []), name]);
    }
  }

  return { streamsByArea, textByArea };
}

/**
 * IDE defs (model → id/txd, id → model) + the highest id — new LODs number from `maxId + 1` (needs fastman92).
 *
 * **The ADDED-CONTENT window is excluded from that maximum.** `maxId + 1` follows whatever else is in the
 * tree, and since 2026-08-20 a vehicle mod's borrowed tuning parts get ids out of 19 001–19 999 in an
 * earlier stage — which dragged these LODs from 18 633 into the window and pushed the whole added fleet 35
 * ids up, silently, in a file whose own header calls an id a promise. A map LOD belongs below 19 000 (SA's
 * map allocators stop there); the window belongs to the tools that allocate out of it with a ledger.
 */
function readDefs(dataDir: string): {
  idToModel: Map<number, string>;
  maxId: number;
  modelDef: Map<string, { id: number; txd: string }>;
} {
  const idToModel = new Map<number, string>();
  const modelDef = new Map<string, { id: number; txd: string }>();
  let maxId = 0;
  for (const file of walk(dataDir).filter((path) => path.toLowerCase().endsWith('.ide'))) {
    for (const [id, ref] of ideRefs(readFileSync(file, 'utf8'))) {
      idToModel.set(id, ref.model);
      modelDef.set(ref.model, { id, txd: ref.txd });
      if (id < ADDED_ID_WINDOW.first) {
        maxId = Math.max(maxId, id);
      }
    }
  }

  return { idToModel, maxId, modelDef };
}

function setLod(line: string, lod: number | undefined): string {
  if (lod === undefined) {
    return line;
  }
  const cells = line.split(',');
  if (cells.length < 11) {
    return line;
  }
  const lead = /^\s*/.exec(cells[10])?.[0] ?? ' ';
  cells[10] = `${lead}${lod}`;

  return cells.join(',');
}

/** Write the new LODs' IDE (`objs`) and register it in `gta.dat` so the game loads them. */
function writeIde(input: FillInput, fills: readonly HoleFill[]): void {
  if (fills.length === 0) {
    return;
  }
  const rel = join('maps', 'salod-holes.ide');
  const rows = fills.map((fill) => `${fill.lodId}, ${fill.lodModel}, ${fill.hdTxd}, ${input.holeLodDraw}, 0`);
  writeFileSync(join(input.outDataDir, rel), `objs\n${rows.join('\n')}\nend\n`);
  // Register the IDE **before the first IPL** (via patchGtaDat): the salodh instances live in stock text IPLs, so
  // their ids must be defined before those IPLs load — appending at the end crashes with `undefined ID`.
  const datPath = join(input.outDataDir, 'gta.dat');
  const dat = readFileSync(datPath, 'utf8');
  if (!/salod-holes\.ide/i.test(dat)) {
    writeFileSync(datPath, patchGtaDat(dat, 'DATA\\MAPS\\salod-holes.ide'));
  }
}
