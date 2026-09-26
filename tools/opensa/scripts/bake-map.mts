/**
 * Route A — offline map baker. Runs the SAME weld pipeline the browser uses (`weldCell` + `TexturePlanner`)
 * in Node, over the user's own install, and writes an engine-ready pak:
 *
 *   <out>/index.json                 render cells, texture arrays and camera collision cells
 *   <out>/cells/<cx>_<cy>[_lod].bin   the `.oscell` bytes, loaded with `engine.cells.load`
 *   <out>/textures/<ref>.ostex        arrays uploaded with `beginLoad` + per-frame `drainUploads`
 *   <out>/collision/<cx>_<cy>.oscol   GTA COL shapes on the 256-unit game grid
 *   <out>/aircraft/*.{dff,txd}        only Hydra (520) and Rustler (476)
 *   <out>/fx/*                        effects.fxp + effectsPC.txd (optional sprite smoke/explosion lane)
 *   <out>/data/*                      replay weather, water, vehicle scale and paint tables
 *
 * Because ONE planner produced every cell, layer indices are globally consistent and the arrays are complete
 * up front: the replay uploads them once and NEVER grows/replaces an array at runtime (the black-screen/TDR
 * source). Textures stay BC-compressed (`.ostex`), so size and look match the original data.
 *
 *   npx tsx scripts/bake-map.mts <outDir> [minCx maxCx minCy maxCy] [base]
 *   npx tsx scripts/bake-map.mts <outDir> --recording <csv> [base]
 *
 * With no rect, the WHOLE exterior map is baked; a rect (cell coordinates) bakes just that window.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { CELL_SIZE, TexturePlanner, weldCell } from '@opensa/cell-weld';
import { GAME_CELL_SIZE } from '@opensa/cell-weld/cell-size';
import { encodeOscol } from '@opensa/engine-formats';
import { buildCellColliders } from '@opensa/renderware/collision/build-cell-colliders';
import { buildCollisionIndex } from '@opensa/renderware/collision/collision-index';
import { cellModelNames } from '@opensa/renderware/map/cell-groups';
import { buildWorldGrid, cellKey } from '@opensa/renderware/map/world-grid';

import { loadMapSource } from '../apps/web/src/flight/map-source';
import { bakeCellCollision, collisionCellRect } from '../tools/opensa-pack/src/pack-collision';

const outDir = path.resolve(process.argv[2] ?? 'map-pak');
const routeFlag = process.argv[3] === '--recording';
const routeFile = routeFlag ? path.resolve(process.argv[4] ?? '') : null;
const rect = !routeFlag && process.argv.length >= 7 ? process.argv.slice(3, 7).map(Number) : null;
const base = process.env.GAME_SOURCE_BASE ?? process.argv[routeFlag ? 5 : 7] ?? 'http://127.0.0.1:4173/game-src';
// A route pak trades the 3000-unit skyline for a 1200-unit horizon. Keep its cells through
// the edge of that horizon; the regular whole-map pak retains the original draw distances.
const routeRadius = 1200;
const routePoints: [number, number][] = [];
if (routeFile) {
  const lines = (await fs.readFile(routeFile, 'utf8')).split(/\r?\n/);
  const header = lines.findIndex((line) => line.startsWith('local_timestamp,'));
  if (header < 0) throw new Error('Recording is missing the FlightRecorder CSV header');
  const columns = lines[header].split(',');
  const xIndex = columns.indexOf('x');
  const yIndex = columns.indexOf('y');
  if (xIndex < 0 || yIndex < 0) throw new Error('Recording is missing x/y coordinates');
  for (const line of lines.slice(header + 1)) {
    if (!line || line.startsWith('#')) continue;
    const values = line.split(',');
    if (!values[xIndex] || !values[yIndex]) continue;
    const x = Number(values[xIndex]);
    const y = Number(values[yIndex]);
    if (Number.isFinite(x) && Number.isFinite(y)) routePoints.push([x, y]);
  }
  if (routePoints.length < 2) throw new Error('Recording has fewer than two valid positions');
}
if (rect && (rect.some((value) => !Number.isInteger(value)) || rect[0] > rect[1] || rect[2] > rect[3])) {
  throw new Error('Invalid cell rectangle');
}

function distanceToRoute(x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < routePoints.length; i += 1) {
    const [ax, ay] = routePoints[i];
    const [bx, by] = routePoints[Math.min(i + 1, routePoints.length - 1)];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}

const started = performance.now();
console.log(`loading map source ${base} …`);
const map = await loadMapSource({ base, kind: 'http-dir' });
console.log(`  cells ${map.grid.size}, instances ${map.defs.instances.length}, models ${map.defs.catalog.size}`);

const all = [...map.grid.values()];
const cells = routeFile
  ? all.filter((cell) => distanceToRoute((cell.cx + 0.5) * CELL_SIZE, (cell.cy + 0.5) * CELL_SIZE)
      <= routeRadius + CELL_SIZE * Math.SQRT2 / 2)
  : rect
    ? all.filter((cell) => cell.cx >= rect[0] && cell.cx <= rect[1] && cell.cy >= rect[2] && cell.cy <= rect[3])
    : all;
if (!cells.length) throw new Error('No map cells intersect the recording route');
console.log(`baking ${cells.length} cell(s)${routeFile ? ` around ${routePoints.length} positions` : rect ? ` in rect ${rect.join(',')}` : ' (whole map)'} → ${outDir}`);

await fs.mkdir(path.join(outDir, 'cells'), { recursive: true });
await fs.mkdir(path.join(outDir, 'textures'), { recursive: true });
await fs.mkdir(path.join(outDir, 'collision'), { recursive: true });
await fs.mkdir(path.join(outDir, 'aircraft'), { recursive: true });
await fs.mkdir(path.join(outDir, 'fx'), { recursive: true });
await fs.mkdir(path.join(outDir, 'data'), { recursive: true });

// Bake the only two aircraft the recorder supports, plus the small text tables used at replay time.
const replayDataFiles = ['timecyc.dat', 'water.dat', 'vehicles.ide', 'carcols.dat'];
for (const name of replayDataFiles) {
  const text = map.fs.getText(`data/${name}`);
  if (text === null) throw new Error(`GTA install is missing data/${name}`);
  await fs.writeFile(path.join(outDir, 'data', name), text);
}
const replayAircraft: Record<number, string> = {};
// SA vehicle models inherit generic materials (including tyres and trim) from this shared dictionary.
// Without it the builder silently substitutes white texels for those model faces.
const genericTxdResponse = await fetch(`${base.replace(/\/$/, '')}/models/generic/vehicle.txd`);
if (!genericTxdResponse.ok) throw new Error('GTA install is missing models/generic/vehicle.txd');
await fs.writeFile(path.join(outDir, 'aircraft', 'vehicle.txd'), new Uint8Array(await genericTxdResponse.arrayBuffer()));
for (const [id, candidates] of [[520, ['hydra']], [476, ['rustler', 'stuntplane']]] as const) {
  let found = false;
  for (const name of candidates) {
    const dff = await map.assets.readRaw(`${name}.dff`);
    const txd = await map.assets.readRaw(`${name}.txd`);
    if (!dff || !txd) continue;
    await fs.writeFile(path.join(outDir, 'aircraft', `${name}.dff`), dff);
    await fs.writeFile(path.join(outDir, 'aircraft', `${name}.txd`), txd);
    replayAircraft[id] = name;
    found = true;
    break;
  }
  if (!found) throw new Error(`GTA install is missing DFF/TXD for model ${id}`);
}
console.log(`  replay aircraft ${Object.entries(replayAircraft).map(([id, name]) => `${id}:${name}`).join(', ')}`);

// Optional sprite FX lane: the `effects.fxp` system tracks and the `effectsPC.txd` sprite dictionary the
// replay's smoke/explosion billboards are baked from. Both are optional — a pak without them still replays,
// it just draws no sprite smoke (the aircraft model, nozzle geometry and flight all keep working).
const replayFx: string[] = [];
for (const name of ['effects.fxp', 'effectsPC.txd'] as const) {
  const bytes = await map.assets.readInstallFile(name);
  if (!bytes) {
    console.log(`  fx: install has no ${name} — sprite smoke/explosions will be skipped at replay`);
    continue;
  }
  await fs.writeFile(path.join(outDir, 'fx', name), bytes);
  replayFx.push(name);
}
if (replayFx.length) console.log(`  fx ${replayFx.join(', ')}`);

const planner = new TexturePlanner(map.fs, map.defs.txdParents ?? new Map<string, string>());
const written: { cx: number; cy: number; lod: boolean }[] = [];
let bytesWritten = 0;
let done = 0;
const t0 = performance.now();

for (const { cx, cy } of cells) {
  for (const lod of [false, true]) {
    const cell = map.grid.get(cellKey(cx, cy));
    if (!cell) continue;
    if (lod && cell.lod.length === 0) continue;
    const names = cellModelNames(map.defs, map.grid, cx, cy, lod);
    await map.assets.ensure(names);
    const origin: [number, number, number] = [(cx + 0.5) * CELL_SIZE, 0, -(cy + 0.5) * CELL_SIZE];
    const result = weldCell(map.fs, map.defs, cell, lod, planner, origin);
    if (!result) continue;
    const file = path.join(outDir, 'cells', `${cx}_${cy}${lod ? '_lod' : ''}.bin`);
    await fs.writeFile(file, result.bytes);
    bytesWritten += result.bytes.byteLength;
    written.push({ cx, cy, lod });
  }
  done += 1;
  if (done % 25 === 0 || done === cells.length) {
    console.log(`  ${done}/${cells.length} cells, ${(bytesWritten / 1024 / 1024).toFixed(1)} MB, ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  }
}

const arrays = planner.build();
for (const array of arrays) {
  await fs.writeFile(path.join(outDir, 'textures', `${array.ref}.ostex`), array.bytes);
}

// The camera needs the original game's COL surfaces to pull in around bridges and walls.
// Collision uses the 256-unit game grid, not the render grid's 250-unit cells.
const colBytes = await map.assets.ensureCollisionLibraries();
const collisionIndex = buildCollisionIndex(map.fs);
const collisionGrid = buildWorldGrid(map.defs, GAME_CELL_SIZE);
const collisionRect = rect ? collisionCellRect(
  [rect[0], rect[2], rect[1], rect[3]], CELL_SIZE, GAME_CELL_SIZE,
) : null;
const collisionCells: { cx: number; cy: number }[] = [];
let collisionBytes = 0;
for (const cell of collisionGrid.values()) {
  const { cx, cy } = cell;
  if (collisionRect && (cx < collisionRect[0] || cx > collisionRect[2]
    || cy < collisionRect[1] || cy > collisionRect[3])) continue;
  if (routeFile && distanceToRoute((cx + 0.5) * GAME_CELL_SIZE, (cy + 0.5) * GAME_CELL_SIZE)
    > routeRadius + GAME_CELL_SIZE * Math.SQRT2 / 2) continue;
  const regions = buildCellColliders(collisionIndex, map.defs, collisionGrid, cx, cy);
  if (regions.length === 0) continue;
  const bytes = encodeOscol(bakeCellCollision(regions, () => false));
  await fs.writeFile(path.join(outDir, 'collision', `${cx}_${cy}.oscol`), bytes);
  collisionCells.push({ cx, cy });
  collisionBytes += bytes.byteLength;
}
await fs.writeFile(
  path.join(outDir, 'index.json'),
  JSON.stringify({
    arrays: arrays.map((array) => ({ layers: array.meta.layers, ref: array.ref })),
    cellSize: CELL_SIZE,
    cells: written,
    collisionCellSize: GAME_CELL_SIZE,
    collisionCells,
    replayAssets: { version: 2, aircraft: replayAircraft, data: replayDataFiles, fx: replayFx, sharedTextures: ['vehicle.txd'] },
    ...(routeFile ? { renderRadius: { hd: routeRadius, lod: routeRadius } } : {}),
    generated: new Date().toISOString(),
    source: base,
  }),
);

const arrayBytes = arrays.reduce((sum, array) => sum + array.bytes.byteLength, 0);
console.log(`done: ${written.length} cell files, ${arrays.length} texture arrays`);
console.log(`  cells ${(bytesWritten / 1024 / 1024).toFixed(1)} MB · textures ${(arrayBytes / 1024 / 1024).toFixed(1)} MB`);
console.log(`  collision ${collisionCells.length} cells, ${(collisionBytes / 1024 / 1024).toFixed(1)} MB (read ${(colBytes / 1024 / 1024).toFixed(1)} MB COL)`);
console.log(`  total ${((performance.now() - started) / 1000).toFixed(0)}s`);
