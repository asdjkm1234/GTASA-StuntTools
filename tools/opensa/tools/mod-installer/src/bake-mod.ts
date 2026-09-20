import { normalizeDatPath } from '@opensa/renderware/archive';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

import { ADDITIVE_DAT, mergeDataFile } from './data-merge';
import { mergeGtaDat } from './gta-dat-merge';
import { injectImgEntries } from './img-merge';
import { parseLoader } from './loader';

/** A binary IPL stream (`<area>_streamN.ipl`) — bytes injected into gta3.img, unlike a text (placement) IPL. */
const STREAM_IPL = /_stream\d+\.ipl$/;

/** The buckets a Modloader mod's files fall into (keyed by **bare name**, the on-disk path being irrelevant). */
export interface ModScan {
  /** bare name → file path: `.dff`/`.txd`/`.col`/`.ifp` + binary `_stream` IPLs → injected into gta3.img. */
  assets: Map<string, string>;
  /** dest path under `<out>/cleo/` → file path: everything under a `cleo`/`CLEO` dir (any extension, the
   *  author-relative structure preserved) + loose `.cs`/`.ini`/`.fxt` (plan 097/06 decision 2). */
  cleo: Map<string, string>;
  /** bare name → file paths: `object.dat`/`procobj.dat` → additively merged onto stock. */
  dataMerges: Map<string, string[]>;
  /** Whether ≥ 1 loader file was found — i.e. this is a Modloader mod (vs a plain path-overlay mod). */
  loaderFound: boolean;
  /** `IDE`/`IPL`/`COLFILE` paths declared across every loader file → `gta.dat` patch + new-file destinations. */
  refs: { col: string[]; ide: string[]; ipl: string[] };
  /** bare name → file path: `.ide` / text `.ipl` / whole-file `.dat` (surfinfo …) → written to disk. */
  texts: Map<string, string>;
}

/**
 * Bake a Modloader-style mod into `outPath` (the accumulated game tree): patch `gta.dat` with the loader's
 * `IDE`/`IPL` lines, write each `.ide`/`.ipl`/`.dat` to disk (overwrite the stock file by bare name, else the
 * loader-declared path), additively merge
 * `object.dat`/`procobj.dat`, and inject the scattered `.dff`/`.txd`/`.col`/`.ifp` into `models/gta3.img` by name.
 * Returns `{ baked:false }` when the mod has no loader file (caller should use the plain path-overlay instead).
 */
export function bakeMod(
  modPath: string,
  outPath: string,
): { assets: number; baked: boolean; cleo: number; texts: number } {
  const scan = scanModloaderMod(modPath);
  if (!scan.loaderFound) {
    return { assets: 0, baked: false, cleo: 0, texts: 0 };
  }

  // 1. Register the loader's defs/placements in gta.dat (COLFILE dropped — col is injected into gta3.img below).
  //    Loader paths come with mixed slashes/case (`DATA\MAPS` vs `data/maps`); canonicalise the appended lines to
  //    the stock convention (backslashes + UPPERCASE directory, filename as-is) so the baked file is consistent.
  //    Dedup keys are normalised by `mergeGtaDat` regardless, and the engine reads any slash/case.
  const datPath = join(outPath, 'data', 'gta.dat');
  const rehomed = {
    col: scan.refs.col,
    ide: scan.refs.ide.map(rehomeDatPath),
    ipl: scan.refs.ipl.map(rehomeDatPath),
  };
  if (existsSync(datPath)) {
    const refs = { ide: rehomed.ide.map(canonicalDatPath), ipl: rehomed.ipl.map(canonicalDatPath) };
    writeFileSync(datPath, mergeGtaDat(readText(datPath), refs));
  }

  // 2. Place each text file: overwrite the stock file with this bare name, else the loader-declared path.
  const declared = declaredPaths(rehomed);
  const stock = indexDataFiles(outPath);
  let texts = 0;
  for (const [base, src] of scan.texts) {
    const rel = declared.get(base);
    const dest = stock.get(base) ?? (rel ? join(outPath, rel) : undefined);
    if (dest) {
      writeOut(dest, new Uint8Array(readFileSync(src)));
      texts += 1;
    }
  }

  // 2b. A baked IDE that REDEFINES an id (e.g. moving a stock `objs` def into `anim` — Animal Statues
  //     Remastered does) must WIN: the real modloader merges IDE lines by id, but baking registers the mod's
  //     IDE as an additional file, so the stock definition would load too — duplicate model-info ids corrupt
  //     the heap during SA's data load (crash after shopping.dat). Strip the older definitions.
  const newIdes = [...scan.texts.entries()]
    .filter(([base]) => base.endsWith('.ide'))
    .flatMap(([base]) => {
      const rel = declared.get(base);
      const dest = stock.get(base) ?? (rel ? join(outPath, rel) : undefined);

      return dest && existsSync(dest) ? [dest] : [];
    });
  // Debug escape hatch: OPENSA_NO_IDE_DEDUPE=1 skips the id dedupe (bisecting whether a crash comes from it).
  if (process.env.OPENSA_NO_IDE_DEDUPE === '1') {
    console.warn('mod-installer: OPENSA_NO_IDE_DEDUPE=1 — baked-IDE id dedupe SKIPPED (duplicate ids may crash SA)');
  } else {
    dedupeIdeIds(outPath, newIdes);
  }

  // 3. Additively merge object.dat / procobj.dat onto stock.
  for (const [base, sources] of scan.dataMerges) {
    const dest = join(outPath, 'data', base);
    const merged = mergeDataFile(existsSync(dest) ? readText(dest) : '', sources.map(readText), ADDITIVE_DAT[base]);
    writeOut(dest, new Uint8Array(Buffer.from(merged)));
  }

  // 4. Inject the scattered model/anim/collision assets into gta3.img by bare name.
  const entries = new Map<string, Uint8Array>();
  for (const [base, src] of scan.assets) {
    entries.set(base, new Uint8Array(readFileSync(src)));
  }
  const assets = injectImgEntries(entries, join(outPath, 'models', 'gta3.img'), basename(modPath));

  // 5. Carry the mod's CLEO files to `<out>/cleo/` (the silent-drop era ends loudly — one line per file).
  for (const [rel, src] of scan.cleo) {
    writeOut(join(outPath, 'cleo', rel), new Uint8Array(readFileSync(src)));
    console.log(`mod-installer: cleo → cleo/${rel}`);
  }

  return { assets, baked: true, cleo: scan.cleo.size, texts };
}

