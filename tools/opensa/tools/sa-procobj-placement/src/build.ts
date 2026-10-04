import type { SourceTexture, TextureSource } from '@opensa/lod-common/texture-source';
import type { ImgArchive } from '@opensa/renderware/archive/img-archive';
import type { RWClump } from '@opensa/renderware/parsers/binary/types';

import { createModelSource, type ModelSource } from '@opensa/lod-common/model-source';
import { applyStockPrelight, type FoliagePredicate, type PrelightInfo } from '@opensa/lod-common/prelight';
import { createTextureSource } from '@opensa/lod-common/texture-source';
import { convertProcObj, type ProcObjCategoryCost, type ProcObjSpecies } from '@opensa/map-placement/procobj';
import { densityLabel, type ProcObjDensityInput } from '@opensa/map-placement/procobj-density';
import { UNDERWATER_PROCOBJ } from '@opensa/map-placement/procobj-strip';
import { retxdSwappedModels, writeTxdpHdMod } from '@opensa/map-placement/retxd';
import { openArchive } from '@opensa/renderware/archive/img-archive';
import { datChildUrl } from '@opensa/renderware/archive/resolve-paths';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { parseGtaDat } from '@opensa/renderware/parsers/text/gta-dat.parser';
import { parseIde, parseTimedObjects } from '@opensa/renderware/parsers/text/ide.parser';
import { decodeDxt } from '@opensa/rw-codec/dxt';
import { editArchive, writeImgFile } from '@opensa/tool-kit/archive/img';
import { type BuildTarget } from '@opensa/tool-kit/target';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { ProcObjLodConfig } from './config';

import { config as defaultConfig } from './config';
import { buildModelMesh, meshBounds } from './mesh-builder';

/** Convenience wrapper: partial `config` merged over the defaults (symmetry with lod-trees `buildTreeLods`). */
export function buildProcobjLods(options: {
  config?: Partial<ProcObjLodConfig>;
  gamePath: string;
  inPath?: string;
  modloader?: boolean;
  outPath: string;
  prelight?: boolean;
  prelightInfo?: PrelightInfo;
  target?: BuildTarget;
}): void {
  run({
    config: { ...defaultConfig, ...options.config },
    gamePath: options.gamePath,
    inPath: options.inPath,
    modloader: options.modloader ?? false,
    outPath: options.outPath,
    prelight: options.prelight ?? false,
    prelightInfo: options.prelightInfo,
    target: options.target ?? 'sa',
  });
}

const IPL_NAME = 'lod_procobj';
/** Area IPL base (`plobj<i>.ipl`). Kept short from the era when each area also shipped
 *  `plobj<i>_stream<k>.ipl` entries inside the IMG, where VER2 caps names at 23 bytes. */
const AREA_BASE = 'plobj';
/** The HD mod (`<out>/hd/`) `txdp` IDE — parents each swapped model's stock TXD to the custom TXD, so the stock
 *  IDEs stay untouched (the `./5` approach; see {@link emitHdMod}). */
const TXDP_IDE_REL = 'data/maps/lod_procobj_hd.ide';

export interface BuildOptions {
  config: ProcObjLodConfig;
  gamePath: string;
  /** Optional HD model folder (`<model>.dff` + `<model>.txd`); omitted → convert the game's own procobj models. */
  inPath?: string;
  /** `--modloader`: emit two Modloader mods under `<out>` — `lod/` (the permanent IPLs + raised `procobj.ide` +
   *  stripped `procobj.dat` + `loader.txt`) and `hd/` (the swapped HD models via a `txdp` IDE, no stock IDE
   *  rewritten) — instead of writing into `<out>` + patching `data/gta.dat` with the HD swap inlined. */
  modloader: boolean;
  outPath: string;
  /** Copy each model's trunk prelight from its stock DFF onto the swapped HD (needs `--in`). */
  prelight: boolean;
  /** Per-model `--prelight` overrides (`--prelight <info.json>`); models in `skip` are left untouched. */
  prelightInfo?: PrelightInfo;
  /** The host this layer is built FOR — it decides which ceilings the layer's cost is reported against, and
   *  (07/02, 07/04) which density profile and caps it is built to. */
  target: BuildTarget;
}

