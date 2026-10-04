import type { Zippable } from 'fflate';

import { zipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve, sep } from 'node:path';

import { chunkByHash, TARGET_CHUNK_BYTES } from './chunk';
import { expandModelArchives, isModelArchive } from './expand-img';

/**
 * The finishing tool of plan 086: pack a pmb build's `opensa/` GAME DIR into the fetch loader's
 * content-hashed zip chunks + `manifest.json` under `<build>/opensa-pack/<game>-<version>/` (phase 8:
 * the SECOND independent build of a pmb run; deploy = upload that folder as `games/<game>-<version>/`,
 * `--out ./static/games` stages a local fetch test). It knows NOTHING
 * about the game's content — no IDE/IPL parsing, no exterior/interior partitioning (all of that died
 * with `build-game.ts`); it walks files, slices the huge ones, buckets by name hash and zips.
 *
 * Group mapping (the loader's fixed vocabulary `data|models|others|textures`):
 *   data     — `data/` + `text/` + the loose root files (stream.ini, parked.json, …)
 *   models   — `models/` + the game dir's `pak/` (world.ospak, pak manifest, water.bin; older builds:
 *              nested `opensa/` or the `opensa-pack/` sibling) — the heavy geometry+texture payload.
 *              The `models/*.img` archives are NOT packed as files: they are expanded into their entries
 *              under bare names, which is the only form the runtime can resolve (see `expand-img.ts`),
 *              and each entry is then bucketed by its own extension.
 *   others   — everything else (`anim/`, audio, dlls…)
 *   textures — EMPTY for a pak build (textures live inside world.ospak); kept so the manifest shape and
 *              the client's group iteration stay untouched
 *
 * Files above the chunk target are SLICED into `<path>#<index>` parts (a 1 GB world.ospak cannot ride
 * one bucket); the fetch VFS reassembles by suffix (plan 086 phase 3).
 */
export interface FetchPackOptions {
  /** A pmb `--out` dir (e.g. `./build/original`) — its `opensa/` target is what ships. */
  buildDir: string;
  log?: (message: string) => void;
  /** Output root; the game lands under `<outRoot>/<game>-<version>/`. Default `<buildDir>/opensa-pack`
   *  (phase 8: the fetch build sits beside the `opensa/` game build — two independent artifacts of one
   *  pmb run; pass `--out ./static/games` to stage a local fetch-mode test directly). */
  outRoot?: string;
}

export interface FetchPackResult {
  chunks: number;
  entries: number;
  game: string;
  outDir: string;
  version: string;
}

type GroupName = 'data' | 'models' | 'others' | 'textures';

/** Same knob as the legacy build-game chunker: `data` changes most, the rest is cache-stable. */
const CACHED: Record<GroupName, boolean> = { data: false, models: true, others: true, textures: true };
/** Fixed zip timestamp (DOS range) — keeps chunk bytes, hence hash/filename, stable across builds. */
const ZIP_MTIME = new Date('1985-01-01T00:00:00Z');

