import type { ArchiveIndex } from '@opensa/tool-kit/archive/layout';
import type { BuildTarget } from '@opensa/tool-kit/target';

import { openArchive } from '@opensa/renderware/archive/img-archive';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
/**
 * The emit path: wipe `--out`, copy the `--game` base in (vehicle-installer's pattern), convert every
 * ready car slot and rebuild `models/cutscene.img` with the converted entries, then patch
 * `data/txdcut.ide` (fix R*'s `csopcarla` typo row, add the rows R* left out) so the empty-TXD route
 * (step 6) has a parent for every slot. Vanilla cs TXDs stay in place until step 6.
 *
 * Under `noBaseCopy` (plan 006) the base copy is skipped and only the three written files land in
 * `--out`. Every read comes from `--game` in BOTH modes — in the copy mode the copy is the game, byte
 * for byte, so one read path serves both and the two modes cannot drift apart.
 *
 * Per-slot conversion failures are collected and reported, never silently skipped. All three branches
 * (car / bike / boat) convert; the branch comes from the slot's `vehicles.ide` type.
 */
import { parseCarcols, type VehicleColours } from '@opensa/renderware/parsers/text/carcols.parser';
import { openImg, writeImgFile } from '@opensa/tool-kit/archive/img';
import { openArchiveIndex } from '@opensa/tool-kit/archive/layout';
import { guardOut } from '@opensa/tool-kit/game-dir';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { ConvertReport } from './rig/emit';
import type { SeatPoint } from './seats';

import { wheelAnimPoses } from './anim-poses';
import {
  type Census,
  type CutsceneSlot,
  loadCensus,
  matchMods,
  PANE_SUPPRESSED_SLOTS,
  type SlotReadiness,
} from './census';
import { bakePaintMarkers, paintColoursFor } from './materials';
import { appendTextures, composePlatePair, PLATE_TOWNS, plateTextFor } from './plate';
import { convertBike } from './rig/bike';
import { convertBoat } from './rig/boat';
import { convertCar } from './rig/car';
import { patchActorSeats } from './seat-patch';
import { patchWheelStashes } from './stash-patch';
import { extractBikeTemplate, extractBoatTemplate, extractCarTemplate, toArrayBuffer } from './template';
import { emptyTxd, referencesPlates, textureNames, unresolvedTextures } from './txd';

export interface CutsceneInstallOptions {
  gamePath: string;
  inPath: string;
  /**
   * Emit ONLY the three files this tool writes, instead of copying the `--game` tree into `--out` first
   * (plan 006). `--out` is never wiped under this flag — it is a folder of the caller's choosing.
   */
  noBaseCopy?: boolean;
  /** Restrict conversion to these donor models / cs names (the CLI's `--only`). */
  only?: ReadonlySet<string>;
  outPath: string;
  /** Plate-text override for ALL slots (default: per-slot deterministic text; plan 003). */
  plate?: string;
  /** Which town's plate background the bake wears (`ls` default — the intro's scenes; plan 003). */
  plateTown?: string;
  /** Escape hatch: on a closure miss, copy the parent TXD into the cs TXD instead of erroring. */
  selfContainedTxd?: boolean;
  /** Which layer of a LAYERED `inPath` (common/sa/opensa) the fleet is read with — the build's target. */
  target?: BuildTarget;
}

export interface CutsceneInstallSummary {
  /** `<scene.ifp> <car> <actor> <dz>` rows lifted by the seat retarget (plan 005); absent = none. */
  actorsSeated?: string[];
  converted: string[];
  errors: { csName: string; message: string }[];
  imgBytesAfter: number;
  imgBytesBefore: number;
  /** Per-model count of paint-marker materials baked with the carcols colours (plan 002 step 5). */
  painted: { csName: string; materials: number }[];
  /** Slots whose cs TXD carries a baked readable plate pair, with the composed text (plan 003). */
  plates: { csName: string; text: string }[];
  skipped: { csName: string; reason: string }[];
  /** Total bytes of the emitted `cs*.txd` entries (empty dictionaries unless self-contained). */
  txdBytes: number;
  /** Non-fatal findings, e.g. a mod's PRE-EXISTING texture holes (missing in gameplay too). */
  warnings: { csName: string; message: string }[];
  /** `<scene.ifp> <model> <bone>` rows sunk by the wheel-stash patch (round 20); absent = none. */
  wheelStashesSunk?: string[];
}

