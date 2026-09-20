import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';

/**
 * Is this game archive still the game's, or has a converter already rewritten it?
 *
 * `opensa-pack` copies `--game` into `--out` and then REWRITES the copy's archives — it deletes the model
 * entries it converted and inserts `.osm` bundles in their place. When `--out` and `--game` resolve to the
 * same directory (two symlinks into one folder — the 2026-08-09 phone incident), that rewrite lands on the
 * SOURCE, and nothing says so: the tree still boots, the next convert just has less to convert. The `.osm`
 * count below is the fingerprint, and it cannot appear in a stock archive.
 *
 * Run: `npx tsx scripts/debug/img-census.ts <path/to/gta3.img>`
 *
 * Reads ONLY the VER2 directory (8 bytes + 32 per entry), not the gigabyte behind it, so it is cheap enough
 * to run on the phone against the real archive.
 */
const path = process.argv[2] ?? 'game-src/original/models/gta3.img';
if (!existsSync(path)) {
  console.error(`no archive at ${path}`);
  process.exit(2);
}

const ENTRY = 32;
const NAME_OFFSET = 8;
const NAME_BYTES = 24;

const file = openSync(path, 'r');
const header = new Uint8Array(8);
readSync(file, header, 0, 8, 0);
const magic = new TextDecoder().decode(header.subarray(0, 4));
if (magic !== 'VER2') {
  closeSync(file);
  console.error(`${path} is not a VER2 archive (magic '${magic}') — an older IMG keeps its directory in a .dir file`);
  process.exit(2);
}

const count = new DataView(header.buffer).getUint32(4, true);
const directory = new Uint8Array(count * ENTRY);
readSync(file, directory, 0, directory.length, 8);
closeSync(file);

const decoder = new TextDecoder();
const byExtension = new Map<string, number>();
for (let index = 0; index < count; index += 1) {
  const raw = directory.subarray(index * ENTRY + NAME_OFFSET, index * ENTRY + NAME_OFFSET + NAME_BYTES);
  const end = raw.indexOf(0);
  const name = decoder.decode(end < 0 ? raw : raw.subarray(0, end)).toLowerCase();
  const dot = name.lastIndexOf('.');
  const extension = dot < 0 ? '(none)' : name.slice(dot);
  byExtension.set(extension, (byExtension.get(extension) ?? 0) + 1);
}

const sizeMb = (statSync(path).size / 1048576).toFixed(0);
console.log(`${path}: ${count} entries, ${sizeMb} MB`);
for (const [extension, entries] of [...byExtension].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${extension.padEnd(8)} ${entries}`);
}

const bundles = byExtension.get('.osm') ?? 0;
console.log(
  bundles > 0
    ? `\nREWRITTEN: ${bundles} .osm bundles — opensa-pack has written into this archive, so it is no longer a ` +
        `clean game copy. Restore it from a pristine install before converting anything off it.`
    : '\nclean: no .osm bundles — nothing from our pipeline has been written into this archive.',
);