/**
 * The per-category breakdown (plan 010 task "logging"). It exists because a TOTAL cannot show DISPLACEMENT:
 * once the global `procObjMax` slice binds, raising one category takes objects from the others, and
 * "bushes +8 000 / rocks −8 000" is a different result from "+8 000 objects" while the totals agree.
 */
export function categoryCostLines(categories: readonly ProcObjCategoryCost[]): string[] {
  return categories.map(({ category, dropped, generated, objects }) => {
    const kept = generated > 0 ? ((100 * objects) / generated).toFixed(1) : '0.0';

    return (
      `  ${category.padEnd(10)} ${String(objects).padStart(7)} objects · ` +
      `${String(generated).padStart(7)} candidates (${kept} % kept)` +
      (dropped > 0 ? ` · ${dropped} taken by the cap` : '')
    );
  });
}

/** The changed IMG entries to emit — since plan 014 only the swapped HD DFFs and the custom TXDs their retxd
 *  produced. The layer itself ships no asset: it is text rows plus a raised draw distance. */
export function collectImgEntries(
  swap: ReadonlyMap<string, Uint8Array>,
  retxdTxds: ReadonlyMap<string, Uint8Array>,
): Map<string, Uint8Array> {
  const entries = new Map<string, Uint8Array>();
  for (const [name, bytes] of [...swap, ...retxdTxds]) {
    entries.set(name, bytes);
  }

  return entries;
}

