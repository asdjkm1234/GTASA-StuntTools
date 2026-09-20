/**
 * Thin Cache Storage wrapper: the loader caches each RAW zip chunk as a Response keyed by its URL, so a
 * returning visit (or a retry after a blip) reads it back instead of re-downloading. Browser-only API —
 * exercised on the Playwright e2e lane, not in node units.
 *
 * The Cache Storage API needs a **secure context** (https / localhost) — it is absent over plain `http://`
 * (e.g. a phone hitting a LAN IP), where `caches` is not even defined. So every method degrades to a no-op
 * when it is unavailable: nothing is cached and the loader simply re-downloads each visit (see `available`).
 * {@link cacheStorageStatus} is what lets the shell SAY that, instead of the load being quietly disposable.
 */
export class CacheStore {
  /** `false` when the Cache Storage API is unavailable (insecure context) — all ops become no-ops. */
  readonly available = cacheStorageStatus().available;

  constructor(private readonly name: string) {}

  /** Drop the entire cache bucket — used to revoke a build (the always-fresh `data` group failed to fetch). */
  async clear(): Promise<void> {
    if (this.available) {
      await caches.delete(this.name);
    }
  }

  /** Remove a cached chunk by URL. */
  async delete(url: string): Promise<void> {
    if (!this.available) {
      return;
    }
    const cache = await caches.open(this.name);
    await cache.delete(url);
  }

  /** Every cached chunk URL (for invalidation diffing); empty when caching is unavailable. */
  async keys(): Promise<string[]> {
    if (!this.available) {
      return [];
    }
    const cache = await caches.open(this.name);

    return (await cache.keys()).map((request) => request.url);
  }

  /** Cached bytes for a chunk URL, or null when not cached / unavailable (forces a fresh download). */
  async match(url: string): Promise<null | Uint8Array<ArrayBuffer>> {
    if (!this.available) {
      return null;
    }
    const cache = await caches.open(this.name);
    const response = await cache.match(url);

    return response ? new Uint8Array(await response.arrayBuffer()) : null;
  }

  /** Store a fully-downloaded, verified chunk under its URL (no-op when caching is unavailable). */
  async put(url: string, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    if (!this.available) {
      return;
    }
    const cache = await caches.open(this.name);
    await cache.put(url, new Response(bytes));
  }
}

/**
 * Whether this context can persist downloads, and — when it cannot — a line that says WHY and what to do
 * about it.
 *
 * Exported because the no-op above is otherwise invisible: nothing breaks, the game just re-downloads
 * itself on every visit, which on a phone is gigabytes over someone's connection. The canonical way to
 * meet this is the one a phone actually takes — `http://<lan-ip>:5173` from a dev machine — so the shell
 * has to be able to SAY it (plan 200/4-06).
 */
export function cacheStorageStatus(): { available: boolean; reason: string } {
  if (typeof caches !== 'undefined') {
    return { available: true, reason: '' };
  }
  // `isSecureContext` is the discriminator: over plain http:// the API is withheld by the platform and https
  // (or localhost, or a tunnel) fixes it. A secure context with no `caches` is a different, rarer animal —
  // an old or stripped-down browser — and telling that user to use https would be a wrong instruction.
  const insecure = typeof isSecureContext !== 'undefined' && !isSecureContext;

  return {
    available: false,
    reason: insecure
      ? 'this page is not a secure context (plain http://), so the browser withholds Cache Storage — the ' +
        'game re-downloads on every visit. Serve it over https, localhost, or a tunnel to keep the download.'
      : 'this browser exposes no Cache Storage API — the game re-downloads on every visit.',
  };
}
