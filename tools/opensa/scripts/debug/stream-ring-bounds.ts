import { MeshoptDecoder } from 'meshoptimizer/decoder';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
/**
 * Measure how far each pak cell's TRUE geometry (exact vertex XZ AABB) extends beyond its slot's
 * 250-grid rect — the overhang the streaming ring cannot see without the manifest `aabb` field
 * (plan 087 A+B: gostown measured mean 141 u / p90 215 u / max 799 u, hd-only↔lod-only slot pairing
 * from the pre-087 256-grid bake — on a 250-bake pak the pairing should be GONE and lod overhang
 * object-level only). Also lists slot asymmetry, the named bridge cells, and the pak's occupied
 * extent (feeds pmb `PACK_RECTS`).
 *
 * Run: npx tsx scripts/debug/stream-ring-bounds.ts [pak-dir]   (default build/gostown/opensa/pak)
 */
import { inflateRawSync } from 'node:zlib';

import {
  decodeOscell,
  decodeOswire,
  OSCELL_VERTEX_STRIDE,
  type OspakManifest,
  rebuildOscell,
} from '../../packages/engine-formats/src/index';

const pakDir = process.argv[2] ?? 'build/gostown/opensa/pak';

interface Row {
  /** World XZ AABB of the actual vertex data. */
  aabb: [number, number, number, number]; // minX maxX minZ maxZ
  cx: number;
  cy: number;
  key: string;
  level: 'hd' | 'lod';
  /** Max distance the AABB pokes outside the rect on any side (0 = fully inside). */
  overhang: number;
  /** Slot grid rect the ring tests. */
  rect: [number, number, number, number];
  verts: number;
}

