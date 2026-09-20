import type { OspakManifest } from '@opensa/engine-formats';

import { OstexFormat } from '@opensa/engine-formats';
import { describe, expect, it, vi } from 'vitest';

import type { Engine } from '../engine';
import type { OpenedPak } from './setup';

import { requireWorldSupport, setupStreaming } from './setup';

/** A device exposing only what the gate asks of it. */
function deviceWith(...features: string[]): { features: { has(name: string): boolean } } {
  const set = new Set(features);

  return { features: { has: (name: string): boolean => set.has(name) } };
}

/** A manifest carrying one texture array in `format` — the only field the world gate reads. */
function manifestWith(format: number): OspakManifest {
  return {
    byteLength: 4096,
    cells: {},
    cellSize: 250,
    textures: { 'array-0': { format, hash: 0, height: 256, layers: 4, length: 8, offset: 0, width: 256 } },
    version: 1,
  };
}

describe('requireWorldSupport', () => {
  describe('negative cases', () => {
    it('rejects a BC world on a mobile GPU, naming the missing feature', () => {
      expect(() => requireWorldSupport(deviceWith('texture-compression-astc'), manifestWith(OstexFormat.BC3))).toThrow(
        /texture-compression-bc/,
      );
    });

    it('says the format was decided at build time, so the message points at the pak', () => {
      expect(() => requireWorldSupport(deviceWith(), manifestWith(OstexFormat.BC1))).toThrow(/opensa-pack --rgba8/);
    });
  });

  describe('positive cases', () => {
    it('passes a BC world on a desktop GPU', () => {
      expect(() =>
        requireWorldSupport(deviceWith('texture-compression-bc'), manifestWith(OstexFormat.BC3)),
      ).not.toThrow();
    });

    it('passes an RGBA8 world on a GPU with no compressed formats at all', () => {
      expect(() => requireWorldSupport(deviceWith(), manifestWith(OstexFormat.RGBA8))).not.toThrow();
    });
  });
});

/**
 * An engine exposing only what `setupStreaming` asks of it before the first cell exists. It is deliberately
 * not the fake device: this test is about the SEAM — an already-opened pak going in — and a real device
 * would say nothing more about it.
 */
function engineWith(...features: string[]): Engine {
  return {
    device: deviceWith(...features),
    setUvAnimations: (): void => undefined,
    textures: { load: (): void => undefined, setMissingLayers: (): void => undefined },
  } as unknown as Engine;
}

/** A pak already opened by `openPakSource` — the manifest read, the worker probed and listening. */
function openedPak(manifest: OspakManifest): OpenedPak {
  return {
    manifest,
    worker: { addEventListener: vi.fn(), postMessage: vi.fn(), removeEventListener: vi.fn() } as unknown as Worker,
  };
}

/**
 * The overlap seam (201/4-03): the pak's engine-free half runs beside `engine.init`, so `setupStreaming` has
 * to accept it already open. `Worker` does not exist in node and `fetch` is stubbed to throw here, which is
 * the point — a path that re-read the manifest or spun a second worker could not pass at all.
 */
describe('setupStreaming with an already-opened pak', () => {
  describe('negative cases', () => {
    it('still gates the world on the device, opened or not', async () => {
      await expect(
        setupStreaming(engineWith(), '/pak', {}, {}, openedPak(manifestWith(OstexFormat.BC3))),
      ).rejects.toThrow(/texture-compression-bc/);
    });
  });

  describe('positive cases', () => {
    it('reads neither the manifest nor a second worker', async () => {
      const fetchSpy = vi.fn(() => {
        throw new Error('the manifest was read twice');
      });
      vi.stubGlobal('fetch', fetchSpy);
      try {
        const setup = await setupStreaming(engineWith(), '/pak', {}, {}, openedPak(manifestWith(OstexFormat.RGBA8)));

        expect(setup.cellSize).toBe(250);
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
