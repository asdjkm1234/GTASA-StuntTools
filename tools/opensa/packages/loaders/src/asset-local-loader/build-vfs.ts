/**
 * In-browser run of the shared fetch-build selection (`@opensa/game-build` partition) (plan 053, phase 4). Given a raw GTA install, it
 * picks the same asset set the shipped build packs — the exterior-placed models/textures (from IPL/IDE) plus
 * the loose + world files — using the **shared** partition logic (`src/game-build/partition.ts`). No zipping:
 * the bytes go straight into the VFS (phase 5). The install is reached through {@link InstallSource} so this is
 * unit-testable over fakes; the File System Access wiring lands in phase 5.
 */
import type { Entry, ModelRef } from '@opensa/game-build/partition';

import { decodeScript } from '@opensa/cleo';
import { ideRefs, partitionEntries, placedModels } from '@opensa/game-build/partition';
import { parseTxdParents } from '@opensa/renderware/parsers/text/ide.parser';
import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { parsePedDefs } from '@opensa/renderware/parsers/text/ped-defs.parser';
import { parseProcObj } from '@opensa/renderware/parsers/text/procobj.parser';
import { parseVehicleDefs } from '@opensa/renderware/parsers/text/vehicle-defs.parser';

import type { LazyImgArchive } from './img-reader';

/** What to materialise into the VFS — mirrors the build's buckets (loose files are grouped by `looseGroup`). */
export interface InstallPlan {
  /** Loose file paths, ingested by their relative path (bucketed by `looseGroup`). */
  loose: string[];
  /** Referenced geometry (`.osm` when converted, else `.dff`) + every `.col` archive entry. */
  models: Entry[];
  /** Placement/anim/data world files (ipl/ifp/dat) from `gta3.img`, ingested by bare name. */
  others: Entry[];
  /** Referenced dictionaries: a converted model's `.ostex`, plus the `.txd` of whatever stayed stock. */
  textures: Entry[];
}

/** A raw GTA install folder, abstracted for the conversion (FSA-backed in production, faked in tests). */
export interface InstallSource {
  /** Opened `gta3.img` (required) — lazy entry reads. */
  readonly gta3: LazyImgArchive;
  /** Opened `gta_int.img` (override), or null when absent. */
  readonly gtaInt: LazyImgArchive | null;
  /** Loose file paths, lowercased + `/`-joined relative, EXCLUDING the model/anim archives. */
  looseFiles(): Promise<string[]>;
  /** Open a file as a Blob (a File handle — `slice()` reads ranges off disk, no whole read), or null when
   *  absent. The world pak reads its bytes this way in folder mode, so the multi-GB pak never loads whole. */
  openLoose(path: string): Promise<Blob | null>;
  /** Raw bytes of a loose file. */
  readLoose(path: string): Promise<Uint8Array>;
  /** UTF-8 text of a loose file (IDE/IPL). */
  readLooseText(path: string): Promise<string>;
}

/** Read one partition entry's bytes from the archive it resolves to (gta3, or gta_int override). */
export async function readEntry(source: InstallSource, entry: Entry): Promise<Uint8Array> {
  const archive = entry.source === 'gta3' ? source.gta3 : source.gtaInt;
  const bytes = archive ? await archive.read(entry.name) : null;
  if (!bytes) {
    throw new Error(`missing archive entry: ${entry.name}`);
  }

  return bytes;
}

/**
 * Compute the install's selection (exterior-placed models/textures + loose + world) — the build's port. Also
 * pulls in **every** ped (from `peds.ide`) and **every** vehicle (from `vehicles.ide`), since those are spawned
 * dynamically, not placed on the map, so the partition would otherwise miss them.
 */
export async function selectInstallEntries(source: InstallSource): Promise<InstallPlan> {
  const ide = await ideData(source);
  const placed = placedModels(await placedInstanceIds(source), ide.byId);
  const extra = await dynamicModelRefs(source);
  const clutter = await procObjModelRefs(source);
  const scripted = await cleoModelRefs(source, ide.byId);
  const refs = {
    models: [...placed.models, ...extra.models, ...clutter.models, ...scripted.models],
    txds: withTxdParents([...placed.txds, ...extra.txds, ...clutter.txds, ...scripted.txds], ide.txdParents),
  };
  const { models, others, textures } = partitionEntries(
    refs,
    new Set(source.gta3.names),
    new Set(source.gtaInt?.names ?? []),
  );

  return { loose: await source.looseFiles(), models, others, textures };
}

