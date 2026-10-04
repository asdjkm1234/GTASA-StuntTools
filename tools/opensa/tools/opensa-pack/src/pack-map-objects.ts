import type { TexturePlanner } from '@opensa/cell-weld/textures';
/**
 * Map objects → `.osm` against the SHARED world dictionary (plan opensa-pack/003 phase 5g).
 *
 * The ~14 000 models the map places are the last class, and the one that cannot afford a private dictionary:
 * a TXD referenced by a hundred models would be stored a hundred times. Measured over the real modded game
 * dir — per-model dictionaries come to **3 674 MB** against **380 MB** of geometry, replacing 1 320 MB of
 * source `.dff`/`.txd`. So a map object plans into the WORLD planner instead: the same instance the welded
 * cells use, whose arrays already ship in the pak. Its `.osm` is `DESC` + `GEOM` and nothing else, and its
 * submeshes carry GLOBAL array refs.
 *
 * It must therefore run while that planner is still open — after every cell is welded (so the plan is the
 * map's), before `build()` seals it.
 *
 * Models a by-name class already bundled are left alone. Those carry their own dictionary on purpose: a
 * clutter species is drawn in ONE instanced call and cannot switch arrays mid-mesh, so a private
 * single-array dictionary is what makes its fast path possible.
 */
import type { AssetFileSystem } from '@opensa/renderware';
import type { IdeObjectDef } from '@opensa/renderware/parsers/text/types';

import { OsmSectionTag } from '@opensa/engine-formats';

import type { ModelBundles } from './model-bundle';

import { buildModelOsm } from './model-osm';
import { createProgress } from './progress';

export interface MapObjectDefs {
  catalog: ReadonlyMap<number, IdeObjectDef>;
  timedCatalog?: ReadonlyMap<number, IdeObjectDef>;
}

export interface MapObjectPackReport {
  /** Bytes of `.osm` written for this class — geometry only, since the dictionary is the world's. */
  readonly bytes: number;
  /** Archive entries the conversion REPLACES: each converted `<model>.dff`, plus the dictionaries nothing
   *  unconverted still needs. */
  readonly deletes: readonly string[];
  readonly failed: readonly { readonly error: string; readonly model: string }[];
  readonly models: number;
  /** Models the IDEs name that the convert rect does not place — skipped under `--map-objects-in-rect`,
   *  0 without it. They keep their `.dff`, so the runtime parses one if anything ever asks. */
  readonly outsideRect: number;
  /** Models a by-name class had already converted, left with their private dictionaries. */
  readonly skipped: number;
  /** Dictionaries held back, and why they could not go. */
  readonly txdsKept: number;
}

/**
 * Convert every model the map's IDEs name. `isVegetation` decides the welder's cutout rule — SA alpha-tests
 * foliage, and a blend-classed canopy writes no depth, so the two paths must agree on which models are
 * vegetation or a converted tree stops matching the cell beside it.
 */
