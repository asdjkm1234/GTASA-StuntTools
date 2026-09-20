/**
 * GPU-free map-pipeline smoke test: opens the user's install over the local http-dir server, resolves the
 * world, then welds the cell under the map centre end to end (IMG Range reads → IDE/IPL/DFF/TXD → `.oscell`
 * bytes). No WebGPU, so it runs anywhere; it is what proves the map side before a browser is involved.
 *
 * Run the local server first, then: `npx tsx scripts/smoke-map.ts http://127.0.0.1:4199/game-src`
 */
import { CELL_SIZE, TexturePlanner, weldCell } from '@opensa/cell-weld';
import { cellModelNames } from '@opensa/renderware/map/cell-groups';
import { cellKey } from '@opensa/renderware/map/world-grid';

import { mapCenterGta } from '../apps/web/src/flight/cell-renderer';
import { loadMapSource } from '../apps/web/src/flight/map-source';

const base = process.argv[2] ?? 'http://127.0.0.1:4199/game-src';
const started = performance.now();
const map = await loadMapSource({ base, kind: 'http-dir' });
console.log(`loaded map in ${Math.round(performance.now() - started)} ms`);
console.log(`  source       ${map.label}`);
console.log(`  cells        ${map.grid.size}`);
console.log(`  instances    ${map.defs.instances.length}`);
console.log(`  catalog      ${map.defs.catalog.size} models`);
console.log(`  archives     dff=${map.models.dff} osm=${map.models.osm}`);

const center = mapCenterGta(map);
const cx = Math.floor(center[0] / CELL_SIZE);
const cy = Math.floor(center[1] / CELL_SIZE);
const cell = map.grid.get(cellKey(cx, cy));
console.log(`centre (GTA)   ${center[0].toFixed(0)}, ${center[1].toFixed(0)} → cell ${cx},${cy}`);
if (!cell) {
  throw new Error('no cell under the map centre');
}
console.log(`  cell         hd=${cell.hd.length} lod=${cell.lod.length}`);

const names = cellModelNames(map.defs, map.grid, cx, cy, false);
const bytes = await map.assets.ensure(names);
console.log(`assets       ${names.length} models, ${(bytes / 1024 / 1024).toFixed(2)} MB read`);

const planner = new TexturePlanner(map.fs, map.defs.txdParents ?? new Map<string, string>());
const origin: [number, number, number] = [(cx + 0.5) * CELL_SIZE, 0, -(cy + 0.5) * CELL_SIZE];
const weldStart = performance.now();
const result = weldCell(map.fs, map.defs, cell, false, planner, origin);
const arrays = planner.build();
console.log(`welded       ${result ? `${result.stats.vertices} verts / ${Math.round(result.stats.indices / 3)} tris / ${result.bytes.byteLength} B` : 'empty'} in ${Math.round(performance.now() - weldStart)} ms`);
console.log(`textures     ${arrays.length} array(s), ${arrays.reduce((sum, a) => sum + a.meta.layers, 0)} layer(s)`);
if (!result) {
  throw new Error('cell welded empty');
}
console.log('MAP PIPELINE OK');
