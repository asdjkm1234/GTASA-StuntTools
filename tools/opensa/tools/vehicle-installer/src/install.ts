import type { ArchiveFamilyMember } from '@opensa/tool-kit/archive/img';
import type { BuildTarget } from '@opensa/tool-kit/target';

import { createImg, openImg, writeImgFamily } from '@opensa/tool-kit/archive/img';
import { allocateIds, MOD_PART_ID_WINDOW, usedModelIds } from '@opensa/tool-kit/free-ids';
import { copyGameDir, guardOut, registerImgArchives } from '@opensa/tool-kit/game-dir';
import { resolveVehicleSources, type VehicleSource, type VehicleSourcePlan } from '@opensa/tool-kit/vehicles-dir';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { applyVehicle } from './apply-vehicle';
import { assertCarmodsCeilings } from './carmods-guard';
import { formatFeatureTable } from './features';
import { pruneReplacedSlotTextures, sharedVehicleFiles, vehicleCohortKey } from './img-merge';
import { type LedgerRow, readAddsLedger, writeAddsLedger } from './ledger';
import { formatModTable, MODS_TABLE } from './mods-table';
import { vehicleColourWarnings } from './palette';
import { SPECIAL_FEATURES_DAT, writeModelSpecialFeatures } from './special-features';
import { stripOutput } from './strip';
import { type DerivedTuning, deriveTuning, shippedParts, slotTokens, vehicleSlots } from './tuning-derive';
import { installDerivedTuning } from './tuning-install';
import { assertCarmodsModels, parseTuningParts, TUNING_PARTS_FILE } from './tuning-parts';
import { assertUpgradeCollision, PARTS_COL, type UpgradePart, writeUpgradeCollision } from './upgrade-collision';

/** Where the per-model feature declarations land in the built game dir (read by opensa-pack). */
export const FEATURES_TABLE = join('data', 'vehicle-features.txt');

export interface InstallOptions {
  gamePath: string;
  inPath: string;
  outPath: string;
  /** Reduce the output to ONLY the installed vehicles (gta3.img + the four data files). Default off. */
  strip?: boolean;
  /** Which layer of a LAYERED `--in` applies after `common` (plan 010); a flat/structured tree ignores it. */
  target?: BuildTarget;
}

/**
 * Build the install: wipe `--out`, copy the `--game` base in, then install every vehicle folder `--in`
 * resolves to (alphabetical — order only matters when two vehicles touch the same stock model; last wins).
 * Each vehicle's dff/txd land in `gta3.img` and its settings merge into the four data files.
 *
 * WHICH folders, from a flat `--in` or a structured one (`models/` overridden per slot by `new/`), is
 * `resolveVehicleSources`' call — the same one `vehicle-cutscene` makes, so the cutscene fleet and the
 * driving fleet cannot disagree about what is in the build (plan 007).
 */
