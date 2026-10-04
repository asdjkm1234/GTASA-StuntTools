/**
 * Boots the http-dir loader end-to-end over a stubbed HTTP server (plan 079 phase 1) — the harness's real
 * load path. Proves `resolveSource` wires `fetchDirIndex` + `fetchInstallSource` against `base`, and that the
 * shared `InstallSourceLoader` boot (init → manifest, load → sink, openWorld → `opensa/`) runs against a
 * served build with no folder picker.
 */
import { buildVer2Buffer } from '@opensa/renderware/archive';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DirIndexEntry } from './fetch-install-source';

import { AssetHttpDirLoader } from './asset-http-dir-loader';

const BASE = 'http://host/build/original/opensa';

const GTA3 = buildVer2Buffer([
  { data: new Uint8Array([1]), name: 'cj.dff' },
  { data: new Uint8Array([2]), name: 'cjtxd.txd' },
  { data: new Uint8Array([3]), name: 'la.col' },
]);

const FILES: Record<string, Uint8Array> = {
  'data/gta.dat': new TextEncoder().encode('x'),
  'data/maps/test.ide': new TextEncoder().encode(['objs', '100, cj, cjtxd, 100, 0', 'end'].join('\n')),
  'data/maps/test.ipl': new TextEncoder().encode(['inst', '100, cj, 0, 0, 0, 0, 0, 0, 0, 1, 0', 'end'].join('\n')),
  'models/gta3.img': GTA3,
  'opensa/manifest.json': new TextEncoder().encode('{"version":1,"buildTime":"07:52 21-07-2026"}'),
  'opensa/world.ospak': new Uint8Array([9, 9, 9]),
};

function make(): AssetHttpDirLoader {
  return new AssetHttpDirLoader({ game: 'gta-sa', version: '1.0.0' }, BASE);
}

/** Stub `fetch` for a served build: `__index` returns the listing, every file GET/Range returns its bytes. */
function serveBuild(files: Record<string, Uint8Array>, base = BASE): void {
  const index: DirIndexEntry[] = Object.entries(files).map(([path, bytes]) => ({ path, size: bytes.length }));
  const respond = (body: null | Uint8Array, status: number): Response =>
    ({
      arrayBuffer: () => Promise.resolve((body ?? new Uint8Array()).slice().buffer),
      blob: () => Promise.resolve(new Blob([(body ?? new Uint8Array()) as BlobPart])),
      json: () => Promise.resolve(index),
      ok: status >= 200 && status < 300,
      status,
      text: () => Promise.resolve(new TextDecoder().decode(body ?? new Uint8Array())),
    }) as Response;

  vi.stubGlobal('fetch', (input: string, init?: RequestInit) => {
    if (input === `${base}/__index`) {
      return Promise.resolve(respond(new Uint8Array(), 200));
    }
    const bytes = files[input.slice(base.length + 1).toLowerCase()];
    if (!bytes) {
      return Promise.resolve(respond(null, 404));
    }
    const range = (init?.headers as Record<string, string> | undefined)?.Range;
    const match = range ? /bytes=(\d+)-(\d+)/.exec(range) : null;

    return match
      ? Promise.resolve(respond(bytes.slice(Number(match[1]), Number(match[2]) + 1), 206))
      : Promise.resolve(respond(bytes, 200));
  });
}

describe('AssetHttpDirLoader', () => {
  afterEach(() => vi.unstubAllGlobals());

  describe('negative cases', () => {
    it('init rejects with a serve:static hint when the served dir has no __index', async () => {
      vi.stubGlobal('fetch', () => Promise.resolve({ ok: false, status: 404 } as Response));

      await expect(make().init()).rejects.toThrow(/serve:static/);
    });

    it('openWorld returns null for a pak file the served dir does not have', async () => {
      serveBuild(FILES);

      expect(await make().openWorld('absent.ospak')).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('init synthesises a manifest labelled with the loader config', async () => {
      serveBuild(FILES);

      const manifest = await make().init();

      expect(manifest.game).toBe('gta-sa');
      expect(manifest.version).toBe('1.0.0');
    });

    it('load ingests each group into the sink under a per-group synthetic chunk id', async () => {
      serveBuild(FILES);
      const chunks: string[] = [];
      const loader = new AssetHttpDirLoader(
        { game: 'gta-sa', sink: { addFiles: (id): void => void chunks.push(id) }, version: '1.0.0' },
        BASE,
      );

      await loader.load();

      expect(chunks.sort()).toEqual(['local-data', 'local-models', 'local-others', 'local-textures']);
    });

    it('openWorld reads opensa/<name> lowercased from the served dir (legacy nested pak)', async () => {
      serveBuild(FILES);

      const world = await make().openWorld('World.OSPAK');
      expect(world).not.toBeNull();
      expect(Array.from(new Uint8Array(await world!.arrayBuffer()))).toEqual([9, 9, 9]);
    });

    it('reads the pak from the game dir’s pak/ folder (086 phase 8 — the self-contained layout)', async () => {
      const files: Record<string, Uint8Array> = {
        ...Object.fromEntries(Object.entries(FILES).filter(([path]) => !path.startsWith('opensa/'))),
        'pak/manifest.json': new TextEncoder().encode('{"version":1}'),
        'pak/world.ospak': new Uint8Array([8, 8]),
      };
      serveBuild(files);

      const world = await make().openWorld('world.ospak');
      expect(world).not.toBeNull();
      expect(Array.from(new Uint8Array(await world!.arrayBuffer()))).toEqual([8, 8]);
    });

    it('boots from a pmb BUILD ROOT too (phase-8 game dir under opensa/, sa/ ignored)', async () => {
      const root = 'http://host/build/original';
      const files: Record<string, Uint8Array> = {
        'sa/models/gta3.img': new Uint8Array([1]), // the real-SA target — must be ignored, not booted
        ...Object.fromEntries(
          Object.entries(FILES)
            .filter(([path]) => !path.startsWith('opensa/'))
            .map(([path, bytes]) => [`opensa/${path}`, bytes]),
        ),
        'opensa/pak/manifest.json': new TextEncoder().encode('{"version":1}'),
        'opensa/pak/world.ospak': new Uint8Array([7, 7]),
      };
      serveBuild(files, root);
      const loader = new AssetHttpDirLoader({ game: 'gta-sa', version: '1.0.0' }, root);

      expect((await loader.init()).game).toBe('gta-sa');
      const world = await loader.openWorld('world.ospak');
      expect(world).not.toBeNull();
      expect(Array.from(new Uint8Array(await world!.arrayBuffer()))).toEqual([7, 7]);
    });
  });
});
