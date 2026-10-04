import { parseDff } from '@opensa/renderware/parsers/binary/dff';

import { gameArg, openGameArchive, positionalArgs } from '../lib/game';

/**
 * Which models wear a license plate, and how (plan 082). Sweeps every DFF in a game's archives for
 * materials textured `carplate` (the generated text strip) or `carpback` (the city background), and
 * reports the per-model breakdown: which geometries carry them, triangle/vertex counts, and whether
 * the model has both faces or only one.
 *
 * Answers "which vehicles get plates" with a number instead of "most cars" — the census plan 082/02
 * scopes its converter split with, and the list plan 082/04 verifies damage against. Naming a model
 * limits the sweep to it and prints the plate quads' geometry indices.
 *
 * Run: `npx tsx scripts/debug/plate-census.ts [model ...] [--game original]`.
 */
const PLATE = new Set(['carpback', 'carplate']);

interface PlateModel {
  readonly faces: string[];
  readonly model: string;
  readonly names: Set<string>;
  readonly tris: number;
}

const archive = openGameArchive(gameArg());
const only = new Set(positionalArgs().map((name) => name.toLowerCase()));
const entries = archive.names.filter(
  (name) => name.endsWith('.dff') && (only.size === 0 || only.has(name.replace('.dff', ''))),
);

const plated: PlateModel[] = [];
const damPlates = new Set<string>();
const lodPlates = new Set<string>();
/** A plate face on a geometry no atomic references — the "standalone plate atomic" edge case (082/02). */
const orphanPlates = new Set<string>();
let scanned = 0;
let unparseable = 0;

for (const entry of entries) {
  const data = archive.get(entry);
  if (!data) {
    continue;
  }
  let clump;
  try {
    clump = parseDff(data);
  } catch {
    unparseable += 1;
    continue;
  }
  scanned += 1;
  const names = new Set<string>();
  const faces: string[] = [];
  let tris = 0;
  // Which FRAME each geometry hangs on — a plate on a `_dam` twin rides the damage swap for free, one on a
  // `_vlo` mesh shows at LOD distance, and one on an atomic named neither is ordinary body geometry.
  const frameOf = new Map<number, string>();
  for (const atomic of clump.atomics) {
    frameOf.set(atomic.geometryIndex, clump.frames[atomic.frameIndex]?.name.trim().toLowerCase() ?? '');
  }
  for (const [gi, geometry] of clump.geometries.entries()) {
    for (const [mi, material] of geometry.materials.entries()) {
      const texture = material.texture?.name?.toLowerCase() ?? '';
      if (!PLATE.has(texture)) {
        continue;
      }
      names.add(texture);
      const verts = new Set<number>();
      let matTris = 0;
      for (const triangle of geometry.triangles) {
        if (triangle.materialIndex === mi) {
          matTris += 1;
          verts.add(triangle.a);
          verts.add(triangle.b);
          verts.add(triangle.c);
        }
      }
      tris += matTris;
      const frame = frameOf.get(gi) ?? '(no atomic)';
      faces.push(`g${gi}/m${mi} ${texture} tris=${matTris} verts=${verts.size} frame=${frame}`);
      if (frame.endsWith('_dam')) {
        damPlates.add(entry);
      }
      if (frame.endsWith('_vlo')) {
        lodPlates.add(entry);
      }
      if (frame === '(no atomic)') {
        orphanPlates.add(entry);
      }
    }
  }
  if (names.size > 0) {
    plated.push({ faces, model: entry.replace('.dff', ''), names, tris });
  }
}

const both = plated.filter((row) => row.names.size === 2);
console.log(`scanned ${scanned} dff (${unparseable} unparseable) — ${plated.length} carry a plate material`);
console.log(`  both carplate+carpback: ${both.length} | only one: ${plated.length - both.length}`);
console.log(
  `  plate on a _dam twin: ${damPlates.size} | on a _vlo LOD: ${lodPlates.size} | on a geometry no atomic references: ${orphanPlates.size}\n`,
);

for (const row of plated) {
  if (only.size > 0 || plated.length <= 20) {
    console.log(`${row.model}: ${[...row.names].sort().join('+')} tris=${row.tris}`);
    for (const face of row.faces) {
      console.log(`    ${face}`);
    }
  }
}
if (only.size === 0) {
  console.log(`\nmodels: ${plated.map((row) => row.model).join(' ')}`);
  const partial = plated.filter((row) => row.names.size === 1);
  console.log(`one face only: ${partial.map((row) => `${row.model}(${[...row.names][0]})`).join(' ')}`);
}
