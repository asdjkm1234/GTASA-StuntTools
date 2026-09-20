import type { ClumpEffect } from '@opensa/lod-common/clump-effects';

import { createBudgetedDecimate } from '@opensa/lod-common/budgeted-decimate';
import { createCoplanarRemesh } from '@opensa/lod-common/coplanar-remesh';
import { dropDegenerateFaces } from '@opensa/lod-common/drop-degenerate-faces';
import { createDropTransparentGroups } from '@opensa/lod-common/drop-transparent-groups';
import { applyModifiers, type LodContext, type LodModifier } from '@opensa/lod-common/hd-to-lod';
import { concatMeshes } from '@opensa/lod-common/mesh';
import { createModelSource } from '@opensa/lod-common/model-source';
import { rebuildMeshNormals } from '@opensa/lod-common/normals';
import { type ScopedRegistry, scopedSource } from '@opensa/lod-common/scoped-texture';
import { createTextureSource } from '@opensa/lod-common/texture-source';
import { lodView } from '@opensa/lod-common/view';
import { createVisibilityCull } from '@opensa/lod-common/visibility-cull';
import { build2dfxSection } from '@opensa/rw-codec/dff';
import { join } from 'node:path';

import type { LodAdapter } from '../../core/adapter';
import type { BakedCell, Cell, LodConfig } from '../../core/types';

import { createStageProfiler, type StageProfiler } from '../../core/profiling';
import { cullTinyInstances } from './cull';
import { writeBuild } from './finalize';
import { type Archive, openArchives } from './io';
import { collectCellEffects, mergeCell } from './merge';
import { maxObjectId, resolveCells } from './resolve';

export { stripOldLods } from './strip';

/**
 * GTA-SA (RenderWare) LOD adapter. Phase 0 (assemble HD instances → cell grid) + Phase 1's merge (HD geometry →
 * one cell-relative mesh by texture) are implemented via read-only reuse of the engine's parsers. QEM decimation,
 * the texture atlas (Phase 1.1 / 2) and the build emit (`finalize`, Phase 3) land next; until then `finalize`
 * throws so callers can't silently produce an empty build. Archives are opened once and shared.
 */
/** Injectables for worker threads: pre-opened (shared-buffer) archives + the thread's profiler. */
export interface AdapterDeps {
  archives?: Archive[];
  profiler?: StageProfiler;
}

