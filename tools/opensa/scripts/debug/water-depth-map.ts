/**
 * ASCII heatmap of the baked water DEPTH field (water.bin) over a GTA-space region — the pak-bytes step
 * for water-look bugs. Found 087 row C: false shorelines on water.dat T-junction seams striped every
 * gostown lake with static shallow bands (the fix: the two-sided coverage probe in water.ts).
 *
 * Run: npx tsx scripts/debug/water-depth-map.ts [pakDir] [x0 y0 x1 y1]
 *      (defaults: build/gostown/opensa/pak, the gostown bridge/dam lakes 900 -1800 1800 -1000)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pakDir = process.argv[2] ?? 'build/gostown/opensa/pak';
const [x0, y0, x1, y1] = process.argv.length >= 7 ? process.argv.slice(3, 7).map(Number) : [900, -1800, 1800, -1000];
const px = 8;

const bin = readFileSync(join(pakDir, 'water.bin'));
const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
const vertexCount = view.getUint32(0, true);

const w = Math.floor((x1 - x0) / px);
const h = Math.floor((y1 - y0) / px);
const grid: (null | number)[] = Array.from({ length: w * h }, () => null);
// Vertex = [gtaX, gtaY, height, depth, class], stride 20 B.
for (let i = 0; i < vertexCount; i += 1) {
  const base = 8 + i * 20;
  const x = view.getFloat32(base, true);
  const y = view.getFloat32(base + 4, true);
  const depth = view.getFloat32(base + 12, true);
  if (x < x0 || x >= x1 || y < y0 || y >= y1) {
    continue;
  }
  const gx = Math.floor((x - x0) / px);
  const gy = Math.floor((y - y0) / px);
  const cur = grid[gy * w + gx];
  grid[gy * w + gx] = cur === null ? depth : Math.min(cur, depth);
}
const shades = ' .:-=+*#%@';
console.log(
  `water depth, GTA x ${x0}..${x1} (→) y ${y0}..${y1} (top = max y), ${px} u px — '@' deep 30 m, '.' shallow, ' ' dry:`,
);
for (let gy = h - 1; gy >= 0; gy -= 2) {
  let line = '';
  for (let gx = 0; gx < w; gx += 1) {
    const value = grid[gy * w + gx];
    line += value === null ? ' ' : shades[Math.max(1, Math.min(9, 1 + Math.floor((value / 30) * 8)))];
  }
  console.log(line);
}
