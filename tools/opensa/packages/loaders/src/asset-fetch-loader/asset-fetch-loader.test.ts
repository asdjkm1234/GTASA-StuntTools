import type { MockInstance } from 'vitest';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetLoaderEvents, GroupName } from '../types';

import { AssetFetchLoader } from './asset-fetch-loader';

/**
 * The loader's contract is about FAILURE choreography, not about downloading: a dead build must wipe the
 * cache before any cacheable chunk is stored, a cache hit must skip the network, and a truncated chunk must
 * be rejected rather than handed to the VFS. `caches` is absent in the node env (see cache-store.test.ts),
 * so these run on the no-cache path — which is exactly the insecure-context path real phones take. The
 * Cache-Storage half is covered in-browser by `e2e/asset-fetch-loader.spec.ts`.
 */

const MANIFEST_URL = 'https://cdn.test/games/sa-1/manifest.json';

interface ChunkSpec {
  bytes: number;
  cached: boolean;
  file: string;
}

const chunk = (file: string, bytes: number, cached: boolean): ChunkSpec => ({ bytes, cached, file });

/** A Response whose body streams `bytes` in one read — enough for the loader's reader loop. */
function bodyResponse(bytes: Uint8Array): Response {
  return {
    body: {
      getReader: () => {
        let sent = false;

        return {
          read: (): Promise<{ done: boolean; value?: Uint8Array }> => {
            if (sent) {
              return Promise.resolve({ done: true });
            }
            sent = true;

            return Promise.resolve({ done: false, value: bytes });
          },
        };
      },
    },
    ok: true,
    status: 200,
  } as unknown as Response;
}

/** A manifest with one chunk per named group; `data` is the always-fresh liveness probe. */
function manifestJson(groups: Partial<Record<GroupName, ChunkSpec[]>>): unknown {
  const entry = (spec: ChunkSpec): unknown => ({
    bytes: spec.bytes,
    cached: spec.cached,
    entries: 1,
    file: spec.file,
    hash: 'aaaaaaaaaaaa',
  });

  return {
    chunks: {
      data: (groups.data ?? []).map(entry),
      models: (groups.models ?? []).map(entry),
      others: (groups.others ?? []).map(entry),
      textures: (groups.textures ?? []).map(entry),
    },
    game: 'sa',
    version: '1',
  };
}

const notFound = (): Response => ({ body: null, ok: false, status: 404 }) as unknown as Response;

const jsonResponse = (json: unknown): Response =>
  ({ json: () => Promise.resolve(json), ok: true, status: 200 }) as unknown as Response;

/** Records everything the sink is handed, so a test can assert what actually reached the VFS. */
function recordingSink(): { addChunk: () => void; added: { file: string; group: GroupName }[]; addFiles: () => void } {
  const added: { file: string; group: GroupName }[] = [];

  return {
    addChunk: ((group: GroupName, file: string) => {
      added.push({ file, group });
    }) as never,
    added,
    addFiles: () => undefined,
  };
}

let fetchMock: MockInstance;

