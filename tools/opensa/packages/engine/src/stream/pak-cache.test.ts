import { afterEach, describe, expect, it, vi } from 'vitest';

import { openPakCache, pakRangeKey } from './pak-cache';

const URL_A = 'http://host/pak/world.ospak';

/** A Cache Storage stand-in — the API is browser-only, and the behaviour under test is our keying. */
class FakeCache {
  readonly entries = new Map<string, ArrayBuffer>();

  constructor(private readonly onPut?: () => void) {}

  match(key: string): Promise<Response | undefined> {
    const hit = this.entries.get(key);

    return Promise.resolve(hit ? new Response(hit) : undefined);
  }

  async put(key: string, response: Response): Promise<void> {
    this.onPut?.();
    this.entries.set(key, await response.arrayBuffer());
  }
}

function installCaches(onPut?: () => void): { caches: Map<string, FakeCache> } {
  const store = new Map<string, FakeCache>();
  const api = {
    delete: (name: string): Promise<boolean> => Promise.resolve(store.delete(name)),
    keys: (): Promise<string[]> => Promise.resolve([...store.keys()]),
    open: (name: string): Promise<FakeCache> => {
      const existing = store.get(name) ?? new FakeCache(onPut);
      store.set(name, existing);

      return Promise.resolve(existing);
    },
  };
  vi.stubGlobal('caches', api);

  return { caches: store };
}

/** One slice, stored and read back through a freshly opened cache — what a second session does. */
async function roundTrip(version: string, bytes: Uint8Array): Promise<ArrayBuffer | undefined> {
  const write = await openPakCache(URL_A, version);
  write?.put(4096, bytes.byteLength, bytes.buffer as ArrayBuffer);
  await vi.waitFor(async () => {
    expect(await (await openPakCache(URL_A, version))?.read(4096, bytes.byteLength)).toBeDefined();
  });

  return (await openPakCache(URL_A, version))?.read(4096, bytes.byteLength);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openPakCache', () => {
  describe('negative cases', () => {
    it('is absent when the context has no Cache Storage — a LAN http:// origin is not a secure one', async () => {
      vi.stubGlobal('caches', undefined);

      expect(await openPakCache(URL_A, '10:00 25-08-2026')).toBeUndefined();
    });

    it('is absent for a pak with no buildTime — an unversioned cache is one nobody can invalidate', async () => {
      installCaches();

      expect(await openPakCache(URL_A, undefined)).toBeUndefined();
      expect(await openPakCache(URL_A, '')).toBeUndefined();
    });

    it('is absent rather than throwing when the origin refuses to open a cache', async () => {
      vi.stubGlobal('caches', {
        keys: (): Promise<string[]> => Promise.resolve([]),
        open: (): Promise<never> => Promise.reject(new Error('quota')),
      });

      expect(await openPakCache(URL_A, '10:00 25-08-2026')).toBeUndefined();
    });

    it('misses on a range it never stored, rather than returning a neighbouring slice', async () => {
      installCaches();
      const cache = await openPakCache(URL_A, '10:00 25-08-2026');
      cache?.put(4096, 512, new Uint8Array([1, 2, 3, 4]).buffer);

      expect(await cache?.read(4096, 256)).toBeUndefined();
      expect(await cache?.read(8192, 512)).toBeUndefined();
    });

    it('stops storing after a write is refused instead of rejecting once per entry', async () => {
      let puts = 0;
      installCaches(() => {
        puts += 1;
        throw new Error('QuotaExceededError');
      });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const cache = await openPakCache(URL_A, '10:00 25-08-2026');
      for (let i = 0; i < 5; i += 1) {
        cache?.put(i * 4096, 512, new Uint8Array(4).buffer);
      }
      await vi.waitFor(() => {
        expect(warn).toHaveBeenCalledTimes(1);
      });

      expect(puts).toBe(1);
    });
  });

  describe('positive cases', () => {
    it('reads back a slice a previous session stored', async () => {
      installCaches();
      const bytes = new Uint8Array([9, 8, 7, 6, 5]);

      const hit = await roundTrip('10:00 25-08-2026', bytes);

      expect(hit && new Uint8Array(hit)).toEqual(bytes);
    });

    it('keys every slice by its range, so two slices of one pak do not collide', () => {
      expect(pakRangeKey(URL_A, 0, 4096)).not.toBe(pakRangeKey(URL_A, 4096, 4096));
      expect(pakRangeKey(URL_A, 4096, 512)).not.toBe(pakRangeKey(URL_A, 4096, 1024));
      expect(pakRangeKey('http://host/pak?v=2', 0, 16)).toContain('&__osrange=0-16');
    });

    it('drops the caches of OTHER builds of the same pak when it opens', async () => {
      const { caches: store } = installCaches();
      await openPakCache(URL_A, '10:00 25-08-2026');
      await openPakCache(URL_A, '11:30 26-08-2026');

      expect([...store.keys()]).toEqual([`opensa-pak|${URL_A}|11:30 26-08-2026`]);
    });

    it('leaves another pak of the same origin alone — districts do not evict each other', async () => {
      const { caches: store } = installCaches();
      await openPakCache('http://host/other/world.ospak', '10:00 25-08-2026');
      await openPakCache(URL_A, '11:30 26-08-2026');

      expect([...store.keys()]).toHaveLength(2);
    });
  });
});
