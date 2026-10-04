import { decodeOscell } from '@opensa/engine-formats/oscell';
import { decodeOswire, OSWIRE_MAGIC, rebuildOscell } from '@opensa/engine-formats/oswire';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';

/**
 * Dump a built pak's WELDED CELL tables for a world position (085 row H's inspector): every objectTable
 * row (kind, timed window, per-group pipeline class / texture array / index count / bounding sphere) and
 * every placement-mapper row whose box intersects a ±60 u column around the point. This is the pak-bytes
 * step of the triage playbook for bugs in the WELDED look — `dump-osm*` only covers per-model archives.
 * Tables travel verbatim in the oswire container, so the meshopt vertex/index payloads stay undecoded.
 * Run: `npx tsx scripts/debug/dump-cell.ts <x> <y> [pakDir]` (default pak `build/original/opensa/opensa`).
 */
const [xArg, yArg, pakArg] = process.argv.slice(2);
const targetX = Number(xArg);
const targetY = Number(yArg);
if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
  console.error('usage: npx tsx scripts/debug/dump-cell.ts <x> <y> [pakDir]');
  process.exit(1);
}
// Plan 086 phase 8 layout first (build/original/opensa/pak), then the older pak homes.
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
const manifest = JSON.parse(readFileSync(join(pakDir, 'manifest.json'), 'utf8')) as {
  cells: Record<string, PakEntry | undefined>;
  cellSize?: number;
};
const pak = readFileSync(join(pakDir, 'world.ospak'));
const cellSize = manifest.cellSize ?? 250;
const cx = Math.floor(targetX / cellSize);
const cy = Math.floor(targetY / cellSize);
const key = `${cx},${cy},hd`;
const entry = manifest.cells[key];
if (!entry) {
  console.log(`no cell ${key}`);
  process.exit(0);
}
let bytes: Uint8Array = pak.subarray(entry.offset, entry.offset + entry.length);
if (entry.enc === 'deflate-raw' || entry.enc === 'oswire-deflate-raw') {
  bytes = inflateRawSync(bytes);
}
if (new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true) === OSWIRE_MAGIC) {
  // Tables live in head/tail verbatim; a zero decoder leaves vertex/index payloads blank, which is fine here.
  const parts = decodeOswire(bytes);
  const skipDecode = (): void => undefined;
  bytes = rebuildOscell(parts, { decodeIndexBuffer: skipDecode, decodeVertexBuffer: skipDecode });
}
const cell = decodeOscell(bytes);
console.log(
  `cell ${key}: origin(${cell.origin.map((v: number) => v.toFixed(1)).join(', ')}) groups=${cell.groups.length} objects=${cell.objects.length} placements=${cell.placements.length}`,
);

console.log('\n== objectTable ==');
const KIND = ['timed', 'breakable', 'animated', 'roadsign', 'uvScroll', 'timedUvScroll'];
for (const [i, object] of cell.objects.entries()) {
  let window = '';
  if (object.kind === 0) {
    window = ` on=${object.params & 0xff} off=${(object.params >> 8) & 0xff}`;
  } else if (object.kind === 5) {
    window = ` slot=${object.params & 0xffff} on=${(object.params >> 16) & 0xff} off=${(object.params >> 24) & 0xff}`;
  } else {
    window = ` params=${object.params}`;
  }
  const groups = cell.groups.slice(object.groupStart, object.groupStart + object.groupCount);
  const spans = groups
    .map(
      (g) =>
        `[cls=${g.pipelineClass} arr=${g.textureArrayRef} idx=${g.indexCount} b=(${g.bounds.map((v) => v.toFixed(0)).join(',')})]`,
    )
    .join(' ');
  console.log(`  #${i} ${KIND[object.kind] ?? object.kind}${window} groups=${object.groupCount} ${spans}`);
}

console.log('\n== placements intersecting the probe column (GTA coords) ==');
// Engine cell-local → GTA: gtaX = ox + lx, gtaZ = ly (height), gtaY = -(oz + lz).
const [ox, , oz] = cell.origin;
for (const p of cell.placements) {
  const b = p.bounds;
  const gta = {
    x0: ox + b[0],
    x1: ox + b[3],
    y0: -(oz + b[5]),
    y1: -(oz + b[2]),
    z0: b[1],
    z1: b[4],
  };
  if (gta.x1 < targetX - 60 || gta.x0 > targetX + 60 || gta.y1 < targetY - 60 || gta.y0 > targetY + 60) {
    continue;
  }
  console.log(
    `  ${cell.names[p.nameRef]} (txd ${cell.names[p.txdRef]}) idx=${p.indexCount} gta-box x(${gta.x0.toFixed(0)}..${gta.x1.toFixed(0)}) y(${gta.y0.toFixed(0)}..${gta.y1.toFixed(0)}) z(${gta.z0.toFixed(0)}..${gta.z1.toFixed(0)})`,
  );
}