beforeEach(() => {
  fetchMock = vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AssetFetchLoader', () => {
  describe('negative cases', () => {
    it('rejects and wipes nothing extra when the manifest 404s (build revoked)', async () => {
      fetchMock.mockResolvedValue(notFound());
      const loader = new AssetFetchLoader({ manifestUrl: MANIFEST_URL });

      await expect(loader.init()).rejects.toThrow('manifest fetch failed: 404');
    });

    it('rejects a manifest that parses but is structurally wrong', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ chunks: {}, game: 'sa', version: '1' }));
      const loader = new AssetFetchLoader({ manifestUrl: MANIFEST_URL });

      await expect(loader.init()).rejects.toThrow('manifest.chunks.data is not an array');
    });

    it('never delivers a cacheable chunk when the always-fresh probe fails FIRST — the atomic revoke', async () => {
      // This is the ordering guarantee in `load`: the `data` group is fetched before anything cacheable,
      // so a revoked build cannot leave a half-populated cache behind.
      const sink = recordingSink();
      fetchMock.mockImplementation((input: unknown) => {
        const url = String(input);
        if (url === MANIFEST_URL) {
          return Promise.resolve(
            jsonResponse(
              manifestJson({ data: [chunk('probe.zip', 4, false)], models: [chunk('models.zip', 4, true)] }),
            ),
          );
        }

        return Promise.resolve(url.endsWith('probe.zip') ? notFound() : bodyResponse(new Uint8Array(4)));
      });
      const loader = new AssetFetchLoader({ manifestUrl: MANIFEST_URL, sink });
      const errors: AssetLoaderEvents['error'][] = [];
      loader.events.on('error', (event) => errors.push(event));

      await expect(loader.load()).rejects.toThrow('chunk fetch failed: probe.zip');
      expect(sink.added).toEqual([]); // models.zip was never even attempted
      expect(errors.map((event) => event.file)).toEqual(['probe.zip']);
    });

    it('rejects a truncated chunk rather than handing short bytes to the sink', async () => {
      const sink = recordingSink();
      fetchMock.mockImplementation((input: unknown) =>
        Promise.resolve(
          String(input) === MANIFEST_URL
            ? jsonResponse(manifestJson({ data: [chunk('probe.zip', 100, false)] }))
            : bodyResponse(new Uint8Array(7)), // manifest says 100
        ),
      );
      const loader = new AssetFetchLoader({ manifestUrl: MANIFEST_URL, sink });

      await expect(loader.load()).rejects.toThrow('size mismatch: 7 != 100');
      expect(sink.added).toEqual([]);
    });

    it('rejects a chunk whose hash disagrees when verifyHash is on', async () => {
      fetchMock.mockImplementation((input: unknown) =>
        Promise.resolve(
          String(input) === MANIFEST_URL
            ? jsonResponse(manifestJson({ data: [chunk('probe.zip', 4, false)] }))
            : bodyResponse(new Uint8Array([1, 2, 3, 4])),
        ),
      );
      const loader = new AssetFetchLoader({ manifestUrl: MANIFEST_URL, verifyHash: true });

      await expect(loader.load()).rejects.toThrow('hash mismatch');
    });

    it('emits an error event carrying the failing file before rethrowing', async () => {
      fetchMock.mockImplementation((input: unknown) =>
        Promise.resolve(
          String(input) === MANIFEST_URL
            ? jsonResponse(manifestJson({ models: [chunk('models.zip', 4, true)] }))
            : notFound(),
        ),
      );
      const loader = new AssetFetchLoader({ manifestUrl: MANIFEST_URL });
      const errors: AssetLoaderEvents['error'][] = [];
      loader.events.on('error', (event) => errors.push(event));

      await expect(loader.load()).rejects.toThrow();
      expect(errors).toHaveLength(1);
      expect(errors[0].file).toBe('models.zip');
    });
  });

  describe('positive cases', () => {
    it('fetches the manifest with no-store so a revoked build is never read from the HTTP cache', async () => {
      fetchMock.mockResolvedValue(jsonResponse(manifestJson({ data: [chunk('probe.zip', 4, false)] })));
      const loader = new AssetFetchLoader({ manifestUrl: MANIFEST_URL });

      const manifest = await loader.init();
      expect(manifest.game).toBe('sa');
      expect(fetchMock).toHaveBeenCalledWith(MANIFEST_URL, { cache: 'no-store' });
    });

    it('resolves chunk URLs against the manifest directory', async () => {
      fetchMock.mockImplementation((input: unknown) =>
        Promise.resolve(
          String(input) === MANIFEST_URL
            ? jsonResponse(manifestJson({ data: [chunk('probe.zip', 4, false)] }))
            : bodyResponse(new Uint8Array(4)),
        ),
      );
      await new AssetFetchLoader({ manifestUrl: MANIFEST_URL }).load();

      expect(fetchMock).toHaveBeenCalledWith('https://cdn.test/games/sa-1/probe.zip');
    });

    it('delivers every requested group to the sink, probe group first', async () => {
      const sink = recordingSink();
      fetchMock.mockImplementation((input: unknown) =>
        Promise.resolve(
          String(input) === MANIFEST_URL
            ? jsonResponse(
                manifestJson({
                  data: [chunk('probe.zip', 4, false)],
                  models: [chunk('models.zip', 4, true)],
                  others: [chunk('others.zip', 4, true)],
                }),
              )
            : bodyResponse(new Uint8Array(4)),
        ),
      );
      const loader = new AssetFetchLoader({ concurrency: 1, manifestUrl: MANIFEST_URL, sink });

      await loader.load();
      expect(sink.added[0]).toEqual({ file: 'probe.zip', group: 'data' });
      expect(sink.added.map((entry) => entry.file).sort()).toEqual(['models.zip', 'others.zip', 'probe.zip']);
    });

    it('loads only the requested groups', async () => {
      const sink = recordingSink();
      fetchMock.mockImplementation((input: unknown) =>
        Promise.resolve(
          String(input) === MANIFEST_URL
            ? jsonResponse(
                manifestJson({
                  data: [chunk('probe.zip', 4, false)],
                  textures: [chunk('textures.zip', 4, true)],
                }),
              )
            : bodyResponse(new Uint8Array(4)),
        ),
      );
      await new AssetFetchLoader({ manifestUrl: MANIFEST_URL, sink }).load(['data']);

      expect(sink.added.map((entry) => entry.file)).toEqual(['probe.zip']);
    });

    it('load() initialises itself when init was never called', async () => {
      fetchMock.mockImplementation((input: unknown) =>
        Promise.resolve(
          String(input) === MANIFEST_URL
            ? jsonResponse(manifestJson({ data: [chunk('probe.zip', 4, false)] }))
            : bodyResponse(new Uint8Array(4)),
        ),
      );
      const loader = new AssetFetchLoader({ manifestUrl: MANIFEST_URL });

      await expect(loader.load()).resolves.toBeUndefined();
    });

    it('reports each chunk through the lifecycle and finishes at 100 % progress', async () => {
      fetchMock.mockImplementation((input: unknown) =>
        Promise.resolve(
          String(input) === MANIFEST_URL
            ? jsonResponse(manifestJson({ data: [chunk('probe.zip', 4, false)] }))
            : bodyResponse(new Uint8Array(4)),
        ),
      );
      const loader = new AssetFetchLoader({ manifestUrl: MANIFEST_URL });
      const statuses: string[] = [];
      const ready: string[] = [];
      loader.events.on('chunk', (event: AssetLoaderEvents['chunk']) => statuses.push(event.status));
      loader.events.on('chunkReady', (event: AssetLoaderEvents['chunkReady']) => ready.push(event.file));

      await loader.load();
      expect(statuses).toContain('downloading');
      expect(statuses[statuses.length - 1]).toBe('done');
      expect(ready).toEqual(['probe.zip']);
    });

    it('runs downloads concurrently up to the configured limit', async () => {
      let inFlight = 0;
      let peak = 0;
      const files = ['a.zip', 'b.zip', 'c.zip', 'd.zip', 'e.zip'];
      fetchMock.mockImplementation(async (input: unknown) => {
        if (String(input) === MANIFEST_URL) {
          return jsonResponse(manifestJson({ models: files.map((file) => chunk(file, 4, true)) }));
        }
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight -= 1;

        return bodyResponse(new Uint8Array(4));
      });

      await new AssetFetchLoader({ concurrency: 2, manifestUrl: MANIFEST_URL }).load();
      expect(peak).toBeLessThanOrEqual(2);
      expect(peak).toBeGreaterThan(1); // proves the runner really parallelises
    });

    it('assembles a chunk streamed in several reads', async () => {
      const readerResponse = (parts: Uint8Array[]): Response =>
        ({
          body: {
            getReader: () => {
              let index = 0;

              return {
                read: (): Promise<{ done: boolean; value?: Uint8Array }> =>
                  Promise.resolve(index < parts.length ? { done: false, value: parts[index++] } : { done: true }),
              };
            },
          },
          ok: true,
          status: 200,
        }) as unknown as Response;

      const delivered: Uint8Array[] = [];
      fetchMock.mockImplementation((input: unknown) =>
        Promise.resolve(
          String(input) === MANIFEST_URL
            ? jsonResponse(manifestJson({ data: [chunk('probe.zip', 5, false)] }))
            : readerResponse([new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])]),
        ),
      );
      const loader = new AssetFetchLoader({ manifestUrl: MANIFEST_URL });
      loader.events.on('chunkReady', (event: AssetLoaderEvents['chunkReady']) => delivered.push(event.bytes));

      await loader.load();
      expect([...delivered[0]]).toEqual([1, 2, 3, 4, 5]);
    });
  });
});

