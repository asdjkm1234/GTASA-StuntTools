import { argValue, fromCwd } from '@opensa/tool-kit/cli';
import { readFileSync, writeFileSync } from 'node:fs';

import {
  findArchivesWithEntry,
  listGameArchives,
  patchedEntries,
  patchImgEntry,
  readImgEntry,
  restoreImgEntry,
} from '../lib/img-patch';

/**
 * Swap ONE entry of a built game's IMG in place — the field A/B instrument that costs seconds instead of a
 * ~10 min rebuild (open-issue `sa-lod-visibility-budget.md`, round 8). Appends past the end of the archive
 * and repoints the directory; the original bytes stay, and `restore` puts the record back (ledger in
 * `<img>.patches.json`). See `scripts/lib/img-patch.ts` for why it never writes in place.
 *
 * Run (the archive is resolved from the tree — every archive carrying the name is patched):
 *   npx tsx scripts/debug/img-patch.ts set     <name> <file.dff> --game build/bisect-nomods/sa
 *   npx tsx scripts/debug/img-patch.ts restore <name>            --game build/bisect-nomods/sa
 *   npx tsx scripts/debug/img-patch.ts get     <name> <out.dff>  --game build/bisect-nomods/sa
 *   npx tsx scripts/debug/img-patch.ts status                    --game build/bisect-nomods/sa
 * `--img <path>` names one archive explicitly instead of `--game`. Entry names are case-insensitive.
 */
function archivesFor(name: string): string[] {
  const img = argValue('--img');
  if (img) return [fromCwd(img)];
  const game = argValue('--game');
  if (!game) throw new Error('need --game <built game dir> or --img <archive>');
  const found = findArchivesWithEntry(fromCwd(game), name);
  if (found.length === 0) throw new Error(`${name} is in no archive of ${game}`);

  return found;
}

function get(name: string, file: string): void {
  const [img] = archivesFor(name);
  writeFileSync(fromCwd(file), readImgEntry(img, name));
  console.log(`${name} ← ${img} → ${file}`);
}

function main(): void {
  const [command, name, file] = positionals();
  switch (command) {
    case 'get':
      if (!name || !file) throw new Error('usage: get <name> <out file>');
      get(name, file);
      break;
    case 'restore':
      if (!name) throw new Error('usage: restore <name>');
      restore(name);
      break;
    case 'set':
      if (!name || !file) throw new Error('usage: set <name> <file>');
      set(name, file);
      break;
    case 'status':
      status();
      break;
    default:
      throw new Error('usage: img-patch.ts <set|restore|get|status> … (--game <dir> | --img <path>)');
  }
}

/** Arguments that are neither a `--flag` nor a flag's value. */
function positionals(): string[] {
  const flagValues = new Set([argValue('--game'), argValue('--img')]);

  return process.argv.slice(2).filter((arg) => !arg.startsWith('--') && !flagValues.has(arg));
}

function restore(name: string): void {
  for (const img of archivesFor(name)) {
    console.log(`${img}: ${name} ${restoreImgEntry(img, name) ? 'restored' : 'was not patched'}`);
  }
}

function set(name: string, file: string): void {
  const data = new Uint8Array(readFileSync(fromCwd(file)));
  for (const img of archivesFor(name)) {
    const { appendedAt } = patchImgEntry(img, name, data);
    console.log(`${img}: ${name} ← ${file} (${data.length} B, appended at ${appendedAt})`);
  }
}

function status(): void {
  const game = argValue('--game');
  const img = argValue('--img');
  if (!img && !game) throw new Error('need --game <built game dir> or --img <archive>');
  for (const path of img ? [fromCwd(img)] : listGameArchives(fromCwd(game as string))) {
    const names = Object.keys(patchedEntries(path));
    console.log(`${path}: ${names.length} patched${names.length ? ` — ${names.join(', ')}` : ''}`);
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
