/**
 * REBAKE — re-run the vehicle half of the pipeline against a game that is already BUILT (plan 006).
 *
 * The install path builds a whole game dir from a stock tree; the converter then bakes every asset class in
 * it. That is minutes of work, and a vehicle round changes a handling row, a model, or one shader-visible
 * detail of one car. This does the vehicle part alone, IN PLACE:
 *
 *   1. each mod's `*.settings.txt` merges into the BUILT `data/*` — the same replace-by-model merge the
 *      install uses, so running it twice changes nothing the first run did not already do;
 *   2. its `features.txt` declaration is merged into `data/vehicle-features.txt`, per model, so rebaking ONE
 *      car cannot drop what the others declared;
 *   3. its `.dff` + `.txd` are converted to the model's `.osm` — the same `buildVehicleOsm` opensa-pack
 *      calls — and that entry is REPLACED in whichever `models/*.img` already holds it.
 *
 * Nothing else in the tree is touched: no map, no peds, no wipe, no copy.
 *
 * It can also ADD a car the built game never had, because nothing about a car is baked into the pak: the
 * roster is the TEXT `data/vehicles.ide` the runtime parses at boot, and a spawn resolves `<model>.osm` out
 * of the archive BY NAME (`gta-sa-world.adapter.ts`; the pak manifest carries cells, textures and water, and
 * no vehicle table at all). What an addition needs is therefore only what a mod already ships — an ide row
 * with an id — and what it must not do is take an id another model owns, which is checked before anything is
 * written. A car added this way has no traffic or parked presence until a full build writes the placements,
 * and the report says so rather than letting it read as a failure.
 */
import type { AssetFileSystem } from '@opensa/renderware';

import { encodeOsm } from '@opensa/engine-formats';
import { rewriteModelArchives } from '@opensa/opensa-pack/archive-edit';
import { openGameDir } from '@opensa/opensa-pack/game-fs';
import { buildVehicleOsm } from '@opensa/opensa-pack/vehicle-osm';
import { assertVer2EntrySize } from '@opensa/renderware/archive/img-archive';
import { parseVehicleDefs } from '@opensa/renderware/parsers/text/vehicle-defs.parser';
import { parseVehicleFeatures, UP_DOWN_LIGHTS } from '@opensa/renderware/parsers/text/vehicle-features.parser';
import { openImg } from '@opensa/tool-kit/archive/img';
import { openArchiveIndex } from '@opensa/tool-kit/archive/layout';
import { resolveVehicleSources } from '@opensa/tool-kit/vehicles-dir';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import type { RebakeOptions, RebakeReport } from './rebake-shared';

import { applyVehicle } from './apply-vehicle';
import { assertCarmodsCeilings } from './carmods-guard';
import { FEATURES_TABLE, logVehiclePlan } from './install';
import { vehicleColourWarnings } from './palette';
import {
  addedCarWarning,
  mergeFeatureTable,
  mergeModTable,
  readText,
  requireBuiltGame,
  selectCars,
  sharedFileWarnings,
} from './rebake-shared';
import { assertCarmodsModels } from './tuning-parts';

export type { RebakeOptions, RebakeReport } from './rebake-shared';