interface SlotContext {
  carcols: VehicleColours;
  /**
   * Every `models/*.img` in the `--game` tree, resolved by entry NAME.
   *
   * It used to be `gta3.img` alone, and the archive split broke that on its first pipeline run: the txdp
   * parents this reads (the installed mod TXDs) had moved into `vehicles.img` and its spill sibling, so a
   * closure that was fine reported `unresolved textures (txdp parent washing.txd)`. Asking WHERE rather
   * than assuming is the fix, and it costs one directory read per archive.
   */
  game: ArchiveIndex;
  /** Texture names of the resident generic `models/generic/vehicle.txd`. */
  genericNames: readonly string[];
  /** The resident generic `models/generic/vehicle.txd` bytes — plate-source art lives here. */
  genericTxd: Uint8Array;
  /** Plate-text override (`--plate`), already cut to eight cells; undefined = per-slot text. */
  plateOverride?: string;
  plateTown: (typeof PLATE_TOWNS)[string];
  /** Per cs model (lowercased): the seat points the converter resolved — the seat retarget's input. */
  seatsBySlot: Map<string, readonly SeatPoint[]>;
  selfContainedTxd: boolean;
  /** Per cs model: wheel-bone frame-0 anim translations from `anim/cuts.img` (round 16 — the anims'
   *  pose overrides a lying bind; csglendale92 binds its left wheels crossed). */
  wheelPoses: ReadonlyMap<string, ReadonlyMap<string, readonly [number, number, number]>>;
}

/** Build the output game: base copy + converted cutscene.img + patched txdcut.ide. */
export function installCutscene(options: CutsceneInstallOptions): CutsceneInstallSummary {
  const gamePath = resolve(options.gamePath);
  const inPath = resolve(options.inPath);
  const outPath = resolve(options.outPath);
  const noBaseCopy = options.noBaseCopy === true;
  guardOut(outPath, gamePath, inPath);

  if (!noBaseCopy) {
    rmSync(outPath, { force: true, recursive: true });
    cpSync(gamePath, outPath, { force: true, recursive: true });
  }

  const census = loadCensus(gamePath);
  const readiness = matchMods(census.slots, inPath, options.target).filter(
    (entry) => !options.only || options.only.has(entry.slot.model) || options.only.has(entry.slot.csName),
  );

  const town = options.plateTown ?? 'ls';
  if (!(town in PLATE_TOWNS)) {
    throw new Error(`--plate-town must be one of ${Object.keys(PLATE_TOWNS).join(' | ')} (got '${town}')`);
  }
  const sourceImgPath = join(gamePath, 'models', 'cutscene.img');
  const imgBytesBefore = statSync(sourceImgPath).size;
  const img = openImg(new Uint8Array(readFileSync(sourceImgPath)));
  const genericTxd = new Uint8Array(readFileSync(join(gamePath, 'models', 'generic', 'vehicle.txd')));
  const plateOverride = options.plate === undefined ? undefined : plateTextFor('', options.plate);
  const context: SlotContext = {
    carcols: parseCarcols(readFileSync(join(gamePath, 'data', 'carcols.dat'), 'utf8')),
    game: openArchiveIndex(gamePath),
    genericNames: textureNames(genericTxd),
    genericTxd,
    ...(plateOverride !== undefined ? { plateOverride } : {}),
    plateTown: PLATE_TOWNS[town],
    seatsBySlot: new Map(),
    selfContainedTxd: options.selfContainedTxd === true,
    wheelPoses: loadWheelPoses(gamePath),
  };

  const summary: CutsceneInstallSummary = {
    converted: [],
    errors: [],
    imgBytesAfter: 0,
    imgBytesBefore,
    painted: [],
    plates: [],
    skipped: [],
    txdBytes: 0,
    warnings: [],
  };
  if (options.plate !== undefined && plateOverride !== undefined && options.plate.length > plateOverride.length) {
    summary.warnings.push({
      csName: '--plate',
      message: `text '${options.plate}' is longer than a plate's 8 cells — truncated to '${plateOverride}'`,
    });
  }
  // Wheel-corner bind distances from the VANILLA entries — captured BEFORE conversion overwrites them.
  const cornerBinds = wheelCornerBinds(census, img);

  for (const entry of readiness) {
    convertSlot(entry, img, inPath, context, summary);
  }

  const outImgPath = join(outPath, 'models', 'cutscene.img');
  writeImgFile(img, outImgPath);
  summary.imgBytesAfter = statSync(outImgPath).size;
  patchTxdcut(gamePath, outPath, census);
  patchCutsceneAnims(gamePath, outPath, noBaseCopy, cornerBinds, context, summary);

  return summary;
}

