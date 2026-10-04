import { openArchive } from '@opensa/renderware/archive/img-archive';
import { parseIde } from '@opensa/renderware/parsers/text/ide.parser';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadMapDefsAt, positionalArgs, readBytes } from '../lib/game';

/**
 * **What does the BUILT tree's procobj layer actually carry?** Splits the generated clutter into the three
 * counts that get confused with each other: HD placements (one per placed object), permanent text LOD rows
 * (one per TALL placement — the `linkedHeight` gate), and binary stream records (HD, plus the LOD of every
 * SHORT placement, which rides the stream unlinked). Plan 07's density target was priced against a single
 * "objects placed" number that matches none of them, which is why this exists.
 *
 * Run: `npx tsx scripts/debug/procobj-layer-census.ts [<game-dir>]` (default `build/original/opensa`).
 *
 * Two traps it exists to avoid. **Scope by FILE, never by model id**: the converted species are stock plants
 * and the stock map hand-places thousands of them, so an id-wide count silently folds Rockstar's placements
 * into ours (816 of them on `original`). And the `plotr` areas are SHARED with the tree impostors, so a row
 * count per file is not a procobj count either. Point it at a BUILT tree — `game-src` has no layer yet.
 */

interface LayerCounts {
  hd: number;
  lod: number;
  other: number;
  treeLod: number;
}

/** The generated areas, both generators: `plobj<i>` (procobj) and the shared `plotr<i>` overflow. */
const AREA_FILE = /^(?:plobj|plotr)\d+(?:_stream\d+\.ipl)?$/;

const [dirArg] = positionalArgs();
const root = dirArg ?? join('build', 'original', 'opensa');
const mapsDir = join(root, 'data', 'maps');
if (!existsSync(join(mapsDir, 'lod_procobj.ide'))) {
  console.error(`no data/maps/lod_procobj.ide under ${root} — the procobj stage never ran on this tree`);
  console.error('usage: npx tsx scripts/debug/procobj-layer-census.ts [<game-dir>]');
  process.exit(1);
}

/** The generator's own LOD defs, and (separately) the tree impostors that share the `plotr` overflow areas. */
const procobjLodIds = new Set(parseIde(readFileSync(join(mapsDir, 'lod_procobj.ide'), 'utf8')).map((def) => def.id));
const treeLodIds = new Set(
  existsSync(join(mapsDir, 'lodtrees.ide'))
    ? parseIde(readFileSync(join(mapsDir, 'lodtrees.ide'), 'utf8')).map((def) => def.id)
    : [],
);

/** The converted species, by name — the manifest the generator writes for exactly this lookup. */
const speciesNames = new Set(
  readFileSync(join(mapsDir, 'lod_procobj.models'), 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean),
);

const archive = openArchive(readBytes(join(root, 'models', 'gta3.img')));
const { catalog, instances } = loadMapDefsAt(root, archive);
const speciesIds = new Set(
  [...catalog.values()].filter((def) => speciesNames.has(def.modelName.toLowerCase())).map((def) => def.id),
);
console.log(`procobj layer census — ${root}`);
console.log(`  species converted: ${speciesNames.size} names → ${speciesIds.size} ids in the catalog`);
console.log(`  LOD defs: ${procobjLodIds.size} (lod_procobj.ide), tree impostors: ${treeLodIds.size} (lodtrees.ide)`);

const text: LayerCounts = { hd: 0, lod: 0, other: 0, treeLod: 0 };
const stream: LayerCounts = { hd: 0, lod: 0, other: 0, treeLod: 0 };
const byFile = new Map<string, LayerCounts>();
let linkedHd = 0;
let unlinkedHd = 0;
/** Placements of the SAME species outside the generated areas — Rockstar's, and untouched by any density knob. */
let elsewhere = 0;

for (const instance of instances) {
  if (!AREA_FILE.test(instance.from)) {
    elsewhere += speciesIds.has(instance.id) ? 1 : 0;
    continue;
  }
  const isStream = instance.from.endsWith('.ipl');
  const counts = byFile.get(instance.from) ?? { hd: 0, lod: 0, other: 0, treeLod: 0 };
  for (const bucket of [isStream ? stream : text, counts]) {
    if (speciesIds.has(instance.id)) {
      bucket.hd += 1;
    } else if (procobjLodIds.has(instance.id)) {
      bucket.lod += 1;
    } else if (treeLodIds.has(instance.id)) {
      bucket.treeLod += 1;
    } else {
      bucket.other += 1;
    }
  }
  byFile.set(instance.from, counts);
  if (speciesIds.has(instance.id)) {
    if (instance.lod >= 0) {
      linkedHd += 1;
    } else {
      unlinkedHd += 1;
    }
  }
}

console.log('\ngenerated text IPLs (the permanent rows — one gta.dat slot each):');
for (const [file, counts] of [...byFile].sort(([a], [b]) => a.localeCompare(b))) {
  if (file.endsWith('.ipl')) {
    continue;
  }
  const total = counts.hd + counts.lod + counts.other + counts.treeLod;
  console.log(
    `  ${file.padEnd(8)} rows ${String(total).padStart(5)} — procobj LOD ${String(counts.lod).padStart(5)}, tree impostor ${String(counts.treeLod).padStart(4)}, other ${counts.other}`,
  );
}
console.log(`  permanent procobj LOD rows: ${text.lod}   (tree impostor rows in the same areas: ${text.treeLod})`);

const streamFiles = [...byFile.keys()].filter((file) => file.endsWith('.ipl')).length;
console.log(`\ngenerated binary streams inside gta3.img (${streamFiles} files):`);
console.log(`  HD records:  ${stream.hd}`);
console.log(`  LOD records: ${stream.lod}   (the LOD of every SHORT placement, unlinked)`);
console.log(`  other:       ${stream.other + stream.treeLod}`);
console.log(`  total:       ${stream.hd + stream.lod + stream.other + stream.treeLod}`);

const placed = text.hd + stream.hd;
console.log('\nthe number a density plan should quote:');
console.log(`  placed procobj objects (HD): ${placed}`);
console.log(`    linked   (permanent text LOD row): ${linkedHd}`);
console.log(`    unlinked (LOD rides the stream):   ${unlinkedHd}`);
console.log(`  objects per permanent text row: ${text.lod > 0 ? (placed / text.lod).toFixed(2) : 'n/a'}`);
console.log(`  stock placements of the same species, outside these areas: ${elsewhere}`);

/** Every placement owes exactly one LOD, in exactly one home — if these disagree, the counts above are wrong. */
console.log('\nself-check:');
console.log(
  `  linked HD (${linkedHd}) == permanent LOD rows (${text.lod}): ${linkedHd === text.lod ? 'ok' : 'MISMATCH'}`,
);
console.log(
  `  unlinked HD (${unlinkedHd}) == stream LOD records (${stream.lod}): ${unlinkedHd === stream.lod ? 'ok' : 'MISMATCH'}`,
);
if (text.hd > 0) {
  console.log(`  NOTE: ${text.hd} HD instances sit in a TEXT ipl — the layer is meant to keep them in streams`);
}
