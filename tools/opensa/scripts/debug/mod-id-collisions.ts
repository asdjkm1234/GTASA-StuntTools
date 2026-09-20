/**
 * mod-id-collisions — which model IDs are claimed by more than one source, across the stock game and
 * EVERY mod of a game's `mods-src` tree (both layers of a layered folder, `docs/contracts/mods.md` §1).
 *
 *   npx tsx scripts/debug/mod-id-collisions.ts [game id = original]
 *
 * **The disagreement is what matters, not the duplicate.** Two sources claiming one id with the SAME model
 * name are a deliberate redefinition (an interiors mod re-flagging a stock object, say). Two sources
 * claiming it with DIFFERENT names is the dangerous kind: mod-installer's supersede rule keeps the baked
 * definition and strips the other, so every placement of that id then draws a model nobody placed there.
 * Found exactly that on `original` (2026-08-15): a train mod's traffic-light masts on ids 18631/18632,
 * which Map Fixes Pack had already given to two neon objects — and the neon's own placements survived,
 * pointing at the masts.
 *
 * Static: it reads `.ide` / `.IDE` / `.ide.merge` files and needs no install, which is why it can be run
 * before a build rather than after one. For what the layers do to each OTHER at install time (files and
 * archive entries), see `mod-layer-conflicts.ts`.
 *
 * **It reads the FOLDER, not `gta.dat`'s load list**, so a stock file the game never loads counts here. On
 * a clean `original` that is a baseline of SEVEN collisions (16700–16708) between the loaded `countn2.ide`
 * and the dead `leveldes.ide` — see `docs/gta-sa-original/unloaded-map-data.md`. What this scan hunts is
 * the eighth.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

interface Claim {
  name: string;
  source: string;
}

/**
 * The sections whose rows are `<id>, <model>, …`. A `2dfx` row is `<id>, x, y, z, …`, so parsing every
 * numbered row makes a float look like a model name — that alone reported 37 collisions that were nothing
 * but one file's own effect entries.
 */
const MODEL_SECTIONS = new Set(['anim', 'cars', 'hier', 'objs', 'peds', 'tobj', 'weap']);

/** `<id>, <name>, …` rows of an IDE, or the `add to` rows of an `.ide.merge` (a `remove from` block is not a claim). */
function claims(path: string): { id: number; name: string }[] {
  const rows: { id: number; name: string }[] = [];
  let section = '';
  let removing = false;
  for (const line of readFileSync(path, 'latin1').split(/\r?\n/)) {
    const trimmed = line.trim();
    const directive = /^(remove from|add to|replace in)\s+"([^"]+)"/i.exec(trimmed);
    if (directive) {
      removing = /^remove from/i.test(directive[1]);
      section = directive[2].toLowerCase();
      continue;
    }
    if (/^\w+$/.test(trimmed)) {
      section = trimmed.toLowerCase() === 'end' ? '' : trimmed.toLowerCase();
      continue;
    }
    const row = /^(\d{1,5})\s*,\s*([^,\s]+)\s*,/.exec(trimmed);
    if (row && !removing && !trimmed.startsWith('-') && MODEL_SECTIONS.has(section)) {
      rows.push({ id: Number(row[1]), name: row[2].toLowerCase() });
    }
  }

  return rows;
}

function idFiles(root: string): string[] {
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
      } else if (/\.ide(?:\.merge)?$/i.test(entry.name)) {
        files.push(path);
      }
    }
  }

  return files;
}

const game = process.argv[2] ?? 'original';
const modsRoot = `mods-src/${game}/mods`;
const byId = new Map<number, Claim[]>();

function collect(files: readonly string[], label: (path: string) => string): void {
  for (const file of files) {
    for (const { id, name } of claims(file)) {
      const claimed = byId.get(id) ?? [];
      const source = label(file);
      if (!claimed.some((claim) => claim.name === name && claim.source === source)) {
        byId.set(id, [...claimed, { name, source }]);
      }
    }
  }
}

collect(idFiles(join(`game-src/${game}`, 'data')), () => 'STOCK');
// One level of grouping (a layer) or none (a flat tree) — walk whatever holds the mod folders.
for (const group of readdirSync(modsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
  const groupPath = join(modsRoot, group.name);
  const children = readdirSync(groupPath, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  const mods = ['common', 'opensa', 'sa'].includes(group.name.toLowerCase())
    ? children.map((mod) => join(groupPath, mod.name))
    : [groupPath];
  for (const mod of mods) {
    collect(idFiles(mod), (path) => `${relative(modsRoot, mod)} :: ${relative(mod, path)}`);
  }
}

const collisions = [...byId.entries()]
  .filter(([, list]) => new Set(list.map((claim) => claim.name)).size > 1)
  .sort(([left], [right]) => left - right);
const modClaims = [...byId.values()].flat().filter((claim) => claim.source !== 'STOCK');

console.log(
  `${byId.size} id(s) claimed — ${modClaims.length} claim(s) from ` +
    `${new Set(modClaims.map((claim) => claim.source.split(' :: ')[0])).size} mod(s).\n` +
    `ids whose claimants DISAGREE on the model: ${collisions.length}\n`,
);
for (const [id, list] of collisions) {
  console.log(`id ${id}`);
  for (const claim of list) {
    console.log(`    ${claim.name.padEnd(24)} ${claim.source}`);
  }
}
