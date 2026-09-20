import type { LodContext, LodModifier } from './hd-to-lod';
import type { MergedMesh } from './mesh';
import type { PreviewCamera } from './preview';

import { decimateMesh } from './decimate';
import { previewDiff, renderMeshPreview } from './preview';
import { createTextureStats } from './texture-stats';

/**
 * Budget-checked QEM decimation (plan 003 — the "tail" simplification, returned under harness control): try
 * aggressive→gentle triangle targets and accept the FIRST whose own render provably stays within `pixelBudget` —
 * the mesh before vs after decimation is rasterized from a validation camera ring (same CPU preview the Phase-4
 * harness uses) and the mean pixel diff must not exceed the budget. A cell that can't be decimated without
 * visible damage keeps its original triangles — the per-cell fallback that the old fixed-ratio QEM lacked (its
 * global 20 % budget punched holes; see the decimation memory).
 *
 * Runs BEFORE the visibility pass: QEM's regroup drops the per-face `twoSided` masks, so sidedness must be
 * assigned after. Both validation renders are two-sided (`cull: 'none'`) — winding is not yet meaningful.
 * Needs `ctx.view` for the camera ring; without it the mesh is returned unchanged.
 */
export interface BudgetedDecimateOptions {
  /** Camera ring azimuth count for the self-check renders (default 8). */
  azimuthSteps?: number;
  /** Camera heights above the mesh's lowest vertex (default [10, 150]). */
  cameraHeights?: readonly number[];
  /** Meshes under this many faces aren't worth decimating (default 500). */
  minFaces?: number;
  /** Mean pixel-diff budget per cell across the validation views (fraction, e.g. 0.01 = 1 %). */
  pixelBudget?: number;
  /** Triangle-count ratios to try, most aggressive first; the first within budget wins (default 0.15…0.8). */
  ratios?: readonly number[];
}

const PREVIEW_WIDTH = 240;
const PREVIEW_HEIGHT = 180;

export function createBudgetedDecimate(options: BudgetedDecimateOptions = {}): LodModifier {
  const azimuthSteps = options.azimuthSteps ?? 8;
  const cameraHeights = options.cameraHeights ?? [10, 150];
  const minFaces = options.minFaces ?? 500;
  const pixelBudget = options.pixelBudget ?? 0.01;
  const ratios = options.ratios ?? [0.15, 0.25, 0.4, 0.6, 0.8];

  return (mesh: MergedMesh, ctx: LodContext): MergedMesh => {
    if (!ctx.view) {
      return mesh;
    }
    const faceCount = mesh.groups.reduce((sum, group) => sum + group.indices.length / 3, 0);
    if (faceCount < minFaces) {
      return mesh;
    }

    const stats = createTextureStats(ctx.textures);
    const cameras = validationCameras(mesh.positions, ctx.view.minDistance, azimuthSteps, cameraHeights);
    const renderOptions = {
      cull: 'none' as const,
      groupColor: stats.color,
      groupCoverage: stats.coverage,
      height: PREVIEW_HEIGHT,
      width: PREVIEW_WIDTH,
    };
    const references = cameras.map((camera) => renderMeshPreview(mesh, camera, renderOptions));

    for (const ratio of ratios) {
      const candidate = decimateMesh(mesh, Math.floor(faceCount * ratio));
      if (candidate === mesh) {
        continue; // already under the target — a gentler ratio can't change anything either
      }
      let total = 0;
      for (const [i, camera] of cameras.entries()) {
        total += previewDiff(renderMeshPreview(candidate, camera, renderOptions), references[i]);
      }
      if (total / cameras.length <= pixelBudget) {
        return candidate;
      }
    }

    return mesh; // no target survives the budget — keep the original triangles
  };
}

/** Validation ring: azimuths × heights above the mesh's lowest vertex + one top-down view. */
function validationCameras(
  positions: Float32Array,
  minDistance: number,
  azimuthSteps: number,
  heights: readonly number[],
): PreviewCamera[] {
  let [minX, minY, minZ] = [Infinity, Infinity, Infinity];
  let [maxX, maxY, maxZ] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    maxY = Math.max(maxY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }
  const target: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const cameras: PreviewCamera[] = [];
  for (const height of heights) {
    for (let a = 0; a < azimuthSteps; a += 1) {
      const angle = (2 * Math.PI * (a + 0.5)) / azimuthSteps;
      cameras.push({
        fovYDeg: 60,
        position: [target[0] + minDistance * Math.cos(angle), target[1] + minDistance * Math.sin(angle), minZ + height],
        target,
      });
    }
  }
  cameras.push({ fovYDeg: 60, position: [target[0], target[1], maxZ + minDistance], target });

  return cameras;
}
