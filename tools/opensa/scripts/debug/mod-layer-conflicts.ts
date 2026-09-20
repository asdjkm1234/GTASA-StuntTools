/**
 * mod-layer-conflicts — what does the target LAYER of a layered mods folder write on top of what the
 * `common` layer already wrote? (mod-installer plan 011, `docs/contracts/mods.md` §1.)
 *
 * EMPIRICAL, never derived: it compares three states of the same install, so it cannot disagree with the
 * installer the way a re-implementation of the overlay/bake rules would. Produce the two installs first:
 *
 *   npx tsx tools/mod-installer/src/cli.ts --game game-src/<id> --in mods-src/<id>/mods --out <A> --target opensa
 *   npx tsx tools/mod-installer/src/cli.ts --game game-src/<id> --in mods-src/<id>/mods --out <B> --target sa
 *   npx tsx scripts/debug/mod-layer-conflicts.ts game-src/<id> <A> <B>
 *
 * (Swap the two `--target` values to look at the other layer. A is "common alone" only while that game
 * has no layer for A's target — the run's own log line says which layers it applied, so read it.)
 *
 *   common wrote = differs between the base game and A · the other layer wrote = differs between A and B
 *   CONFLICT     = both wrote it — the second layer's version is what ships.
 *
 * Two things it deliberately reports apart, because they are not the same kind of finding:
 * loose FILES (a path both layers write) and ARCHIVE ENTRIES (a name both layers put into `models/*.img`,
 * which no file-level diff can see — the archive is one file and it always differs).
 *
 * What it CANNOT see, and why the id line below matters more than the file list: the installer strips an
 * id definition superseded by a baked IDE, so a row can vanish from a stock `.ide` without any mod
 * shipping that file. Those show up as a changed `.ide` here and as `… id definition(s) … superseded` in
 * the install log — read both, and diff the id sets of the flagged file when one appears.
 */
import { openLazyVer2 } from '@opensa/tool-kit/archive/layout';
import { createHash } from 'node:crypto';
import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

/** The archives compared entry by entry instead of byte by byte. */
const ARCHIVES = ['models/gta3.img', 'models/gta_int.img', 'models/cutscene.img'];

function archiveEntries(path: string): Map<string, string> {
  const entries = new Map<string, string>();
  const archive = statSync(path, { throwIfNoEntry: false }) ? openLazyVer2(path) : null;
  if (!archive) {
    return entries;
  }
  for (const name of archive.names) {
    const bytes = archive.get(name);
    entries.set(name.toLowerCase(), bytes ? createHash('sha1').update(new Uint8Array(bytes)).digest('hex') : '');
  }

  return entries;
}

/** Which mods of `modsRoot`'s layers ship a file with each of these bare names. */
function attribute(modsRoot: string, names: readonly string[]): Map<string, string[]> {
  const hits = new Map<string, string[]>();
  const layers = readdirSync(modsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const layer of layers) {
    for (const mod of readdirSync(join(modsRoot, layer), { withFileTypes: true }).filter((e) => e.isDirectory())) {
      const shipped = baseNames(join(modsRoot, layer, mod.name));
      for (const wanted of names) {
        const merge = shipped.has(`${wanted}.merge`);
        if (shipped.has(wanted) || merge) {
          hits.set(wanted, [...(hits.get(wanted) ?? []), `${layer}/${mod.name}${merge ? ' (.merge)' : ''}`]);
        }
      }
    }
  }

  return hits;
}

/** Every file inside a mod folder, by bare lowercase name — the attribution index. */
function baseNames(dir: string): Set<string> {
  const names = new Set<string>();
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        stack.push(join(current, entry.name));
      } else {
        names.add(entry.name.toLowerCase());
      }
    }
  }

  return names;
}

/**
 * Same size is not the same file, so hash — in CHUNKS. The first cut of this script short-circuited
 * anything over 64 MB to "differs" and duly reported `anim/cuts.img` as written by both layers when
 * nothing had touched it.
 */
function contentDiffers(left: string, right: string): boolean {
  return hashFile(left) !== hashFile(right);
}

function hashFile(path: string): string {
  const digest = createHash('sha1');
  const fd = openSync(path, 'r');
  const buffer = Buffer.alloc(4 * 1024 * 1024);
  try {
    for (let read = readSync(fd, buffer, 0, buffer.length, null); read > 0; ) {
      digest.update(buffer.subarray(0, read));
      read = readSync(fd, buffer, 0, buffer.length, null);
    }
  } finally {
    closeSync(fd);
  }

  return digest.digest('hex');
}

function report(title: string, names: readonly string[], modsRoot: string | undefined): void {
  console.log(`\n${title}: ${names.length}`);
  const hits = modsRoot === undefined ? new Map<string, string[]>() : attribute(modsRoot, names.map(basenameLower));
  for (const name of names) {
    const shipped = hits.get(basenameLower(name)) ?? [];
    console.log(`  ${name}${shipped.length > 0 ? `\n      ${shipped.join('\n      ')}` : ''}`);
  }
}

const basenameLower = (name: string): string => basename(name).toLowerCase();

function walk(root: string): Map<string, number> {
  const files = new Map<string, number>();
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
      } else if (entry.isFile()) {
        files.set(relative(root, path).split('\\').join('/'), statSync(path).size);
      }
    }
  }

  return files;
}

function writtenEntries(from: string, to: string, archive: string): Set<string> {
  const before = archiveEntries(join(from, archive));
  const after = archiveEntries(join(to, archive));

  return new Set([...after].filter(([name, hash]) => before.get(name) !== hash).map(([name]) => name));
}

function writtenFiles(from: string, to: string): Set<string> {
  const before = walk(from);
  const after = walk(to);
  const written = new Set<string>();
  for (const [path, size] of after) {
    const previous = before.get(path);
    if (previous === undefined || previous !== size || contentDiffers(join(from, path), join(to, path))) {
      written.add(path);
    }
  }

  return written;
}

const [base, a, b, modsRoot] = process.argv.slice(2);
if (!base || !a || !b) {
  throw new Error(
    'usage: tsx scripts/debug/mod-layer-conflicts.ts <base game dir> <install A> <install B> [mods root]\n' +
      '       (mods root defaults to mods-src/original/mods — it is only used to name the mods)',
  );
}
const mods = modsRoot ?? 'mods-src/original/mods';

const firstLayer = writtenFiles(base, a);
const secondLayer = writtenFiles(a, b);
console.log(`A wrote ${firstLayer.size} file(s) over the base; B wrote ${secondLayer.size} over A`);
report(
  'FILE CONFLICTS (B writes over what A wrote)',
  [...secondLayer].filter((path) => firstLayer.has(path) && !ARCHIVES.includes(path)).sort(),
  mods,
);

for (const archive of ARCHIVES) {
  const first = writtenEntries(base, a, archive);
  const second = writtenEntries(a, b, archive);
  report(
    `${archive} — ENTRY CONFLICTS (A wrote ${first.size}, B wrote ${second.size})`,
    [...second].filter((name) => first.has(name)).sort(),
    mods,
  );
}
