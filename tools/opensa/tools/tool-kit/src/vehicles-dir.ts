import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { BuildTarget } from './target';

import { planLayers, type PlannedLayer } from './layers';

/**
 * The shapes a `mods-src/<game>/vehicles` folder may have (vehicle-installer plans 007 and 010).
 *
 * **Flat** — every immediate subfolder is a car, and all of them install. What most games ship.
 *
 * **Structured** — the immediate subfolders are `models/` (the installed fleet), `new/` (candidates) and
 * `screenshots/` (pictures, never installed); all optional. A car in `new/` **replaces** the `models/` car
 * that holds the same SLOT, so trying a replacement costs no rename, move or deletion of the incumbent.
 *
 * **Layered** (plan 010, the same `common/` + `sa/` + `opensa/` as mod-installer's plan 011, ONE planner —
 * `planLayers`) — each layer is itself flat or structured; `common` resolves first, then the target's own
 * layer, and a car in the target layer **replaces** the `common` car holding the same SLOT. Reading a layered
 * tree needs the TARGET; a flat or structured one ignores it.
 */
export const VEHICLE_MODELS_DIR = 'models';

/** The higher-priority layer: a car here wins the slot over the same slot in `models/`. */
export const VEHICLE_NEW_DIR = 'new';

/**
 * Reserved siblings that hold no INSTALLED cars — present in the tree, never scanned for one.
 *
 * `screenshots/` is the pictures. `reserved/` is the author's own shelf: cars taken out of the fleet
 * without being deleted (the added-vehicles root holds one). It is a NAME rather than a guess precisely
 * because the alternative — a stray folder — is refused, and a refusal over a folder the author put there
 * on purpose stops every tool that reads the tree.
 */
export const VEHICLE_ASSET_DIRS: readonly string[] = ['screenshots', 'reserved'];

/** A layer that holds cars. */
export type VehicleLayer = typeof VEHICLE_MODELS_DIR | typeof VEHICLE_NEW_DIR;

/** The layers that hold cars, in apply order (later wins the slot). */
const VEHICLE_LAYERS: readonly VehicleLayer[] = [VEHICLE_MODELS_DIR, VEHICLE_NEW_DIR];

/** Every reserved top-level folder name of a structured tree. */
const RESERVED_DIRS: readonly string[] = [...VEHICLE_LAYERS, ...VEHICLE_ASSET_DIRS];

export interface VehicleSource {
  /** The STOCK slots the folder name's `(base)` suffix declares; empty when it has none — see
   *  {@link parseVehicleBases}. */
  readonly bases: readonly string[];
  /** Absolute-or-caller-relative path of the car folder — what `applyVehicle` is handed. */
  readonly folder: string;
  /** The build layer it came from (`common` / a target) — absent for an unlayered tree. */
  readonly layer?: string;
  /** The folder's own name (`admiral - 1976 Mercedes-Benz 230 - k1real24`). */
  readonly name: string;
  /** Which fleet layer it came from; `flat` for an unlayered tree. */
  readonly origin: 'flat' | VehicleLayer;
  /** The game model slot this car takes over, case-folded — see {@link parseVehicleSlot}. */
  readonly slot: string;
}

export interface VehicleSourcePlan {
  /** The build layers APPLIED, in apply order (`common` then the target's), each with its folder as spelled on
   *  disk — what a reader of the layers' side folders (`screenshots/`) overlays in the same order. A flat or
   *  structured tree is one layer rooted at `--in`. */
  readonly layers: readonly PlannedLayer[];
  /** Build layers present but NOT applied (the other target's) — logged, never dropped silently. */
  readonly layersSkipped: readonly string[];
  /** What a `new/` car — or the target layer's car — displaced; logged by the caller, because a fleet that
   *  changed silently is the bug. `by`/`replaced` carry the layer when there is one (`sa/models/x`). */
  readonly overrides: readonly { readonly by: string; readonly replaced: string; readonly slot: string }[];
  /** The cars to install, ordered by folder name (case-insensitive); one entry per slot. */
  readonly sources: readonly VehicleSource[];
  readonly strategy: 'flat' | 'layered' | 'structured';
}

