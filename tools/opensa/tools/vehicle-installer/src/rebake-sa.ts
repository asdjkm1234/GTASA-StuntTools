/**
 * REBAKE for the REAL-SA target (plan 008) — the vehicle half of the pipeline against a `build/<game>/sa`
 * tree that is already built, in place, instead of the ~12 min `sa` build a one-car round would otherwise
 * cost.
 *
 * Nothing here is converted: a real-SA tree carries the mod's own `.dff`/`.txd` in its archives, so a rebake
 * is exactly one install step over one car — the SAME `applyVehicle` the install runs, with the archive on:
 *
 *   1. its `.dff` + `.txd`s (paint jobs included) REPLACE their entries in the vehicles archive FAMILY, by
 *      name — `vehicles.img` AND the `vehicles2.img` the install spilled into, opened as one, so a paint-job
 *      dictionary a sibling holds is replaced there rather than duplicated;
 *   2. its `*.settings.txt` merges into the BUILT `data/*` (replace-by-model, idempotent), its `features.txt`
 *      into `data/vehicle-features.txt` AND into the adjuster's `data/model_special_features.dat` (plan 011),
 *      and its slot into the mod ledger — all MERGED so one car cannot disarm the rest;
 *   3. the family is written back (re-planned under the archive cap; a new sibling is registered in
 *      `gta.dat`, a stale one deleted) and `data/img-layout.json` restated.
 *
 * What it will NOT do, and says so: touch a CONVERTED tree (an `.osm` under the model's name means
 * `--kind opensa`), or a car whose `.dff` lives outside the family it edits. And what it cannot do: the
 * cutscene twin (`cs<model>` in `cutscene.img`) was cut from the PREVIOUS car by the cutscene stage — a
 * rebake leaves it, and warns, because the fleet and its cutscene copies are separate outputs.
 */
import { imgFamilyMembers, openImgFamily, writeImgFamily } from '@opensa/tool-kit/archive/img';
import { openArchiveIndex, writeArchiveManifest } from '@opensa/tool-kit/archive/layout';
import { registerImgArchives } from '@opensa/tool-kit/game-dir';
import { resolveVehicleSources } from '@opensa/tool-kit/vehicles-dir';
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import type { RebakeOptions, RebakeReport } from './rebake-shared';

import { applyVehicle } from './apply-vehicle';
import { assertCarmodsCeilings } from './carmods-guard';
import { logVehiclePlan } from './install';
import { vehicleColourWarnings } from './palette';
import {
  addedCarWarning,
  mergeFeatureTable,
  mergeModTable,
  requireBuiltGame,
  selectCars,
  sharedFileWarnings,
} from './rebake-shared';
import { writeModelSpecialFeatures } from './special-features';
import { assertCarmodsModels } from './tuning-parts';

/** Rebake the vehicles of a built REAL-SA game in place. Returns what happened; throws only on a broken target. */
export function rebakeVehiclesSa(options: RebakeOptions): RebakeReport {
  const targetPath = resolve(options.targetPath);
  const inPath = resolve(options.inPath);
  requireBuiltGame(targetPath);

  const only = options.only ? new Set(options.only.map((name) => name.toLowerCase())) : null;
  const { sources } = logVehiclePlan(resolveVehicleSources(inPath, options.target), options.target);

  const { added, refused, selected, skipped } = selectCars(sources, targetPath, only);

  // The archive a car belongs in, read off the tree the way the install reads it: a split tree owns
  // `models/vehicles.img`, an unsplit one has only `gta3.img`. The FAMILY of that base is what gets edited.
  const basePath = join(
    targetPath,
    'models',
    existsSync(join(targetPath, 'models', 'vehicles.img')) ? 'vehicles.img' : 'gta3.img',
  );
  const family = new Set(imgFamilyMembers(basePath).map((path) => basename(path).toLowerCase()));
  // The index reads directories only, and is used BEFORE the family is rewritten — its handles would be
  // reading a hole afterwards.
  const index = openArchiveIndex(targetPath);
  const warnings: string[] = [];
  const accepted: { folder: string; model: string }[] = [];
  for (const car of selected) {
    const home = index.archiveOf(`${car.model}.dff`);
    if (index.archiveOf(`${car.model}.osm`) !== null) {
      refused.push({
        model: car.model,
        reason: `the target holds ${car.model}.osm — a CONVERTED (OpenSA) tree; rebake it with --kind opensa`,
      });
      continue;
    }
    if (home !== null && !family.has(home.toLowerCase())) {
      refused.push({
        model: car.model,
        reason: `${car.model}.dff lives in ${home}, outside the ${basename(basePath)} family this rebake edits`,
      });
      continue;
    }
    if (index.archiveOf(`cs${car.model}.dff`) !== null) {
      warnings.push(
        `${car.model}: its cutscene twin cs${car.model} was cut from the PREVIOUS car — rerun the cutscene ` +
          'stage to see the change in cutscenes',
      );
    }
    accepted.push(car);
  }

  const rebaked: { bytes: number; model: string }[] = [];
  const declared = new Map<string, readonly string[]>();
  if (accepted.length > 0) {
    const img = openImgFamily(basePath);
    for (const { folder, model } of accepted) {
      const applied = applyVehicle(folder, targetPath, { img, target: 'sa' });
      applied.warnings.forEach((warning) => warnings.push(`${basename(folder)}: ${warning}`));
      if (applied.features.length > 0) {
        declared.set(model, applied.features);
      }
      rebaked.push({ bytes: applied.imgNames.reduce((sum, name) => sum + img.size(name), 0), model });
    }
    mergeFeatureTable(targetPath, declared);
    // The real game's half of the same declaration (plan 011). A rebake speaks only for the cars it rebaked, so
    // the block keeps every other model's line — and a car that no longer declares anything loses its own.
    warnings.push(
      ...writeModelSpecialFeatures(targetPath, declared, new Set(accepted.map(({ model }) => model))).warnings,
    );
    assertCarmodsModels(targetPath);
    assertCarmodsCeilings(targetPath);
    warnings.push(...vehicleColourWarnings(targetPath));
    warnings.push(...sharedFileWarnings(sources, accepted));
    mergeModTable(
      targetPath,
      accepted.map(({ model }) => model),
    );
    const archives = writeImgFamily(img, basePath);
    if (archives.length > 1) {
      registerImgArchives(
        targetPath,
        archives.slice(1).map((archive) => basename(archive.path)),
      );
    }
    writeArchiveManifest(targetPath);
  }
  // `added` is what the roster said before the archive checks — a car refused above was not added.
  const addedAccepted = added.filter((model) => accepted.some((car) => car.model === model));
  for (const model of addedAccepted) {
    warnings.push(addedCarWarning(model));
  }

  return { added: addedAccepted, failed: [], rebaked, refused, skipped, unplaced: [], warnings };
}