/**
 * Is this cutscene object an ACTOR? A SKINNED clump is — the same test perfect-cutscene's ASI makes at
 * runtime (`GetAnimHierarchyFromSkinClump`), and the only one that works: model TYPE cannot tell them
 * apart (every cutscene object reports 5, the shared CUTOBJ slots) and a name rule would be a guess.
 * Props ride vehicles too, and without this the mothership's `csmstand` matched a seat point and was
 * lifted 1.6 m. Cutscene peds live in `cutscene.img`, EXCEPT the player: `csplay` is in `gta3.img`.
 */
function actorPredicate(gamePath: string, context: SlotContext): (model: string) => boolean {
  const cutscene = openArchive(new Uint8Array(readFileSync(join(gamePath, 'models', 'cutscene.img'))));
  const known = new Map<string, boolean>();

  return (model: string): boolean => {
    const cached = known.get(model);
    if (cached !== undefined) {
      return cached;
    }
    const dff = cutscene.get(`${model}.dff`) ?? context.game.get(`${model}.dff`);
    let skinned = false;
    try {
      skinned = dff !== null && parseDff(dff).geometries.some((geometry) => geometry.skin !== undefined);
    } catch {
      skinned = false; // an unreadable clump is not evidence of an actor
    }
    known.set(model, skinned);

    return skinned;
  };
}

function convertSlot(
  entry: SlotReadiness,
  img: ReturnType<typeof openImg>,
  inPath: string,
  context: SlotContext,
  summary: CutsceneInstallSummary,
): void {
  const { folder, slot, status } = entry;
  if (status !== 'ready') {
    summary.skipped.push({ csName: slot.csName, reason: status });

    return;
  }
  try {
    const vanilla = img.get(`${slot.csName}.dff`);
    if (!vanilla) {
      throw new Error(`cutscene.img has no ${slot.csName}.dff`);
    }
    const modDff = new Uint8Array(readFileSync(join(inPath, folder!, `${slot.model}.dff`)));
    const { dff, report } = convertSlotDff(
      slot.branch,
      modDff,
      vanilla,
      context.wheelPoses.get(slot.csName.toLowerCase()),
      PANE_SUPPRESSED_SLOTS.has(slot.csName.toLowerCase()),
    );
    context.seatsBySlot.set(slot.csName.toLowerCase(), report.seats);
    const { baked, bytes } = bakePaintMarkers(dff, paintColoursFor(context.carcols, slot.model));
    const txd = slotTxd(slot, bytes, join(inPath, folder!, `${slot.model}.txd`), context);

    // The plate bake (plan 003): a slot whose model wears the placeholder quads gets a READABLE pair in
    // its own TXD — own-TXD-first resolution overrides the runtime placeholders, zero DFF changes.
    let txdBytes = txd.bytes;
    if (referencesPlates(bytes)) {
      const text = plateTextFor(slot.csName, context.plateOverride);
      const pair = composePlatePair(context.genericTxd, text, context.plateTown);
      txdBytes = appendTextures(txdBytes, [
        { name: 'carplate', raster: pair.carplate },
        { name: 'carpback', raster: pair.carpback },
      ]);
      summary.plates.push({ csName: slot.csName, text });
    }

    img.set(`${slot.csName}.dff`, bytes);
    img.set(`${slot.csName}.txd`, txdBytes);
    summary.txdBytes += txdBytes.byteLength;
    summary.converted.push(slot.csName);
    if (txd.preExisting.length > 0) {
      summary.warnings.push({
        csName: slot.csName,
        message: `pre-existing texture holes (missing in gameplay too): ${txd.preExisting.join(', ')}`,
      });
    }
    if (baked > 0) {
      summary.painted.push({ csName: slot.csName, materials: baked });
    }
  } catch (error) {
    summary.errors.push({ csName: slot.csName, message: (error as Error).message });
  }
}

