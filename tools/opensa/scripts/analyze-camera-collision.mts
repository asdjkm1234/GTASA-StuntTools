/** Compare baked COL camera hits with the temporary GTA camera trace. */
import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import { readBakedCell } from '@opensa/game/adapters/baked-collision';
import { PhysicsWorld } from '@opensa/game/physics/physics-world';
import { initRapier } from '@opensa/game/physics/rapier';

import { ChaseCameraTimeline } from '../apps/web/src/flight/camera-track';
import { parseFlightCsv } from '../apps/web/src/flight/csv';

const csvPath = resolve(process.argv[2] ?? '');
const pakDir = resolve(process.argv[3] ?? 'map-pak');
const radius = Number(process.argv[4] ?? 0.18);
const summary = process.argv[5] === 'summary';
if (!process.argv[2]) throw new Error('usage: analyze-camera-collision.mts <camera-debug.csv> [map-pak]');
const text = readFileSync(csvPath, 'utf8');
const track = parseFlightCsv(text, basename(csvPath));
const lines = text.split(/\r?\n/).filter((line) => line && !line.startsWith('#'));
const names = lines[0].split(',');
const index = new Map(names.map((name, i) => [name, i]));
const raw = lines.slice(1).map((line) => line.split(','));
const value = (row: string[], name: string) => Number(row[index.get(name) ?? -1]);
const ranges = summary ? [[18.5, 19.5], [31.7, 33], [40.1, 42.3]]
  : [[0, 2.6], [18.5, 19.5], [31.7, 33], [40.1, 42.3]];
const selected = track.rows.map((row, i) => ({ row, i }))
  .filter(({ row, i }) => (summary || i % 3 === 0) && ranges.some(([from, to]) => row.s >= from && row.s <= to));
const pak = JSON.parse(readFileSync(join(pakDir, 'index.json'), 'utf8')) as {
  collisionCellSize: number;
  collisionCells: { cx: number; cy: number }[];
};
const needed = pak.collisionCells.filter((cell) => selected.some(({ row }) =>
  Math.hypot((cell.cx + 0.5) * pak.collisionCellSize - row.pos[0],
    (cell.cy + 0.5) * pak.collisionCellSize - row.pos[1]) <= 450));
const physics = new PhysicsWorld(await initRapier());
let bodies = 0;
for (const cell of needed) {
  const bytes = readFileSync(join(pakDir, 'collision', `${cell.cx}_${cell.cy}.oscol`));
  const models = readBakedCell(bytes);
  if (models) bodies += physics.createStaticColliders(models).length;
}
console.log(`loaded ${needed.length} collision cells, ${bodies} bodies`);
physics.step(1 / 60);
const timeline = new ChaseCameraTimeline(track, 14.2, 2.2);
let previous = 20.559;
let lastTime = -Infinity;
const errors: number[] = [];
for (const { row, i } of selected) {
  const state = timeline.state(row.s, 'chase-mid', 16 / 9);
  const offset = state.eye.map((component, axis) => component - state.target[axis]);
  const desired = Math.hypot(...offset);
  const from: [number, number, number] = [state.target[0], -state.target[2], state.target[1]];
  const dir: [number, number, number] = [offset[0], -offset[2], offset[1]];
  const hit = physics.sphereCast(from, dir, radius, desired);
  const allowed = hit ? Math.max(0.5, hit.dist - 0.12) : desired;
  const record = raw[i];
  const actual = [value(record, 'camera_source_x'), value(record, 'camera_source_z'), -value(record, 'camera_source_y')];
  const target = [row.pos[0], row.pos[2] + 0.84104, -row.pos[1]];
  const reference = Math.hypot(...actual.map((component, axis) => component - target[axis]));
  if (row.s - lastTime > 0.5) previous = desired;
  const shown = allowed < previous ? allowed : previous + (allowed - previous) *
    (1 - Math.exp(-(row.s - lastTime) / 0.18));
  errors.push(Math.abs(shown - reference));
  previous = shown;
  lastTime = row.s;
  if (!summary) console.log(`${row.s.toFixed(3)} actual=${reference.toFixed(2)} predicted=${allowed.toFixed(2)} desired=${desired.toFixed(2)} hit=${hit?.dist.toFixed(2) ?? '-'}`);
}
if (summary) console.log(`radius=${radius}: MAE=${(errors.reduce((a,b)=>a+b,0)/errors.length).toFixed(2)} p90=${errors.sort((a,b)=>a-b)[Math.floor(errors.length*0.9)].toFixed(2)} n=${errors.length}`);
physics.dispose();
