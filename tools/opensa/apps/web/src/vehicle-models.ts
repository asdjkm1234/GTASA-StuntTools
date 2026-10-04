import type { AssetFileSystem } from '@opensa/renderware';

import { parseVehicleDefs } from '@opensa/renderware/parsers/text/vehicle-defs.parser';
import { parseVehicleMods } from '@opensa/renderware/parsers/text/vehicle-mods.parser';

/**
 * The slots a mod installed a car into, from the build-time ledger `data/vehicle-mods.txt` (096/06) — video
 * mode's car pick (D10 as revised 2026-08-03: a build with mod cars drives ONLY those).
 *
 * An ABSENT ledger is an empty set, never an error: a game built before the installer wrote one, or one with
 * no vehicle mods at all, simply has every scene take a stock car. The format lives with the other data-file
 * parsers (`@opensa/renderware`'s `vehicle-mods.parser`) and in `docs/contracts/vehicles.md`; this is only
 * the read.
 */
export function modCarSlots(fs: Pick<AssetFileSystem, 'getText'>): Set<string> {
  return parseVehicleMods(fs.getText('data/vehicle-mods.txt') ?? '');
}

/**
 * The models a scene may actually put a driver in: the `car` type only (no boats, planes, bikes or trains),
 * and only those whose model is PRESENT — the roster is what `vehicles.ide` declares, and a slot whose `.osm`
 * a build does not carry throws at spawn rather than being skipped.
 *
 * The type comes from the IDE row rather than a name list, so a total conversion that re-slots its vehicles is
 * read rather than contradicted. Used by video mode's car pick (096/05).
 */
export function roadCarModels(fs: Pick<AssetFileSystem, 'getText' | 'has'>): string[] {
  const text = fs.getText('data/vehicles.ide');
  if (!text) {
    return [];
  }

  return [...parseVehicleDefs(text).values()]
    .filter((def) => def.type === 'car')
    .map((def) => def.model.toLowerCase())
    .filter((model) => fs.has(`${model}.osm`))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Every spawnable vehicle model name, from `vehicles.ide`'s `cars` section (lowercased + sorted) — the canonical
 * list, independent of the loader (a raw install keeps the DFFs in `gta3.img`, not a loose `vehicles/` folder).
 * Drives the debug spawn list, so no hardcoded per-car set is needed. Lives in the app layer (the generic `game`
 * engine may not parse renderware directly — that goes through its adapter).
 */
export function vehicleModelsFromIde(fs: Pick<AssetFileSystem, 'getText'>): string[] {
  const text = fs.getText('data/vehicles.ide');
  if (!text) {
    return [];
  }

  return [...parseVehicleDefs(text).keys()].sort((a, b) => a.localeCompare(b));
}