/** Combined model source: the `--in` pack's DFF first (the model the HD is swapped to), then the archive. */
export function combinedModelSource(inPath: string, archive: ImgArchive): ModelSource {
  const stock = createModelSource([archive]);
  const files = new Map(
    statSync(inPath).isDirectory()
      ? readdirSync(inPath)
          .filter((f) => f.toLowerCase().endsWith('.dff'))
          .map((f) => [base(f), join(inPath, f)] as const)
      : [[base(inPath), inPath] as const],
  );
  const cache = new Map<string, null | RWClump>();

  return {
    load(model: string): null | RWClump {
      const key = base(model);
      const cached = cache.get(key);
      if (cached !== undefined || cache.has(key)) {
        return cached ?? null;
      }
      const file = files.get(key);
      let clump: null | RWClump = null;
      if (file) {
        try {
          const bytes = readFileSync(file);
          clump = parseDff(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        } catch {
          clump = null; // unparseable pack DFF — fall through to stock
        }
      }
      clump = clump ?? stock.load(model);
      cache.set(key, clump);

      return clump;
    },
  };
}

/**
 * model → bbox height for every candidate that clears the `procObjHeight` gate — the only thing the placement
 * layer reads from geometry. A model the source cannot load is skipped rather than failing the build: a TC's
 * `procobj.dat` may name species it does not ship.
 */
export function gatedHeights(
  species: readonly string[],
  modelSource: ModelSource,
  minHeight: number,
): Map<string, number> {
  const heights = new Map<string, number>();
  for (const model of species) {
    const clump = modelSource.load(model);
    if (!clump) {
      continue;
    }
    const height = speciesHeight(clump);
    if (minHeight > 0 && height < minHeight) {
      continue; // short clutter (grass) — left on the runtime scatter
    }
    heights.set(model, height);
  }

  return heights;
}

/**
 * The layer's PRICE, READ OFF the run: objects placed, the permanent text rows they cost (one each since plan
 * 014, so the ratio is 1.000 and stays there), and the inst-bearing area files they spend against SA's 40 slots.
 *
 * `sa` is the only host that pays it — OpenSA scatters this clutter at runtime. What the rows spend there is the
 * `CBuilding` pool and the int16 building index our asi lifts.
 */
export function layerCostLine(
  target: BuildTarget,
  density: ProcObjDensityInput,
  procObj: null | {
    drawDistance?: { changed: number };
    dropped?: number;
    floored?: number;
    instBearingFiles?: number;
    objects: number;
    rows: number;
    staleAreasRemoved?: number;
  },
): null | string {
  if (!procObj) {
    return null; // nothing converted (a TC with no matching species) — there is no price to report
  }
  const { drawDistance, dropped = 0, floored = 0, instBearingFiles, objects, rows, staleAreasRemoved } = procObj;
  const perObject = objects > 0 ? (rows / objects).toFixed(3) : '0.000';

  return (
    `procobj cost (target ${target}, density ${densityLabel(density)}): ` +
    `${objects} objects · ${rows} permanent text rows · ${perObject} rows/object` +
    // The other, scarcer price: an inst-bearing area IPL is one of SA's 40 IplEntityIndexArrays slots, and the
    // field crashed on slot 40 (plan 002). Reported beside the rows so a density change shows BOTH costs.
    (instBearingFiles === undefined ? '' : ` · ${instBearingFiles} inst-bearing area IPL(s) of SA's 40 slots`) +
    // The range the rows are declared at, stated because it is the layer's whole visibility mechanism now.
    (drawDistance === undefined ? '' : ` · ${drawDistance.changed} species raised to the configured draw distance`) +
    // Never silent: an in-place bake that deletes a previous run's surplus says how much it deleted, or a
    // census taken over the directory reads two scatters at once (measured 2026-08-10: 46 files for 10 areas).
    (staleAreasRemoved ? ` · ${staleAreasRemoved} stale area file(s) from an earlier run removed` : '') +
    // What the species-floor guarantee cost: these are objects the density lottery had turned down, so a build
    // that reports a density is also reporting this, or the two numbers stop adding up.
    (floored > 0 ? ` · ${floored} floored in (species-roster guarantee)` : '') +
    // A capped run is measuring procObjMax, not the density it says it ran at — so the cap says so itself.
    (dropped > 0 ? ` · CAP DROPPED ${dropped} (procObjMax binds — raise it or this density is not what shipped)` : '') +
    (target === 'sa'
      ? " — permanent rows spend SA's int16 building-pool budget (perfect-map.asi past 32,767 map-wide)"
      : ' — no SA row ceiling on this target')
  );
}

/**
 * Delete the outputs this tool USED to write and no longer does — the LOD IDE and the linear-TXD sidecar of the
 * pre-014 shape.
 *
 * The bake runs in place on a tree that is not wiped between runs, so a retired output survives every later
 * build. `lod_procobj.ide` was found in the artifact on 2026-08-10 declaring 48 models with zero DFFs behind
 * them. Harmless as it stood — unregistered in `gta.dat` and nothing places those ids — but a stale declaration
 * that nobody removed is indistinguishable from a live one a month later, and the whole reason this project
 * gates dangling models is that such a thing is invisible until the field finds it.
 *
 * Silent by design here: these are OUR leftovers, not the user's data, and the first run after the change is the
 * only one with anything to remove.
 */
export function removeRetiredOutputs(outPath: string): void {
  for (const relative of [join('data', 'maps', `${IPL_NAME}.ide`), join('linear-txd', `${IPL_NAME}.txd`)]) {
    rmSync(join(outPath, relative), { force: true });
  }
}

/**
 * Convert the `--dff ∩ procobj` species into static IPL instances with **simplified-copy** LODs: per species,
 * build a model-local mesh (frame-aware) → QEM decimate → re-derive normals → encode a low-poly DFF; pack one
 * shared `lod_procobj.txd` (downscaled, `--txd ∪ stock`) + `lod_procobj.col`; register the LODs in
 * `lod_procobj.ide`; then reuse `convertProcObj` (scatter → static IPL + `procobj.dat` strip), swap the procobj
 * HD DFFs for `--dff`, and emit the drop-in under `--out`.
 */
export function run(options: BuildOptions): void {
  const { config, gamePath, modloader, outPath, prelight, prelightInfo, target } = options;
  const inPath = swapFolder(options.inPath);
  const archive = openArchive(readBytes(join(gamePath, 'models', 'gta3.img')));
  const dat = parseGtaDat(readFileSync(join(gamePath, 'data', 'gta.dat'), 'utf8'));
  const { idByModel } = scanIdes(gamePath, dat.ide);
  const procModels = procObjModels(gamePath);

  // Non-modloader: mirror the whole input game first so the drop-in is a **complete** build (our repacked gta3.img +
  // the IPLs below then overwrite the copies) — even when there are no species to convert. Keeps the pipeline
  // lossless (see plan 005). `--modloader` writes only `lod/` + `hd/` mods, so it must NOT mirror.
  //
  // `--game` === `--out` is an IN-PLACE bake, which is how pmb runs it since plan 014: the layer belongs to the
  // `sa` target alone, so it is baked into the finished `sa/` tree rather than into the common build both targets
  // share. Mirroring a tree onto itself is at best a long no-op, so it is skipped — every read here happens
  // before the write that would disturb it.
  const inPlace = resolve(gamePath) === resolve(outPath);
  if (!modloader && !inPlace) {
    cpSync(gamePath, outPath, { force: true, recursive: true });
  }

  // Candidate species: a procobj scatter species that has a stock object id. With `--in`, narrowed to the models
  // it ships; without it, **every** procobj species — converted straight from the game's own gta3.img. The
  // never-touch UNDERWATER set (seaweed/starfish/searock) is dropped here too — `convertProcObj` never places it,
  // so without this filter the no-`--in` run would bake dead LOD DFFs/ids/IDE rows for seabed scatter.
  const candidates = inPath === undefined ? [...procModels] : listDffModels(inPath).filter((m) => procModels.has(m));
  const species = candidates.filter((m) => idByModel.has(m) && !UNDERWATER_PROCOBJ.has(m));
  // With `--in` the HD gets SWAPPED to the pack's model — so the LOD must decimate the PACK model too, or
  // near/far show two different plants (stock silhouette + stock textures at LOD range vs the modded HD).
  const modelSource = inPath === undefined ? createModelSource([archive]) : combinedModelSource(inPath, archive);
  const textureSource = inPath === undefined ? createTextureSource([archive]) : combinedTextureSource(inPath, archive);

  const heights = gatedHeights(species, modelSource, config.procObjHeight);
  if (heights.size === 0) {
    // Name the likely cause rather than the symptom. An in-place bake CONSUMES its input: the first run strips
    // the converted species out of `procobj.dat`, so a second run on the same tree sees only the never-touch
    // underwater set and has nothing to do. Harmless (this returns before anything is written), but "no species"
    // reads like a missing `--in` and sent one debugging session looking for the wrong thing.
    const rebaked = inPlace && existsSync(join(outPath, 'data', 'maps', `${AREA_BASE}0.ipl`));
    console.log(
      rebaked
        ? `sa-procobj-placement: ${outPath} is already baked (its procobj.dat is stripped) — nothing to do. ` +
            'Re-run from the common build, not on the output.'
        : 'sa-procobj-placement: no `--dff ∩ procobj` species to convert',
    );

    return;
  }

  // `--prelight` transfers each stock model's ambient onto its SWAPPED HD copy, foliage kept. Foliage is decided
  // by the texture's own alpha, read UNSCOPED: the scoped-name registry existed only to disambiguate names inside
  // the shared LOD txd, and there is no longer a shared LOD txd.
  const isFoliage: FoliagePredicate = (name) => textureSource.get(name)?.hasAlpha ?? false;

  const species_ = new Map<string, ProcObjSpecies>(
    [...heights].map(([model, height]) => [model, { hdId: idByModel.get(model)!, height }]),
  );
  // `--modloader` ships two mods under `<out>`: `lod/` (this build's placements + data) and `hd/` (the swapped HD
  // models). Under `--modloader` procobj.dat is emitted as disable rows (surviving Modloader's additive `.dat`
  // merge) rather than stripped.
  const lodOut = modloader ? join(outPath, 'lod') : outPath;
  const procObj = convertProcObj({
    archive,
    areaBase: AREA_BASE,
    density: config.density,
    disableScatter: modloader,
    drawDistance: config.drawDistance,
    gamePath,
    heightThreshold: config.procObjHeight,
    iplName: IPL_NAME,
    outPath: lodOut,
    procObjMax: config.procObjMax,
    sampler: config.procObjSampler,
    slope: config.procObjSlope,
    species: species_,
    speciesFloor: config.procObjSpeciesFloor,
  });
  logLayerCost(target, config.density, procObj);
  // The swapped (prelit) HD DFFs — with `--in`, regardless of mode (the HD carries our prelight; we don't drop it).
  const swapModels = [...heights.keys()];
  const swap =
    inPath === undefined
      ? new Map<string, Uint8Array>()
      : swapEntries(inPath, swapModels, prelight ? archive : null, isFoliage, prelightInfo);

  emitRegistration({ gamePath, modloader, outPath: lodOut, procObj });
  removeRetiredOutputs(lodOut);

  if (modloader) {
    // LOD mod: only the LOD assets to `<out>/lod/gta3img/`; the HD swap is a separate `<out>/hd/` mod that parents
    // the stock TXDs to the custom one via `txdp` — so no stock IDE is rewritten (the `./5` approach).
    emitImg(archive, collectImgEntries(new Map(), new Map()), lodOut, true);
    const swapped = emitHdMod(inPath, gamePath, dat, swap, swapModels, outPath);
    console.log(
      `procobj→sa: ${species_.size} species · ${procObj?.objects ?? 0} static objects → ${outPath}/lod` +
        (swapped > 0 ? ` · ${swapped} HD swapped (txdp) → ${outPath}/hd` : ''),
    );

    return;
  }

  // `--out`: repack everything (LOD assets + swapped HD + custom TXDs) into models/gta3.img + retxd the stock IDEs.
  const retxd =
    inPath === undefined
      ? { ides: new Map<string, string>(), txds: new Map<string, Uint8Array>() }
      : retxdSwappedModels(gamePath, dat.ide, inPath, inPath, swapModels);
  for (const [idePath, text] of retxd.ides) {
    writeText(join(outPath, idePath.replace(/\\/g, '/')), text);
  }
  emitImg(archive, collectImgEntries(swap, retxd.txds), outPath, false);
  console.log(
    `procobj→sa: ${species_.size} species · ${procObj?.objects ?? 0} static objects · ` +
      `${swap.size} HD swapped (${retxd.txds.size} custom TXD) → ${outPath}/models/gta3.img`,
  );
}

/**
 * A species' bbox HEIGHT in model-local space (frame-aware), which is the only thing the placement layer reads
 * from the geometry — it feeds `procObjHeight`, the gate that leaves short clutter (grass) on the runtime
 * scatter. Plan 014: no mesh is decimated and no LOD is encoded here any more.
 */
export function speciesHeight(clump: RWClump): number {
  const bbox = meshBounds(buildModelMesh(clump));

  return bbox.max[2] - bbox.min[2];
}

/**
 * The HD-swap folder, or `undefined` for "no swap" — every `procobj.dat` species converts from the game's
 * own `gta3.img`.
 *
 * A caller may hand over a path that is not there: pmb always passes `<mods-src>/procobj`, whether or not
 * the user keeps that folder. An absent folder, and one holding no `.dff`, both mean the same thing as
 * omitting the flag — no models to swap in — so they take the same default path rather than throwing.
 * A path the CLI was given EXPLICITLY is checked there, so a typo is still loud.
 */
export function swapFolder(inPath: string | undefined): string | undefined {
  if (inPath === undefined) {
    return undefined;
  }
  const stat = statSync(inPath, { throwIfNoEntry: false });
  if (stat === undefined) {
    console.log(`sa-procobj-placement: no HD swap folder at ${inPath} — converting every procobj species`);

    return undefined;
  }
  if (stat.isDirectory() && listDffModels(inPath).length === 0) {
    console.log(`sa-procobj-placement: no .dff in ${inPath} — converting every procobj species`);

    return undefined;
  }

  return inPath;
}

function base(path: string): string {
  return (path.split(/[\\/]/).pop() ?? path).replace(/\.(?:dff|txd)$/i, '').toLowerCase();
}

/** Combined texture resolver: the user's `--txd` first, then the stock game TXDs (downscaled by the encoder). */
function combinedTextureSource(txdPath: string, archive: ImgArchive): TextureSource {
  const custom = loadCustomTextures(txdPath);
  const stock = createTextureSource([archive]);

  return {
    get: (name) => custom.get(name.toLowerCase()) ?? stock.get(name),
    getFrom: (txd, name) => custom.get(name.toLowerCase()) ?? stock.getFrom!(txd, name),
  };
}

/**
 * Emit the HD mod under `<out>/hd/` (`--modloader`): the swapped (prelit) procobj HD DFFs + the custom parent TXD,
 * plus a `txdp` IDE parenting each swapped model's **stock** TXD to the custom one — so the stock IDEs are never
 * rewritten (the `./5` approach). Returns the number of swapped DFFs; 0 (nothing written) without `--in` or when no
 * model matched a custom TXD.
 */
function emitHdMod(
  inPath: string | undefined,
  gamePath: string,
  dat: ReturnType<typeof parseGtaDat>,
  swap: ReadonlyMap<string, Uint8Array>,
  swapModels: readonly string[],
  outPath: string,
): number {
  if (inPath === undefined) {
    return 0;
  }

  return writeTxdpHdMod({
    gamePath,
    hdDir: join(outPath, 'hd'),
    idePaths: dat.ide,
    inPath,
    swap,
    swapModels,
    txdpIdeRel: TXDP_IDE_REL,
  });
}

/** Repack the changed entries into `<out>/models/gta3.img`, or write them loose to `<out>/gta3img/` (`--modloader`). */
function emitImg(archive: ImgArchive, entries: ReadonlyMap<string, Uint8Array>, outPath: string, loose: boolean): void {
  if (loose) {
    for (const [name, bytes] of entries) {
      writeBytes(join(outPath, 'gta3img', name), bytes);
    }

    return;
  }
  const img = editArchive(archive);
  for (const [name, bytes] of entries) {
    img.set(name, bytes);
  }
  writeImgFile(img, join(outPath, 'models', 'gta3.img'));
}

/**
 * Register the area IPLs for the game to load: a Modloader `loader.txt` of `IPL` lines (`--modloader`, no
 * `gta.dat` edit — Modloader merges them), or a patched `data/gta.dat` (default). The IPLs, the raised
 * `procobj.ide` and the stripped `procobj.dat` already sit at their `data/` paths (written by `convertProcObj`).
 *
 * **No `IDE` line of our own since plan 014**: the layer places STOCK species under their stock ids, so the
 * declaration it needs is the stock `procobj.ide` the game already loads — the bake only raises its draw
 * distance. An IDE we registered here would be a second declaration of models that already have one.
 */
function emitRegistration(args: {
  gamePath: string;
  modloader: boolean;
  outPath: string;
  procObj: null | { datLines: string[] };
}): void {
  const { gamePath, modloader, outPath, procObj } = args;
  if (modloader) {
    const lines: string[] = [];
    for (const datLine of procObj?.datLines ?? []) {
      lines.push(datLine.replace(/\\/g, '/').replace('DATA/MAPS', 'data/maps'));
    }
    writeText(join(outPath, 'loader.txt'), `${lines.join('\n')}\n`);

    return;
  }
  let gtaDat = readFileSync(join(gamePath, 'data', 'gta.dat'), 'utf8');
  if (procObj && procObj.datLines.length > 0) {
    const eol = gtaDat.includes('\r\n') ? '\r\n' : '\n';
    gtaDat = `${gtaDat.replace(/\s*$/, '')}${eol}${procObj.datLines.join(eol)}${eol}`;
  }
  writeText(join(outPath, 'data', 'gta.dat'), gtaDat);
}

/** Model names under `--dff` (a `.dff` file or a directory), lowercased without extension. */
function listDffModels(dffPath: string): string[] {
  if (!statSync(dffPath).isDirectory()) {
    return [base(dffPath)];
  }

  return readdirSync(dffPath)
    .filter((f) => f.toLowerCase().endsWith('.dff'))
    .map(base);
}

/** Decode every texture in the `--txd` (a `.txd` file or a directory of them) to RGBA, keyed by lowercased name. */
function loadCustomTextures(txdPath: string): Map<string, SourceTexture> {
  const files = statSync(txdPath).isDirectory()
    ? readdirSync(txdPath)
        .filter((f) => f.toLowerCase().endsWith('.txd'))
        .map((f) => join(txdPath, f))
    : [txdPath];
  const out = new Map<string, SourceTexture>();
  for (const file of files) {
    for (const tex of parseTxd(toArrayBuffer(readBytes(file))).textures) {
      const key = tex.name.toLowerCase();
      const base = tex.mipmaps[0];
      if (out.has(key) || !base) {
        continue;
      }
      const rgba = tex.format === 'rgba8888' ? base.data : decodeDxt(tex.format, base.data, base.width, base.height);
      out.set(key, { hasAlpha: tex.hasAlpha, height: base.height, rgba, width: base.width });
    }
  }

  return out;
}

/** Print {@link layerCostLine} and its per-category breakdown when there is a price to print. */
function logLayerCost(
  target: BuildTarget,
  density: ProcObjDensityInput,
  procObj: null | { categories?: readonly ProcObjCategoryCost[]; objects: number; rows: number },
): void {
  const line = layerCostLine(target, density, procObj);
  if (line === null) {
    return;
  }
  console.log(line);
  for (const line_ of categoryCostLines(procObj?.categories ?? [])) {
    console.log(line_);
  }
}

/** procobj scatter species (column 2 of each `procobj.dat` data row), lowercased. */
function procObjModels(gamePath: string): Set<string> {
  const models = new Set<string>();
  for (const line of readFileSync(join(gamePath, 'data', 'procobj.dat'), 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed !== '' && !trimmed.startsWith('#')) {
      const model = trimmed.split(/\s+/)[1]?.toLowerCase();
      if (model) {
        models.add(model);
      }
    }
  }

  return models;
}

function readBytes(path: string): Uint8Array {
  const buffer = readFileSync(path);

  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

/** model name → object id, and the full set of occupied ids, from every IDE the gta.dat lists. */
function scanIdes(
  gamePath: string,
  idePaths: readonly string[],
): { idByModel: Map<string, number>; txdByModel: Map<string, string>; usedIds: Set<number> } {
  const idByModel = new Map<string, number>();
  const txdByModel = new Map<string, string>();
  const usedIds = new Set<number>();
  for (const idePath of idePaths) {
    const file = datChildUrl(gamePath, idePath);
    if (!existsSync(file)) {
      continue;
    }
    const text = readFileSync(file, 'utf8');
    for (const def of [...parseIde(text), ...parseTimedObjects(text)]) {
      usedIds.add(def.id);
      idByModel.set(def.modelName.toLowerCase(), def.id);
      txdByModel.set(def.modelName.toLowerCase(), def.txdName.toLowerCase());
    }
  }

  return { idByModel, txdByModel, usedIds };
}

/**
 * Read the user HD DFF bytes for each swapped model, keyed by its `<model>.dff` IMG entry. When `archive` is given
 * (`--prelight`), each swapped DFF inherits its stock model's trunk prelight before being packed — except models
 * the `--prelight` info opts out (`prelightInfo.skip`), which are packed verbatim.
 */
function swapEntries(
  dffPath: string,
  models: readonly string[],
  archive: ImgArchive | null,
  isFoliage: FoliagePredicate,
  prelightInfo: PrelightInfo | undefined,
): Map<string, Uint8Array> {
  const isDir = statSync(dffPath).isDirectory();
  const files = isDir
    ? new Map(readdirSync(dffPath).map((f) => [base(f), join(dffPath, f)]))
    : new Map([[base(dffPath), dffPath]]);
  const swap = new Map<string, Uint8Array>();
  for (const model of models) {
    const file = files.get(model);
    if (!file) {
      continue;
    }
    let bytes = readBytes(file);
    if (archive && !prelightInfo?.skip.has(model)) {
      const stock = archive.get(`${model}.dff`);
      if (stock) {
        bytes = applyStockPrelight(bytes, new Uint8Array(stock), isFoliage);
      } else {
        console.warn(`  ! ${model}: no stock DFF in gta3.img → prelight not transferred`);
      }
    }
    swap.set(`${model}.dff`, bytes);
  }

  return swap;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function writeBytes(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
