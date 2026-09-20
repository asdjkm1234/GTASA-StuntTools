import { decodeOscell, decodeOswire, type OspakManifest, rebuildOscell } from '@opensa/engine-formats';
import { MeshoptDecoder } from 'meshoptimizer';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

/**
 * verify-cell-normals — read a MODEL's welded vertex normals straight out of a pak cell (plan 024
 * phase 0 verification): decodes the oswire/oscell entry, finds the model's placement ranges, and
 * prints the up-component histogram of exactly the vertices its triangles reference — the offline
 * proof that an experiment reached the shipping cells, without booting the game. Compares the main
 * pak against the `model-repack.ts` lab pak by default (byte-level A/B of one model's normals).
 * The cell key is `<cx>,<cy>,hd|lod` — the cell of the instance's pivot (position / 250, floored).
 * Run: npx tsx scripts/debug/verify-cell-normals.ts <cellKey> <model> [labPakDir] [mainPakDir]
 *   e.g. npx tsx scripts/debug/verify-cell-normals.ts "9,-7,hd" lae2_roads17
 */

const cellKey = process.argv[2] ?? '9,-7,hd';
const model = (process.argv[3] ?? 'lae2_roads17').toLowerCase();
const dirs: [string, string][] = [
  ['main', process.argv[5] ?? 'build/original/opensa/pak'],
  ['lab ', process.argv[4] ?? 'build/original/opensa-lab/pak'],
];

async function main(): Promise<void> {
  await MeshoptDecoder.ready;
  for (const [label, dir] of dirs) {
    const bytes = readCellBytes(dir);
    if (bytes) report(label, bytes);
    else console.log(`${label}: no cell ${cellKey}`);
  }
}

/** The cell's raw `.oscell` bytes out of a pak dir (inflating whichever wire encoding it carries). */
function readCellBytes(dir: string): null | Uint8Array {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as OspakManifest;
  const entry = manifest.cells[cellKey];
  if (!entry) return null;
  const pak = readFileSync(join(dir, 'world.ospak'));
  const bytes = new Uint8Array(pak.buffer, pak.byteOffset + entry.offset, entry.length);
  if (entry.enc === 'oswire-deflate-raw') {
    return rebuildOscell(decodeOswire(new Uint8Array(inflateRawSync(bytes))), MeshoptDecoder);
  }

  return entry.enc === 'deflate-raw' ? new Uint8Array(inflateRawSync(bytes)) : bytes;
}

/** The model's placement-referenced vertices → n.up histogram line, or a miss note. */
function report(label: string, bytes: Uint8Array): void {
  const cell = decodeOscell(bytes);
  const placements = cell.placements.filter((p) => cell.names[p.nameRef]?.toLowerCase() === model);
  if (placements.length === 0) {
    console.log(`${label}: model ${model} not in cell placements (${cell.names.slice(0, 6).join(', ')}…)`);

    return;
  }
  const view = new DataView(cell.vertexData.buffer, cell.vertexData.byteOffset, cell.vertexData.byteLength);
  const indices = cell.index16
    ? new Uint16Array(cell.indexData.buffer, cell.indexData.byteOffset, cell.indexCount)
    : new Uint32Array(cell.indexData.buffer, cell.indexData.byteOffset, cell.indexCount);
  const verts = new Set<number>();
  for (const p of placements) {
    for (let i = p.indexOffset; i < p.indexOffset + p.indexCount; i += 1) verts.add(indices[i]);
  }
  const buckets = [0, 0, 0, 0, 0];
  for (const v of verts) {
    // Normal = snorm8x4 at byte 12 (x,y,z, w=sunVis). Engine is Y-up: GTA "up" (z) lands in byte 13 (y).
    const nx = view.getInt8(v * 36 + 12) / 127;
    const ny = view.getInt8(v * 36 + 13) / 127;
    const nz = view.getInt8(v * 36 + 14) / 127;
    const up = ny / (Math.hypot(nx, ny, nz) || 1);
    buckets[up < 0 ? 0 : up < 0.5 ? 1 : up < 0.9 ? 2 : up < 0.99 ? 3 : 4] += 1;
  }
  console.log(
    `${label}: ${placements.length} placement(s), ${verts.size} verts — n.up buckets  ` +
      `<0:${buckets[0]}  0-0.5:${buckets[1]}  0.5-0.9:${buckets[2]}  0.9-0.99:${buckets[3]}  >=0.99:${buckets[4]}`,
  );
}
void main();
