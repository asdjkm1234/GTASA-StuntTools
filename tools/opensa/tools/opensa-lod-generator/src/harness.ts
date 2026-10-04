/**
 * Phase-4 measurement harness (lod-common plan 003): renders sampled cells' HD geometry (as vanilla SA draws it —
 * two-sided) against each simplification stage (as the engine draws the LOD — doubled per its masks, then
 * back-face culled) from cameras deliberately DIFFERENT from the ones the visibility cull used (offset azimuths,
 * two distances), and reports the pixel-diff per stage — so every knob change gets a number instead of a "looks
 * bad" verdict. CPU raster, fully deterministic, no browser. Usage:
 * `tsx opensa-lod-generator/src/harness.ts --game <path> [--cells 12]`.
 */
import type { LodContext, LodModifier } from '@opensa/lod-common/hd-to-lod';
import type { MergedMesh } from '@opensa/lod-common/mesh';
import type { PreviewCamera } from '@opensa/lod-common/preview';

import { createBudgetedDecimate } from '@opensa/lod-common/budgeted-decimate';
import { createCoplanarRemesh } from '@opensa/lod-common/coplanar-remesh';
import { dropDegenerateFaces } from '@opensa/lod-common/drop-degenerate-faces';
import { createDropTransparentGroups } from '@opensa/lod-common/drop-transparent-groups';
import { applyModifiers } from '@opensa/lod-common/hd-to-lod';
import { createModelSource } from '@opensa/lod-common/model-source';
import { previewDiff, renderMeshPreview } from '@opensa/lod-common/preview';
import { type ScopedRegistry, scopedSource } from '@opensa/lod-common/scoped-texture';
import { createTextureSource } from '@opensa/lod-common/texture-source';
import { createTextureStats } from '@opensa/lod-common/texture-stats';
import { lodView } from '@opensa/lod-common/view';
import { createVisibilityCull } from '@opensa/lod-common/visibility-cull';
import { statSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

import type { Cell } from './core/types';

import { cullTinyInstances } from './adapters/gta-sa/cull';
import { openArchives } from './adapters/gta-sa/io';
import { mergeCell } from './adapters/gta-sa/merge';
import { resolveCells } from './adapters/gta-sa/resolve';
import { config } from './lod.config';

const WIDTH = 240;
const HEIGHT = 180;

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

/** Expand a mesh exactly as `encode-dff` would: masked faces doubled, maskless groups blanket-doubled. */
function expandTwoSided(mesh: MergedMesh): MergedMesh {
  const groups = mesh.groups.map((group) => {
    const src = group.indices;
    const indices: number[] = [];
    for (let i = 0; i < src.length; i += 3) {
      const [a, b, c] = [src[i], src[i + 1], src[i + 2]];
      indices.push(a, b, c);
      if (!group.twoSided || group.twoSided[i / 3] === 1) {
        indices.push(a, c, b);
      }
    }

    return { indices: Uint32Array.from(indices), texture: group.texture };
  });

  return { ...mesh, groups };
}

/** Harness camera ring: half-step azimuth offset + different heights/distances than the cull's own cameras. */
function harnessCameras(mesh: MergedMesh, minDistance: number): PreviewCamera[] {
  let [minX, minY, minZ] = [Infinity, Infinity, Infinity];
  let [maxX, maxY, maxZ] = [-Infinity, -Infinity, -Infinity];
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    minX = Math.min(minX, p[i]);
    maxX = Math.max(maxX, p[i]);
    minY = Math.min(minY, p[i + 1]);
    maxY = Math.max(maxY, p[i + 1]);
    minZ = Math.min(minZ, p[i + 2]);
    maxZ = Math.max(maxZ, p[i + 2]);
  }
  const target: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const cameras: PreviewCamera[] = [];
  for (const distance of [minDistance, minDistance * 2]) {
    for (const height of [10, 100, 350]) {
      for (let a = 0; a < 8; a += 1) {
        const angle = (2 * Math.PI * (a + 0.5)) / 8;
        cameras.push({
          fovYDeg: 60,
          position: [target[0] + distance * Math.cos(angle), target[1] + distance * Math.sin(angle), minZ + height],
          target,
        });
      }
    }
  }
  cameras.push({ fovYDeg: 60, position: [target[0], target[1], maxZ + minDistance * 1.2], target });

  return cameras;
}