/**
 * The STOCK slots a folder name declares as its BASE — the trailing parenthesised list of the added-cars
 * convention (`001veh - 1971 Chevrolet Vega - alfamodding (manana)` → `['manana']`). Empty for a name
 * without one, which is every folder of the `vehicles/` root.
 *
 * The base is what an ADDED car inherits from and varies: its engine sound when it ships no `audio.txt`,
 * the tuning parts it re-models, and the traffic slot ModelVariations spawns it in place of. The first is
 * "the" base; further entries are additional traffic parents. Contract: `docs/contracts/vehicles.md`.
 */
export function parseVehicleBases(folderName: string): string[] {
  const match = /\(([^()]*)\)\s*$/.exec(folderName.trim());
  if (match === null) {
    return [];
  }

  return match[1]
    .split(',')
    .map((base) => base.trim().toLowerCase())
    .filter((base) => base !== '');
}

/**
 * The model slot a vehicle mod folder claims: everything before the first ` - `, trimmed and lowercased
 * (`admiral - 1976 Mercedes-Benz 230 - k1real24` → `admiral`). A name without the separator IS the slot.
 *
 * **Read from the folder, not from the `.dff` inside**, and that is the whole point: 13 of the original's
 * 212 car folders ship several `.dff`s (a bodykit — `exh_a_l.dff`, `spl_c_l_b.dff` …), and in 10 of them the
 * first one alphabetically is a bodykit part rather than the car. The folder name is the one place the
 * author states the slot once. Contract: `docs/contracts/vehicles.md` §1.
 */
export function parseVehicleSlot(folderName: string): string {
  const [slot] = folderName.split(' - ');

  return (slot ?? folderName).trim().toLowerCase();
}

/**
 * Classify the immediate subfolders of a `vehicles` tree: flat, or the reserved folders of a structured one
 * (`models`/`new` → the folder as it is actually spelled on disk).
 *
 * Two things are refused rather than guessed, because either would install a fleet nobody asked for and say
 * nothing about it:
 *
 * - **a stray folder beside the reserved ones** — that is what a misspelled `New/` or `model/` looks like,
 *   and it is also a car folder left at the top level of a structured tree;
 * - **two reserved folders differing only in case** (`new/` + `New/`) — ONE folder on macOS and Windows, so
 *   a case variant must not become a second layer, and must not silently lose to the other either.
 */
export function planVehicleLayers(entries: readonly string[]): Map<string, string> | undefined {
  const reserved = new Map<string, string[]>();
  const strays: string[] = [];
  for (const entry of entries) {
    const folded = entry.toLowerCase();
    if (RESERVED_DIRS.includes(folded)) {
      reserved.set(folded, [...(reserved.get(folded) ?? []), entry]);
    } else {
      strays.push(entry);
    }
  }

  if (reserved.size === 0) {
    return undefined;
  }
  if (strays.length > 0) {
    throw new Error(
      `--in mixes the reserved vehicle folders (${[...reserved.keys()].join(', ')}) with plain car ` +
        `folder(s): ${strays.join(', ')}. A structured vehicles folder holds ONLY ` +
        `${RESERVED_DIRS.join(', ')}; move those into a layer (a misspelled folder name lands here too)`,
    );
  }
  const duplicated = [...reserved.values()].filter((folders) => folders.length > 1);
  if (duplicated.length > 0) {
    throw new Error(
      `--in carries the same reserved vehicle folder twice, differing only in case: ` +
        duplicated.map((folders) => folders.join(' / ')).join('; '),
    );
  }

  return new Map([...reserved].map(([name, folders]) => [name, folders[0]]));
}

/**
 * Decide which car folders install, and in what order, from a `vehicles` source tree: every subfolder of a
 * flat tree, `models/` overridden per SLOT by `new/` in a structured one, or — layered — `common` overridden
 * per SLOT by the target's layer, each layer flat or structured (`common/models/x` loses to `sa/models/y`
 * AND to `sa/new/z`; within a layer `new/` still beats `models/`).
 *
 * On top of what {@link planVehicleLayers} and `planLayers` refuse, **two folders in one layer claiming the
 * same slot** is refused as well — the loser would be installed and then overwritten by whichever came last
 * alphabetically, which is a coin toss nobody can see in a folder listing.
 */