export function install(options: InstallOptions): ArchiveFamilyMember[] {
  const gamePath = resolve(options.gamePath);
  const inPath = resolve(options.inPath);
  const outPath = resolve(options.outPath);
  guardOut(outPath, gamePath, inPath);

  copyGameDir(gamePath, outPath);

  const { sources: vehicles } = logVehiclePlan(resolveVehicleSources(inPath, options.target), options.target);
  const imgNames = new Set<string>();
  const models = new Set<string>();
  const handlingIds = new Set<string>();
  const features = new Map<string, readonly string[]>();
  // ONE archive for the whole run: opened here, staged by each vehicle, written once at the end. Per-car
  // rebuilds cost O(n) passes over a growing multi-GB file and the last of them crossed `writeFileSync`'s
  // 2 GiB ceiling outright (2026-08-15) — this is both the speed fix and the ceiling fix.
  // WHICH archive, read off the tree rather than configured: a split tree owns `models/vehicles.img` and
  // that is where a car belongs; an unsplit one has only `gta3.img`. Getting this from the output means one
  // installer serves both shapes, and a car never lands in an archive the split has moved its stock twin out of.
  const imgPath = join(
    outPath,
    'models',
    existsSync(join(outPath, 'models', 'vehicles.img')) ? 'vehicles.img' : 'gta3.img',
  );
  const img = existsSync(imgPath) ? openImg(new Uint8Array(readFileSync(imgPath))) : createImg();
  // A part this fleet ships under ANOTHER car's name is a new part of the car shipping it, and it is derived
  // BEFORE the first car is applied: the classification reads the stock tables, and the first install would
  // already have rewritten one of them. Ids come in one pass out of the TOP of the added range, so how many
  // parts this fleet borrows can never move the added cars allocated from the bottom several stages later.
  const derived = deriveFleetTuning(outPath, vehicles);
  const partNames = [...derived.values()].flatMap((tuning) => tuning.rows.map((row) => row.name));
  const partIds = allocateIds({
    ledger: new Map([...readAddsLedger(outPath)].filter(([slot]) => partNames.includes(slot))),
    slots: partNames,
    used: usedModelIds(outPath),
    window: MOD_PART_ID_WINDOW,
  });
  assertNoStagedClash(vehicles, derived);
  const ledgerRows: LedgerRow[] = [];
  const newParts: UpgradePart[] = [];
  for (const vehicle of vehicles) {
    // The slot's STOCK texture bundle goes before the mod's is staged: a paintjob the mod does not ship has
    // no owner once its car is replaced, and would offer the player artwork drawn for another body's UVs.
    reportDropped(vehicle.name, pruneReplacedSlotTextures(img, vehicle.slot, readdirSync(vehicle.folder)));
    newParts.push(...partsNeedingCollision(vehicle.folder, derived.get(vehicle.folder)?.renames));
    const renames = derived.get(vehicle.folder)?.renames ?? new Map<string, string>();
    const applied = applyVehicle(vehicle.folder, outPath, {
      img,
      partRenames: new Map([...renames].map(([file, entry]) => [stem(file), stem(entry)])),
      renames,
      target: options.target,
    });
    ledgerRows.push(...writeVehicleTuning(outPath, vehicle, derived.get(vehicle.folder), partIds));
    applied.warnings.forEach((warning) => console.warn(`vehicle-installer: ${vehicle.name}: ${warning}`));
    applied.imgNames.forEach((name) => imgNames.add(name));
    if (applied.model) {
      models.add(applied.model);
    }
    if (applied.handlingId) {
      handlingIds.add(applied.handlingId);
    }
    if (applied.model && applied.features.length > 0) {
      features.set(applied.model, applied.features);
    }
  }
  // The derived parts' ids are a promise like a car's — a part id is in the player's save as part of the
  // car's upgrades. Written only when the fleet derived any, so a tree with no borrowed part has no file.
  if (ledgerRows.length > 0) {
    writeAddsLedger(outPath, ledgerRows);
    console.log(`vehicle-installer: ${ledgerRows.length} derived tuning part(s) recorded in the id ledger`);
  }
  // Every carmods token must resolve to an IDE row — the real game crashes on one that does not, at boot,
  // at an address; here it fails naming the line (plan 009).
  assertCarmodsModels(outPath);
  // And every part must have collision: the shop previews one as an ordinary CObject, which dereferences
  // m_pColModel without a null check. Static, so it costs a read rather than a field round (014 step 5).
  // Every part we added gets a bounds-only collision model of its own: without one, anything that SPAWNS a
  // part as an object dies on a null m_pColModel. Written before the gate below, which is what proves it.
  const collision = writeUpgradeCollision(outPath, newParts);
  if (collision.length > 0) {
    console.log(`vehicle-installer: ${collision.length} part(s) have collision in ${PARTS_COL}`);
  }
  assertUpgradeCollision(outPath).forEach((warning) => console.warn(`vehicle-installer: ${warning}`));
  assertCarmodsCeilings(outPath);
  vehicleColourWarnings(outPath).forEach((warning) => console.warn(`vehicle-installer: ${warning}`));
  // Written as a FAMILY, not one file: the buffered path caps at 2 GiB and so does every reader, and this
  // archive is past it on the original's mod set (1.24 GB of map + 3.08 GB of cars). The cap is now enforced
  // by construction rather than discovered mid-build.
  mkdirSync(dirname(imgPath), { recursive: true });
  // A car is not split across siblings: its dff, its txd and its paintjob dictionaries travel together.
  const archives = writeImgFamily(img, imgPath, undefined, vehicleCohortKey(outPath));
  // Whoever writes an archive registers it. A spill sibling the game never registers is invisible content —
  // the build succeeds, the file is on disk, and its entries simply never load. The base member is skipped:
  // `gta3.img` is hardcoded in the game and `vehicles.img` was declared by the split that created it.
  if (archives.length > 1) {
    registerImgArchives(
      outPath,
      archives.slice(1).map((archive) => basename(archive.path)),
    );
    console.log(`vehicle-installer: ${archives.length} archives — ${archives.map((a) => basename(a.path)).join(', ')}`);
  }
  // The declarations travel as DATA in the built game dir, because the converter runs later and in another
  // process; `opensa-pack` reads this file when it bakes each car. Written only when a mod declared
  // something, so a plain install leaves no stray file.
  if (features.size > 0) {
    writeFileSync(join(outPath, FEATURES_TABLE), formatFeatureTable(features));
  }
  // The REAL game reads none of that: in SA a special ability is a branch on a model id, and the only lever the
  // install we ship to has is fastman92's model special feature loader. So on the `sa` target the same
  // declarations are ALSO written as `<model> <standard model>` pairs into the adjuster's own file (plan 011).
  if (options.target === 'sa') {
    const special = writeModelSpecialFeatures(outPath, features);
    special.warnings.forEach((warning) => console.warn(`vehicle-installer: ${warning}`));
    if (special.written) {
      console.log(`vehicle-installer: ${special.lines.length} model(s) mapped in ${SPECIAL_FEATURES_DAT}`);
    }
  }
  // The mod-car ledger (096/06), written on EVERY run including one that installed nothing: after this point
  // the build cannot tell a mod car from a stock one, and an empty ledger says "looked, found none" where an
  // absent one says "this build predates the ledger". Only one of those is a fact worth having.
  writeFileSync(join(outPath, MODS_TABLE), formatModTable(models));

  if (options.strip) {
    stripOutput(outPath, { handlingIds, imgNames, models });
  }

  console.log(
    `vehicle-installer: ${vehicles.length} vehicle(s) → ${outPath} (${imgNames.size} img entries` +
      (features.size > 0 ? `, ${features.size} with declared features` : '') +
      `, ${models.size} slot(s) in the mod ledger)` +
      (options.strip ? ' [stripped to installed]' : ''),
  );

  return archives;
}

