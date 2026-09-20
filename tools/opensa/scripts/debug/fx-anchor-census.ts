import { decodeOscell } from '@opensa/engine-formats/oscell';
import { decodeOswire, OSWIRE_MAGIC, rebuildOscell } from '@opensa/engine-formats/oswire';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

/**
 * The 2dfx PARTICLE anchors a built pak carries: how many of each `effects.fxp` system, and — the half a
 * count cannot give you — WHERE to stand to see one. Plan 100's field check spent two rounds failing to frame
 * an emitter it had no coordinate for; this answers "where is the nearest `insects`" in one call.
 *
 * Run: `npx tsx scripts/debug/fx-anchor-census.ts [--pak <dir>] [--level hd|lod] [--system <name>]
 *       [--near <x,y>] [--limit <n>]`
 *
 * Positions are printed in GTA coordinates (the ones `?spawn=`/`?look=` take). The pak stores each anchor in
 * ENGINE space RELATIVE TO ITS CELL ORIGIN — the host adds the origin at load, which is why `Oscell.particles`
 * reads as world-space downstream — so the conversion is `gtaX = ox + lx`, `gtaY = −(oz + lz)`, `gtaZ = ly`,
 * the same one `dump-cell.ts` applies to placements. The self-check below exists because reading them as
 * already-world prints perfectly plausible coordinates for the wrong place on the map.
 *
 * Counting is per LEVEL — since plan 100/03 a LOD bundle carries its cell's anchors too, so summing both
 * levels double-counts the map.
 */
const args = process.argv.slice(2);
const argValue = (flag: string): string | undefined => {
  const at = args.indexOf(flag);

  return at < 0 ? undefined : args[at + 1];
};

const pakDir =
  argValue('--pak') ??
  ['build/original/opensa/pak', 'build/original/opensa-pack', 'build/original/opensa/opensa'].find((dir) =>
    existsSync(dir),
  ) ??
  'build/original/opensa/pak';
const level = argValue('--level') ?? 'hd';
const system = argValue('--system')?.toLowerCase();
const near = argValue('--near')
  ?.split(',')
  .map((value) => Number(value));
const limit = Number(argValue('--limit') ?? 20);

/**
 * The per-system cull distances the pipeline SHIPS (plan 100/04's table). A Map because these are effects.fxp
 * system NAMES — data, not identifiers, and not camelCase. — an emitter is live only inside its
 * own. They are what bounds the far-view budget, so a budget question is asked against these and never
 * against a flat radius. Anything absent falls back to the dynamic lane's floor.
 */
const SHIPPED_CULL = new Map<string, number>([
  ['carwashspray', 70],
  ['cigarette_smoke', 100],
  ['fire', 35],
  ['flame', 35],
  ['insects', 100],
  ['smoke30lit', 1500],
  ['smoke30m', 1500],
  ['smoke50lit', 1500],
  ['vent2', 25],
  ['vent', 25],
  ['water_fnt_tme', 30],
  ['water_fountain', 30],
  ['waterfall_end', 25],
  ['ws_factorysmoke', 1500],
]);
/** The long-range systems — the ones a LOD-range budget is actually about (a distant refinery's smoke). */
const FAR_SYSTEMS = new Set(['smoke30lit', 'smoke30m', 'smoke50lit', 'ws_factorysmoke']);

interface PakEntry {
  enc?: string;
  length: number;
  offset: number;
}
const manifest = JSON.parse(readFileSync(join(pakDir, 'manifest.json'), 'utf8')) as {
  cells: Record<string, PakEntry | undefined>;
  cellSize?: number;
};
const cellSize = manifest.cellSize ?? 250;
const pak = readFileSync(join(pakDir, 'world.ospak'));

interface Anchor {
  cell: string;
  name: string;
  x: number;
  y: number;
  z: number;
}
const anchors: Anchor[] = [];
const counts = new Map<string, number>();
let cellsRead = 0;
/** Self-check: an anchor read out of cell `cx,cy` must LAND in that cell, or at most spill a metre or two over
 *  its edge (the cell owns the PLACEMENT, and an emitter can hang off the far side of the model). A wrong
 *  space or a swapped axis puts it kilometres away, so the OVERSHOOT is the number that separates the two —
 *  reading these anchors as already-world scored 934 of 943 outside, at up to 3 km. */
let misplaced = 0;
let worstOvershoot = 0;