function main(): void {
  const gameArg = argValue('--game');
  if (!gameArg) {
    throw new Error('usage: tsx opensa-lod-generator/src/harness.ts --game <path> [--cells 12]');
  }
  const gameDir = isAbsolute(gameArg) ? gameArg : resolve(process.cwd(), gameArg);
  if (!statSync(gameDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`--game must be a game-data directory: ${gameDir}`);
  }
  const cellCount = Number(argValue('--cells') ?? 12);

  const archives = openArchives(join(gameDir, 'models'));
  const source = createModelSource(archives);
  const rawTextures = createTextureSource(archives);
  const harnessRegistry: ScopedRegistry = new Map();
  const textures = scopedSource(rawTextures, harnessRegistry); // scoped names (lod-common plan 004)
  const stats = createTextureStats(textures);
  const view = lodView(config.hdDrawDistance);
  const ctx: LodContext = { textures, view };

  const phase1: LodModifier[] = [dropDegenerateFaces, createDropTransparentGroups(config.minOpaqueCoverage)];
  const stages: { chain: LodModifier[]; name: string }[] = [
    { chain: phase1, name: 'phase1' },
    { chain: [...phase1, createVisibilityCull(), createCoplanarRemesh()], name: 'no-decimate' },
    {
      chain: [
        ...phase1,
        createBudgetedDecimate({ pixelBudget: config.decimateBudget }),
        createVisibilityCull(),
        createCoplanarRemesh(),
      ],
      name: 'default',
    },
  ];

  const culled = cullTinyInstances(resolveCells(gameDir, archives, config.cellSize), source, view, config.minLodPixels);
  const sampled = sampleCells(culled.cells, cellCount);
  console.log(`harness: ${sampled.length} cells (dense/median/sparse), ${WIDTH}×${HEIGHT}, 49 views each`);

  const totals = new Map(stages.map((stage) => [stage.name, { count: 0, max: 0, sum: 0, worst: '' }]));
  for (const cell of sampled) {
    const raw = mergeCell(cell, config.cellSize, source, harnessRegistry);
    const cameras = harnessCameras(raw, view.minDistance);
    const renderOpts = {
      cull: 'back' as const,
      groupColor: stats.color,
      groupCoverage: stats.coverage,
      height: HEIGHT,
      width: WIDTH,
    };
    const references = cameras.map((camera) => renderMeshPreview(raw, camera, { ...renderOpts, cull: 'none' }));
    for (const stage of stages) {
      const mesh = expandTwoSided(applyModifiers(raw, stage.chain, ctx));
      const total = totals.get(stage.name)!;
      cameras.forEach((camera, i) => {
        const diff = previewDiff(renderMeshPreview(mesh, camera, renderOpts), references[i]);
        total.sum += diff;
        total.count += 1;
        if (diff > total.max) {
          total.max = diff;
          total.worst = `cell ${cell.cx},${cell.cy} view ${i}`;
        }
      });
    }
    console.log(`  cell ${cell.cx},${cell.cy} (${cell.instances.length} inst, ${raw.positions.length / 3} verts) done`);
  }

  console.log('');
  for (const [name, total] of totals) {
    const mean = (100 * total.sum) / total.count;
    console.log(`${name.padEnd(11)} mean ${mean.toFixed(3)}%  max ${(100 * total.max).toFixed(2)}% (${total.worst})`);
  }
}

/** Deterministic density spread: top / middle / bottom thirds by instance count. */
function sampleCells(cells: Cell[], count: number): Cell[] {
  const sorted = [...cells].sort((a, b) => b.instances.length - a.instances.length);
  const third = Math.floor(count / 3);
  const middle = Math.floor(sorted.length / 2);

  return [
    ...sorted.slice(0, third),
    ...sorted.slice(middle, middle + third),
    ...sorted.slice(sorted.length - (count - 2 * third), sorted.length),
  ];
}

main();
