import { getClump } from '@opensa/renderware/archive/asset-cache';
import { OPEN_SCRIPT_IPL, resolveMap } from '@opensa/renderware/map/resolve-map';
import { buildWorldGrid, cellKey } from '@opensa/renderware/map/world-grid';
/**
 * Stochastic-list candidate scanner (plan 074/12, the auto-candidate analyzer v0).
 *
 *   npx tsx tools/opensa-pack/src/stochastic-candidates.ts --game <dir> --rect x0,y0,x1,y1 [--top 30]
 *
 * Ranks the rect's textures by COVERED TRIANGLE AREA (ground planes dominate regardless of naming) and
 * prints the top entries NOT yet in `data/stochastic.txt` — the curation loop is: run, eyeball, promote
 * names into the list, reconvert. Textures with painted directional patterns (road markings!) must NOT
 * be promoted — stochastic offsets scramble them.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openGameDir } from './game-fs';

function accumulateClumpArea(fs: ReturnType<typeof openGameDir>, modelName: string, area: Map<string, number>): void {
  try {
    const clump = getClump(fs, modelName);
    for (const atomic of clump.atomics) {
      const geometry = clump.geometries[atomic.geometryIndex];
      if (!geometry) {
        continue;
      }
      for (const tri of geometry.triangles) {
        const name = geometry.materials[tri.materialIndex]?.texture?.name?.toLowerCase();
        if (!name) {
          continue;
        }
        area.set(name, (area.get(name) ?? 0) + triangleArea(geometry.positions, tri.a, tri.b, tri.c));
      }
    }
  } catch {
    // unparseable model — skip (parity with the converter's tolerance)
  }
}

function arg(name: string): null | string {
  const index = process.argv.indexOf(`--${name}`);

  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function main(): void {
  const game = arg('game');
  const rectRaw = arg('rect');
  if (!game || !rectRaw) {
    console.error('usage: stochastic-candidates --game <dir> --rect x0,y0,x1,y1 [--top 30]');
    process.exitCode = 2;

    return;
  }
  const [x0, y0, x1, y1] = rectRaw.split(',').map(Number);
  const top = Number(arg('top') ?? 30) || 30;
  const listed = new Set(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'stochastic.txt'), 'utf8')
      .split('\n')
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line.length > 0 && !line.startsWith('#')),
  );

  const fs = openGameDir(game);
  const defs = resolveMap(fs, { extraIpl: OPEN_SCRIPT_IPL });
  const grid = buildWorldGrid(defs, 250);
  const area = new Map<string, number>();
  for (let cx = Math.min(x0, x1); cx <= Math.max(x0, x1); cx += 1) {
    for (let cy = Math.min(y0, y1); cy <= Math.max(y0, y1); cy += 1) {
      const cell = grid.get(cellKey(cx, cy));
      if (!cell) {
        continue;
      }
      for (const inst of cell.hd) {
        const def = defs.catalog.get(inst.id) ?? defs.timedCatalog?.get(inst.id);
        if (def) {
          accumulateClumpArea(fs, def.modelName, area);
        }
      }
    }
  }

  const rows = [...area.entries()]
    .filter(([name]) => !listed.has(name))
    .sort((a, b) => b[1] - a[1])
    .slice(0, top);
  console.log(`top ${rows.length} candidates by covered area (not in data/stochastic.txt):`);
  for (const [name, squareMetres] of rows) {
    console.log(`  ${name.padEnd(28)} ${Math.round(squareMetres).toLocaleString('en-US')} m²`);
  }
}

function triangleArea(p: Float32Array, a: number, b: number, c: number): number {
  const ux = p[b * 3] - p[a * 3];
  const uy = p[b * 3 + 1] - p[a * 3 + 1];
  const uz = p[b * 3 + 2] - p[a * 3 + 2];
  const vx = p[c * 3] - p[a * 3];
  const vy = p[c * 3 + 1] - p[a * 3 + 1];
  const vz = p[c * 3 + 2] - p[a * 3 + 2];
  const cx = uy * vz - uz * vy;
  const cy = uz * vx - ux * vz;
  const cz = ux * vy - uy * vx;

  return Math.hypot(cx, cy, cz) / 2;
}

main();
