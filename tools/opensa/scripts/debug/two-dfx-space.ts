import { extract2dfxEntries } from '@opensa/rw-codec/dff';

import type { PlacedInstance } from '../lib/game';

import { gameArg, loadMapDefs, openGameArchive } from '../lib/game';

/**
 * Decide, per 2dfx TYPE, whether its authored position is MODEL-LOCAL or WORLD — the fact that picks the
 * transform a LOD carry must apply, and the one whose absence would have thrown every roadsign plate a
 * kilometre from its post (plan 100/00). Companion to `two-dfx-census.ts`, which counts entries but says
 * nothing about the space they are written in.
 *
 * The discriminator is a comparison, not a threshold: for every entry, `local` is how far the position sits
 * from the model's own origin and `world` is how far it sits from the NEAREST placement of that model. A
 * model-local entry is a few units from the origin and kilometres from nothing in particular; a world-space
 * one is the other way round. A model no IPL places cannot be judged and is reported as `unplaced`.
 *
 * Run: `npx tsx scripts/debug/two-dfx-space.ts [--game original]`.
 */

/** Every type id a 2dfx entry can carry — `extract2dfxEntries` drops particles unless asked for them. */
const ALL_TYPES = new Set(Array.from({ length: 32 }, (_, index) => index));
/** gtamods' names for the types, for a readable table. */
const TYPE_NAMES = new Map([
  [0, 'light'],
  [1, 'particle'],
  [2, 'unknown'],
  [3, 'ped attractor'],
  [4, 'sun glare'],
  [6, 'enter/exit'],
  [7, 'roadsign'],
  [8, 'trigger point'],
  [9, 'cover point'],
  [10, 'escalator'],
]);

interface TypeTally {
  /** One readable line per verdict, for eyeballing the extremes. */
  examples: string[];
  local: number;
  unplaced: number;
  world: number;
}

const game = gameArg();
const archive = openGameArchive(game);
const { catalog, instances } = loadMapDefs(game, archive);

const placements = new Map<string, PlacedInstance[]>();
const nameById = new Map<number, string>();
for (const [id, def] of catalog) {
  nameById.set(id, def.modelName.toLowerCase());
}
for (const instance of instances) {
  const model = nameById.get(instance.id);
  if (model) {
    placements.set(model, [...(placements.get(model) ?? []), instance]);
  }
}

const tallies = new Map<number, TypeTally>();
let scanned = 0;
let failed = 0;
for (const name of archive.names) {
  if (!name.toLowerCase().endsWith('.dff')) {
    continue;
  }
  const buffer = archive.get(name);
  if (!buffer) {
    continue;
  }
  scanned += 1;
  let found: ReturnType<typeof extract2dfxEntries>;
  try {
    found = extract2dfxEntries(new Uint8Array(buffer), ALL_TYPES);
  } catch {
    failed += 1; // a DFF our chunk reader refuses — counted, never silently skipped
    continue;
  }
  const model = name.toLowerCase().replace(/\.dff$/, '');
  const placed = placements.get(model) ?? [];
  for (const entry of found) {
    tally(entry.type, model, entry.position, placed);
  }
}

console.log(`\n2dfx coordinate space — game-src/${game}: ${scanned} models scanned, ${failed} unreadable\n`);
console.log('  type                 model-local     world   unplaced   verdict');
for (const [type, counts] of [...tallies.entries()].sort((a, b) => a[0] - b[0])) {
  const label = `${String(type).padStart(2)} ${(TYPE_NAMES.get(type) ?? '?').padEnd(15)}`;
  const judged = counts.local + counts.world;
  let verdict = 'UNDECIDABLE (nothing placed)';
  if (judged > 0) {
    verdict = counts.world === judged ? 'world' : counts.local === judged ? 'model' : 'MIXED — read the examples';
  }
  console.log(
    `  ${label} ${String(counts.local).padStart(11)} ${String(counts.world).padStart(9)} ` +
      `${String(counts.unplaced).padStart(10)}   ${verdict}`,
  );
  for (const example of counts.examples) {
    console.log(`      ${example}`);
  }
}

/** Score one entry against its model's placements and record the verdict. */
function tally(type: number, model: string, position: readonly number[], placed: PlacedInstance[]): void {
  const counts = tallies.get(type) ?? { examples: [], local: 0, unplaced: 0, world: 0 };
  tallies.set(type, counts);
  if (placed.length === 0) {
    counts.unplaced += 1;

    return;
  }
  const local = Math.hypot(position[0], position[1], position[2]);
  const world = Math.min(
    ...placed.map((instance) =>
      Math.hypot(
        position[0] - instance.position[0],
        position[1] - instance.position[1],
        position[2] - instance.position[2],
      ),
    ),
  );
  const isWorld = world < local;
  counts[isWorld ? 'world' : 'local'] += 1;
  if (counts.examples.length < 2) {
    counts.examples.push(
      `${model} @ (${position.map((value) => value.toFixed(1)).join(', ')}) ` +
        `local ${local.toFixed(1)} / nearest placement ${world.toFixed(1)} → ${isWorld ? 'world' : 'model'}`,
    );
  }
}
