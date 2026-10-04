/**
 * A MODEL's dictionary, planned from the RAW TXDs (plan opensa-pack/003 phase 5g).
 *
 * `packModelOstex` — the dictionary path vehicles, clutter and peds use — takes `buildVehicleModel`'s output,
 * and by then the mip chain is gone: `VehicleTextures` decoded level 0 and dropped the rest. That is fine for
 * a car (SA ships no mips for vehicles) and fatal for a map object: **95 % of the textures the mod packs
 * ship carry a chain**, up to 12 levels, and map-optimizer authors those chains deliberately.
 *
 * So a map object plans from the raw TXD instead — by reusing the WORLD planner, one instance per model.
 * That gets, for free and without a second implementation: the opaque-DXT pass-through that preserves the
 * source chain byte for byte, the `txdp` parent walk, the alpha pipeline for everything else, flat-colour
 * materials, and content dedup. A fresh instance numbers its arrays from 0, so `arrayRef` IS the model's
 * array index.
 *
 * It plans per BUILDER LAYER — `built.texture.names`, in the builder's own order — so the result doubles as
 * the remap table for `meta.x`: slot `i` is where builder layer `i` went. Planning the clump's materials
 * instead would leave the two orders to be matched up afterwards, and a mismatch there silently retextures
 * every submesh.
 */
import type { AssetFileSystem } from '@opensa/renderware';

import { TexturePlanner } from '@opensa/cell-weld/textures';

export interface ModelDictionary {
  /** One `.ostex` per array, indexed by the `array` field of a slot. */
  arrays: Uint8Array[];
  /** Where each BUILDER LAYER landed — `slots[i]` is the planned home of `built.texture.names[i]`. */
  slots: ModelTextureSlot[];
}

export interface ModelTextureSlot {
  array: number;
  layer: number;
}

/**
 * The builder's stand-in layer for an UNTEXTURED material (`vehicle/textures.ts` refuses to look this name
 * up in the TXD). Its colour lives in the vertex colours, and the shader multiplies texel × vertex colour —
 * so it must stay WHITE here. Resolving it as the material's flat colour would apply that colour twice.
 */
const WHITE_LAYER = 'white';

const WHITE: readonly number[] = [255, 255, 255, 255];

/**
 * Where each builder layer lands in a planner that is ALREADY RUNNING — the shared world plan, one instance
 * for the whole map (opensa-pack 003 phase 5g). Nothing is built here: the caller owns the arrays, and a map
 * object's `.osm` therefore carries no dictionary of its own. That is the difference between 380 MB of
 * geometry and 3 674 MB of per-model dictionaries, most of which would be the same texture copied again for
 * every model that references it.
 */
export function planModelSlots(
  planner: TexturePlanner,
  names: readonly string[],
  txdName: string,
  preferCutout = false,
  emptyDictionary = false,
  model?: string,
): ModelTextureSlot[] {
  const txd = txdName.toLowerCase();

  return names.map((raw) => {
    const name = raw.toLowerCase();
    // An EMPTY source dictionary is stock SA's own convention, not a data gap: the builder gave every one
    // of these names a white stand-in and the material colour carries, so plan them as white without
    // touching the planner's missing-texture ledger.
    const resolved =
      name === WHITE_LAYER || emptyDictionary
        ? planner.resolve(txd, null, WHITE)
        : planner.resolve(txd, name, WHITE, preferCutout, model);

    return { array: resolved.arrayRef, layer: resolved.layer };
  });
}

/**
 * Plan every layer the builder claimed. `preferCutout` mirrors the welder's vegetation rule — SA alpha-tests
 * foliage, and a blend-classed canopy writes no depth (trees show through trees).
 *
 * A texture the chain cannot resolve comes out as the material-colour stand-in (vanilla draws it
 * untextured) and lands in the planner's `report.missing` ledger — the same rule as the welded cell path,
 * so the two never disagree on the same model. `emptyDictionary` skips the ledger, and it is not a data
 * gap — see the call site.
 */
export function planModelTextures(
  fs: AssetFileSystem,
  txdParents: Map<string, string>,
  names: readonly string[],
  txdName: string,
  preferCutout = false,
  emptyDictionary = false,
  model?: string,
  forceRgba8 = false,
): ModelDictionary {
  // The planner owns the format choice, so `--rgba8` has to reach it here too: a map object planned from its
  // raw TXD would otherwise stay BC while the world around it converted.
  const planner = new TexturePlanner(fs, txdParents, [], new Set(), { forceRgba8 });
  const slots = planModelSlots(planner, names, txdName, preferCutout, emptyDictionary, model);

  // `build()` emits in ref order, but say so rather than assume it — a mis-ordered array silently
  // retextures every submesh that indexes it.
  const built = planner.build();
  const arrays: Uint8Array[] = [];
  for (const entry of built) {
    arrays[entry.ref] = entry.bytes;
  }
  const missing = arrays.findIndex((bytes) => bytes === undefined);
  if (missing >= 0) {
    throw new Error(`model dictionary is missing array ${missing} of ${arrays.length}`);
  }

  return { arrays, slots };
}

/**
 * Rewrite a built model's per-vertex layer indices onto the planned slots, in place.
 *
 * `meta.x` is the layer; `meta.y` is the lamps-on TWIN, whose 0 means "none" — the builder can rely on that
 * because its layer 0 is always the first body material, but the planner has no such rule, so a twin landing
 * on planned layer 0 would read as "no twin". Both that and a twin landing in a DIFFERENT array than its base
 * (a per-vertex swap cannot cross arrays — only `meta.x`'s array is bound) throw rather than mis-sample.
 */
export function remapModelLayers(meta: Uint8Array, slots: readonly ModelTextureSlot[]): void {
  for (let at = 0; at < meta.length; at += 4) {
    const base = slots[meta[at]];
    if (!base) {
      throw new Error(`vertex layer ${meta[at]} has no planned slot (${slots.length} layers planned)`);
    }
    const twinLayer = meta[at + 1];
    if (twinLayer !== 0) {
      const twin = slots[twinLayer];
      if (!twin) {
        throw new Error(`vertex twin layer ${twinLayer} has no planned slot`);
      }
      if (twin.array !== base.array) {
        throw new Error(`lamps-on twin landed in array ${twin.array}, base is in ${base.array}`);
      }
      if (twin.layer === 0) {
        throw new Error('lamps-on twin landed on planned layer 0, which the runtime reads as "no twin"');
      }
      meta[at + 1] = twin.layer;
    }
    meta[at] = base.layer;
  }
}
