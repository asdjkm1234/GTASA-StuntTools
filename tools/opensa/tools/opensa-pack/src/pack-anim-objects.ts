/**
 * Animated map objects → `.osm` with a `SKEL` section (plan opensa-pack/003 phase 5).
 *
 * Windmills, garage doors and spinning signs are multi-frame clumps whose IFP "bones" ARE those frames,
 * matched by name. The runtime derives everything it needs — which frames the clip moves, the sampler
 * bones, the resolved tracks, the part→frame map — from the frame tree, so baking the tree replaces the
 * clump outright.
 *
 * The IFP is NOT baked in: a clip is a separate, moddable asset resolved by name, and burning it into the
 * model would freeze that binding (the mistake the manifest made with timecyc).
 *
 * The roster is the IDE `anim` column, which is where the runtime gets it too.
 */
import type { AssetFileSystem, IdeObjectDef } from '@opensa/renderware';
import type { RWFrame } from '@opensa/renderware/parsers/binary/types';

import { encodeOsmSkeleton, OsmSectionTag, type OsmSkeleton } from '@opensa/engine-formats';
import { getClump } from '@opensa/renderware/archive/asset-cache';

import type { ModelBundles } from './model-bundle';

import { buildModelOsm } from './model-osm';

export interface AnimPackReport {
  /** IDE `anim` rows whose model no longer exists — e.g. a far LOD the LOD stage stripped. */
  readonly absent: number;
  readonly failed: readonly { readonly error: string; readonly model: string }[];
  readonly frames: number;
  readonly models: number;
  readonly skeletonBytes: number;
}

/** Convert every model an IDE row gives an `anim`. Missing models are reported, never fatal. */
export function packAnimObjects(
  fs: AssetFileSystem,
  defs: { catalog: ReadonlyMap<number, IdeObjectDef> },
  bundles: ModelBundles,
  log: (message: string) => void,
  options: { forceRgba8?: boolean } = {},
): AnimPackReport {
  const failed: { error: string; model: string }[] = [];
  const converted = new Set<string>();
  let absent = 0;
  let skeletonBytes = 0;
  let frames = 0;

  for (const def of defs.catalog.values()) {
    const model = def.modelName.toLowerCase();
    if (def.anim === undefined || def.anim === '' || converted.has(model)) {
      continue;
    }
    // The LOD stage strips a stock far LOD's instances and then its DFF, but leaves IDE defs as they are —
    // so an `anim` row can outlive its model. Nothing places it, so this is not a conversion failure.
    if (!bundles.hasSection(model, OsmSectionTag.GEOM) && !fs.has(`${model}.dff`)) {
      absent += 1;
      continue;
    }
    try {
      const skeleton = (clumpFrames: OsmSkeleton): { bytes: Uint8Array; tag: number } => {
        const bytes = encodeOsmSkeleton(clumpFrames);
        skeletonBytes += bytes.byteLength;
        frames += clumpFrames.frames.length;

        return { bytes, tag: OsmSectionTag.SKEL };
      };
      // An animated object may already be bundled by another class (it is a map object like any other), in
      // which case only the skeleton is new — see `packProps` for the same rule.
      if (bundles.hasSection(model, OsmSectionTag.GEOM)) {
        bundles.add(model, { sections: [skeleton(skeletonOf(getClump(fs, model).frames))] });
      } else {
        const built = buildModelOsm(fs, model, {
          extraSections: (_built, _dff, clump) => [skeleton(skeletonOf(clump.frames))],
          ...(options.forceRgba8 ? { forceRgba8: true } : {}),
          txd: def.txdName.toLowerCase(),
        });
        bundles.add(model, { sections: built.sections });
        built.warnings.forEach((warning) => log(`anim objects: ${warning}`));
      }
      converted.add(model);
    } catch (error) {
      failed.push({ error: error instanceof Error ? error.message : String(error), model });
    }
  }
  log(
    `anim objects: ${converted.size} converted, ${absent} rows with no model, ${failed.length} failed, ` +
      `${frames} frames in ${(skeletonBytes / 1024).toFixed(0)} KB`,
  );

  return { absent, failed, frames, models: converted.size, skeletonBytes };
}

/** Every `RWFrame` field a rigid consumer can use, verbatim. `boneId` is -1 when the frame has no HAnim. */
function skeletonOf(clumpFrames: readonly RWFrame[]): OsmSkeleton {
  return {
    frames: clumpFrames.map((frame) => ({
      boneId: frame.boneId ?? -1,
      name: frame.name,
      parentIndex: frame.parentIndex,
      position: [frame.position[0], frame.position[1], frame.position[2]],
      rotation: [...frame.rotation],
    })),
  };
}
