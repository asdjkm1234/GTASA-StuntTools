import { clumpBoundingRadius } from '@opensa/lod-common/bounds';
import { createTextureSource } from '@opensa/lod-common/texture-source';
import { lodView, subtendsAtLeast } from '@opensa/lod-common/view';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { join } from 'node:path';

import type { SaLodAdapter } from '../../core/adapter';
import type { SizingReport } from '../../core/report';
import type { LodConfig, ResolveResult } from '../../core/types';
import type { BuildStats } from './finalize';

import { summarize } from '../../core/report';
import { writeBuild } from './finalize';
import { openArchives } from './io';
import { resolveLodLinks } from './resolve';

/**
 * GTA-SA (RenderWare) adapter for sa-lod-generator. Phase 1 (`docs/plans/002`): resolve the map's HD↔LOD links
 * from the IPL `lod` field (sizing report), then `finalize` clones every per-object LOD from its HD model with a
 * 50 % TXD into a drop-in build. Read-only reuse of the engine parsers; archives are opened once and shared.
 */
export function createSaLodAdapter(game: string, gameDir: string, config: LodConfig): SaLodAdapter {
  const archives = openArchives(join(gameDir, 'models'));
  const dataDir = join(gameDir, 'data');
  const source = createTextureSource(archives.all);
  const halvings = halvingsFor(config.texScale);
  const exclude = new Set((config.excludeItems ?? []).map((name) => name.toLowerCase()));
  // Lowercase defensively — the whole pipeline compares lowercased names, and a mixed-case curated entry would
  // silently land in `skippedHoles` instead of filling its hole.
  const holeModels = new Set(
    [...(config.holeFillModels ?? [])].map((model) => model.toLowerCase()).filter((model) => !exclude.has(model)),
  );
  const holeLodDraw = config.holeLodDraw ?? 1500;
  const minLodPixels = config.minLodPixels ?? 2;

  // Per-model triangle count + bounding radius (one cached DFF parse serves both) — the sizing report and the
  // screen-size skip read these.
  const statCache = new Map<string, { radius: number; tris: number }>();
  const stats = (model: string): { radius: number; tris: number } => {
    const cached = statCache.get(model);
    if (cached !== undefined) {
      return cached;
    }
    let result = { radius: 0, tris: 0 };
    const bytes = archives.get(`${model}.dff`);
    if (bytes) {
      try {
        const clump = parseDff(bytes);
        result = {
          radius: clumpBoundingRadius(clump),
          tris: clump.geometries.reduce((sum, geometry) => sum + geometry.triangles.length, 0),
        };
      } catch {
        result = { radius: 0, tris: 0 }; // unparseable model — counts as 0, not a crash
      }
    }
    statCache.set(model, result);

    return result;
  };

  return {
    finalize: (outDir: string, resolved: ResolveResult): BuildStats =>
      writeBuild({
        archives,
        decimateBudget: config.decimateBudget ?? 0,
        gameDir,
        halvings,
        holeLodDraw,
        holeModels,
        keepParticles: config.keepParticles ?? true,
        links: resolved.links,
        outDir,
        selfContainedTxd: config.selfContainedTxd ?? false,
        source,
      }),
    game,
    report: (resolved: ResolveResult): SizingReport => summarize(resolved, (model) => stats(model).tris),
    resolvePairs: (): ResolveResult => {
      // Screen-size skip (plan 003, Track 1): an HD that is sub-pixel at its own draw distance (where its LOD
      // takes over) isn't worth cloning — keep the stock LOD. Unloadable HDs (radius 0) are kept conservatively.
      const resolved = resolveLodLinks(dataDir, archives.gta3, exclude);
      const links = resolved.links.filter((link) => {
        const radius = stats(link.hdModel).radius;
        if (radius === 0) {
          return true;
        }

        return subtendsAtLeast(lodView(link.hdDrawDistance || DEFAULT_HD_DRAW), radius, minLodPixels);
      });

      return { ...resolved, excludedTiny: resolved.links.length - links.length, links };
    },
  };
}

/** Fallback closest-LOD distance for an HD def that carries no draw distance. */
const DEFAULT_HD_DRAW = 300;

/** Power-of-two downscale steps for a texture scale (0.5 → 1 halving, 0.25 → 2); clamped at 0. */
function halvingsFor(texScale: number): number {
  return Math.max(0, Math.round(Math.log2(1 / texScale)));
}
