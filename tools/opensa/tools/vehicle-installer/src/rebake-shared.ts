import type { BuildTarget } from '@opensa/tool-kit/target';
import type { VehicleSource } from '@opensa/tool-kit/vehicles-dir';

/**
 * What both rebake flavours share — the OpenSA one (`rebake.ts`, converts to `.osm`) and the real-SA one
 * (`rebake-sa.ts`, installs the raw `.dff`/`.txd`): the options and report shape, WHO gets rebaked (decided
 * against the built roster before anything is written), and the two per-model tables a rebake MERGES into
 * rather than rewrites.
 */
import { splitRow } from '@opensa/renderware/parsers/text/text-lines';
import { parseVehicleDefs } from '@opensa/renderware/parsers/text/vehicle-defs.parser';
import { parseVehicleFeatures } from '@opensa/renderware/parsers/text/vehicle-features.parser';
import { parseVehicleMods } from '@opensa/renderware/parsers/text/vehicle-mods.parser';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { formatFeatureTable } from './features';
import { sharedVehicleFiles } from './img-merge';
import { FEATURES_TABLE } from './install';
import { resolveVehicleModel } from './model';
import { formatModTable, MODS_TABLE } from './mods-table';
import { decodeSettings, parseVehicleSettings } from './settings';

export interface RebakeOptions {
  /** Folder of vehicle mod folders — normally `mods-src/<game>/vehicles`. */
  inPath: string;
  /** Rebake only these models (lowercased basenames). Absent = every folder under `inPath`. */
  only?: readonly string[];
  /** Which layer of a LAYERED `inPath` applies after `common` — the rebake's `--kind`, by construction. */
  target?: BuildTarget;
  /** The BUILT game dir to edit in place — normally `build/<game>/opensa` or `build/<game>/sa`. */
  targetPath: string;
}

export interface RebakeReport {
  /** Models the built game did NOT have and that were added on the mod's own `vehicles.ide` row. */
  readonly added: readonly string[];
  /** Cars whose conversion threw — the built tree keeps whatever it had for them. */
  readonly failed: readonly { readonly error: string; readonly model: string }[];
  /** Per rebaked car: the bytes that replaced its entry — the `.osm` (OpenSA) or its `.dff`+`.txd`s (SA). */
  readonly rebaked: readonly { readonly bytes: number; readonly model: string }[];
  /** Cars this run would not touch at all, and why — nothing of theirs was written. */
  readonly refused: readonly { readonly model: string; readonly reason: string }[];
  /** Folders that carry no `.dff`, or that `--only` filtered out. */
  readonly skipped: readonly string[];
  /** Converted, but no archive held the entry to replace — a car the built game does not have. */
  readonly unplaced: readonly string[];
  /** Everything the settings merge complained about, prefixed with the folder. */
  readonly warnings: readonly string[];
}

/** Said once per added car — the difference between "it did not work" and "it is not placed yet". */
export function addedCarWarning(model: string): string {
  return (
    `${model}: added to the built game — it will NOT appear in traffic or as a parked car until it is in ` +
    'cargrp.dat and the placements a full build writes; spawn it by name to look at it'
  );
}

/** Merge the rebaked cars' declarations into the target's table, keeping every other model's line. */
export function mergeFeatureTable(targetPath: string, declared: ReadonlyMap<string, readonly string[]>): void {
  if (declared.size === 0) {
    return;
  }
  const path = join(targetPath, FEATURES_TABLE);
  const merged = new Map<string, readonly string[]>(parseVehicleFeatures(readText(path) ?? ''));
  for (const [model, features] of declared) {
    merged.set(model, features);
  }
  writeFileSync(path, formatFeatureTable(merged));
}

/** Add the rebaked slots to the target's mod ledger, keeping every slot already in it (096/06). */
export function mergeModTable(targetPath: string, models: readonly string[]): void {
  if (models.length === 0) {
    return;
  }
  const path = join(targetPath, MODS_TABLE);
  const merged = parseVehicleMods(readText(path) ?? '');
  models.forEach((model) => merged.add(model.toLowerCase()));
  writeFileSync(path, formatModTable(merged));
}

