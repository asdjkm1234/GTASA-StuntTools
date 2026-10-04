import { buildVer2Buffer } from '@opensa/renderware/archive';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openModelSource } from './model-source';

vi.mock('@opensa/loaders/model-osm', () => ({
  // The decode is `readModelOsm`'s own contract and has its own tests; what is on trial here is WHICH bytes
  // reach it, which archive they came out of, and what happens when there are none.
  // A VER2 read answers the whole SECTOR the entry occupies, padding included — that is the archive's own
  // shape and the container reader takes it, so the fixture keys on the payload rather than on the length.
  readModelOsm: (name: string, bytes: Uint8Array): unknown => ({ head: [...bytes.subarray(0, 4)], name }),
}));

const VEHICLES = buildVer2Buffer([{ data: new Uint8Array([1, 2, 3, 4]), name: 'copcarls.osm' }]);
const PEDS = buildVer2Buffer([{ data: new Uint8Array(7), name: 'lapd1.osm' }]);

/** Serve `files` over HEAD + Range, exactly as a static host does, and record every URL asked for. */
function serve(files: Record<string, Uint8Array>): string[] {
  const asked: string[] = [];
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    asked.push(`${init?.method ?? 'GET'} ${url}`);
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    const bytes = files[path];
    if (!bytes) {
      return Promise.resolve({ headers: new Headers(), ok: false, status: 404 } as Response);
    }
    if (init?.method === 'HEAD') {
      return Promise.resolve({
        headers: new Headers({ 'content-length': String(bytes.length) }),
        ok: true,
        status: 200,
      } as Response);
    }
    const range = /bytes=(\d+)-(\d+)/.exec(String((init?.headers as Record<string, string> | undefined)?.Range ?? ''));
    const slice = range ? bytes.subarray(Number(range[1]), Number(range[2]) + 1) : bytes;

    return Promise.resolve({
      arrayBuffer: () => Promise.resolve(slice.slice().buffer),
      ok: true,
      status: 206,
    } as unknown as Response);
  });

  return asked;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openModelSource', () => {
  describe('negative cases', () => {
    it('is nothing at all without a game dir — the demo world has no archives to read', () => {
      expect(openModelSource('')).toBeNull();
    });

    it('answers null for a build whose archives are not served, rather than throwing into the frame', async () => {
      serve({});
      const source = openModelSource('/build/original/opensa');

      expect(await source?.read('copcarls')).toBeNull();
      expect([...(source?.missing ?? [])]).toEqual(['copcarls']);
    });

    it('answers null for a name no archive carries, and remembers it as missing', async () => {
      serve({ '/build/original/opensa/models/vehicles.img': VEHICLES });
      const source = openModelSource('/build/original/opensa');

      expect(await source?.read('infernus')).toBeNull();
      expect([...(source?.missing ?? [])]).toEqual(['infernus']);
    });

    it('never asks for a DFF: an unconverted build carries no model this surface can draw', async () => {
      const asked = serve({
        '/build/original/opensa/models/vehicles.img': buildVer2Buffer([
          { data: new Uint8Array([1]), name: 'copcarls.dff' },
        ]),
      });
      const source = openModelSource('/build/original/opensa');

      expect(await source?.read('copcarls')).toBeNull();
      expect(asked.some((url) => url.includes('.dff'))).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('reads a converted car out of the vehicle archive by name', async () => {
      serve({ '/build/original/opensa/models/vehicles.img': VEHICLES });
      const source = openModelSource('/build/original/opensa');

      expect(await source?.read('copcarls')).toMatchObject({ head: [1, 2, 3, 4], name: 'copcarls' });
    });

    it('is case-insensitive about the name, the way the archive itself is', async () => {
      serve({ '/build/original/opensa/models/vehicles.img': VEHICLES });
      const source = openModelSource('/build/original/opensa');

      expect(await source?.read('CopCarLS')).toMatchObject({ head: [1, 2, 3, 4] });
    });

    it('falls through to the next archive when the first does not carry the model', async () => {
      serve({
        '/build/original/opensa/models/peds.img': PEDS,
        '/build/original/opensa/models/vehicles.img': VEHICLES,
      });
      const source = openModelSource('/build/original/opensa');

      expect(await source?.read('lapd1')).toMatchObject({ head: [0, 0, 0, 0], name: 'lapd1' });
    });

    it('opens each archive once, however many models the board asks for', async () => {
      const asked = serve({ '/build/original/opensa/models/vehicles.img': VEHICLES });
      const source = openModelSource('/build/original/opensa');
      await source?.read('copcarls');
      await source?.read('copcarls');

      expect(asked.filter((url) => url.startsWith('HEAD') && url.includes('vehicles.img'))).toHaveLength(1);
    });
  });
});
