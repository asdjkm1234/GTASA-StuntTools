/**
 * Smashable props → a `.osm` carrying their baked shatter mesh (plan opensa-pack/003 phase 5b).
 *
 * The runtime's first hit on a prop costs a whole `parseDff` on the MAIN thread, plus a scan for the
 * geometry holding the RW Breakable plugin — and for the props that ship none (boxes, bags) a synthesized
 * mesh built from the render geometry instead. None of that depends on anything but the asset, so it
 * happens here once.
 *
 * **The authored-vs-synthesized choice is resolved offline.** `shatterMeshOf` in the host picks
 * `getBreakable(...) ?? renderMeshOf(...)`, and the fallback is additionally capped at 65 535 vertices
 * because it reuses u16 indices. The writer runs the same decision and bakes the winner, so the reader has
 * no branch left to take.
 *
 * Only `SHAT` is written here. A prop that later gains geometry/collision sections keeps this one — that is
 * what a sectioned container is for.
 */
import type { AssetFileSystem } from '@opensa/renderware';
import type { RWBreakable } from '@opensa/renderware/parsers/binary/types';

import { encodeOsmShatter, OsmSectionTag, type OsmShatter } from '@opensa/engine-formats';
import { getClump } from '@opensa/renderware/archive/asset-cache';
import { breakableFromGeometry, getBreakable } from '@opensa/renderware/breakable/mesh';

import type { ModelBundles } from './model-bundle';

import { createProgress } from './progress';

/** The synthetic fallback reuses u16 triangle indices — the host's own cap, applied at bake time. */
const MAX_SYNTHETIC_VERTICES = 65535;

export interface BreakablePackReport {
  /** Models whose shatter mesh came from the DFF's own RW Breakable plugin. */
  authored: number;
  bytes: number;
  readonly failed: readonly { readonly error: string; readonly model: string }[];
  /** Models with nothing to shatter (no plugin, and a render mesh too big to synthesize from). */
  skipped: number;
  /** Models whose mesh was synthesized from the render geometry (boxes, bags — no authored plugin). */
  synthesized: number;
}

/**
 * Bake `SHAT` for every model in `models` (the `object.dat` smashable set). Missing or unparsable models are
 * reported, never fatal — a prop that fails simply keeps the runtime path it has today.
 */
export function packBreakables(
  fs: AssetFileSystem,
  models: Iterable<string>,
  bundles: ModelBundles,
  log: (message: string) => void,
): BreakablePackReport {
  const failed: { error: string; model: string }[] = [];
  let authored = 0;
  let synthesized = 0;
  let skipped = 0;
  let bytes = 0;

  const names = [...models];
  const progress = createProgress('breakables', names.length, log);
  for (const raw of names) {
    progress.tick();
    const model = raw.toLowerCase();
    try {
      const baked = shatterOf(fs, model);
      if (!baked) {
        skipped += 1;
        continue;
      }
      if (baked.authored) {
        authored += 1;
      } else {
        synthesized += 1;
      }
      const section = { bytes: encodeOsmShatter(baked.shatter), tag: OsmSectionTag.SHAT };
      bundles.add(model, { sections: [section] });
      bytes += section.bytes.byteLength;
    } catch (error) {
      failed.push({ error: error instanceof Error ? error.message : String(error), model });
    }
  }
  log(
    `breakables: ${authored} authored + ${synthesized} synthesized, ${skipped} with nothing to shatter, ` +
      `${failed.length} failed, ${(bytes / 1048576).toFixed(1)} MB`,
  );

  return { authored, bytes, failed, skipped, synthesized };
}

/** The mesh the runtime would have chosen: the authored plugin, else a synthesized one, else nothing. */
function shatterOf(fs: AssetFileSystem, model: string): null | { authored: boolean; shatter: OsmShatter } {
  const own = getBreakable(fs, model);
  if (own) {
    return { authored: true, shatter: toShatter(own) };
  }
  const geometry = getClump(fs, model).geometries[0];
  if (!geometry || geometry.positions.length / 3 > MAX_SYNTHETIC_VERTICES) {
    return null;
  }

  return { authored: false, shatter: toShatter(breakableFromGeometry(geometry)) };
}

/** RW shape → section shape. Structurally identical today; the mapping keeps the format independent. */
function toShatter(breakable: RWBreakable): OsmShatter {
  return {
    colours: breakable.colours,
    materials: breakable.materials.map((material) => ({
      ambient: [...material.ambient] as [number, number, number],
      mask: material.mask,
      texture: material.texture,
    })),
    positions: breakable.positions,
    triangleMaterials: breakable.triangleMaterials,
    triangles: breakable.triangles,
    uvs: breakable.uvs,
  };
}