/**
 * Scan a `--in` mod subtree (any depth, folder layout irrelevant) and bucket every file by **bare name**, the way
 * SA's Modloader resolves one. `loaderFound` tells {@link bakeMod}/`install` whether to bake
 * (a Modloader mod) or fall back to the plain path-overlay. CLEO content (anything under a `cleo`/`CLEO` dir +
 * loose `.cs`/`.ini`/`.fxt`) buckets separately for the `<out>/cleo/` carry; vehicle `*.settings.txt` and prose
 * `.txt` are ignored.
 */
export function scanModloaderMod(modPath: string): ModScan {
  const scan: ModScan = {
    assets: new Map(),
    cleo: new Map(),
    dataMerges: new Map(),
    loaderFound: false,
    refs: { col: [], ide: [], ipl: [] },
    texts: new Map(),
  };
  for (const path of walk(modPath)) {
    const lower = path.toLowerCase();
    const base = basename(lower);
    // The cleo segment is matched against the MOD-relative path only — the corpus itself may live under a
    // `cleo/` parent on disk, and that outer segment must not turn every file into script content.
    const modRel = relative(modPath, path).split(/[\\/]/);
    const cleoAt = modRel.findIndex((segment) => segment.toLowerCase() === 'cleo');
    if (cleoAt >= 0 && cleoAt < modRel.length - 1) {
      scan.cleo.set(modRel.slice(cleoAt + 1).join('/'), path);
      continue;
    }
    if (lower.endsWith('.cs') || lower.endsWith('.fxt') || lower.endsWith('.ini')) {
      scan.cleo.set(base, path);
      continue;
    }
    if (
      lower.endsWith('.dff') ||
      lower.endsWith('.txd') ||
      lower.endsWith('.col') ||
      lower.endsWith('.ifp') ||
      STREAM_IPL.test(base)
    ) {
      scan.assets.set(base, path);
    } else if (base in ADDITIVE_DAT) {
      (scan.dataMerges.get(base) ?? scan.dataMerges.set(base, []).get(base)!).push(path);
    } else if (lower.endsWith('.ipl') || lower.endsWith('.ide') || lower.endsWith('.dat')) {
      scan.texts.set(base, path);
    } else if (lower.endsWith('.settings.txt')) {
      // vehicle settings — out of scope for the map baker (vehicle-installer owns them)
    } else if (lower.endsWith('.txt')) {
      const refs = parseLoader(readText(path));
      if (refs.ide.length > 0 || refs.ipl.length > 0 || refs.col.length > 0) {
        scan.loaderFound = true;
        scan.refs.ide.push(...refs.ide);
        scan.refs.ipl.push(...refs.ipl);
        scan.refs.col.push(...refs.col);
      }
    }
  }

  return scan;
}

/** Canonicalise a gta.dat path to the stock convention: backslashes + UPPERCASE directory (`DATA\MAPS\`), with the
 *  filename left as-authored (matching `DATA\MAPS\LAn.IDE`). The engine reads case-insensitively (OpenSA lowercases
 *  on read; the baker writes the file lowercased), so the displayed case is cosmetic. */
