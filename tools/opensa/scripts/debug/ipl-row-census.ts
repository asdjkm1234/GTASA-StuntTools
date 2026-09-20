import { parseGtaDat } from '@opensa/renderware/parsers/text/gta-dat.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { positionalArgs } from '../lib/game';

/**
 * **What does this game cost against SA's permanent-placement ceilings?** Counts every permanent text-IPL
 * `inst` row and every gta.dat IPL slot that carries one, including anything modloader adds or overrides —
 * the two numbers that decide whether a map-content plan can ship, and the ones plan 07 spent a fortnight
 * guessing at. Points at a BUILT tree or at a real modded install; both were needed to settle the question.
 * Run: `npx tsx scripts/debug/ipl-row-census.ts [<game-dir>]` (default `build/original/opensa`).
 *
 * The ceilings it reports against are STOCK. A real install may lift them — the reference one sets OLA's
 * `EntitiesPerIpl`/`EntityIpl` to `unlimited`, so its 9 627-row file is fine and this script's per-file
 * warning is noise there. Read `docs/gta-sa-original/reference-install.md` before acting on a red line.
 */

/** Stock ceilings + the pmb build guards that sit under them (`docs/restrictions/sa-target.md`). */
const INT16_CEILING = 32_767;
const ROW_GUARD = 30_000;
const SLOT_CEILING = 40;
const SLOT_GUARD = 39;
/** `gpLoadedBuildings` — text rows + boot-loaded binary streams of ONE file, through a 4096-slot buffer. */
const PER_FILE_BUFFER = 4_096;

interface Counted {
  readonly path: string;
  readonly rows: number;
  readonly source: 'gta.dat' | 'modloader';
}

const [dirArg] = positionalArgs();
const root = dirArg ?? join('build', 'original', 'opensa');
if (!existsSync(join(root, 'data', 'gta.dat'))) {
  console.error(`no data/gta.dat under ${root}`);
  console.error('usage: npx tsx scripts/debug/ipl-row-census.ts [<game-dir>]');
  process.exit(1);
}

/** Case-insensitive basename index over the trees an install actually reads. */
function indexFiles(...roots: readonly string[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        const key = entry.toLowerCase();
        index.set(key, [...(index.get(key) ?? []), full]);
      }
    }
  };
  for (const dir of roots) {
    if (existsSync(dir)) {
      walk(dir);
    }
  }

  return index;
}

const modloaderDir = join(root, 'modloader');
const index = indexFiles(join(root, 'data'), modloaderDir);

/** Modloader wins over `data/` — the merged tree is what the game loads, never the source one. */
function resolve(declared: string): null | string {
  const base = declared.replace(/\\/g, '/').split('/').pop()?.toLowerCase();
  const candidates = base ? (index.get(base) ?? []) : [];

  return candidates.find((c) => c.startsWith(modloaderDir)) ?? candidates[0] ?? null;
}

function rowsIn(file: string): number {
  return parseIpl(readFileSync(file, 'latin1')).length;
}

const counted: Counted[] = [];
const unresolved: string[] = [];

for (const declared of parseGtaDat(readFileSync(join(root, 'data', 'gta.dat'), 'utf8')).ipl) {
  const file = resolve(declared);
  if (!file) {
    unresolved.push(declared);
    continue;
  }
  counted.push({ path: file, rows: rowsIn(file), source: 'gta.dat' });
}

/** Modloader `loader.txt` files add IPL slots the gta.dat never names — the reference install adds six. */
for (const [name, paths] of index) {
  if (name !== 'loader.txt') {
    continue;
  }
  for (const loader of paths) {
    for (const line of readFileSync(loader, 'latin1').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.toLowerCase().startsWith('ipl ')) {
        continue;
      }
      const file = resolve(trimmed.slice(4).trim());
      if (file) {
        counted.push({ path: file, rows: rowsIn(file), source: 'modloader' });
      }
    }
  }
}

const withRows = counted.filter((c) => c.rows > 0);
const totalRows = withRows.reduce((sum, c) => sum + c.rows, 0);
const fromModloader = withRows.filter((c) => c.source === 'modloader').reduce((sum, c) => sum + c.rows, 0);

console.log(`game dir: ${root}`);
console.log(`IPL files counted: ${counted.length} (gta.dat + modloader) — ${withRows.length} carry inst rows`);
console.log('Only files carrying inst rows take an IplEntityIndexArrays slot; an inst-less IPL costs none.');
console.log('');
console.log(`permanent text inst rows : ${totalRows} / ${INT16_CEILING} int16 ceiling (pmb guard ${ROW_GUARD})`);
console.log(`  from gta.dat           : ${totalRows - fromModloader}`);
console.log(`  added by modloader     : ${fromModloader}`);
console.log(`IPL slots carrying inst  : ${withRows.length} / ${SLOT_CEILING} (pmb guard ${SLOT_GUARD})`);
console.log('');
console.log('largest files:');
for (const entry of [...withRows].sort((a, b) => b.rows - a.rows).slice(0, 10)) {
  const over = entry.rows > PER_FILE_BUFFER ? `  <- over the stock ${PER_FILE_BUFFER}-row buffer` : '';
  console.log(`  ${String(entry.rows).padStart(6)}  ${relative(root, entry.path)}${over}`);
}

if (unresolved.length > 0) {
  console.log('');
  console.log(`unresolved gta.dat IPL lines (${unresolved.length}): ${unresolved.join(', ')}`);
}

const breaches = [
  totalRows > ROW_GUARD ? `rows ${totalRows} over the ${ROW_GUARD} guard` : null,
  withRows.length > SLOT_GUARD ? `slots ${withRows.length} over the ${SLOT_GUARD} guard` : null,
].filter((x): x is string => x !== null);

console.log('');
console.log(
  breaches.length > 0
    ? `STOCK BUDGET BREACHED: ${breaches.join('; ')} — safe only on an install that lifts it`
    : 'within the stock budget',
);
