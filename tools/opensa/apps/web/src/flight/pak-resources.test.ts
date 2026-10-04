import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PakResources } from './pak-resources';

const BASE = '/fixtures';
/** A synthetic pre-audio pak manifest: complete except that its `replayAssets.version` is 1. */
const OLD_PAK = readFileSync(new URL('./fixtures/index-v1.json', import.meta.url), 'utf8');
const HANDLING = '# handling fixture\nHYDRA 1600.0 1.0 5.0\n';
const AUDIO_MANIFEST = {
  samples: [
    {
      bankName: 'SND_BANK_GENRL_SINGLEPROP',
      category: 'engine accelerate',
      file: 'engine-accelerate.wav',
      globalBankId: 120,
      headroom: 0,
      loopStartFrame: 0,
      packageBankIndex: 113,
      pcmBytes: 4,
      sampleRateHz: 21950,
      setSoundCount: 2,
      slotId: 7,
      slotName: 'DUMMY_ENGINE_0',
      soundIndex: 0,
      wavBytes: 48,
      wavFrames: 2,
    },
  ],
  source: 'audio/SFX/GENRL',
  version: 8,
};

function stubRoutes(routes: Record<string, string | Uint8Array>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const key = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const route = routes[key];
      if (route === undefined) return new Response('not found', { status: 404 });
      // Copy the view's bytes into a plain ArrayBuffer: `Response` rejects a `SharedArrayBuffer`-backed view.
      const body =
        typeof route === 'string'
          ? route
          : (route.buffer as ArrayBuffer).slice(route.byteOffset, route.byteOffset + route.byteLength);

      return new Response(body);
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PakResources.load', () => {
  describe('negative cases', () => {
    it('rejects a complete-looking version-1 pak with a re-bake error (stale state must not boot)', async () => {
      stubRoutes({ [`${BASE}/index.json`]: OLD_PAK });

      await expect(PakResources.load(BASE)).rejects.toThrow(/version=1[\s\S]*re-bake required/);
    });

    it('rejects a manifest without replayAssets.version the same way', async () => {
      stubRoutes({
        [`${BASE}/index.json`]: JSON.stringify({ replayAssets: { aircraft: { '476': 'rustler', '520': 'hydra' } } }),
      });

      await expect(PakResources.load(BASE)).rejects.toThrow(/缺失[\s\S]*re-bake required/);
    });

    it('rejects the old single-sample collision audio lane and asks for a re-bake', async () => {
      stubRoutes({
        [`${BASE}/audio/manifest.json`]: JSON.stringify({ ...AUDIO_MANIFEST, version: 3 }),
        ...Object.fromEntries(
          ['carcols.dat', 'handling.cfg', 'timecyc.dat', 'vehicles.ide', 'water.dat'].map((name) => [
            `${BASE}/data/${name}`,
            name,
          ]),
        ),
        [`${BASE}/index.json`]: JSON.stringify({
          replayAssets: {
            aircraft: { '476': 'rustler', '520': 'hydra' },
            audio: { manifest: 'manifest.json' },
            version: 3,
          },
        }),
      });
      await expect(PakResources.load(BASE)).rejects.toThrow(/音效包版本过旧/);
    });

    it.each([5, 6, 7])('rejects stale v%s engine samples and requires a re-bake', async (version) => {
      stubRoutes({
        [`${BASE}/audio/manifest.json`]: JSON.stringify({ ...AUDIO_MANIFEST, version }),
        ...Object.fromEntries(
          ['carcols.dat', 'handling.cfg', 'timecyc.dat', 'vehicles.ide', 'water.dat'].map((name) => [
            `${BASE}/data/${name}`,
            name,
          ]),
        ),
        [`${BASE}/index.json`]: JSON.stringify({
          replayAssets: {
            aircraft: { '476': 'rustler', '520': 'hydra' },
            audio: { manifest: 'manifest.json' },
            version: 3,
          },
        }),
      });
      await expect(PakResources.load(BASE)).rejects.toThrow(/音效包版本过旧/);
    });

    it('names the missing handling.cfg when a version-3 pak lacks it', async () => {
      stubRoutes({
        [`${BASE}/data/carcols.dat`]: 'carcols',
        [`${BASE}/data/timecyc.dat`]: 'timecyc',
        [`${BASE}/data/vehicles.ide`]: 'vehicles',
        [`${BASE}/data/water.dat`]: 'water',
        [`${BASE}/index.json`]: JSON.stringify({
          replayAssets: { aircraft: { '476': 'rustler', '520': 'hydra' }, data: ['handling.cfg'], version: 3 },
        }),
      });

      await expect(PakResources.load(BASE)).rejects.toThrow('data/handling.cfg');
    });
  });

  describe('positive cases', () => {
    it('loads a version-3 pak and serves handling.cfg through getText', async () => {
      stubRoutes({
        [`${BASE}/audio/engine-accelerate.wav`]: new Uint8Array([82, 73, 70, 70]),
        [`${BASE}/audio/manifest.json`]: JSON.stringify(AUDIO_MANIFEST),
        [`${BASE}/data/carcols.dat`]: 'carcols',
        [`${BASE}/data/handling.cfg`]: HANDLING,
        [`${BASE}/data/timecyc.dat`]: 'timecyc',
        [`${BASE}/data/vehicles.ide`]: 'vehicles',
        [`${BASE}/data/water.dat`]: 'water',
        [`${BASE}/index.json`]: JSON.stringify({
          replayAssets: {
            aircraft: { '476': 'rustler', '520': 'hydra' },
            audio: { files: ['engine-accelerate.wav'], manifest: 'manifest.json' },
            data: ['timecyc.dat', 'water.dat', 'vehicles.ide', 'carcols.dat', 'handling.cfg'],
            fx: [],
            version: 3,
          },
        }),
      });

      const resources = await PakResources.load(BASE);

      expect(resources.getText('data/handling.cfg')).toBe(HANDLING);
      expect(resources.getText('data/timecyc.dat')).toBe('timecyc');
      expect(resources.getFxpText()).toBeNull();
    });

    it('exposes the audio manifest bank/slot provenance and the baked sample bytes', async () => {
      stubRoutes({
        [`${BASE}/audio/engine-accelerate.wav`]: new Uint8Array([82, 73, 70, 70]),
        [`${BASE}/audio/manifest.json`]: JSON.stringify(AUDIO_MANIFEST),
        [`${BASE}/data/carcols.dat`]: 'carcols',
        [`${BASE}/data/handling.cfg`]: HANDLING,
        [`${BASE}/data/timecyc.dat`]: 'timecyc',
        [`${BASE}/data/vehicles.ide`]: 'vehicles',
        [`${BASE}/data/water.dat`]: 'water',
        [`${BASE}/index.json`]: JSON.stringify({
          replayAssets: {
            aircraft: { '476': 'rustler', '520': 'hydra' },
            audio: { files: ['engine-accelerate.wav'], manifest: 'manifest.json' },
            data: ['timecyc.dat', 'water.dat', 'vehicles.ide', 'carcols.dat', 'handling.cfg'],
            version: 3,
          },
        }),
      });

      const resources = await PakResources.load(BASE);

      expect(resources.getAudioManifest()?.samples.map((sample) => sample.category)).toEqual(['engine accelerate']);
      expect(resources.getAudioManifest()?.samples[0]).toMatchObject({
        bankName: 'SND_BANK_GENRL_SINGLEPROP',
        globalBankId: 120,
        slotId: 7,
        slotName: 'DUMMY_ENGINE_0',
        soundIndex: 0,
      });
      expect(resources.getAudioSample('engine-accelerate.wav')).toEqual(new Uint8Array([82, 73, 70, 70]));
      expect(resources.getAudioSample('missing.wav')).toBeNull();
    });
  });
});
