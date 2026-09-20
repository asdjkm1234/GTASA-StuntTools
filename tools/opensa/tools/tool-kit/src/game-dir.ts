import { cpSync, existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, parse, resolve, sep } from 'node:path';

/**
 * The chain's `--game` in / `--out` out convention (plan opensa-pack/003): every tool copies the whole game
 * dir into `--out` and mutates the COPY, so each stage hands the next a complete, bootable game tree
 * (`perfect-map-builder/src/pipeline.ts` relies on exactly that).
 */

/**
 * Wipe `--out` and mirror the game dir into it. Guard the paths with {@link guardOut} first.
 *
 * **`dereference` is what keeps `--out` a real tree.** With the default, a SYMLINKED `--game` is copied as a
 * symlink — so `--out` becomes a second name for the game dir, and every stage after this one (the archive
 * rewrite above all) writes into the source. That is not theory: on 2026-08-10 the guard passed on two
 * genuinely different paths, and then this copy created the very aliasing the guard exists to prevent —
 * the run rewrote the game archives that had been restored an hour earlier.
 */
export function copyGameDir(gamePath: string, outPath: string): void {
  rmSync(outPath, { force: true, recursive: true });
  cpSync(gamePath, outPath, { dereference: true, force: true, recursive: true });
}

/** How many `IMG` lines `data/gta.dat` already carries — the archives the game registers beyond its three
 *  hardcoded ones. */
export function countImgArchives(gameDir: string): number {
  const datPath = join(gameDir, 'data', 'gta.dat');

  return existsSync(datPath)
    ? readFileSync(datPath, 'latin1')
        .split(/\r?\n/)
        .filter((line) => /^IMG\s/i.test(line.trim())).length
    : 0;
}

/**
 * Refuse a dangerous `--out` before anything is wiped: the filesystem root, a path that IS one of the source
 * dirs, one that CONTAINS one (wiping `--out` would take the source with it), or one that sits INSIDE one
 * (the copy would feed on itself).
 *
 * The comparison is on REAL paths, symlinks resolved, because the names alone do not tell you where a wipe
 * lands. On the phone `build/*` and `game-src/*` are routinely symlinks into shared storage, and two of them
 * pointing at one folder is exactly how a converter run ate its own source archives (2026-08-09) — the guard
 * saw two different names and let it through.
 *
 * Those real paths are then compared case-INSENSITIVELY, on every platform. The two mistakes do not cost the
 * same: a false refusal costs the caller a rename, a missed match points a tool at the source it is about to
 * wipe or overwrite. `GTA San Andreas` and `gta san andreas` are ONE folder on both platforms this repo runs
 * on (Windows and macOS), and a tool that emits into a game rather than into a copy of one
 * (`vehicle-cutscene --no-base-copy`) has no copy standing between that mistake and the user's install.
 * Folding unconditionally also keeps the guard's behaviour — and its tests — the same everywhere.
 */
export function guardOut(outPath: string, ...sources: readonly string[]): void {
  const outReal = realPath(outPath);
  if (outReal === parse(outReal).root) {
    throw new Error(`refusing to wipe the filesystem root as --out: ${outPath}`);
  }
  const out = foldPath(outReal);
  for (const source of sources) {
    const real = realPath(source);
    const folded = foldPath(real);
    const where = real === resolve(source) ? source : `${source} → ${real}`;
    if (out === folded) {
      throw new Error(`--out must differ from the source dirs: ${outPath} and ${where} are the same directory`);
    }
    if (folded.startsWith(out + sep)) {
      throw new Error(`--out must not contain a source dir (would wipe it): ${outPath} contains ${where}`);
    }
    if (out.startsWith(folded + sep)) {
      throw new Error(`--out must not sit inside a source dir (would copy into it): ${outPath} is inside ${where}`);
    }
  }
}

/**
 * Declare `models/*.img` archives in `data/gta.dat` and return how many `IMG` lines the file ends up with.
 *
 * **Whoever WRITES an archive registers it.** An archive the game never registers is invisible content: the
 * build succeeds, the file is on disk, and its entries simply never load. Both places that create one — the
 * split, and an installer whose family spilled into a sibling — call this, so the invariant does not depend
 * on a later stage remembering.
 *
 * Idempotent, and the lines are spliced after the LAST existing `IMG` rather than appended: `gta.dat` is read
 * top to bottom and archives are declared before the data that streams out of them.
 */
export function registerImgArchives(gameDir: string, names: readonly string[]): number {
  const datPath = join(gameDir, 'data', 'gta.dat');
  if (!existsSync(datPath)) {
    return 0;
  }
  const lines = readFileSync(datPath, 'latin1').split(/\r?\n/);
  const isImg = (line: string): boolean => /^IMG\s/i.test(line.trim());
  const wanted = names.map((name) => `IMG MODELS\\${name.toUpperCase()}`);
  const missing = wanted.filter(
    (line) => !lines.some((existing) => existing.trim().toUpperCase() === line.toUpperCase()),
  );
  if (missing.length > 0) {
    const lastImg = lines.reduce((last, line, index) => (isImg(line) ? index : last), -1);
    lines.splice(lastImg + 1, 0, ...missing);
    writeFileSync(datPath, lines.join('\n'), 'latin1');
  }

  return lines.filter(isImg).length;
}

/**
 * The inverse of {@link registerImgArchives}: drop the `IMG MODELS\\<name>` lines of archives a writer no
 * longer writes (a family that shrank). A registered archive that is not on disk is a boot failure in the
 * real game and a dead fetch in ours. Returns how many `IMG` lines remain.
 */
export function unregisterImgArchives(gameDir: string, names: readonly string[]): number {
  const datPath = join(gameDir, 'data', 'gta.dat');
  if (!existsSync(datPath)) {
    return 0;
  }
  const lines = readFileSync(datPath, 'latin1').split(/\r?\n/);
  const isImg = (line: string): boolean => /^IMG\s/i.test(line.trim());
  const gone = new Set(names.map((name) => `IMG MODELS\\${name.toUpperCase()}`));
  const kept = lines.filter((line) => !gone.has(line.trim().toUpperCase()));
  if (kept.length !== lines.length) {
    writeFileSync(datPath, kept.join('\n'), 'latin1');
  }

  return kept.filter(isImg).length;
}

/** A path as the case-insensitive filesystems this repo targets would match it. See {@link guardOut}. */
function foldPath(path: string): string {
  return path.toLowerCase();
}

/**
 * Where a path really lands, symlinks resolved. `--out` does not have to exist yet, so an unresolvable tail
 * is rebuilt onto the nearest ancestor that does resolve — which is the directory a wipe would sit in.
 */
function realPath(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync(absolute);
  } catch {
    const parent = dirname(absolute);

    return parent === absolute ? absolute : join(realPath(parent), basename(absolute));
  }
}