/** Pack one pmb build into fetch chunks. */
export function fetchPack(options: FetchPackOptions): FetchPackResult {
  // eslint-disable-next-line no-console -- the CLI's default sink; callers inject their own logger
  const log = options.log ?? ((message: string): void => console.log(`[fetch-pack] ${message}`));
  const buildRoot = resolve(options.buildDir);
  const gameDir = join(buildRoot, 'opensa');
  if (!existsSync(gameDir)) {
    throw new Error(`no opensa/ target under ${options.buildDir} — run pmb first`);
  }
  // Identity comes from the pak manifest (plan 086 phase 1): `<game>/pak/` since phase 8, with the two
  // older homes as fallbacks; a pre-phase-1 pak falls back to the folder/package.json, loudly.
  const pakManifestPath = [
    join(gameDir, 'pak', 'manifest.json'),
    join(buildRoot, 'opensa-pack', 'manifest.json'),
    join(gameDir, 'opensa', 'manifest.json'),
  ].find((path) => existsSync(path));
  const pakManifest = pakManifestPath
    ? (JSON.parse(readFileSync(pakManifestPath, 'utf8')) as { appVersion?: string; game?: string })
    : {};
  const game = pakManifest.game ?? basename(resolve(options.buildDir));
  const version = pakManifest.appVersion ?? readRootVersion();
  if (!pakManifest.game || !pakManifest.appVersion) {
    log(`⚠ pak manifest lacks game/appVersion (pre-086 build) — using ${game}-${version} from fallbacks`);
  }

  const outDir = join(resolve(options.outRoot ?? join(buildRoot, 'opensa-pack')), `${game}-${version}`);
  mkdirSync(outDir, { recursive: true });

  const groups: Record<GroupName, { bytes: Uint8Array; name: string }[]> = {
    data: [],
    models: [],
    others: [],
    textures: [],
  };
  let entryCount = 0;
  const archives: string[] = [];
  // The game dir is self-contained (phase 8) — one walk covers everything; the pak ships by its
  // game-relative `pak/<name>` path, the VFS key the fetch loader's `openWorld` reads.
  for (const file of walk(gameDir)) {
    const path = relative(gameDir, file).split(sep).join('/');
    // The packed NAME is lowercased, like the local loader's loose paths (`install-source-core.ts`), while
    // the READ keeps the on-disk spelling — a case-sensitive filesystem would not find the other one. The
    // runtime looks a data file up by the lowercased path `gta.dat` names, and a total conversion is free to
    // call its files whatever it likes: gostown ships `data/maps/Gostown6/Gp_City.IPL`. Packed under the
    // on-disk spelling, 32 of that build's 67 files were unreachable — `resolveMap` returned 384 placements
    // instead of 3 970, so the map rendered off the pak and the player fell through a world with no collision.
    const name = path.toLowerCase();
    if (isSkipped(name)) {
      continue;
    }
    // Model archives are held back and EXPANDED below — packed whole, every name inside them would be
    // unreachable through the fetch loader (see `expand-img.ts`).
    if (isModelArchive(name)) {
      archives.push(path);
      continue;
    }
    const raw = readFileSync(file);
    const bytes = new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
    for (const entry of sliceEntries([{ bytes, name }])) {
      groups[groupOf(name)].push(entry);
    }
    entryCount += 1;
  }
  const expanded = expandModelArchives((path) => {
    const raw = readFileSync(join(gameDir, path));

    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  }, archives);
  for (const entry of expanded) {
    for (const part of sliceEntries([{ bytes: entry.bytes, name: entry.name }])) {
      groups[entry.group].push(part);
    }
    entryCount += 1;
  }
  log(`${archives.length} model archive(s) expanded → ${expanded.length} entries by name`);

  const chunks = {} as Record<
    GroupName,
    { bytes: number; cached: boolean; entries: number; file: string; hash: string }[]
  >;
  let chunkCount = 0;
  for (const group of ['data', 'models', 'others', 'textures'] as const) {
    const sized = groups[group].map((entry) => ({ ...entry, size: entry.bytes.byteLength }));
    chunks[group] = chunkByHash(sized).map((bucket) => {
      const sorted = [...bucket].sort((a, b) => a.name.localeCompare(b.name)); // stable order → stable bytes
      const zip = buildZip(sorted);
      const hash = createHash('sha1').update(zip).digest('hex').slice(0, 12);
      const file = `${group}-${hash}.zip`;
      writeFileSync(join(outDir, file), zip);
      chunkCount += 1;

      return { bytes: zip.length, cached: CACHED[group], entries: bucket.length, file, hash };
    });
    log(`${group}: ${groups[group].length} entries → ${chunks[group].length} chunk(s)`);
  }

  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify({ chunks, game, version }, null, 2)}\n`, 'utf8');
  // A chunk's NAME carries its content hash, so a re-pack writes new files beside the old ones and never
  // overwrites them. Left alone, the output dir accumulates every chunk set ever built and the deploy uploads
  // all of them — 502 MB of dead chunks after a single gostown re-pack, and the reason a size comparison of
  // this very change first read as a regression.
  const live = new Set(
    Object.values(chunks)
      .flat()
      .map((chunk) => chunk.file),
  );
  const stale = readdirSync(outDir).filter((file) => file.endsWith('.zip') && !live.has(file));
  for (const file of stale) {
    rmSync(join(outDir, file));
  }
  log(
    `→ ${outDir} (${entryCount} files, ${chunkCount} chunks${stale.length > 0 ? `, ${stale.length} stale removed` : ''})`,
  );

  return { chunks: chunkCount, entries: entryCount, game, outDir, version };
}

/** Which group a game-dir-relative path ships in (posix-style path expected). */
export function groupOf(path: string): GroupName {
  const top = path.split('/')[0].toLowerCase();
  if (!path.includes('/') || top === 'data' || top === 'text') {
    return 'data';
  }
  if (top === 'models' || top === 'pak' || top === 'opensa' || top === 'opensa-pack') {
    return 'models';
  }

  return 'others';
}

/**
 * Files the pack must never carry (posix-style path expected).
 *
 * `*.bak` is the installers' own rollback copy — `gostown6.img.bak` alone is 180 MB, and a pack that walks
 * the tree with no filter uploaded it to the CDN in four slices. `.ds_store` is Finder's, and the local
 * loader already drops it (`install-source-core.ts`); a name that means nothing to one loader and ships
 * through the other is the asymmetry this whole change is about.
 */
export function isSkipped(path: string): boolean {
  const lower = path.toLowerCase();

  return lower.endsWith('.bak') || lower.endsWith('.ds_store');
}

/** Split oversized entries into `<name>#<index>` parts so no bucket exceeds the chunk target. */
export function sliceEntries(
  entries: readonly { bytes: Uint8Array; name: string }[],
  targetBytes = TARGET_CHUNK_BYTES,
): { bytes: Uint8Array; name: string }[] {
  const out: { bytes: Uint8Array; name: string }[] = [];
  for (const entry of entries) {
    if (entry.bytes.byteLength <= targetBytes) {
      out.push(entry);
      continue;
    }
    for (let index = 0, offset = 0; offset < entry.bytes.byteLength; index += 1, offset += targetBytes) {
      out.push({ bytes: entry.bytes.subarray(offset, offset + targetBytes), name: `${entry.name}#${index}` });
    }
  }

  return out;
}

function buildZip(entries: readonly { bytes: Uint8Array; name: string }[]): Uint8Array {
  const data: Zippable = {};
  for (const entry of entries) {
    // Our own formats are already compressed and must be STORED: `.ospak` wraps deflate-raw payloads, and
    // `.osm`/`.ostex` carry BC-compressed texture blocks. They used to ride inside a stored `.img`, so
    // expanding the archives is what makes this list matter — deflating ~300 MB of them at level 6 would
    // cost the whole pack run and win back close to nothing. Stock `.dff`/`.txd` still compress well.
    const level = /\.(?:ospak|osm|ostex)(?:#\d+)?$/i.test(entry.name) ? 0 : 6;
    data[entry.name] = [entry.bytes, { level: level, mtime: ZIP_MTIME }];
  }

  return zipSync(data);
}

function readRootVersion(): string {
  try {
    const root = join(__dirname, '..', '..', '..');
    const parsed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string };

    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else if (entry.isFile() && statSync(path).size > 0) {
      yield path;
    }
  }
}