describe('openWorld (plan 086 phase 3)', () => {
  describe('negative cases', () => {
    it('returns null without a files view or for an absent pak file', async () => {
      const bare = new AssetFetchLoader({ manifestUrl: 'http://x/manifest.json' });
      expect(await bare.openWorld('world.ospak')).toBeNull();

      const empty = new AssetFetchLoader({
        files: { get: (): ArrayBuffer | null => null },
        manifestUrl: 'http://x/manifest.json',
      });
      expect(await empty.openWorld('world.ospak')).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('serves pak/<name> from the delivered files (phase 8), lowercased', async () => {
      const loader = new AssetFetchLoader({
        files: {
          get: (name): ArrayBuffer | null => (name === 'pak/world.ospak' ? new Uint8Array([8, 8]).buffer : null),
        },
        manifestUrl: 'http://x/manifest.json',
      });

      const blob = await loader.openWorld('WORLD.OSPAK');
      expect(blob).not.toBeNull();
      expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(new Uint8Array([8, 8]));
    });

    it('falls back to the legacy opensa/<name> key of older chunk sets', async () => {
      const loader = new AssetFetchLoader({
        files: {
          get: (name): ArrayBuffer | null => (name === 'opensa/world.ospak' ? new Uint8Array([7, 7]).buffer : null),
        },
        manifestUrl: 'http://x/manifest.json',
      });

      const blob = await loader.openWorld('WORLD.OSPAK');
      expect(blob).not.toBeNull();
      expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(new Uint8Array([7, 7]));
    });
  });
});