export function packMapObjects(
  fs: AssetFileSystem,
  defs: MapObjectDefs,
  planner: TexturePlanner,
  bundles: ModelBundles,
  isVegetation: (def: IdeObjectDef) => boolean,
  log: (message: string) => void,
  txdParents: ReadonlyMap<string, string> = new Map(),
  /** Convert only these model names (lowercased) — the rect's PLACED set (`--map-objects-in-rect`). Absent =
   *  every model the IDEs name, which is right for a full-map build and wasteful for a district. */
  only?: ReadonlySet<string>,
): MapObjectPackReport {
  const failed: { error: string; model: string }[] = [];
  const converted = new Set<string>();
  const deletes: string[] = [];
  const txdUsers = new Map<string, string[]>();
  let bytes = 0;
  let models = 0;
  let outsideRect = 0;
  let skipped = 0;

  const unique = uniqueByModel([defs.catalog, defs.timedCatalog ?? new Map<number, IdeObjectDef>()]);
  // The denominator a wait is measured against is what will actually be CONVERTED — the IDE row count is not
  // it (many rows per model), and neither is the catalogue when `only` cuts it to a district's placements.
  const progress = createProgress(
    'map objects',
    unique.filter(([model]) => only === undefined || only.has(model)).length,
    log,
  );

  for (const [model, def] of unique) {
    const txd = def.txdName.toLowerCase();
    // Registered BEFORE the rect test on purpose: `planTxdDeletions` may only drop a dictionary nothing
    // UNCONVERTED still needs, and a model skipped here is exactly that — skipping it earlier would drop
    // the textures it is still going to be read with.
    txdUsers.set(txd, [...(txdUsers.get(txd) ?? []), model]);
    if (only !== undefined && !only.has(model)) {
      outsideRect += 1;
      continue;
    }
    progress.tick();
    if (bundles.hasSection(model, OsmSectionTag.GEOM)) {
      skipped += 1;
      continue;
    }
    if (!fs.has(`${model}.dff`)) {
      continue; // an IDE row with no model is the map's own business, not a conversion failure
    }
    try {
      const built = buildModelOsm(fs, model, {
        txd,
        worldDictionary: { planner, preferCutout: isVegetation(def) },
      });
      bundles.add(model, { sections: built.sections });
      bytes += built.sections.reduce((total, section) => total + section.bytes.byteLength, 0);
      // The `.osm` REPLACES the model: a surviving `.dff` is how the runtime recognises a mod.
      deletes.push(`${model}.dff`);
      converted.add(model);
      models += 1;
    } catch (error) {
      failed.push({ error: error instanceof Error ? error.message : String(error), model });
    }
  }
  const txdsKept = planTxdDeletions(txdUsers, converted, txdParents, deletes);
  log(
    `map objects: ${models} converted against the shared dictionary, ${skipped} already bundled by name, ` +
      `${failed.length} failed, ${(bytes / 1048576).toFixed(0)} MB; ` +
      `${deletes.length - models} dictionaries dropped, ${txdsKept} kept` +
      (outsideRect > 0 ? `; ${outsideRect} not placed in the rect, left unconverted` : ''),
  );

  return { bytes, deletes, failed, models, outsideRect, skipped, txdsKept };
}

/**
 * Queue `<txd>.txd` deletes for the dictionaries nothing unconverted still needs — the vehicle stage's rule,
 * plus one the map needs and cars do not: a dictionary that is a `txdp` PARENT of a KEPT one must stay, or
 * the child's unconverted models lose the textures they inherit.
 */
function planTxdDeletions(
  users: ReadonlyMap<string, readonly string[]>,
  converted: ReadonlySet<string>,
  txdParents: ReadonlyMap<string, string>,
  deletes: string[],
): number {
  const kept = new Set<string>();
  for (const [txd, models] of users) {
    if (models.some((model) => !converted.has(model))) {
      kept.add(txd);
    }
  }
  // Walk every kept dictionary's ancestry — a parent is only free once nothing that inherits from it stays.
  for (const txd of [...kept]) {
    let parent = txdParents.get(txd);
    const walked = new Set<string>([txd]);
    while (parent && !walked.has(parent)) {
      kept.add(parent);
      walked.add(parent);
      parent = txdParents.get(parent);
    }
  }
  for (const txd of users.keys()) {
    if (!kept.has(txd)) {
      deletes.push(`${txd}.txd`);
    }
  }

  return kept.size;
}

/** One `[lowercased model, def]` per model across both catalogues — a model is named by many IDE rows, and
 *  the first row wins, which is the order the loop used to dedup in. */
function uniqueByModel(catalogs: readonly ReadonlyMap<number, IdeObjectDef>[]): [string, IdeObjectDef][] {
  const byModel = new Map<string, IdeObjectDef>();
  for (const catalog of catalogs) {
    for (const def of catalog.values()) {
      const model = def.modelName.toLowerCase();
      if (!byModel.has(model)) {
        byModel.set(model, def);
      }
    }
  }

  return [...byModel];
}
