/**
 * Per-part vehicle-AO stats for the REAL mod cars: bake admiral + comet from mods-src DFFs through
 * buildVehicleOsm, read back and print each part's night-alpha (the AO channel) — count / avg /
 * below-100 share / worst. THE tool for judging a sky-occlusion change offline: run, `git stash` the
 * change, run again, diff (built for the 085 night-speckle round, 2026-07-23).
 *
 * Run: `npx tsx scripts/debug/dump-vehicle-ao.ts`
 */
import { readVehicleOsm } from '@opensa/game/adapters/vehicle-osm';
import { resolveVehicleSources } from '@opensa/tool-kit/vehicles-dir';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildVehicleOsm } from '../../tools/opensa-pack/src/vehicle-osm';

const buf = (p: string): ArrayBuffer => {
  const d = readFileSync(p);

  return d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
};

const MODS = 'mods-src/original/vehicles';
const GENERIC = 'fixtures/original/models/generic/vehicle.txd';
// By SLOT, never by folder name: the folder carries the car's real name and author, both of which change
// when a car is replaced — and a `new/` candidate is the folder the build is actually using.
const folderOf = new Map(resolveVehicleSources(MODS).sources.map((source) => [source.slot, source.folder]));
const CARS: Record<string, string> = {
  admiral: folderOf.get('admiral') ?? '',
  comet: folderOf.get('comet') ?? '',
};

function fsOf(model: string, dir: string): unknown {
  const files = new Map<string, ArrayBuffer>([
    ['models/generic/vehicle.txd', buf(GENERIC)],
    [`${model}.dff`, buf(join(dir, `${model}.dff`))],
    [`${model}.txd`, buf(join(dir, `${model}.txd`))],
  ]);

  return {
    get: (n: string) => files.get(n.toLowerCase()) ?? null,
    getText: () => null,
    has: (n: string) => files.has(n.toLowerCase()),
    names: [...files.keys()],
  };
}

for (const [model, dir] of Object.entries(CARS)) {
  const built = buildVehicleOsm(fsOf(model, dir) as never, model, { wheelScale: [0.7, 0.7] }) as unknown as {
    bytes?: Uint8Array;
    osm?: Uint8Array;
  };
  const vehicle = readVehicleOsm(model, built.osm ?? built.bytes ?? (built as never));
  const m = vehicle.model as unknown as {
    index16: boolean;
    indices: Uint8Array;
    night: Uint8Array;
    parts: { name: string }[];
    submeshes: { indexCount: number; indexOffset: number; part: number }[];
  };
  const idx = m.index16
    ? new Uint16Array(m.indices.buffer, m.indices.byteOffset, m.indices.byteLength / 2)
    : new Uint32Array(m.indices.buffer, m.indices.byteOffset, m.indices.byteLength / 4);
  console.log(`\n=== ${model} ===`);
  const byPart = new Map<string, Set<number>>();
  for (const submesh of m.submeshes) {
    const part = m.parts[submesh.part]?.name ?? '(body)';
    const set = byPart.get(part) ?? new Set<number>();
    for (let i = submesh.indexOffset; i < submesh.indexOffset + submesh.indexCount; i += 1) {
      set.add(idx[i]);
    }
    byPart.set(part, set);
  }
  for (const [part, verts] of byPart) {
    let sum = 0;
    let below = 0;
    let worst = 255;
    for (const v of verts) {
      const a = m.night[v * 4 + 3];
      sum += a;
      below += a < 100 ? 1 : 0;
      worst = Math.min(worst, a);
    }
    const avg = Math.round(sum / verts.size);
    console.log(
      `${part.padEnd(18)} verts ${String(verts.size).padStart(5)}  avg ${String(avg).padStart(3)}  ` +
        `below100 ${String(below).padStart(4)} (${((100 * below) / verts.size).toFixed(1)}%)  worst ${worst}`,
    );
  }
}