function canonicalDatPath(path: string): string {
  const backslashed = path.replace(/\//g, '\\');
  const slash = backslashed.lastIndexOf('\\');

  return slash < 0 ? backslashed : `${backslashed.slice(0, slash).toUpperCase()}${backslashed.slice(slash)}`;
}

/** Bare name → gta.dat-normalised declared path, from the loader `IDE`/`IPL` refs (where a *new* file is written). */
function declaredPaths(refs: ModScan['refs']): Map<string, string> {
  const paths = new Map<string, string>();
  for (const ref of [...refs.ide, ...refs.ipl]) {
    const normalised = normalizeDatPath(ref);
    paths.set(basename(normalised), normalised);
  }

  return paths;
}

/**
 * Make the freshly-baked IDEs' id definitions WIN over older ones: every id they define is stripped from
 * every OTHER `.ide` under `<out>/data` (stock or an earlier mod's) — the modloader-equivalent id merge.
 */
function dedupeIdeIds(outPath: string, newIdeFiles: readonly string[]): void {
  if (newIdeFiles.length === 0) {
    return;
  }
  const newIds = new Set<number>();
  const own = new Set(newIdeFiles.map((file) => file.toLowerCase()));
  for (const file of newIdeFiles) {
    for (const id of ideDefinedIds(readText(file))) {
      newIds.add(id);
    }
  }
  if (newIds.size === 0) {
    return;
  }
  const dataDir = join(outPath, 'data');
  if (!existsSync(dataDir)) {
    return;
  }
  for (const file of walk(dataDir).filter((path) => path.toLowerCase().endsWith('.ide'))) {
    if (own.has(file.toLowerCase())) {
      continue;
    }
    const text = readText(file);
    let inSection = false;
    let removed = 0;
    const kept = text.split(/\r?\n/).filter((raw) => {
      const line = raw.trim();
      if (!inSection) {
        inSection = /^(?:objs|tobj|anim)$/i.test(line);

        return true;
      }
      if (line.toLowerCase() === 'end') {
        inSection = false;

        return true;
      }
      const id = Number(line.split(',')[0]);
      if (Number.isFinite(id) && newIds.has(id)) {
        removed += 1;

        return false; // the baked mod's definition wins
      }

      return true;
    });
    if (removed > 0) {
      writeFileSync(file, kept.join('\n'));

      console.log(`mod-installer: ${removed} id definition(s) in ${basename(file)} superseded by a baked IDE`);
    }
  }
}

/**
 * The numeric ids an IDE text defines across its drawable sections (objs/anim/tobj — any line whose first
 * cell parses as a number inside a section).
 */
function ideDefinedIds(text: string): Set<number> {
  const ids = new Set<number>();
  let inSection = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!inSection) {
      inSection = /^(?:objs|tobj|anim)$/i.test(line);
      continue;
    }
    if (line.toLowerCase() === 'end') {
      inSection = false;
      continue;
    }
    const id = Number(line.split(',')[0]);
    if (Number.isFinite(id)) {
      ids.add(id);
    }
  }

  return ids;
}

/** Index every loose file under `<out>/data` by bare name → its path (first wins) — to overwrite stock in place. */
function indexDataFiles(outPath: string): Map<string, string> {
  const index = new Map<string, string>();
  const dataDir = join(outPath, 'data');
  if (!existsSync(dataDir)) {
    return index;
  }
  for (const path of walk(dataDir)) {
    const base = basename(path).toLowerCase();
    if (!index.has(base)) {
      index.set(base, path);
    }
  }

  return index;
}

/** BOM-aware text read — some mod loaders/data files ship as UTF-16 (a Notepad-saved `Loader.txt`). */
function readText(path: string): string {
  const bytes = new Uint8Array(readFileSync(path));
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes);
  }

  return new TextDecoder().decode(bytes);
}

/**
 * Re-home a loader path that points OUTSIDE `data/` to `data\maps\<basename>`. Modloader-style loaders declare
 * paths relative to the mod's own `modloader\<Mod Name>\…` folder (Smoke in factory pipes did) — baked verbatim
 * that writes the file into a literal `modloader/` dir: dead weight in the opensa pack (never packed) and a
 * DOUBLE load on a real SA that also runs modloader.asi (gta.dat + modloader both register it). Paths already
 * under `data/` pass through untouched.
 */
function rehomeDatPath(path: string): string {
  const segments = path
    .replace(/\\/g, '/')
    .replace(/^\.?\//, '')
    .split('/');
  if (segments[0]?.toLowerCase() === 'data') {
    return path;
  }

  return `data\\maps\\${segments[segments.length - 1]}`;
}

/** Every file under `dir`, recursively (absolute paths). */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(path));
    } else {
      out.push(path);
    }
  }

  return out;
}

function writeOut(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}
