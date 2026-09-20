/**
 * Probe: the true occupied 250-grid extent of a game dir (feeds PACK_RECTS.full).
 *
 * It also names the STRAGGLERS — cells sitting far from the body of the map. Removing an object by exiling
 * it thousands of metres out is standard SA modding, and one such placement stretches the extent without
 * adding any map: a merged `original` build carried a lamppost 17 km south (`las2_stream1.ipl`), which made
 * the extent 24 × 93 cells instead of 24 × 24. That is what a `--rect`-less convert would pack and what any
 * midpoint-derived default camera would open on, so the extent alone is not enough to read off.
 *
 *   npx tsx scripts/debug/grid-extent.ts <game-dir>
 */
import { OPEN_SCRIPT_IPL, resolveMap } from '../../packages/renderware/src/map/resolve-map';
import { buildWorldGrid } from '../../packages/renderware/src/map/world-grid';
import { openGameDir } from '../../tools/opensa-pack/src/game-fs';

/** How many cells from the median a cell must sit to be reported as a straggler. */
const STRAGGLER_CELLS = 24;

const fs = openGameDir(process.argv[2] ?? 'build/gostown/sa');
const defs = resolveMap(fs, { extraIpl: OPEN_SCRIPT_IPL });
const grid = buildWorldGrid(defs, 250);
const cells = [...grid.values()];
let x0 = Infinity;
let y0 = Infinity;
let x1 = -Infinity;
let y1 = -Infinity;
for (const cell of cells) {
  x0 = Math.min(x0, cell.cx);
  y0 = Math.min(y0, cell.cy);
  x1 = Math.max(x1, cell.cx);
  y1 = Math.max(y1, cell.cy);
}
console.log(`occupied 250-grid extent: [${x0}, ${y0}, ${x1}, ${y1}] (${grid.size} cells with content)`);

const mx = median(cells.map((cell) => cell.cx));
const my = median(cells.map((cell) => cell.cy));
const stragglers = cells
  .filter((cell) => Math.abs(cell.cx - mx) > STRAGGLER_CELLS || Math.abs(cell.cy - my) > STRAGGLER_CELLS)
  .sort((a, b) => a.cx - b.cx || a.cy - b.cy);
console.log(`median cell: (${mx}, ${my}) — ${stragglers.length} cells more than ${STRAGGLER_CELLS} cells away`);
for (const cell of stragglers) {
  const names = [...cell.hd, ...cell.lod].map((instance) => `${instance.modelName || '?'}#${instance.id}`);
  console.log(`  cell (${cell.cx}, ${cell.cy}) — ${cell.hd.length} hd / ${cell.lod.length} lod: ${names.join(', ')}`);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);

  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}