/** Say which layers a layered `--in` applied and what every override displaced — a fleet that changed silently is the bug. */
export function logVehiclePlan(plan: VehicleSourcePlan, target: BuildTarget | undefined): VehicleSourcePlan {
  if (plan.strategy === 'layered') {
    const layers = [...new Set(plan.sources.map((source) => source.layer))].filter(Boolean).join(' → ');
    const unused = plan.layersSkipped.length > 0 ? `; ${plan.layersSkipped.join(', ')} not for this target` : '';
    console.log(`vehicle-installer: layered vehicles for target ${target} — ${layers || 'nothing applied'}${unused}`);
  }
  plan.overrides.forEach(({ by, replaced }) => console.log(`vehicle-installer: ${by} replaces ${replaced}`));

  return plan;
}

/**
 * Refuse a fleet where two folders still stage DIFFERENT files under one archive entry name after the
 * derivation has renamed what it can (014 step 4). One entry name holds one file, so the last folder
 * installed wins and every other car on that name silently wears its geometry — the defect that had the
 * blade wearing the voodoo's rear bumper for as long as both mods were installed.
 *
 * Same name and the same SIZE is the same file shipped twice, which costs nothing and is left alone. The
 * check should be unreachable from `vehicles/` now, which is exactly why it is worth keeping: it is what
 * says so, and it still fires for anything the derivation cannot classify.
 */