for (const [key, entry] of Object.entries(manifest.cells)) {
  if (!entry || !key.endsWith(`,${level}`)) {
    continue;
  }
  let bytes: Uint8Array = pak.subarray(entry.offset, entry.offset + entry.length);
  if (entry.enc === 'deflate-raw' || entry.enc === 'oswire-deflate-raw') {
    bytes = inflateRawSync(bytes);
  }
  if (new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true) === OSWIRE_MAGIC) {
    // The particle table travels verbatim in the container head; the geometry payloads stay undecoded.
    const skipDecode = (): void => undefined;
    bytes = rebuildOscell(decodeOswire(bytes), { decodeIndexBuffer: skipDecode, decodeVertexBuffer: skipDecode });
  }
  const cell = decodeOscell(bytes);
  cellsRead += 1;
  const [cx, cy] = key.split(',').map((part) => Number(part));
  const [ox, , oz] = cell.origin;
  for (const particle of cell.particles) {
    const name = particle.effectName.toLowerCase();
    const anchor = {
      cell: key,
      name,
      x: ox + particle.position[0],
      y: -(oz + particle.position[2]),
      z: particle.position[1],
    };
    if (Math.floor(anchor.x / cellSize) !== cx || Math.floor(anchor.y / cellSize) !== cy) {
      misplaced += 1;
      const overshoot = Math.max(
        cx * cellSize - anchor.x,
        anchor.x - (cx + 1) * cellSize,
        cy * cellSize - anchor.y,
        anchor.y - (cy + 1) * cellSize,
      );
      worstOvershoot = Math.max(worstOvershoot, overshoot);
    }
    counts.set(name, (counts.get(name) ?? 0) + 1);
    anchors.push(anchor);
  }
}

const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
console.log(`pak ${pakDir} — ${cellsRead} ${level} cells, ${total} anchors across ${counts.size} systems`);
console.log(
  `self-check: ${misplaced} anchors outside their own cell, worst overshoot ${worstOvershoot.toFixed(1)} u ` +
    `(a handful of metres = a model straddling the edge; hundreds = the wrong space)`,
);
for (const [name, count] of [...counts].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name.padEnd(20)} ${count}`);
}

if (args.includes('--worst')) {
  reportWorstViewpoint();
  process.exit(0);
}

if (!system) {
  process.exit(0);
}

let listed = anchors.filter((anchor) => anchor.name === system);
if (near && near.length === 2 && near.every((value) => Number.isFinite(value))) {
  const distance = (anchor: Anchor): number => Math.hypot(anchor.x - near[0], anchor.y - near[1]);
  listed = listed.sort((a, b) => distance(a) - distance(b));
}
console.log(`\n== ${system}: ${listed.length} anchors${near ? `, nearest ${near.join(',')}` : ''} ==`);
for (const anchor of listed.slice(0, limit)) {
  console.log(`  ${anchor.x.toFixed(1)}, ${anchor.y.toFixed(1)}, ${anchor.z.toFixed(1)}  (cell ${anchor.cell})`);
}

/**
 * `--worst`: **the deliberate worst-case viewpoint** plan 008 asks for — the point in the whole map where the
 * most emitters are simultaneously LIVE. Every anchor is a candidate viewpoint (an emitter cluster's own
 * position is where the count peaks), and the count is a strict UPPER BOUND on what a frame can hold: a
 * camera sees a frustum, never the whole sphere.
 */
function reportWorstViewpoint(): void {
  const cullOf = (name: string): number => SHIPPED_CULL.get(name) ?? 300;
  const live = (from: Anchor, only?: Set<string>): number =>
    anchors.filter(
      (a) =>
        (!only || only.has(a.name)) &&
        Math.hypot(a.x - from.x, a.y - from.y, a.z - from.z) <= (only ? 1500 : cullOf(a.name)),
    ).length;

  const peak = (candidates: Anchor[], only?: Set<string>): { at: Anchor; n: number } =>
    candidates.reduce(
      (best, at) => {
        const n = live(at, only);

        return n > best.n ? { at, n } : best;
      },
      { at: candidates[0], n: -1 },
    );

  const all = peak(anchors);
  const far = peak(
    anchors.filter((a) => FAR_SYSTEMS.has(a.name)),
    FAR_SYSTEMS,
  );
  const farTotal = anchors.filter((a) => FAR_SYSTEMS.has(a.name)).length;
  console.log('\n== the deliberate worst case (an upper bound: a frustum sees less than a sphere) ==');
  console.log(
    `  ALL systems, each inside its own shipped cull: ${all.n} live at once — ` +
      `?spawn=${all.at.x.toFixed(1)},${all.at.y.toFixed(1)},${all.at.z.toFixed(1)}`,
  );
  console.log(
    `  FAR-VIEW only (the 1500 u smokes): ${far.n} of ${farTotal} live at once — ` +
      `?spawn=${far.at.x.toFixed(1)},${far.at.y.toFixed(1)},${far.at.z.toFixed(1)}`,
  );
  console.log(`  Map-wide anchors: ${total}. Positive control for a frame A/B here: ?fx=0.001 (collapses all).`);
}