function convertSlotDff(
  branch: CutsceneSlot['branch'],
  modDff: Uint8Array,
  vanilla: Uint8Array,
  wheelPoses?: ReadonlyMap<string, readonly [number, number, number]>,
  suppressWindowPanes = false,
): { dff: Uint8Array; report: ConvertReport } {
  if (branch === 'bike') {
    return convertBike(modDff, extractBikeTemplate(vanilla));
  }
  if (branch === 'boat') {
    return convertBoat(modDff, extractBoatTemplate(vanilla));
  }

  return convertCar(modDff, extractCarTemplate(vanilla, wheelPoses), suppressWindowPanes);
}

/** The scene wheel poses, or an empty map when the game tree ships no `anim/cuts.img` (test trees). */
function loadWheelPoses(gamePath: string): ReadonlyMap<string, ReadonlyMap<string, readonly [number, number, number]>> {
  const cutsPath = join(gamePath, 'anim', 'cuts.img');
  if (!existsSync(cutsPath)) {
    return new Map();
  }

  return wheelAnimPoses(new Uint8Array(readFileSync(cutsPath)));
}

/**
 * A path in `--out`, with the folder the base copy would have provided created first. `writeImgFile`
 * does its own `mkdir`; the two plain-file writes need this one.
 */
function outFile(outPath: string, ...parts: readonly string[]): string {
  const path = join(outPath, ...parts);
  mkdirSync(dirname(path), { recursive: true });

  return path;
}

/**
 * Emit the patched `anim/cuts.img` when the game tree ships one. TWO passes write the same file — the
 * wheel-stash sink (round 20) and the seat retarget (plan 005) — so they CHAIN through one buffer and
 * one write; running them as separate reads would silently drop whichever wrote first.
 *
 * `noBaseCopy` writes the file even when neither pass touched it: the copy mode always leaves a
 * `cuts.img` in `--out`, and a delivery set that sometimes has three files and sometimes two is a
 * delivery set nobody can check. Copying vanilla bytes into the game they came from is a no-op.
 */
function patchCutsceneAnims(
  gamePath: string,
  outPath: string,
  noBaseCopy: boolean,
  cornerBinds: ReadonlyMap<string, ReadonlyMap<string, number>>,
  context: SlotContext,
  summary: CutsceneInstallSummary,
): void {
  const cutsPath = join(gamePath, 'anim', 'cuts.img');
  if (!existsSync(cutsPath)) {
    return;
  }
  let bytes: Uint8Array<ArrayBufferLike> = new Uint8Array(readFileSync(cutsPath));
  let touched = false;

  const stashes = patchWheelStashes(bytes, cornerBinds);
  if (stashes.bytes) {
    [bytes, touched] = [stashes.bytes, true];
    summary.wheelStashesSunk = stashes.patched;
  }
  const seats = patchActorSeats(bytes, context.seatsBySlot, actorPredicate(gamePath, context));
  if (seats.bytes) {
    [bytes, touched] = [seats.bytes, true];
    summary.actorsSeated = seats.patched;
  }
  if (touched || noBaseCopy) {
    writeFileSync(outFile(outPath, 'anim', 'cuts.img'), bytes);
  }
}

