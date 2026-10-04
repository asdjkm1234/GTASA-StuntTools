/**
 * Topple props → `.osm` with a `HULL` section (plan opensa-pack/003 phase 5).
 *
 * A prop with a non-zero `uprootLimit` in `object.dat` is knocked OVER rather than shattered (a lamppost
 * bends and falls; a crate bursts). Toppling one costs the host two clump walks: one to build the
 * renderable, one to collect every vertex for the collider hull. Both happen here instead.
 *
 * The hull cloud is DEDUPLICATED. A convex hull is determined by its point set, and RW geometry repeats the
 * same position across faces, so dropping duplicates cannot move the hull — it only shrinks the section.
 */
import type { AssetFileSystem } from '@opensa/renderware';
import type { RWClump } from '@opensa/renderware/parsers/binary/types';

import { encodeOsmHull, type OsmHull, type OsmSection, OsmSectionTag } from '@opensa/engine-formats';
import { getClump } from '@opensa/renderware/archive/asset-cache';
import { parseObjectDat } from '@opensa/renderware/parsers/text/object-dat.parser';

import type { ModelBundles } from './model-bundle';

import { buildModelOsm } from './model-osm';
import { createProgress } from './progress';

/** The host's own floor on the fallback box: too thin and the solver jitters (`engine-props.ts`). */
const MIN_HALF_EXTENT = 0.12;

export interface PropPackReport {
  /** `object.dat` rows with no model behind them — stale tuning entries, not conversion failures. */
  readonly absent: number;
  readonly failed: readonly { readonly error: string; readonly model: string }[];
  readonly hullBytes: number;
  readonly models: number;
  /** Points kept vs points walked — the dedup ratio, and proof the clouds are not the raw vertex spam. */
  readonly points: { readonly kept: number; readonly walked: number };
}

/** Convert every prop `object.dat` marks as topple-able. Missing models are reported, never fatal. */
export function packProps(
  fs: AssetFileSystem,
  defs: { catalog: ReadonlyMap<number, { modelName: string; txdName: string }> },
  bundles: ModelBundles,
  log: (message: string) => void,
  options: { forceRgba8?: boolean } = {},
): PropPackReport {
  const text = fs.getText('data/object.dat');
  if (text === null) {
    log('props: no data/object.dat — skipped');

    return { absent: 0, failed: [], hullBytes: 0, models: 0, points: { kept: 0, walked: 0 } };
  }
  const txdByModel = txdIndex(defs.catalog);
  // A prop not already bundled builds its OWN dictionary, so it needs the flag exactly as every other
  // by-name class does — `model-ostex` picks BC for any block-aligned dictionary, and that is a format no
  // mobile GPU carries. Hoisted out of the loop: it is the same for every prop.
  const rgba8 = options.forceRgba8 ? ({ forceRgba8: true } as const) : {};

  const failed: { error: string; model: string }[] = [];
  const converted = new Set<string>();
  let absent = 0;
  let hullBytes = 0;
  let walked = 0;
  let kept = 0;

  const propEntries = [...parseObjectDat(text)];
  const progress = createProgress('props', propEntries.length, log);
  for (const [name, entry] of propEntries) {
    progress.tick();
    const model = name.toLowerCase();
    if (entry.uprootLimit <= 0 || converted.has(model)) {
      continue;
    }
    // `object.dat` is SA's physics-tuning table, not a model roster: it carries stale rows (cutscene body
    // parts, effect names) with no `.dff` in any archive, in stock SA too. Same rule as `packMapObjects`.
    if (!fs.has(`${model}.dff`)) {
      absent += 1;
      continue;
    }
    try {
      // The hull is baked from the CLUMP, exactly as `engine-props.ts:boundsOf` walks it — the built model's
      // positions can differ wherever the builder bakes a frame transform.
      const hullSection = (clump: RWClump): OsmSection => {
        const hull = hullOf(clump);
        walked += clump.geometries.reduce((sum, geometry) => sum + geometry.positions.length / 3, 0);
        kept += hull.points.length / 3;
        const bytes = encodeOsmHull(hull);
        hullBytes += bytes.byteLength;

        return { bytes, tag: OsmSectionTag.HULL };
      };
      // Many topple props are ALSO clutter species (cacti, joshua trees, firs), and that class already
      // contributed the rigid sections. Rebuilding them would be wasted work AND a duplicate-tag conflict —
      // so an already-bundled model gets only the section this class adds.
      if (bundles.hasSection(model, OsmSectionTag.GEOM)) {
        bundles.add(model, { sections: [hullSection(getClump(fs, model))] });
      } else {
        const built = buildModelOsm(fs, model, {
          extraSections: (_built, _dff, clump) => [hullSection(clump)],
          ...rgba8,
          ...(txdByModel.has(model) ? { txd: txdByModel.get(model) } : {}),
        });
        bundles.add(model, { sections: built.sections });
        built.warnings.forEach((warning) => log(`props: ${warning}`));
      }
      converted.add(model);
    } catch (error) {
      failed.push({ error: error instanceof Error ? error.message : String(error), model });
    }
  }
  const ratio = walked > 0 ? ((kept / walked) * 100).toFixed(0) : '0';
  log(
    `props: ${converted.size} topple props converted, ${absent} rows with no model, ${failed.length} failed, ` +
      `hulls ${(hullBytes / 1048576).toFixed(1)} MB (${kept} of ${walked} points kept, ${ratio} %)`,
  );

  return { absent, failed, hullBytes, models: converted.size, points: { kept, walked } };
}

/** The collider cloud + the fallback box, from every geometry of the raw clump. */
function hullOf(clump: RWClump): OsmHull {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const seen = new Set<string>();
  const points: number[] = [];
  for (const geometry of clump.geometries) {
    const positions = geometry.positions;
    for (let at = 0; at < positions.length; at += 3) {
      const x = positions[at];
      const y = positions[at + 1];
      const z = positions[at + 2];
      min[0] = Math.min(min[0], x);
      min[1] = Math.min(min[1], y);
      min[2] = Math.min(min[2], z);
      max[0] = Math.max(max[0], x);
      max[1] = Math.max(max[1], y);
      max[2] = Math.max(max[2], z);
      const key = `${x},${y},${z}`;
      if (!seen.has(key)) {
        seen.add(key);
        points.push(x, y, z);
      }
    }
  }
  if (!Number.isFinite(min[0])) {
    throw new Error('model has no vertices');
  }

  return {
    centre: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    half: [
      Math.max(MIN_HALF_EXTENT, (max[0] - min[0]) / 2),
      Math.max(MIN_HALF_EXTENT, (max[1] - min[1]) / 2),
      Math.max(MIN_HALF_EXTENT, (max[2] - min[2]) / 2),
    ],
    points: new Float32Array(points),
  };
}

/** `model → txd`, both lowercased, over the render catalogue. */
function txdIndex(catalog: ReadonlyMap<number, { modelName: string; txdName: string }>): Map<string, string> {
  const byModel = new Map<string, string>();
  for (const def of catalog.values()) {
    byModel.set(def.modelName.toLowerCase(), def.txdName.toLowerCase());
  }

  return byModel;
}