function assertNoStagedClash(vehicles: readonly VehicleSource[], derived: ReadonlyMap<string, DerivedTuning>): void {
  const shared = sharedVehicleFiles(
    vehicles,
    new Map([...derived].map(([folder, tuning]) => [folder, tuning.renames])),
  );
  const clashes = [...shared].filter(([, staged]) => new Set(staged.map(({ size }) => size)).size > 1);
  for (const [name, staged] of shared) {
    if (!clashes.some(([clashing]) => clashing === name)) {
      console.warn(
        `vehicle-installer: ${name} is shipped by ${staged.length} folders ` +
          `(${staged.map(({ name: folder }) => folder).join(' / ')}), identical in size — one entry, one file`,
      );
    }
  }
  if (clashes.length > 0) {
    throw new Error(
      `${clashes.length} archive entry name(s) are staged with different files by more than one vehicle ` +
        `folder. The archive holds one entry per name, so the last one installed would win and the other ` +
        `car would wear its geometry:\n  ` +
        clashes
          .map(
            ([name, staged]) =>
              `${name} — ${staged.map(({ name: folder, size }) => `${folder} (${size} B)`).join(' / ')}`,
          )
          .join('\n  '),
    );
  }
}

/**
 * What every folder of the fleet ships that belongs to ANOTHER car, derived against the tree as the copy
 * left it — stock. Folders with nothing borrowed are not in the map at all, which is most of them.
 */
function deriveFleetTuning(outPath: string, vehicles: readonly VehicleSource[]): Map<string, DerivedTuning> {
  const tokens = slotTokens(vehicleSlots(outPath));
  const derived = new Map<string, DerivedTuning>();
  for (const vehicle of vehicles) {
    const token = tokens.get(vehicle.slot);
    if (token === undefined) {
      // A folder naming a slot the game does not define: `applyVehicle` merges its rows as authored, and the
      // model resolver already says so. Nothing to derive against.
      continue;
    }
    const tuning = deriveTuning({
      base: vehicle.slot,
      gameDir: outPath,
      shipped: shippedParts(vehicle.folder, vehicle.slot),
      slot: vehicle.slot,
      token,
    });
    if (tuning.rows.length > 0 || tuning.warnings.length > 0) {
      derived.set(vehicle.folder, tuning);
    }
  }

  return derived;
}

/**
 * The models of this folder that the game has no collision for: every part it ships under a DERIVED name
 * (the stock name it replaces has collision, the new one does not), plus every model its
 * `tuning_new_parts.txt` declares, which the stock game never had at all.
 */
function partsNeedingCollision(folder: string, renames: ReadonlyMap<string, string> | undefined): UpgradePart[] {
  const parts: UpgradePart[] = [];
  for (const [file, entry] of renames ?? []) {
    parts.push({ dff: join(folder, file), name: stem(entry) });
  }
  const declared = readdirSync(folder).find((name) => name.toLowerCase() === TUNING_PARTS_FILE);
  for (const row of declared === undefined
    ? []
    : parseTuningParts(readFileSync(join(folder, declared), 'latin1')).ideRows) {
    const name = row.split(',')[1]?.trim();
    if (name !== undefined && name !== '') {
      parts.push({ dff: join(folder, `${name}.dff`), name });
    }
  }

  return parts;
}

/** Say which stock textures a replaced slot gave up — silence would make the archive change unexplainable. */
function reportDropped(vehicle: string, dropped: readonly string[]): void {
  if (dropped.length > 0) {
    console.log(`vehicle-installer: ${vehicle}: dropped ${dropped.length} stock texture(s) — ${dropped.join(', ')}`);
  }
}

/** An archive entry name without its extension — the form `carmods.dat` and the settings file speak. */
function stem(file: string): string {
  return file.replace(/\.dff$/i, '');
}

/**
 * Merge one car's derived parts into the tree and report what it cost, returning their ledger rows. Split
 * out of the install loop only to keep that loop readable — the whole of it is one call.
 */
function writeVehicleTuning(
  outPath: string,
  vehicle: VehicleSource,
  tuning: DerivedTuning | undefined,
  ids: ReadonlyMap<string, number>,
): LedgerRow[] {
  if (tuning === undefined) {
    return [];
  }
  tuning.warnings.forEach((warning) => console.warn(`vehicle-installer: ${vehicle.name}: ${warning}`));
  const written = installDerivedTuning({ derived: tuning, gameDir: outPath, ids, source: vehicle.name });
  written.warnings.forEach((warning) => console.warn(`vehicle-installer: ${warning}`));

  return written.rows;
}
