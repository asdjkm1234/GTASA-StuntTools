import { decodeOscol, oscolTriangleCount } from '@opensa/engine-formats/oscol';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

import { readPakManifest } from '../lib/pak-dir';

/**
 * Does this pak actually carry the collision the runtime would read, and is it keyed on the grid the runtime
 * streams on? (plan 200/3-01.)
 *
 * The failure this answers is the silent one: a pak baked on the RENDER grid (250) instead of the GAME grid
 * (256) loads, renders, and drops the player through a strip of world — so the first thing printed is the
 * grid, and the cell is derived with it. With a world position it dumps that cell (regions, triangles,
 * surface ids, breakable placements); without one it summarises the whole bake, which is what tells you a
 * `--bake-collision` run wrote anything at all.
 *
 * Run: `npx tsx scripts/debug/dump-cell-collision.ts [x y] [pakDir]`
 * (default pak `build/original/opensa/pak`).
 */
const args = process.argv.slice(2);
const numeric = args.filter((value) => Number.isFinite(Number(value)) && value.trim() !== '');
const [xArg, yArg] = numeric;
const pakArg = args.find((value) => !numeric.includes(value));

// Plan 086 phase 8 layout first (build/<game>/opensa/pak), then the older pak homes.
const pakDir =
  pakArg ??
  ['build/original/opensa/pak', 'build/original/opensa-pack', 'build/original/opensa/opensa'].find((dir) =>
    existsSync(dir),
  ) ??
  'build/original/opensa/pak';

interface PakEntry {
  enc?: string;
  length: number;
  offset: number;
}
const manifest = readPakManifest<{
  buildTime?: string;
  cellSize?: number;
  collision?: Record<string, PakEntry | undefined>;
  collisionCellSize?: number;
}>(pakDir);

const entries = manifest.collision;
if (!entries || manifest.collisionCellSize === undefined) {
  console.log(
    `${pakDir}: NO baked collision (build it with --bake-collision). The runtime parses COL for every cell — ` +
      `which is correct, just slower.`,
  );
  process.exit(0);
}

const grid = manifest.collisionCellSize;
console.log(`pak ${pakDir}${manifest.buildTime ? ` (built ${manifest.buildTime})` : ''}`);
console.log(`collision grid ${grid} (render grid ${manifest.cellSize ?? 250}) — ${Object.keys(entries).length} cells`);
if (grid === (manifest.cellSize ?? 250)) {
  // Not a hard error here: a game whose two grids legitimately coincide would print the same thing. It is
  // still the first thing to suspect when the world renders and the player falls through it.
  console.log(
    '  ⚠ the collision grid EQUALS the render grid — verify that is intended (see restrictions/architecture)',
  );
}

const pak = readFileSync(join(pakDir, 'world.ospak'));

/** One entry's raw `.oscol` bytes. */
function read(entry: PakEntry): Uint8Array {
  const bytes = pak.subarray(entry.offset, entry.offset + entry.length);

  return entry.enc === 'deflate-raw' ? inflateRawSync(bytes) : bytes;
}

if (xArg === undefined || yArg === undefined) {
  let triangles = 0;
  let regions = 0;
  let breakable = 0;
  for (const entry of Object.values(entries)) {
    if (!entry) {
      continue;
    }
    const cell = decodeOscol(read(entry));
    triangles += oscolTriangleCount(cell);
    regions += cell.regions.length;
    breakable += cell.regions.filter((region) => region.instanceKeys !== undefined).length;
  }
  console.log(`total: ${regions} regions, ${triangles} triangles, ${breakable} breakable regions`);
  console.log('pass a world x y to dump one cell');
  process.exit(0);
}

const cx = Math.floor(Number(xArg) / grid);
const cy = Math.floor(Number(yArg) / grid);
const entry = entries[`${cx},${cy}`];
if (!entry) {
  console.log(`no baked collision for cell ${cx},${cy} — the runtime parses COL there (an empty cell is normal)`);
  process.exit(0);
}
const cell = decodeOscol(read(entry));
console.log(`cell ${cx},${cy}: ${cell.regions.length} regions, ${oscolTriangleCount(cell)} triangles`);
for (const region of cell.regions) {
  const surfaces = region.materials ? [...new Set(region.materials)].sort((a, b) => a - b) : null;
  console.log(
    `  ${region.name.padEnd(24)} ${String(region.indices.length / 3).padStart(6)} tris  ` +
      `${String(region.transforms.length).padStart(4)} placements  ` +
      `${region.boxes.length} box ${region.spheres.length} sph  ` +
      `surfaces ${surfaces ? surfaces.join(',') : 'NONE (unknown, not 0)'}` +
      `${region.instanceKeys ? `  breakable ×${region.instanceKeys.length}` : ''}`,
  );
}
