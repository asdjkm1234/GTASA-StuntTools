/**
 * Defends the served-dir load path (plan 079 phase 1): a game dir behind an HTTP server with Range support
 * resolves gta3.img + mod override archives + loose files exactly like the File System Access backing, so the
 * lab, the harness and the app read one canonical build without a folder picker.
 */
import { buildVer2Buffer } from '@opensa/renderware/archive';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DirIndexEntry } from './fetch-install-source';

import { fetchDirIndex, fetchInstallSource } from './fetch-install-source';

const BASE = 'http://host/build/original/opensa';

const GTA3 = buildVer2Buffer([
  { data: new Uint8Array([1, 2, 3, 4]), name: 'cj.dff' },
  { data: new Uint8Array([5, 5]), name: 'dup.dff' },
]);
const GTA_INT = buildVer2Buffer([{ data: new Uint8Array([7, 7]), name: 'dup.dff' }]);
const MOD_IMG = buildVer2Buffer([{ data: new Uint8Array([9, 9]), name: 'lod_5_5.dff' }]);

/** A served game dir: lowercased path → bytes. */
function serve(files: Record<string, Uint8Array>): DirIndexEntry[] {
  const respond = (body: null | Uint8Array, status: number): Response =>
    ({
      arrayBuffer: () => Promise.resolve((body ?? new Uint8Array()).slice().buffer),
      blob: () => Promise.resolve(new Blob([(body ?? new Uint8Array()) as BlobPart])),
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(new TextDecoder().decode(body ?? new Uint8Array())),
    }) as Response;

  // fetchInstallSource only ever calls fetch with string URLs, so the mock narrows to that.
  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => {
    const path = input.slice(BASE.length + 1);
    const bytes = files[path.toLowerCase()];
    if (!bytes) {
      return Promise.resolve(respond(null, 404));
    }
    const range = (init?.headers as Record<string, string> | undefined)?.Range;
    const match = range ? /bytes=(\d+)-(\d+)/.exec(range) : null;
    if (match) {
      return Promise.resolve(respond(bytes.slice(Number(match[1]), Number(match[2]) + 1), 206));
    }

    return Promise.resolve(respond(bytes, 200));
  });

  return Object.entries(files).map(([path, bytes]) => ({ path, size: bytes.length }));
}

describe('fetchInstallSource', () => {
  afterEach(() => vi.unstubAllGlobals());

  describe('negative cases', () => {
    it('rejects when gta3.img is absent from the index', async () => {
      const index = serve({ 'data/gta.dat': new TextEncoder().encode('x') });

      await expect(fetchInstallSource(BASE, index)).rejects.toThrow(/gta3\.img not found/i);
    });

    it('rejects reading a loose file the server 404s', async () => {
      const index = serve({ 'data/gta.dat': new Uint8Array([1]), 'models/gta3.img': GTA3 });
      const source = await fetchInstallSource(BASE, index);

      await expect(source.readLoose('data/missing.ide')).rejects.toThrow(/loose file not found: data\/missing\.ide/);
    });
  });

  describe('positive cases', () => {
    let index: DirIndexEntry[];

    beforeEach(() => {
      index = serve({
        'anim/anim.img': new Uint8Array([0]),
        'data/gta.dat': new TextEncoder().encode('IDE data/x.ide'),
        'models/gta3.img': GTA3,
        'models/gta_int.img': GTA_INT,
        'models/lods.img': MOD_IMG,
        'opensa/manifest.json': new TextEncoder().encode('{"version":1}'),
      });
    });

    it('opens gta3.img over Range and reads an entry', async () => {
      const source = await fetchInstallSource(BASE, index);

      // VER2 entries are sector-granular, so reads come back padded — consumers parse by content length.
      expect(Array.from((await source.gta3.read('cj.dff'))!.subarray(0, 4))).toEqual([1, 2, 3, 4]);
    });

    it('merges every other models/*.img as one override, gta_int winning ties', async () => {
      const source = await fetchInstallSource(BASE, index);

      expect(source.gtaInt?.has('lod_5_5.dff')).toBe(true); // the mod archive
      expect(Array.from((await source.gtaInt!.read('dup.dff'))!.subarray(0, 2))).toEqual([7, 7]); // gta_int wins
    });

    it('lists only loose files (no img archives, no anim)', async () => {
      const source = await fetchInstallSource(BASE, index);

      expect((await source.looseFiles()).sort()).toEqual(['data/gta.dat', 'opensa/manifest.json']);
    });

    it('opens a loose file as a Blob and reports absence as null', async () => {
      const source = await fetchInstallSource(BASE, index);

      expect(await (await source.openLoose('opensa/manifest.json'))!.text()).toBe('{"version":1}');
      expect(await source.openLoose('opensa/absent.bin')).toBeNull();
    });

    it('decodes loose text', async () => {
      const source = await fetchInstallSource(BASE, index);

      expect(await source.readLooseText('data/gta.dat')).toBe('IDE data/x.ide');
    });
  });
});

describe('fetchDirIndex', () => {
  afterEach(() => vi.unstubAllGlobals());

  describe('negative cases', () => {
    it('rejects with a serve:static hint when __index 404s', async () => {
      vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, status: 404 } as Response));

      await expect(fetchDirIndex('http://host/x')).rejects.toThrow(/no __index at http:\/\/host\/x\/__index \(404\)/);
      await expect(fetchDirIndex('http://host/x')).rejects.toThrow(/serve:static/);
    });
  });

  describe('positive cases', () => {
    it('fetches ${base}/__index and returns the parsed listing', async () => {
      const listing: DirIndexEntry[] = [{ path: 'models/gta3.img', size: 4 }];
      let requested = '';
      vi.stubGlobal('fetch', (input: string) => {
        requested = input;

        return Promise.resolve({ json: () => Promise.resolve(listing), ok: true } as Response);
      });

      expect(await fetchDirIndex('http://host/build/x')).toEqual(listing);
      expect(requested).toBe('http://host/build/x/__index');
    });
  });
});
