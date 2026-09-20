/**
 * Which ADDED cars a run installs, and whether the tree can say what each of them is a variation OF.
 *
 * The source root is `mods-src/<game>/add-vehicles` and it is read through the ONE vehicles resolver
 * (`@opensa/tool-kit/vehicles-dir`), the same call `vehicle-installer`, `vehicle-cutscene` and `cars-server`
 * make — so the added fleet is planned by the same rules as the replacement fleet: flat or `models/`+`new/`,
 * `screenshots/` and `reserved/` never scanned, one folder per slot, a stray folder refused.
 *
 * Two things are this root's own, and both are refusals rather than defaults:
 *
 * 1. **It is SA-only.** The feature is ModelVariations + FLA + CLEO; our own engine has none of them. A
 *    layered root whose applied layers include `common` or `opensa` is refused, because a `common/` added
 *    car would silently be planned into an `opensa` build that cannot use it.
 * 2. **Every `(base)` must name a car the built tree really has.** A mistyped base is not a broken build —
 *    it is a car that quietly never enters traffic, never inherits a sound and has no parts to re-model.
 */
import type { BuildTarget } from '@opensa/tool-kit/target';
import type { VehicleSource, VehicleSourcePlan } from '@opensa/tool-kit/vehicles-dir';

import { parseVehicleDefs } from '@opensa/renderware/parsers/text/vehicle-defs.parser';
import { resolveVehicleSources } from '@opensa/tool-kit/vehicles-dir';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Where the added cars' own root lives under a game's `mods-src`. */
export const ADD_VEHICLES_DIR = 'add-vehicles';

/** The layers this root refuses: the feature is the real game's plugins, and only the `sa` build has them. */
const REFUSED_LAYERS: readonly string[] = ['common', 'opensa'];

/** One added car, with the stock slots it varies resolved against the built tree. */
export interface AddedVehicle extends VehicleSource {
  /** The FIRST base — what the car inherits from (sound, tuning parts) when it needs one. */
  readonly base: string;
}

export interface AddedVehiclePlan {
  /** What the resolver reported about layers and overrides — logged by the caller, as the fleet's is. */
  readonly plan: VehicleSourcePlan;
  /** The cars to install, ordered by folder name. */
  readonly sources: readonly AddedVehicle[];
}

/**
 * Resolve `--in` (an added-vehicles root) against `--game` (a BUILT `sa` tree): the cars to install, each
 * with its base slot. Refuses a non-`sa` layer, a car with no `(base)` and a base the tree does not define.
 */
export function resolveAddedVehicles(inPath: string, gamePath: string, target: BuildTarget = 'sa'): AddedVehiclePlan {
  if (target !== 'sa') {
    throw new Error(`add-vehicles builds for the 'sa' target only — the added-car plugins are the real game's`);
  }
  const plan = resolveVehicleSources(inPath, target);
  const refused = plan.layers.map(({ name }) => name).filter((name) => REFUSED_LAYERS.includes(name));
  if (refused.length > 0) {
    throw new Error(
      `${inPath} carries the layer(s) ${refused.join(', ')}, and added vehicles are an SA-only feature ` +
        `(ModelVariations, FLA's audio loader, Parked Maker — our own engine has none of them). Put every ` +
        `added car in the 'sa' layer, or leave the root unlayered`,
    );
  }
  const stock = stockSlots(gamePath);
  const sources = plan.sources.map((source) => ({ ...source, base: source.bases[0] ?? '' }));
  const problems = sources.flatMap((source) => describeBaseProblem(source, stock));
  if (problems.length > 0) {
    throw new Error(
      `${problems.length} added car folder(s) do not name a base the built game defines — an added car is a ` +
        `variation OF a stock slot, and a base nobody can resolve is a car that never enters traffic:\n  ` +
        problems.join('\n  '),
    );
  }

  return { plan, sources };
}

/** Those slots with the model id each holds — what a variation list is written out of. */
export function stockSlotIds(gamePath: string): Map<string, number> {
  const path = join(gamePath, 'data', 'vehicles.ide');
  const defs = parseVehicleDefs(readFileSync(path, 'latin1'));

  return new Map([...defs].map(([slot, def]) => [slot, def.id]));
}

/** Every stock vehicle slot the BUILT tree's `vehicles.ide` defines, lowercased. */
export function stockSlots(gamePath: string): Set<string> {
  return new Set(stockSlotIds(gamePath).keys());
}

/** What is wrong with this folder's `(base)` suffix, if anything. */
function describeBaseProblem(source: AddedVehicle, stock: ReadonlySet<string>): string[] {
  if (source.bases.length === 0) {
    return [`${source.name}: no '(base)' suffix — the folder must end in the stock slot(s) it varies`];
  }
  const unknown = source.bases.filter((base) => !stock.has(base));

  return unknown.length === 0
    ? []
    : [`${source.name}: no vehicles.ide row for base(s) ${unknown.map((base) => `'${base}'`).join(', ')}`];
}