export function readText(path: string): null | string {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** A rebake edits a game in place — say so loudly when the path is not one, instead of writing into a hole. */
export function requireBuiltGame(targetPath: string): void {
  for (const required of [join('data', 'vehicles.ide'), 'models']) {
    if (!existsSync(join(targetPath, required))) {
      throw new Error(`--target is not a built game dir (no ${required}): ${targetPath}`);
    }
  }
}

/** Which cars this run will touch, and why it will not touch the others — see `rebakeVehicles`. */
export function selectCars(
  sources: readonly VehicleSource[],
  targetPath: string,
  only: null | ReadonlySet<string>,
): {
  added: string[];
  refused: { model: string; reason: string }[];
  selected: { folder: string; model: string }[];
  skipped: string[];
} {
  const roster = parseVehicleDefs(readFileSync(join(targetPath, 'data', 'vehicles.ide'), 'utf8'));
  const owners = new Map<number, string>();
  for (const def of roster.values()) {
    owners.set(def.id, def.model.toLowerCase());
  }

  const added: string[] = [];
  const refused: { model: string; reason: string }[] = [];
  const selected: { folder: string; model: string }[] = [];
  const skipped: string[] = [];
  for (const source of sources) {
    const folderPath = source.folder;
    const model = modelOf(folderPath);
    if (!model || (only && !only.has(model))) {
      skipped.push(source.name);
      continue;
    }
    const declaredId = declaredIdOf(folderPath);
    const owner = declaredId === null ? undefined : owners.get(declaredId);
    if (owner !== undefined && owner !== model) {
      // Two models on one id: `modelById` keeps whichever came last, and a car generator then spawns the
      // wrong car — silently, and only where that generator stands.
      refused.push({ model, reason: `vehicles.ide id ${declaredId} already belongs to '${owner}'` });
      continue;
    }
    if (!roster.has(model)) {
      if (declaredId === null) {
        refused.push({
          model,
          reason:
            "not in the built game's vehicles.ide and the mod declares no ide row — a car needs an id, a txd " +
            'and a type before it can be added',
        });
        continue;
      }
      added.push(model);
    }
    selected.push({ folder: folderPath, model });
  }

  return { added, refused, selected, skipped };
}

/**
 * For each rebaked car, the archive entries it ships that ANOTHER folder of the fleet ships too — a rebake of
 * one car makes ITS version the one in the archive, where a full install lets the later folder win.
 */
export function sharedFileWarnings(
  sources: readonly VehicleSource[],
  rebaked: readonly { readonly folder: string; readonly model: string }[],
): string[] {
  const shared = sharedVehicleFiles(sources);
  const warnings: string[] = [];
  for (const { folder, model } of rebaked) {
    const name = basename(folder);
    for (const [entry, staged] of shared) {
      const owners = staged.map((owner) => owner.name);
      if (owners.includes(name)) {
        const others = owners.filter((owner) => owner !== name);
        warnings.push(
          `${model}: ${entry} is also shipped by ${others.join(' / ')} — this rebake puts ${name}'s version in the ` +
            `archive; a full install lets ${owners[owners.length - 1]} win`,
        );
      }
    }
  }

  return warnings;
}

/** The `vehicles.ide` id this mod declares for itself (column 0 of its ide line), or null if it declares none. */
function declaredIdOf(folderPath: string): null | number {
  const file = readdirSync(folderPath).find(
    (name) => name.toLowerCase().endsWith('.settings.txt') || name.toLowerCase().endsWith('.txt'),
  );
  if (!file || file.toLowerCase() === 'features.txt') {
    return null;
  }
  const line = parseVehicleSettings(decodeSettings(readFileSync(join(folderPath, file)))).ideLine;
  const id = line === undefined ? NaN : Number(splitRow(line)[0]);

  return Number.isFinite(id) ? id : null;
}

/** The model a folder is for — the same rule the install uses ({@link resolveVehicleModel}). */
function modelOf(folderPath: string): null | string {
  return resolveVehicleModel(basename(folderPath), readdirSync(folderPath)).model ?? null;
}
