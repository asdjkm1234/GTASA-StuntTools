import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type MapCacheManifest, MapPakCache } from './map-pak-cache';

const origin = 'https://replay.example';
function setup() {
  const stored = new Map<string, Response>();
  let failPut = false;
  const cache = {
    delete: (key: string): Promise<boolean> => Promise.resolve(stored.delete(key)),
    keys: (): Promise<Request[]> => Promise.resolve([...stored.keys()].map((key) => new Request(key))),
    match: (key: string): Promise<Response | undefined> => Promise.resolve(stored.get(key)?.clone()),
    put: async (key: string, value: Response) => {
      await Promise.resolve();
      if (failPut && !key.includes('/manifest-')) throw new DOMException('Full', 'QuotaExceededError');
      stored.set(key, value.clone());
    },
  };
  vi.stubGlobal('location', { origin });
  vi.stubGlobal('caches', {
    delete: () => {
      stored.clear();

      return Promise.resolve(true);
    },
    open: () => Promise.resolve(cache),
  });
  vi.stubGlobal('navigator', {
    storage: { persist: () => Promise.resolve(true), persisted: () => Promise.resolve(false) },
  });
  const bodies = new Map([
    ['cells/0_0.bin', 'synthetic terrain'],
    ['index.json', '{}'],
    ['textures/0.ostex', 'synthetic texture'],
  ]);
  const downloads: string[] = [];
  let corrupt = false,
    failFile = '',
    offline = false;
  const manifest = (): MapCacheManifest => {
    const files = [...bodies].map(([path, value]) => ({
      bytes: Buffer.byteLength(value),
      path,
      sha256: createHash('sha256').update(value).digest('hex'),
    }));

    return { files, schema: 1, version: createHash('sha256').update(JSON.stringify(files)).digest('hex') };
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      await Promise.resolve();
      const url = new URL(input, origin);
      if (offline) throw new Error('Offline');
      if (url.pathname.endsWith('/cache-manifest.json')) return Response.json(manifest());
      const name = url.pathname.slice('/map-pak/'.length);
      downloads.push(name);
      if (name === failFile) throw new Error('Interrupted');

      return new Response(corrupt ? 'bad bytes' : bodies.get(name), { headers: { 'Content-Encoding': 'gzip' } });
    }),
  );

  return {
    bodies,
    corrupt: () => {
      corrupt = true;
    },
    downloads,
    fail: (name: string) => {
      failFile = name;
    },
    full: () => {
      failPut = true;
    },
    offline: () => {
      offline = true;
    },
    stored,
  };
}
afterEach(() => vi.unstubAllGlobals());
describe('MapPakCache', () => {
  it('deduplicates requests, survives reopening, and serves a completed map without network', async () => {
    const fixture = setup();
    const source = await MapPakCache.open('/map-pak');
    const results = await Promise.all([source.fetch('/map-pak/index.json'), source.fetch('/map-pak/index.json')]);
    expect(await results[0].text()).toBe('{}');
    expect(await results[1].text()).toBe('{}');
    expect(results[0].headers.has('Content-Encoding')).toBe(false);
    expect(fixture.downloads).toEqual(['index.json']);
    source.resume();
    await vi.waitFor(() => expect(source.state.phase).toBe('ready'));
    await source.requestPersistence();
    expect(source.state.persistent).toBe(true);
    fixture.offline();
    const reopened = await MapPakCache.open('/map-pak');
    expect(reopened.state.phase).toBe('ready');
    expect(await (await reopened.fetch('/map-pak/cells/0_0.bin')).text()).toBe('synthetic terrain');
    expect(fixture.downloads).toHaveLength(3);
  });
  it('resumes a partially saved map after an interrupted download and reopening', async () => {
    const fixture = setup();
    const first = await MapPakCache.open('/map-pak');
    await first.fetch('/map-pak/index.json');
    fixture.fail('cells/0_0.bin');
    first.resume();
    await vi.waitFor(() => expect(first.state.phase).toBe('interrupted'));
    fixture.fail('');
    const resumed = await MapPakCache.open('/map-pak');
    expect(resumed.state.savedFiles).toBe(1);
    resumed.resume();
    await vi.waitFor(() => expect(resumed.state.phase).toBe('ready'));
    expect(fixture.downloads.filter((name) => name === 'index.json')).toHaveLength(1);
  });
  it('reuses unchanged content and replaces only changed map files', async () => {
    const fixture = setup();
    const source = await MapPakCache.open('/map-pak');
    source.resume();
    await vi.waitFor(() => expect(source.state.phase).toBe('ready'));
    fixture.bodies.set('cells/0_0.bin', 'updated terrain');
    const updated = await MapPakCache.open('/map-pak');
    expect(updated.state.savedFiles).toBe(2);
    updated.resume();
    await vi.waitFor(() => expect(updated.state.phase).toBe('ready'));
    expect(await (await updated.fetch('/map-pak/cells/0_0.bin')).text()).toBe('updated terrain');
    expect([...fixture.downloads].sort()).toEqual(['cells/0_0.bin', 'cells/0_0.bin', 'index.json', 'textures/0.ostex']);
    expect(fixture.stored.size).toBe(4);
  });
  it('rejects corrupt bytes instead of marking a download complete', async () => {
    const fixture = setup();
    const source = await MapPakCache.open('/map-pak');
    fixture.corrupt();
    await expect(source.fetch('/map-pak/index.json')).rejects.toThrow('校验失败');
    expect(source.state.savedFiles).toBe(0);
    expect(fixture.stored.size).toBe(1);
  });
  it('keeps playback downloads usable when browser storage is full', async () => {
    const fixture = setup();
    const source = await MapPakCache.open('/map-pak');
    fixture.full();
    expect(await (await source.fetch('/map-pak/index.json')).text()).toBe('{}');
    expect(source.state.phase).toBe('limited');
    expect(source.state.savedFiles).toBe(0);
  });
  it('clears saved map data without changing the map source or requiring a reload', async () => {
    const fixture = setup();
    const source = await MapPakCache.open('/map-pak');
    source.resume();
    await vi.waitFor(() => expect(source.state.phase).toBe('ready'));
    await source.clear();
    expect(source.state.savedFiles).toBe(0);
    expect(source.state.phase).toBe('paused');
    expect(await (await source.fetch('/map-pak/index.json')).text()).toBe('{}');
    expect(fixture.downloads.filter((name) => name === 'index.json')).toHaveLength(2);
  });
  it('bounds transfers to two and promotes a queued background file needed by playback', async () => {
    const fixture = setup();
    fixture.bodies.set('extra.bin', 'extra');
    const original = globalThis.fetch;
    const started: string[] = [];
    const release = new Map<string, () => void>();
    vi.stubGlobal('fetch', (input: string) => {
      const url = new URL(input, origin);
      if (url.pathname.endsWith('/cache-manifest.json')) return original(input);
      const name = url.pathname.slice('/map-pak/'.length);
      started.push(name);

      return new Promise<Response>((resolve) =>
        release.set(name, () => resolve(new Response(fixture.bodies.get(name)))),
      );
    });
    const source = await MapPakCache.open('/map-pak');
    const a = source.fetch('/map-pak/index.json', true);
    const b = source.fetch('/map-pak/cells/0_0.bin', true);
    const c = source.fetch('/map-pak/textures/0.ostex', true);
    await vi.waitFor(() => expect(started).toHaveLength(2));
    const d = source.fetch('/map-pak/extra.bin');
    const promoted = source.fetch('/map-pak/textures/0.ostex');
    release.get('index.json')!();
    await vi.waitFor(() => expect(started).toHaveLength(3));
    expect(started[2]).toBe('textures/0.ostex');
    release.get('cells/0_0.bin')!();
    await vi.waitFor(() => expect(started).toHaveLength(4));
    release.get('textures/0.ostex')!();
    release.get('extra.bin')!();
    await Promise.all([a, b, c, d, promoted]);
    expect(started.filter((name) => name === 'textures/0.ostex')).toHaveLength(1);
  });
});
