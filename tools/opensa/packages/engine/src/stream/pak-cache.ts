/**
 * The pak's range slices, kept between sessions (plan 201/4-03).
 *
 * A district's opening view pulls tens of megabytes out of the pak, and every open paid for all of it again:
 * on the phone that is the difference between a map that appears and a map that is fetched. The reads are
 * `Range:` requests over one immutable file, so they cache perfectly — the only thing that makes a slice
 * stale is a REBUILD of the pak, and the manifest already stamps that (`buildTime`).
 *
 * Four things this has to get right, and each of them is why it is not
 * `@opensa/loaders`' `CacheStore` (which keys whole URLs, has no version to prune against, and would pull
 * the game's loader package into the engine's single dependency):
 *
 * - **The key is a RANGE, not a URL.** Cache Storage matches on the URL and ignores the `Range:` header, so
 *   every slice of `world.ospak` would collide on one entry. The key carries the range instead.
 *   The request is never sent — it exists to be matched.
 * - **A 206 cannot be stored.** `cache.put` rejects a partial response by spec, so the slice is re-wrapped
 *   as a plain 200 over its bytes.
 * - **A rebuilt pak invalidates everything.** The cache is named for the build; on open, the caches of
 *   OTHER builds of the same pak are deleted. A pak with no `buildTime` (built before the field existed)
 *   is not cached at all — an unversioned cache is one nobody can invalidate, and serving a stale slice of
 *   a rebuilt pak is silent corruption rather than a miss.
 * - **It is optional, always.** Cache Storage needs a secure context, and the phone reaches this app over
 *   `http://<lan-ip>` where `caches` is not even defined — the same rule
 *   `cacheStorageStatus()` states for the game loader. Quota can also refuse a write mid-session. Every
 *   path here degrades to "read it off the network", because that is exactly the behaviour we had before.
 */

const PREFIX = 'opensa-pak|';

export interface PakRangeCache {
  /** Store a slice. Fire-and-forget: the caller must not wait on the disk to serve a frame. */
  put(offset: number, length: number, bytes: ArrayBuffer): void;
  /** A previously stored slice, or `undefined` — which simply means "fetch it". */
  read(offset: number, length: number): Promise<ArrayBuffer | undefined>;
}

class CacheStorageRangeCache implements PakRangeCache {
  /** Writes run one at a time, in order. A burst of slices is a burst of disk writes otherwise, and — the
   *  reason it is a chain rather than a flag — a refusal has to be able to STOP the ones behind it: five
   *  concurrent puts all fail before the first rejection is seen, and log five times. */
  private chain: Promise<void> = Promise.resolve();
  private writable = true;

  constructor(
    private readonly cache: Cache,
    private readonly url: string,
  ) {}

  put(offset: number, length: number, bytes: ArrayBuffer): void {
    if (!this.writable) {
      return;
    }
    // The Response copies the bytes as it is constructed, which is what makes the write safe to leave
    // running: the caller transfers `bytes` to the main thread the moment this returns.
    const body = new Response(bytes, { status: 200 });
    const key = pakRangeKey(this.url, offset, length);
    this.chain = this.chain
      .then(async () => {
        if (this.writable) {
          await this.cache.put(key, body);
        }
      })
      .catch((error: unknown) => {
        // Quota, or an origin that stopped accepting writes. One line, once — then read from the network
        // for the rest of the session rather than rejecting a promise per entry.
        this.writable = false;
        // A cache that silently stopped storing looks exactly like one that is working, and the next
        // session pays for it in bytes — so it is said out loud, once.
        // eslint-disable-next-line no-console -- deliberate field diagnostic, same class as the stream warnings
        console.warn(`[pak-cache] not storing slices this session: ${message(error)}`);
      });
  }

  async read(offset: number, length: number): Promise<ArrayBuffer | undefined> {
    try {
      const hit = await this.cache.match(pakRangeKey(this.url, offset, length));

      return hit ? await hit.arrayBuffer() : undefined;
    } catch {
      return undefined;
    }
  }
}

/**
 * Open the cache for one pak build, or `undefined` when there is nothing to open — no Cache Storage, no
 * version to key on, or an origin that refuses. The caller treats all three the same way.
 */
export async function openPakCache(url: string, version: string | undefined): Promise<PakRangeCache | undefined> {
  if (typeof caches === 'undefined' || version === undefined || version === '') {
    return undefined;
  }
  const name = `${PREFIX}${url}|${version}`;
  try {
    const cache = await caches.open(name);
    await dropOtherBuilds(url, name);

    return new CacheStorageRangeCache(cache, url);
  } catch {
    return undefined;
  }
}

/** The key a slice is stored under. Exported for the test — a key that drifts is a cache that never hits. */
export function pakRangeKey(url: string, offset: number, length: number): string {
  return `${url}${url.includes('?') ? '&' : '?'}__osrange=${offset}-${length}`;
}

/** Every other build of THIS pak, dropped — the disk holds one build's slices, not a year of them. */
async function dropOtherBuilds(url: string, keep: string): Promise<void> {
  const stale = (await caches.keys()).filter((name) => name.startsWith(`${PREFIX}${url}|`) && name !== keep);
  await Promise.all(stale.map(async (name) => caches.delete(name)));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
