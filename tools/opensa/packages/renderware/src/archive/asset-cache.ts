import type { IfpAnimation } from '../parsers/binary/ifp';
import type { RWClump } from '../parsers/binary/types';
import type { ImgArchive } from './img-archive';

import { parseDff } from '../parsers/binary/dff';
import { parseIfp } from '../parsers/binary/ifp';

/**
 * Parse models/textures out of the in-memory WIMG archive, cached by name.
 *
 * Synchronous (the archive is already downloaded), so there's no per-model
 * fetch/Suspense. A name absent from the archive (or unparseable) yields an
 * empty clump / empty texture map — it renders nothing instead of crashing.
 */
const EMPTY_CLUMP: RWClump = { atomics: [], frames: [], geometries: [] };

const clumpCache = new Map<string, RWClump>();
/** Parse caches are BOUNDED (plan 073/08 memory): unbounded, every model ever driven past stayed in the JS
 *  heap forever (multi-GB — unified-memory pressure collapses the GPU on Apple Silicon). LRU by insertion
 *  order: a hit re-inserts, overflow evicts the oldest — an evicted model simply re-parses on revisit. */
const CLUMP_CACHE_MAX = 512;

/** LRU touch: refresh `key`'s recency (Maps iterate in insertion order) and evict past `max`. */
function lruSet<K, V>(cache: Map<K, V>, key: K, value: V, max: number): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > max) {
    const oldest = cache.keys().next().value as K;
    cache.delete(oldest);
  }
}

/** Parsed IFP animation packages (zone object clips like `counxref.ifp`), by lowercased name. BOUNDED like
 *  the clump cache (plan 073/08) — the distinct-IFP set is small and static, but an unbounded Map still
 *  contradicts the "parse caches are bounded" rule, so cap it; an evicted package just re-parses on revisit. */
const ifpCache = new Map<string, IfpAnimation[]>();
const IFP_CACHE_MAX = 64;

/**
 * RAW TXD bytes by lowercased name — the fetch, not the texels.
 *
 * Consecutive models share a dictionary (an IDE lists its district together), and the shared ones are huge:
 * re-reading `lodtrees.txd` from the archive for each of its 184 models cost ~80 ms apiece. This caches the
 * BYTES only; the decoded-texel cache the comment on {@link getTxdChain} warns against is still forbidden.
 * Budgeted in bytes rather than entries because TXD sizes span kilobytes to ~80 MB.
 */
const txdBytesCache = new WeakMap<ImgArchive, { entries: Map<string, ArrayBuffer>; held: number }>();
const TXD_BYTES_MAX = 256 * 1024 * 1024;

/**
 * The archive read for one TXD, memoised under the byte budget (oldest evicted first).
 *
 * Keyed PER ARCHIVE, not by name alone: the same dictionary name resolves to different bytes in different
 * archives (a mod overlay, a second game dir, one test's fixture after another's), and a name-only cache
 * hands the wrong TXD — or one the archive does not contain at all — to whoever asks next.
 */
function cachedTxdBytes(archive: ImgArchive, name: string): ArrayBuffer | null {
  let cache = txdBytesCache.get(archive);
  if (!cache) {
    cache = { entries: new Map(), held: 0 };
    txdBytesCache.set(archive, cache);
  }
  const hit = cache.entries.get(name);
  if (hit) {
    cache.entries.delete(name);
    cache.entries.set(name, hit);

    return hit;
  }
  const bytes = archive.get(`${name}.txd`);
  if (!bytes) {
    return null;
  }
  cache.entries.set(name, bytes);
  cache.held += bytes.byteLength;
  while (cache.held > TXD_BYTES_MAX && cache.entries.size > 1) {
    const oldest = cache.entries.keys().next().value as string;
    cache.held -= cache.entries.get(oldest)?.byteLength ?? 0;
    cache.entries.delete(oldest);
  }

  return bytes;
}

/** `txdp` parent links (lowercased child → parent). Empty until {@link setTxdParents}; then chains resolve. */
let txdParents: ReadonlyMap<string, string> = new Map();

export function getClump(archive: ImgArchive, modelName: string): RWClump {
  const key = `${modelName.toLowerCase()}.dff`;
  let clump = clumpCache.get(key);
  if (!clump) {
    clump = parseOrEmpty(archive.get(key), parseDff, EMPTY_CLUMP);
  }
  lruSet(clumpCache, key, clump, CLUMP_CACHE_MAX);

  return clump;
}

/** An IFP package's animations (e.g. the zone object clips a map model's IDE `anim` row names),
 *  cached by name. Absent/unparseable yields an empty list — the object renders static. */
export function getIfp(archive: ImgArchive, ifpName: string): IfpAnimation[] {
  const key = ifpName.toLowerCase();
  let animations = ifpCache.get(key);
  if (!animations) {
    animations = parseOrEmpty(archive.get(`${key}.ifp`), parseIfp, []);
  }
  lruSet(ifpCache, key, animations, IFP_CACHE_MAX);

  return animations;
}

/**
 * A TXD's bytes followed by its `txdp` ancestors', **highest priority first** — the child, then its parent,
 * then its parent's parent. Feed the result straight to `VehicleTextures` / `decodeTextures`, whose
 * "first TXD wins" rule IS `txdp` inheritance: a child inherits every texture it does not itself define.
 *
 * Returning a CHAIN rather than a merged texture map is deliberate. The merge already exists in both
 * consumers, and a second resolved-texture cache here would be a second copy of every decoded texel — the
 * plan 073/08 memory lesson. Cycle-guarded; absent links or a missing parent TXD collapse to just the
 * child, so this is a no-op on self-contained (stock) archives.
 */
export function getTxdChain(archive: ImgArchive, txdName: string): ArrayBuffer[] {
  const chain: ArrayBuffer[] = [];
  const seen = new Set<string>();
  let name: string | undefined = txdName.toLowerCase();
  while (name !== undefined && !seen.has(name)) {
    seen.add(name);
    const bytes = cachedTxdBytes(archive, name);
    if (bytes) {
      chain.push(bytes);
    }
    name = txdParents.get(name);
  }

  return chain;
}

/** Whether a model's clump is already cached (the streaming parse worker skips re-parsing it). */
export function hasClump(modelName: string): boolean {
  return clumpCache.has(`${modelName.toLowerCase()}.dff`);
}

/** Seed the clump cache with a worker-parsed model (plan 060 Phase 5). */
export function primeClump(modelName: string, clump: RWClump): void {
  lruSet(clumpCache, `${modelName.toLowerCase()}.dff`, clump, CLUMP_CACHE_MAX);
}

/**
 * Install the `txdp` parent map (from `MapDefinitions`). A child TXD then inherits any texture it lacks
 * from its parent, recursively. No-op effect when empty (stock archives are self-contained), so it is
 * always safe to call.
 *
 * This is the UNOPTIMIZED path's texture resolution (opensa-pack 003): what opensa-pack converts has its
 * chain flattened offline by `TexturePlanner`, but a stock or modded `.txd` reached at runtime still needs
 * the walk — without it, a mod that parents a TXD silently loses every inherited texture.
 */
export function setTxdParents(parents: ReadonlyMap<string, string> | undefined): void {
  txdParents = parents ?? new Map();
}

function parseOrEmpty<T>(buffer: ArrayBuffer | null, parse: (buffer: ArrayBuffer) => T, empty: T): T {
  if (!buffer) {
    return empty;
  }
  try {
    return parse(buffer);
  } catch {
    return empty;
  }
}