export function resolveVehicleSources(inPath: string, target?: BuildTarget): VehicleSourcePlan {
  const entries = subdirectories(inPath);
  const plan = planLayers(entries, target, 'car');
  if (plan.strategy === 'flat') {
    return { ...resolveOneLayer(inPath, entries, undefined), layers: plan.layers, layersSkipped: [] };
  }
  // Layered: every layer resolved on its own (flat or structured), then folded by slot in apply order —
  // the target's layer is the last writer, so its car takes the slot.
  const bySlot = new Map<string, VehicleSource>();
  const overrides: { by: string; replaced: string; slot: string }[] = [];
  for (const layer of plan.layers) {
    const layerPath = join(inPath, layer.subdir ?? '');
    const resolved = resolveOneLayer(layerPath, subdirectories(layerPath), layer.name);
    overrides.push(...resolved.overrides);
    for (const source of resolved.sources) {
      const incumbent = bySlot.get(source.slot);
      if (incumbent) {
        overrides.push({ by: labelOf(source), replaced: labelOf(incumbent), slot: source.slot });
      }
      bySlot.set(source.slot, source);
    }
  }

  return {
    layers: plan.layers,
    layersSkipped: plan.skipped,
    overrides,
    sources: byName([...bySlot.values()]),
    strategy: 'layered',
  };
}

function byName(sources: readonly VehicleSource[]): VehicleSource[] {
  return [...sources].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'en'));
}

/** `sa/models/<name>` for a layered source, `models/<name>` for a structured one, the name for a flat one. */
function labelOf(source: VehicleSource): string {
  const parts = [source.layer, source.origin === 'flat' ? undefined : source.origin, source.name];

  return parts.filter((part): part is string => part !== undefined).join('/');
}

/** The car folders of one fleet layer (or of a flat tree, `origin: 'flat'`), ordered by name. */
function layerSources(
  path: string,
  origin: undefined | VehicleLayer,
  entries: readonly string[],
  layer: string | undefined,
): VehicleSource[] {
  return byName(
    entries.map((name) => ({
      bases: parseVehicleBases(name),
      folder: join(path, name),
      ...(layer === undefined ? {} : { layer }),
      name,
      origin: origin ?? 'flat',
      slot: parseVehicleSlot(name),
    })),
  );
}

/** One layer (or the whole unlayered tree): flat, or `models/` overridden per slot by `new/`. */
function resolveOneLayer(
  inPath: string,
  entries: readonly string[],
  layer: string | undefined,
): Omit<VehicleSourcePlan, 'layers' | 'layersSkipped' | 'strategy'> & { strategy: 'flat' | 'structured' } {
  const reserved = planVehicleLayers(entries);
  if (reserved === undefined) {
    return { overrides: [], sources: layerSources(inPath, undefined, entries, layer), strategy: 'flat' };
  }

  const bySlot = new Map<string, VehicleSource>();
  const overrides: { by: string; replaced: string; slot: string }[] = [];
  for (const fleetLayer of VEHICLE_LAYERS) {
    const subdir = reserved.get(fleetLayer);
    if (subdir === undefined) {
      continue;
    }
    const layerPath = join(inPath, subdir);
    for (const source of layerSources(layerPath, fleetLayer, subdirectories(layerPath), layer)) {
      const incumbent = bySlot.get(source.slot);
      if (incumbent?.origin === source.origin) {
        throw new Error(
          `${labelOf(source).replace(/[^/]*$/, '')}carries two cars for the slot '${source.slot}': ` +
            `${incumbent.name} and ${source.name}. One folder per slot per layer`,
        );
      }
      if (incumbent) {
        overrides.push({ by: labelOf(source), replaced: labelOf(incumbent), slot: source.slot });
      }
      bySlot.set(source.slot, source);
    }
  }

  return { overrides, sources: byName([...bySlot.values()]), strategy: 'structured' };
}

/** The immediate subfolder names of a directory. */
function subdirectories(path: string): string[] {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}
