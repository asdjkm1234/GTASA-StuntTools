import { readVehicleOsm } from '@opensa/game/adapters/vehicle-osm';
import { openArchive } from '@opensa/renderware/archive/img-archive';
import { existsSync, readFileSync } from 'node:fs';

/**
 * What the BUILT fleet costs in draws, and what a build-time merge would leave: for every `.osm` in the split
 * vehicle archives of `build/<game>/opensa`, the opaque submeshes shown by default (`body`, no extra/variant)
 * against the number of DISTINCT runtime states among them — part, kind, damage group, extra, variant,
 * texture array, uv-anim slot, lamp, plate, tyre: everything the engine binds or gates per submesh. Two
 * submeshes with the same key differ only in per-vertex material state (colour, layer, paint, reflect), so
 * the builder could weld them into one draw without the engine noticing. Also the `_vlo` census (which cars
 * ship a LOD mesh, mean body vs LOD triangles) — the other half of the fleet's price.
 *
 * Written 2026-08-18 for `docs/performance/deferred-optimizations/vehicle-submesh-draw-batching.md`: the
 * fleet is +1.0..2.6 ms of pass on the display lane; this says how much of it a build-time merge reaches.
 *
 * Run: `npx tsx scripts/debug/vehicle-submesh-census.ts [game] [model]` — a model name adds its per-part
 * breakdown (opaque submeshes per part, over how many texture arrays).
 */
const game = process.argv[2] ?? 'original';
const only = process.argv[3];

type Read = ReturnType<typeof readVehicleOsm>;
const models: { name: string; read: Read }[] = [];
for (const img of ['vehicles', 'vehicles2', 'gta3']) {
  const path = `build/${game}/opensa/models/${img}.img`;
  if (!existsSync(path)) {
    continue;
  }
  const archive = openArchive(new Uint8Array(readFileSync(path)));
  for (const entry of archive.names) {
    if (!entry.endsWith('.osm')) {
      continue;
    }
    const name = entry.slice(0, -4);
    if (models.some((m) => m.name === name)) {
      continue;
    }
    try {
      models.push({ name, read: readVehicleOsm(name, new Uint8Array(archive.get(entry)!)) });
    } catch {
      // not a vehicle .osm (peds and props share the archives)
    }
  }
}

const shown = (s: Read['rig']['submeshes'][number]): boolean => s.kind === 'body' && !s.extra && !s.variant;
const mergeKey = (s: Read['rig']['submeshes'][number]): string =>
  [
    s.part,
    s.kind,
    s.damageGroup,
    s.extra ?? '',
    s.variant ?? '',
    s.array ?? 0,
    s.uvAnim ?? -1,
    s.lamp ?? '',
    s.plate ?? '',
    s.tyre ? 1 : 0,
  ].join('|');

let opaque = 0;
let merged = 0;
let translucent = 0;
let withLod = 0;
let bodyTris = 0;
let lodTris = 0;
const rows: { merged: number; name: string; opaque: number; translucent: number }[] = [];
const noLod: string[] = [];
for (const { name, read } of models) {
  const keys = new Set<string>();
  let o = 0;
  let t = 0;
  let l = 0;
  for (const s of read.rig.submeshes) {
    if (s.kind === 'lod') {
      l += s.indexCount / 3;
    }
    if (!shown(s)) {
      continue;
    }
    bodyTris += s.indexCount / 3;
    if (s.translucent) {
      t += 1;
    } else {
      o += 1;
      keys.add(mergeKey(s));
    }
  }
  opaque += o;
  merged += keys.size;
  translucent += t;
  if (l > 0) {
    withLod += 1;
    lodTris += l;
  } else {
    noLod.push(name);
  }
  rows.push({ merged: keys.size, name, opaque: o, translucent: t });
}
console.log(
  `models ${models.length} · shown-by-default submeshes: opaque ${opaque} → ${merged} after a same-state merge (${((1 - merged / opaque) * 100).toFixed(0)} % fewer) · translucent ${translucent} (not mergeable — sorted per submesh)`,
);
console.log(
  `_vlo: ${withLod}/${models.length} ship one · mean body tris ${(bodyTris / models.length).toFixed(0)} · mean lod tris ${(lodTris / Math.max(1, withLod)).toFixed(0)} · without: ${noLod.join(' ') || '—'}`,
);
rows.sort((a, b) => b.opaque - a.opaque);
for (const r of rows.slice(0, 12)) {
  console.log(
    `  ${r.name.padEnd(12)} opaque ${String(r.opaque).padStart(4)} → ${String(r.merged).padStart(3)} · translucent ${r.translucent}`,
  );
}

const one = only ? models.find((m) => m.name === only) : undefined;
if (one) {
  const byPart = new Map<number, { arrays: Set<number>; opaque: number; translucent: number }>();
  for (const s of one.read.rig.submeshes) {
    if (!shown(s)) {
      continue;
    }
    const e = byPart.get(s.part) ?? { arrays: new Set<number>(), opaque: 0, translucent: 0 };
    if (s.translucent) {
      e.translucent += 1;
    } else {
      e.opaque += 1;
      e.arrays.add(s.array ?? 0);
    }
    byPart.set(s.part, e);
  }
  console.log(`${only}: parts ${one.read.rig.parts.length}, body parts used ${byPart.size}`);
  for (const [part, e] of [...byPart].sort((a, b) => b[1].opaque - a[1].opaque)) {
    console.log(
      `  part ${String(part).padStart(2)} ${(one.read.rig.parts[part]?.name ?? '').padEnd(16)} opaque ${String(e.opaque).padStart(3)} over ${e.arrays.size} array(s) · translucent ${e.translucent}`,
    );
  }
}