/** Rebake the vehicles of a built game in place. Returns what happened; throws only on a broken target. */
export function rebakeVehicles(options: RebakeOptions): RebakeReport {
  const targetPath = resolve(options.targetPath);
  const inPath = resolve(options.inPath);
  requireBuiltGame(targetPath);

  const only = options.only ? new Set(options.only.map((name) => name.toLowerCase())) : null;
  // The SAME resolution the install runs (plan 007): a flat `--in`, or `models/` overridden per slot by
  // `new/`. A rebake that read the tree its own way would bake a car the build does not carry.
  const { sources } = logVehiclePlan(resolveVehicleSources(inPath, options.target), options.target);

  const failed: { error: string; model: string }[] = [];
  const rebaked: { bytes: number; model: string }[] = [];
  const warnings: string[] = [];
  const declared = new Map<string, readonly string[]>();

  // Pass 0 — WHO. Decided against the roster the built game has BEFORE anything is merged into it, so a car
  // that must not be touched is refused with its files still untouched rather than half-written.
  const { added: addedByRoster, refused, selected: byRoster, skipped } = selectCars(sources, targetPath, only);
  // A tree that still carries `<model>.dff` is a REAL-SA build, not a converted one: converting into it would
  // merge the data, then find no `.osm` to replace and leave the car half-written. Refused up front instead.
  const index = openArchiveIndex(targetPath);
  const selected = byRoster.filter(({ model }) => {
    const home = index.archiveOf(`${model}.dff`);
    if (home === null) {
      return true;
    }
    refused.push({
      model,
      reason: `the target holds ${model}.dff in ${home} — a REAL-SA tree; rebake it with --kind sa`,
    });

    return false;
  });
  const added = addedByRoster.filter((model) => selected.some((car) => car.model === model));

  // Pass 1 — the DATA. Every accepted car's rows land before any car is converted, because the conversion
  // reads the merged `vehicles.ide` (txd name, wheel scale) and `vehicle-features.txt` back out of the target.
  for (const { folder, model } of selected) {
    const applied = applyVehicle(folder, targetPath, { target: 'opensa' });
    applied.warnings.forEach((warning) => warnings.push(`${basename(folder)}: ${warning}`));
    if (applied.features.length > 0) {
      declared.set(model, applied.features);
    }
  }
  mergeFeatureTable(targetPath, declared);
  assertCarmodsModels(targetPath);
  assertCarmodsCeilings(targetPath);
  warnings.push(...vehicleColourWarnings(targetPath));
  // Not an archive concern on a CONVERTED tree (one .osm per car), but the mod's data is still shared.
  warnings.push(...sharedFileWarnings(sources, selected));
  // The ledger is MERGED, never rewritten from this run's selection: `--only previon` rebakes one car, and a
  // ledger truncated to it would tell video mode that every other mod car in the build is stock. What a
  // rebake knows is "these slots are also mod slots", which is an addition.
  mergeModTable(
    targetPath,
    selected.map(({ model }) => model),
  );

  // Pass 2 — the MODELS. One composite filesystem per car: the mod folder shadows the built tree, so the
  // converter reads the mod's own `.dff`/`.txd` and everything else (the shared `vehicle.txd`, the plate
  // rasters) from the game it is being baked into.
  const defs = parseVehicleDefs(readFileSync(join(targetPath, 'data', 'vehicles.ide'), 'utf8'));
  const features = parseVehicleFeatures(readText(join(targetPath, FEATURES_TABLE)) ?? '');
  const newcomer = added.length > 0 ? anchorEntry(targetPath) : null;
  const inserts: { bytes: Uint8Array; name: string; near: string }[] = [];
  for (const { folder, model } of selected) {
    // A car the built game already has replaces its own entry; a NEW one has none to sit near, so it goes
    // into `models/gta3.img` beside whatever that archive already holds.
    const near = added.includes(model) ? newcomer : `${model}.osm`;
    if (near === null) {
      refused.push({ model, reason: 'nothing to insert beside — models/gta3.img is missing or empty' });
      continue;
    }
    try {
      inserts.push({
        bytes: convert(openGameDir(targetPath, [folder]), model, defs, features.get(model) ?? [], warnings),
        name: `${model}.osm`,
        near,
      });
    } catch (error) {
      failed.push({ error: error instanceof Error ? error.message : String(error), model });
    }
  }

  const written = rewriteModelArchives(targetPath, { deletes: [], inserts });
  const unplaced = new Set(written.unplaced);
  for (const insert of inserts) {
    if (!unplaced.has(insert.name.toLowerCase())) {
      rebaked.push({ bytes: insert.bytes.byteLength, model: insert.name.replace(/\.osm$/, '') });
    }
  }
  for (const model of added) {
    // Saying it once, here, is the difference between "it did not work" and "it is not placed yet".
    warnings.push(addedCarWarning(model));
  }

  return { added, failed, rebaked, refused, skipped, unplaced: [...unplaced], warnings };
}

/** Any entry `models/gta3.img` already holds — the address a brand-new model is inserted at. */
function anchorEntry(targetPath: string): null | string {
  const path = join(targetPath, 'models', 'gta3.img');
  if (!existsSync(path)) {
    return null;
  }
  const bytes = readFileSync(path);

  return openImg(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)).names()[0] ?? null;
}

/** One car → its `.osm` bytes, exactly as `opensa-pack` bundles them (`DESC`/`GEOM`/`COLL`/`TEXS`). */
function convert(
  fs: AssetFileSystem,
  model: string,
  defs: ReturnType<typeof parseVehicleDefs>,
  declared: readonly string[],
  warnings: string[],
): Uint8Array {
  const def = [...defs.values()].find((entry) => entry.model.toLowerCase() === model);

  const osm = buildVehicleOsm(fs, model, {
    ...(declared.includes(UP_DOWN_LIGHTS) ? { popUpLights: true } : {}),
    ...(def ? { txd: def.txd.toLowerCase(), wheelScale: def.wheelScale } : {}),
  });
  warnings.push(...osm.warnings);

  const bytes = encodeOsm(osm.sections);
  // Checked per car so an oversized model lands in `failed` instead of aborting the whole run when the
  // archive rewrite refuses it.
  assertVer2EntrySize(`${model}.osm`, bytes.byteLength);

  return bytes;
}
