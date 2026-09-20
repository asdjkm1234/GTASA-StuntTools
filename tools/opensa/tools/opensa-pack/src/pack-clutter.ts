/**
 * Clutter species → `.osm` + `.ostex` (plan opensa-pack/003 phase 5).
 *
 * Clutter is the HOT by-name class: a species is built the moment a cell streams it in, not on a rare
 * collision event, so its `getClump` → `parseDff` → `buildVehicleModel` → TXD decode is on the streaming
 * path. It also needs no section beyond `DESC`/`GEOM` — the per-instance matrices come from the adapter's
 * scatter, not from the asset.
 *
 * The species roster is `procobj.dat`, and the TXD comes from the model's IDE row (procobj carries only
 * model names) — the same resolution the local loader's `procObjModelRefs` does, for the same reason: the
 * class that once went missing entirely because nobody enumerated it.
 */
import type { AssetFileSystem, MapDefinitions } from '@opensa/renderware';

import { parseProcObj } from '@opensa/renderware/parsers/text/procobj.parser';

import type { ModelBundles } from './model-bundle';

import { buildModelOsm } from './model-osm';

export interface ClutterPackReport {
  readonly failed: readonly { readonly error: string; readonly model: string }[];
  readonly models: number;
  /** Total `.osm` bytes — the dictionary is a section INSIDE it, so this already includes `ostexBytes`. */
  readonly osmBytes: number;
  /** The `TEXS` share of `osmBytes`. */
  readonly ostexBytes: number;
}

/** Convert every species `procobj.dat` names. A missing or unparsable model is reported, never fatal. */
export function packClutter(
  fs: AssetFileSystem,
  defs: MapDefinitions,
  bundles: ModelBundles,
  log: (message: string) => void,
  options: { forceRgba8?: boolean } = {},
): ClutterPackReport {
  const text = fs.getText('data/procobj.dat');
  if (text === null) {
    log('clutter: no data/procobj.dat — skipped');

    return { failed: [], models: 0, osmBytes: 0, ostexBytes: 0 };
  }
  const txdByModel = new Map<string, string>();
  for (const def of defs.catalog.values()) {
    txdByModel.set(def.modelName.toLowerCase(), def.txdName.toLowerCase());
  }

  const failed: { error: string; model: string }[] = [];
  const converted = new Set<string>();
  let osmBytes = 0;
  let ostexBytes = 0;

  for (const rule of parseProcObj(text)) {
    const model = rule.model.toLowerCase();
    if (converted.has(model)) {
      continue; // several rules share a species
    }
    try {
      const built = buildModelOsm(fs, model, {
        ...(options.forceRgba8 ? { forceRgba8: true } : {}),
        ...(txdByModel.has(model) ? { txd: txdByModel.get(model) } : {}),
      });
      bundles.add(model, { sections: built.sections });
      osmBytes += built.bytes.byteLength;
      ostexBytes += built.ostex.byteLength;
      converted.add(model);
      built.warnings.forEach((warning) => log(`clutter: ${warning}`));
    } catch (error) {
      failed.push({ error: error instanceof Error ? error.message : String(error), model });
    }
  }
  log(
    `clutter: ${converted.size} species converted, ${failed.length} failed, ` +
      `osm ${mb(osmBytes)} (dictionaries ${mb(ostexBytes)} of it)`,
  );

  return { failed, models: converted.size, osmBytes, ostexBytes };
}

function mb(bytes: number): string {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