async function cleoModelRefs(
  source: InstallSource,
  ideById: ReadonlyMap<number, ModelRef>,
): Promise<{ models: string[]; txds: string[] }> {
  const txdByModel = new Map<string, string>();
  for (const ref of ideById.values()) {
    txdByModel.set(ref.model.toLowerCase(), ref.txd.toLowerCase());
  }
  const models = new Set<string>();
  for (const path of await source.looseFiles()) {
    if (!path.startsWith('cleo/') || !path.endsWith('.cs')) {
      continue;
    }
    try {
      collectScriptModels(decodeScript(await source.readLoose(path)), ideById, models);
    } catch (error) {
      // eslint-disable-next-line no-console -- a skipped script must be visible, not silent
      console.warn(`[cleo] ${path} failed to decode — its models are not selected:`, error);
    }
  }
  const txds: string[] = [];
  for (const model of models) {
    const txd = txdByModel.get(model);
    if (txd) {
      txds.push(txd);
    }
  }

  return { models: [...models], txds };
}

/**
 * Model + txd base names a CLEO script spawns (plan 097/04, the spike's measured subset boundary):
 * script-created models are neither IPL-placed nor dynamic-spawned, so the partition would miss them
 * and `fs.get('<name>.osm')` would come back null at runtime. Every loose `cleo/*.cs` is pre-decoded
 * (plan 01's decoder — pure, browser-safe) and its literal model references collected: REQUEST_MODEL
 * `0247` / CREATE_OBJECT_NO_SAVE `0E01` ids resolved through the IDE map, GET_MODEL_BY_NAME `0E9C`
 * strings taken as names. A script that fails to decode is SKIPPED with a log — a broken mod script
 * must not cost the whole install.
 */
/** One decoded script's literal model references into `models` (lowercased names). */
function collectScriptModels(
  script: ReturnType<typeof decodeScript>,
  ideById: ReadonlyMap<number, ModelRef>,
  models: Set<string>,
): void {
  for (const instruction of script.instructions) {
    if (instruction.opcode === 0x0e9c && instruction.operands[0]?.kind === 'string') {
      models.add(instruction.operands[0].value.toLowerCase());
    }
    if (instruction.opcode === 0x0247 || instruction.opcode === 0x0e01) {
      const operand = instruction.operands[0];
      if (operand?.kind === 'int') {
        const ref = ideById.get(operand.value);
        if (ref) {
          models.add(ref.model.toLowerCase());
        }
      }
    }
  }
}

/** Model + txd base names for the dynamically-spawned set: **every** ped in `peds.ide` + **every** vehicle in
 *  `vehicles.ide` (both are spawned dynamically, not placed on the map, so the partition would otherwise miss them). */
async function dynamicModelRefs(source: InstallSource): Promise<{ models: string[]; txds: string[] }> {
  const models: string[] = [];
  const txds: string[] = [];
  const loose = await source.looseFiles();

  const pedsPath = loose.find((path) => path.endsWith('peds.ide'));
  if (pedsPath) {
    for (const def of parsePedDefs(await source.readLooseText(pedsPath)).values()) {
      models.push(def.model.toLowerCase());
      txds.push(def.txd.toLowerCase());
    }
  }

  const vehiclesPath = loose.find((path) => path.endsWith('vehicles.ide'));
  if (vehiclesPath) {
    for (const def of parseVehicleDefs(await source.readLooseText(vehiclesPath)).values()) {
      models.push(def.model.toLowerCase());
      txds.push(def.txd.toLowerCase());
    }
  }

  return { models, txds };
}

/**
 * What one pass over every IDE under `data/` yields: `id → {model, txd}` (the build's `ideIdMap`) and the
 * `txdp` child → parent links. The parents are read here because they are named NOWHERE else — a dictionary
 * only ever appears as some other dictionary's ancestor, never as an IDE row's txd — so a partition built
 * from IDE rows alone cannot know it is needed.
 */