export function createGtaSaLodAdapter(
  game: string,
  gameDir: string,
  config: LodConfig,
  deps: AdapterDeps = {},
): LodAdapter {
  const archives = deps.archives ?? openArchives(join(gameDir, 'models'));
  const source = createModelSource(archives);
  const textureSource = createTextureSource(archives);
  const exclude = new Set((config.excludeItems ?? []).map((name) => name.toLowerCase()));
  const holeFill = new Set((config.holeFillModels ?? []).map((name) => name.toLowerCase()));

  // Plan 003 Phases 1–3: the geometry is never deformed (QEM degraded the models); the chain removes what can't
  // be seen — degenerate faces, mostly-transparent texture groups, then every face no reachable camera sees
  // (buried/interior/ground-facing, with survivors oriented so only genuinely two-sided faces get doubled at
  // encode) — and finally re-triangulates flat clusters from their byte-exact boundary. The same shared chain
  // sa-lod-generator will run once its mesh path is lossless (plan 003, Phase 5).
  const view = lodView(config.hdDrawDistance);
  // Every stage is profiled by name — the run prints a stage-time table at the end (core/profiling.ts).
  const profiler = deps.profiler ?? createStageProfiler();
  const profiled = (stage: string, modify: LodModifier): LodModifier => {
    return (mesh, modifierCtx) => profiler.time(stage, () => modify(mesh, modifierCtx));
  };
  const modifiers: readonly LodModifier[] = [
    profiled('drop-degenerate', dropDegenerateFaces),
    profiled('drop-transparent', createDropTransparentGroups(config.minOpaqueCoverage)),
    // Decimation runs BEFORE the visibility pass — QEM's regroup drops per-face sidedness masks, so orientation
    // is assigned after; it also shrinks the raycast workload.
    ...(config.decimateBudget > 0
      ? [profiled('budgeted-decimate', createBudgetedDecimate({ pixelBudget: config.decimateBudget }))]
      : []),
    ...(config.hiddenFaces !== 'off'
      ? [profiled('visibility-cull', createVisibilityCull({ mode: config.hiddenFaces }))]
      : []),
    ...(config.mergeCoplanar ? [profiled('coplanar-remesh', createCoplanarRemesh())] : []),
  ];
  // Every texture lookup below happens through scoped names (lod-common plan 004): the registry fills as
  // cells merge, and the scoped view resolves each name inside its own source TXD.
  const scopedRegistry: ScopedRegistry = new Map();
  const ctx: LodContext = { textures: scopedSource(textureSource, scopedRegistry), view };

  // Per-model 2dfx light entries (memoized) — baked into each cell as its distant coronas (plan 003, Phase 5).
  const effectsCache = new Map<string, ClumpEffect[]>();
  const loadRaw = (model: string): null | Uint8Array => {
    const name = model.endsWith('.dff') ? model : `${model}.dff`;
    for (const archive of archives) {
      const bytes = archive.get(name);
      if (bytes) {
        return new Uint8Array(bytes);
      }
    }

    return null;
  };

  return {
    bakeCell(cell: Cell): BakedCell {
      // Merged real HD geometry + the chain above (invisible-only culls + budget-checked decimation). Normals are
      // re-derived after (most map geometry ships without normals). The source models' corona lights ride along
      // as a transplanted 2dfx section — the cell glows at night like the HD it replaces.
      return profiler.cell(`cell ${cell.cx},${cell.cy}`, () => {
        // Hole-fill exemption (plan 086): protected instances skip the whole modifier chain — they merge
        // verbatim and join the shaped remainder, so no cull/remesh track can eat them (the gostown bridge).
        const protectedInstances = cell.instances.filter((instance) => holeFill.has(instance.model));
        const reducible =
          protectedInstances.length > 0
            ? { ...cell, instances: cell.instances.filter((instance) => !holeFill.has(instance.model)) }
            : cell;
        const merged = profiler.time('merge', () => mergeCell(reducible, config.cellSize, source, scopedRegistry));
        let shaped = applyModifiers(merged, modifiers, ctx); // each modifier records its own stage
        if (protectedInstances.length > 0) {
          const verbatim = profiler.time('merge', () =>
            mergeCell({ ...cell, instances: protectedInstances }, config.cellSize, source, scopedRegistry),
          );
          shaped = concatMeshes(shaped, verbatim);
        }
        const mesh = profiler.time('normals', () => rebuildMeshNormals(shaped));
        const effects = profiler.time('2dfx', () =>
          build2dfxSection(collectCellEffects(cell, config.cellSize, loadRaw, source, effectsCache)),
        );
        // The cell's scoped-name meanings ride along as plain data — bake workers each hold their own
        // registry, and the coordinator/finalize re-merges the per-cell maps (plan 004).
        const textureMap = mesh.groups
          .map((group) => group.texture)
          .filter((name) => scopedRegistry.has(name))
          .map((name) => [name, scopedRegistry.get(name)!] as const);

        return { cx: cell.cx, cy: cell.cy, mesh, textureMap, ...(effects ? { effects } : {}) };
      });
    },
    finalize(outDir: string, baked: readonly BakedCell[]): void {
      profiler.time('finalize-encode', () =>
        writeBuild({
          baked,
          cellSize: config.cellSize,
          drawDistance: config.lodDrawDistance,
          firstId: maxObjectId(gameDir) + 1,
          gameDir,
          lodTextureSize: config.lodTextureSize,
          outDir,
          textureSource,
        }),
      );
    },
    game,
    resolveCells(): Cell[] {
      // Screen-size cull (plan 003, Track 1): sub-`minLodPixels` instances never read at LOD range — drop them
      // before the merge so cells stop spending triangles on bins/poles/wires.
      const culled = cullTinyInstances(
        resolveCells(gameDir, archives, config.cellSize, exclude),
        source,
        view,
        config.minLodPixels,
      );
      console.log(
        `  culled ${culled.culledInstances} tiny instances (${culled.culledModels} models < ` +
          `${config.minLodPixels}px at ${config.hdDrawDistance}u)`,
      );

      return culled.cells;
    },
  };
}