/**
 * Fix the one known R* typo (`csopcarla, copcarla` names a TXD that does not exist — the model is
 * `cscopcarla`; 001's research record) and append a `txdp` row for every census slot that has none
 * (`cscopcarsf`, `csdinghy`), so each slot's empty TXD can resolve through its parent.
 */
function patchTxdcut(gamePath: string, outPath: string, census: Census): void {
  let text = readFileSync(join(gamePath, 'data', 'txdcut.ide'), 'utf8');
  text = text.replace(/^csopcarla\s*,\s*copcarla\s*$/m, 'cscopcarla, copcarla');

  const additions = census.slots
    .filter((slot) => rowIsMissing(text, slot))
    .map((slot) => `${slot.csName}, ${slot.txd}`);
  if (additions.length > 0) {
    text = text.replace(/^end\s*$/m, `${additions.join('\n')}\nend`);
  }
  writeFileSync(outFile(outPath, 'data', 'txdcut.ide'), text);
}

function rowIsMissing(text: string, slot: CutsceneSlot): boolean {
  return !new RegExp(`^${slot.csName}\\s*,`, 'm').test(text);
}

/**
 * The slot's `cs*.txd`: EMPTY when the closure resolves through the txdp parent + generic vehicle.txd
 * (the normal case — the pipeline's gta3.img carries the installed mod TXD as the parent). Under
 * `--self-contained-txd` a parent miss embeds the MOD's own TXD instead (the bottle-gate case, where
 * the runtime parent is stock).
 *
 * A name missing even from the MOD's OWN dictionary is a PRE-EXISTING hole (gameplay shows the same
 * white face — three of the real mods ship them: `lights_f`, `t_chrome2`,
 * `vehicle_generic_doorshut2`): reported as a warning, never a failure. A name the mod's TXD HAS but
 * the parent chain lacks is actionable (the base is not installed / no self-contained flag) — that one
 * still fails the slot.
 */
function slotTxd(
  slot: CutsceneSlot,
  dff: Uint8Array,
  modTxdPath: string,
  context: SlotContext,
): { bytes: Uint8Array; preExisting: string[] } {
  const parent = context.game.get(`${slot.txd}.txd`);
  const parentNames = parent ? textureNames(new Uint8Array(parent)) : [];
  const parentChain = new Set([...context.genericNames, ...parentNames]);
  const modTxd = new Uint8Array(readFileSync(modTxdPath));
  const fullChain = new Set([...parentChain, ...textureNames(modTxd)]);

  const preExisting = unresolvedTextures(dff, fullChain);
  const fixable = unresolvedTextures(dff, parentChain).filter((name) => !preExisting.includes(name));
  if (fixable.length === 0) {
    return { bytes: emptyTxd(), preExisting };
  }
  if (context.selfContainedTxd) {
    return { bytes: modTxd, preExisting };
  }
  throw new Error(`unresolved textures (txdp parent ${slot.txd}.txd): ${fixable.join(', ')}`);
}

/** Per cs model: each `wheel*` bone's bind-local distance from its parent origin (the corner test). */
function wheelCornerBinds(census: Census, img: ReturnType<typeof openImg>): Map<string, Map<string, number>> {
  const binds = new Map<string, Map<string, number>>();
  for (const slot of census.slots) {
    const vanilla = img.get(`${slot.csName}.dff`);
    if (!vanilla) {
      continue;
    }
    const clump = parseDff(toArrayBuffer(new Uint8Array(vanilla)));
    const wheels = new Map<string, number>();
    for (const frame of clump.frames) {
      const name = frame.name.trim().toLowerCase();
      if (name.startsWith('wheel')) {
        wheels.set(name, Math.hypot(frame.position[0], frame.position[1], frame.position[2]));
      }
    }
    binds.set(slot.csName.toLowerCase(), wheels);
  }

  return binds;
}