async function ideData(
  source: InstallSource,
): Promise<{ byId: Map<number, ModelRef>; txdParents: Map<string, string> }> {
  const byId = new Map<number, ModelRef>();
  const txdParents = new Map<string, string>();
  for (const path of await source.looseFiles()) {
    if (path.startsWith('data/') && path.endsWith('.ide')) {
      const text = await source.readLooseText(path);
      for (const [id, ref] of ideRefs(text)) {
        byId.set(id, ref);
      }
      for (const [child, parent] of parseTxdParents(text)) {
        txdParents.set(child, parent); // later IDEs win, like resolveMap's catalog
      }
    }
  }

  return { byId, txdParents };
}

/** Exterior-placed instance ids: text IPLs under `data/` (not `interior/`) + binary IPL streams in gta3.img. */
async function placedInstanceIds(source: InstallSource): Promise<number[]> {
  const ids: number[] = [];
  for (const path of await source.looseFiles()) {
    if (path.startsWith('data/') && path.endsWith('.ipl') && !path.includes('/interior/')) {
      for (const inst of parseIpl(await source.readLooseText(path))) {
        ids.push(inst.id);
      }
    }
  }
  for (const name of source.gta3.names) {
    if (name.endsWith('.ipl')) {
      const bytes = await source.gta3.read(name);
      if (bytes) {
        for (const inst of parseBinaryIpl(toArrayBuffer(bytes))) {
          ids.push(inst.id);
        }
      }
    }
  }

  return ids;
}

/** Model + txd base names for the procedurally-SCATTERED clutter (plan 042 / 074/19): `procobj.dat` names
 *  the models the game scatters over collision surfaces (grass, rocks, cacti). Like peds/vehicles, they are
 *  never IPL-placed, so the partition would miss their DFF+TXD and the clutter would silently not render. */
async function procObjModelRefs(source: InstallSource): Promise<{ models: string[]; txds: string[] }> {
  const loose = await source.looseFiles();
  const procObjPath = loose.find((path) => path.endsWith('procobj.dat'));
  if (!procObjPath) {
    return { models: [], txds: [] };
  }
  // procobj.dat carries only model NAMES; the TXD lives in the model's IDE row — build a name → txd map.
  const txdByModel = new Map<string, string>();
  for (const ref of (await ideData(source)).byId.values()) {
    txdByModel.set(ref.model.toLowerCase(), ref.txd.toLowerCase());
  }
  const models: string[] = [];
  const txds: string[] = [];
  for (const rule of parseProcObj(await source.readLooseText(procObjPath))) {
    const model = rule.model.toLowerCase();
    models.push(model);
    const txd = txdByModel.get(model);
    if (txd) {
      txds.push(txd);
    }
  }

  return { models, txds };
}

/** A tight `ArrayBuffer` view of `bytes` (copying only when it is a sub-range of a larger buffer). */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }

  return bytes.slice().buffer;
}

/**
 * The referenced dictionaries plus every `txdp` ANCESTOR of each — a child TXD inherits the textures it
 * lacks from its parent chain, and the texture resolvers (`asset-cache`, `TexturePlanner`) walk that chain
 * at read time. A parent left out of the install is therefore not an error anywhere: the lookup simply falls
 * off the end and the material renders in its flat colour. Measured on a merged build: `salodpar.txd`
 * (2.7 MB, 1 087 textures) is the shared parent of 995 `salod*` LOD dictionaries and is named by no IDE row,
 * so every LOD texture that lived only in it came out white.
 *
 * Only the ancestors of dictionaries already wanted are added — pulling every parent in the file would drag
 * in dictionaries nothing on this map references. Cycle-safe.
 */
function withTxdParents(txds: readonly string[], parents: ReadonlyMap<string, string>): string[] {
  const out = new Set<string>();
  for (const txd of txds) {
    let current: string | undefined = txd.toLowerCase();
    while (current && !out.has(current)) {
      out.add(current);
      current = parents.get(current);
    }
  }

  return [...out];
}