async function main(): Promise<void> {
  await MeshoptDecoder.ready;
  const manifest = JSON.parse(readFileSync(join(pakDir, 'manifest.json'), 'utf8')) as OspakManifest;
  const pak = readFileSync(join(pakDir, 'world.ospak'));
  const cellSize = manifest.cellSize ?? 250;
  const rows: Row[] = [];

  for (const [key, entry] of Object.entries(manifest.cells)) {
    const [cxRaw, cyRaw, level] = key.split(',');
    const cx = Number(cxRaw);
    const cy = Number(cyRaw);
    let bytes: Uint8Array = pak.subarray(entry.offset, entry.offset + entry.length);
    if (entry.enc === 'deflate-raw' || entry.enc === 'oswire-deflate-raw') {
      bytes = inflateRawSync(bytes);
    }
    if (entry.enc === 'oswire-deflate-raw') {
      bytes = rebuildOscell(decodeOswire(bytes), MeshoptDecoder);
    }
    const cell = decodeOscell(bytes);
    const view = new DataView(cell.vertexData.buffer, cell.vertexData.byteOffset, cell.vertexData.byteLength);
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let v = 0; v < cell.vertexCount; v += 1) {
      const base = v * OSCELL_VERTEX_STRIDE;
      const x = view.getFloat32(base, true) + cell.origin[0];
      const z = view.getFloat32(base + 8, true) + cell.origin[2];
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const rect: [number, number, number, number] = [
      cx * cellSize,
      (cx + 1) * cellSize,
      -(cy + 1) * cellSize,
      -cy * cellSize,
    ];
    const overhang = Math.max(0, rect[0] - minX, maxX - rect[1], rect[2] - minZ, maxZ - rect[3]);
    rows.push({
      aabb: [minX, maxX, minZ, maxZ],
      cx,
      cy,
      key,
      level: level as 'hd' | 'lod',
      overhang,
      rect,
      verts: cell.vertexCount,
    });
  }

  for (const level of ['hd', 'lod'] as const) {
    const set = rows.filter((r) => r.level === level);
    const ov = set.map((r) => r.overhang).sort((a, b) => a - b);
    const mean = ov.reduce((s, v) => s + v, 0) / ov.length;
    const p = (q: number): number => ov[Math.min(ov.length - 1, Math.floor(q * ov.length))];
    console.log(
      `\n=== ${level}: ${set.length} cells — overhang beyond slot rect (u): ` +
        `mean ${mean.toFixed(1)}, p50 ${p(0.5).toFixed(1)}, p90 ${p(0.9).toFixed(1)}, ` +
        `p99 ${p(0.99).toFixed(1)}, max ${ov[ov.length - 1].toFixed(1)}`,
    );
    const worst = [...set].sort((a, b) => b.overhang - a.overhang).slice(0, 12);
    for (const r of worst) {
      console.log(
        `  ${r.key.padEnd(12)} overhang ${r.overhang.toFixed(0).padStart(5)} u, verts ${String(r.verts).padStart(6)}, ` +
          `aabb x[${r.aabb[0].toFixed(0)}..${r.aabb[1].toFixed(0)}] z[${r.aabb[2].toFixed(0)}..${r.aabb[3].toFixed(0)}] ` +
          `rect x[${r.rect[0]}..${r.rect[1]}] z[${r.rect[2]}..${r.rect[3]}]`,
      );
    }
  }

  // Slot asymmetry: which slots carry only one level.
  const slots = new Map<string, { hd?: Row; lod?: Row }>();
  for (const r of rows) {
    const slot = slots.get(`${r.cx},${r.cy}`) ?? {};
    slot[r.level] = r;
    slots.set(`${r.cx},${r.cy}`, slot);
  }
  const hdOnly = [...slots.entries()].filter(([, s]) => s.hd && !s.lod);
  const lodOnly = [...slots.entries()].filter(([, s]) => !s.hd && s.lod);
  const extent = rows.reduce(
    (acc, r) => [Math.min(acc[0], r.cx), Math.min(acc[1], r.cy), Math.max(acc[2], r.cx), Math.max(acc[3], r.cy)],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
  console.log(`\n=== occupied extent (PACK_RECTS candidate): [${extent.join(', ')}]`);
  console.log(`=== slots: ${slots.size} total, hd-only ${hdOnly.length}, lod-only ${lodOnly.length}`);
  console.log('  hd-only:', hdOnly.map(([k]) => k).join('  '));
  console.log('  lod-only:', lodOnly.map(([k]) => k).join('  '));

  // The named suspects from the field round.
  console.log('\n=== named cells');
  for (const key of ['5,-6,lod', '6,-6,lod', '5,-7,lod', '5,-6,hd', '6,-6,hd', '5,-7,hd']) {
    const r = rows.find((row) => row.key === key);
    console.log(
      r
        ? `  ${key.padEnd(10)} verts ${r.verts}, overhang ${r.overhang.toFixed(0)} u, ` +
            `aabb x[${r.aabb[0].toFixed(0)}..${r.aabb[1].toFixed(0)}] z[${r.aabb[2].toFixed(0)}..${r.aabb[3].toFixed(0)}]`
        : `  ${key.padEnd(10)} ABSENT from manifest`,
    );
  }

  // Ring-decision error from the gostown spawn: rect distance (what the ring tests) vs true AABB
  // distance (where the geometry actually is) — cells the ring would SKIP while geometry is in view.
  const spawn: [number, number] = [1531.15, 1271.89]; // engine XZ (GTA y → −z… engine z = −y → +1271.89)
  const lodRadius = 3000;
  const missed = rows.filter((r) => {
    if (r.level !== 'lod') return false;
    const rectD = rectDist(r.rect, spawn[0], spawn[1]);
    const aabbD = rectDist(r.aabb, spawn[0], spawn[1]);

    return rectD >= lodRadius && aabbD < lodRadius - 150; // geometry inside fog, slot outside ring
  });
  console.log(
    `\n=== from spawn [${spawn.join(', ')}]: lod cells the ring skips while geometry sits inside fog: ${missed.length}`,
  );
  for (const r of missed.slice(0, 10)) {
    console.log(
      `  ${r.key.padEnd(12)} rectDist ${rectDist(r.rect, spawn[0], spawn[1]).toFixed(0)} ` +
        `aabbDist ${rectDist(r.aabb, spawn[0], spawn[1]).toFixed(0)}`,
    );
  }
}

function rectDist(rect: readonly [number, number, number, number], fx: number, fz: number): number {
  const dx = Math.max(rect[0] - fx, 0, fx - rect[1]);
  const dz = Math.max(rect[2] - fz, 0, fz - rect[3]);

  return Math.hypot(dx, dz);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
