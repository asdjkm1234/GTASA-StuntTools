/**
 * Every ped in `peds.ide` → `.osm` (plan opensa-pack/003 phase 5f).
 *
 * Peds are spawned dynamically, never placed on the map, so `peds.ide` is the whole roster — the same
 * place the local loader's `dynamicModelRefs` gets it, and for the same reason: nothing else enumerates
 * them, and a class nobody enumerates is a class that silently goes missing.
 */
import type { AssetFileSystem } from '@opensa/renderware';

import { parsePedDefs } from '@opensa/renderware';
import { getIfp } from '@opensa/renderware/archive/asset-cache';

import type { ModelBundles } from './model-bundle';

import { buildPedOsm } from './ped-osm';
import { createProgress } from './progress';

/** The idle clip a standing ped holds — `minZ` is measured in this pose. */
const REST_CLIP = 'idle_stance';

export interface PedPackReport {
  /** Roster slots with no model — the player row and the mission `special0*` placeholders. */
  readonly absent: number;
  readonly bytes: number;
  readonly failed: readonly { readonly error: string; readonly model: string }[];
  readonly models: number;
  /** Peds whose textures did NOT all share one size — each needed more than one `.ostex` array. */
  readonly multiArray: number;
}

export interface PedPackResult {
  /** The stock entries this class makes obsolete. */
  readonly deletes: readonly string[];
  readonly report: PedPackReport;
}

/** Convert every ped. A missing model or an unskinned clump is reported, never fatal. */
export function packPeds(
  fs: AssetFileSystem,
  bundles: ModelBundles,
  log: (message: string) => void,
  options: { forceRgba8?: boolean; only?: ReadonlySet<string> } = {},
): PedPackResult {
  const text = fs.getText('data/peds.ide');
  if (text === null) {
    log('peds: no data/peds.ide — skipped');

    return { deletes: [], report: { absent: 0, bytes: 0, failed: [], models: 0, multiArray: 0 } };
  }

  // The REST clip the posed `minZ` is measured against — the same one the host plays standing still. A ped
  // measured on its bind pose sinks into the ground (field check, 2026-07-19).
  const restClip = ['ped', 'anim/ped']
    .flatMap((name) => getIfp(fs, name))
    .find((animation) => animation.name.toLowerCase() === REST_CLIP);

  const deletes: string[] = [];
  const failed: { error: string; model: string }[] = [];
  const converted = new Set<string>();
  let absent = 0;
  let bytes = 0;
  let multiArray = 0;

  // Same subset rule as the vehicles (`--peds`). The one that must never be left out is the PLAYER's model:
  // without its `.osm` the game boots and has nobody to move (`GAME_CONFIG.mainCharacter`).
  const allPeds = [...parsePedDefs(text).values()];
  const pedDefs = options.only ? allPeds.filter((def) => options.only?.has(def.model.toLowerCase())) : allPeds;
  if (options.only) {
    const missing = [...options.only].filter((name) => !allPeds.some((def) => def.model.toLowerCase() === name));
    log(
      `peds: converting ${pedDefs.length} of ${allPeds.length} (--peds)` +
        (missing.length > 0 ? ` — NOT in peds.ide: ${missing.join(', ')}` : ''),
    );
  }
  const progress = createProgress('peds', pedDefs.length, log);
  for (const def of pedDefs) {
    progress.tick();
    const model = def.model.toLowerCase();
    if (converted.has(model)) {
      continue;
    }
    // Not every roster row names a model: `null` is the player slot (CJ is assembled at runtime from
    // `player.img` components) and `special01…10` are the mission slots `LOAD_SPECIAL_CHARACTER` fills.
    if (!fs.has(`${model}.dff`)) {
      absent += 1;
      continue;
    }
    try {
      const built = buildPedOsm(fs, model, def.txd.toLowerCase(), restClip, options.forceRgba8 ?? false);
      bundles.add(model, { sections: built.sections });
      deletes.push(`${model}.dff`);
      bytes += built.bytes.byteLength;
      if (built.textureArrays.length > 1) {
        multiArray += 1;
      }
      converted.add(model);
    } catch (error) {
      failed.push({ error: error instanceof Error ? error.message : String(error), model });
    }
  }
  log(
    `peds: ${restClip ? `posed on ${REST_CLIP}` : 'BIND POSE (no ped.ifp — feet level will be wrong)'}, ` +
      `${converted.size} converted, ${absent} slots with no model, ${failed.length} failed, ` +
      `${multiArray} needed several texture arrays, ${(bytes / 1048576).toFixed(1)} MB`,
  );

  return { deletes, report: { absent, bytes, failed, models: converted.size, multiArray } };
}
