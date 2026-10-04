/**
 * Which vehicles actually AUTHOR lamps — the evidence the engine derives its night lighting from
 * (plan 098/11). Per model: the `headlights`/`taillights` dummies (real / at the model ORIGIN, which is
 * SA's way of saying "no lamp here" / absent), how many submeshes carry a head or tail lamp material,
 * and how many carry ImVehFt `ivflights` geometry — a convention we do NOT read, so a model whose lamps
 * live only there looks lampless to us.
 *
 * Run it after installing custom cars: a mod that authors neither a dummy nor a lamp material gets no
 * beam, pool light or corona, and this is where you see that before the field does.
 *
 *   npx tsx scripts/debug/lamp-census.ts                                  # the BUILT archive (default)
 *   npx tsx scripts/debug/lamp-census.ts game-src/original/models/gta3.img # stock, for comparison
 *
 * Reads `.osm` (a built archive) and `.dff` (a stock one) alike.
 */
import { decodeOsm, osmSection, OsmSectionTag } from '@opensa/engine-formats';
import { openArchive } from '@opensa/renderware/archive/img-archive';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { buildVehicleModel } from '@opensa/renderware/vehicle/build-vehicle-model';
import { VehicleTextures } from '@opensa/renderware/vehicle/textures';
import { readFileSync } from 'node:fs';

const IMG = process.argv[2] ?? 'build/original/opensa/models/gta3.img';
const ZERO = 1e-6;

interface Fixture {
  dummies: { name: string; position: number[] }[];
  parts?: { name: string }[];
  submeshes: { lamp?: null | string; part?: number }[];
  wheels?: unknown[];
}

interface Row {
  head: State;
  headMat: number;
  ivf: number;
  name: string;
  tail: State;
  tailMat: number;
}
type State = 'absent' | 'ok' | 'zero';

const archive = openArchive(new Uint8Array(readFileSync(IMG)));
const rows: Row[] = [];

for (const entryName of archive.names) {
  const isOsm = entryName.toLowerCase().endsWith('.osm');
  if (!isOsm && !entryName.toLowerCase().endsWith('.dff')) {
    continue;
  }
  const bytes = archive.get(entryName);
  if (!bytes) {
    continue;
  }
  let fixture: Fixture;
  if (isOsm) {
    const desc = osmSection(decodeOsm(new Uint8Array(bytes)), OsmSectionTag.DESC);
    if (!desc) {
      continue;
    }
    fixture = JSON.parse(new TextDecoder().decode(desc)) as Fixture;
  } else {
    try {
      const model = buildVehicleModel(parseDff(bytes), new VehicleTextures([]));
      fixture = model as unknown as Fixture;
    } catch {
      continue;
    }
  }
  if (!fixture.wheels || fixture.wheels.length === 0) {
    continue; // vehicles only
  }
  const state = (kind: string): State => {
    const dummy = fixture.dummies.find((candidate) => candidate.name === kind);
    if (!dummy) {
      return 'absent';
    }

    return dummy.position.every((value) => Math.abs(value) < ZERO) ? 'zero' : 'ok';
  };
  const ivfParts = new Set(
    (fixture.parts ?? []).map((part, index) => (/^ivf/i.test(part.name) ? index : -1)).filter((i) => i >= 0),
  );
  rows.push({
    head: state('headlights'),
    headMat: fixture.submeshes.filter((submesh) => submesh.lamp === 'head').length,
    ivf: fixture.submeshes.filter((submesh) => submesh.part !== undefined && ivfParts.has(submesh.part)).length,
    name: entryName.replace(/\.(?:osm|dff)$/i, ''),
    tail: state('taillights'),
    tailMat: fixture.submeshes.filter((submesh) => submesh.lamp === 'tail').length,
  });
}

const count = (predicate: (row: Row) => boolean): number => rows.filter(predicate).length;
console.log(`${rows.length} vehicle models in the BUILT archive`);
for (const kind of ['head', 'tail'] as const) {
  const mat = kind === 'head' ? 'headMat' : 'tailMat';
  console.log(
    `${kind}: dummy ok ${count((row) => row[kind] === 'ok')} · ZERO ${count((row) => row[kind] === 'zero')} · ` +
      `absent ${count((row) => row[kind] === 'absent')}  |  no ${kind} material: ${count((row) => row[mat] === 0)}`,
  );
}
console.log(
  `\nno lamp material at ALL: ${count((row) => row.headMat === 0 && row.tailMat === 0)}` +
    ` · no usable dummy at all: ${count((row) => row.head !== 'ok' && row.tail !== 'ok')}`,
);
const odd = rows.filter((row) => row.head !== 'ok' || row.tail !== 'ok' || row.headMat === 0 || row.tailMat === 0);
console.log(`\n-- every model that is NOT (both dummies real AND both lamp kinds present): ${odd.length} --`);
for (const row of odd) {
  console.log(
    `  ${row.name.padEnd(12)} head=${row.head.padEnd(6)} mat=${String(row.headMat).padStart(2)}   ` +
      `tail=${row.tail.padEnd(6)} mat=${String(row.tailMat).padStart(2)}`,
  );
}

const noMat = rows.filter((row) => row.headMat === 0 && row.tailMat === 0);
console.log(
  `\nNO standard lamp material: ${noMat.length} — of which WITH ivflights: ${noMat.filter((r) => r.ivf > 0).length}`,
);
console.log(`models carrying ivflights at all: ${rows.filter((row) => row.ivf > 0).length}`);
for (const row of rows.filter((r) => r.ivf > 0)) {
  console.log(
    `  ivf ${String(row.ivf).padStart(3)}  ${row.name.padEnd(12)} headMat=${row.headMat} tailMat=${row.tailMat} head=${row.head} tail=${row.tail}`,
  );
}
