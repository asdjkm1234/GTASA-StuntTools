import { describe, expect, it } from 'vitest';

import { probeWebGpu, webGpuGateMessage } from './webgpu-gate';

/** Minimal GPU stand-in returning the given adapter (or throwing when `fail` is set). */
function fakeGpu(adapter: null | { features: Set<string> }, fail = false): Parameters<typeof probeWebGpu>[0] {
  return {
    requestAdapter: (): Promise<GPUAdapter | null> => {
      if (fail) {
        return Promise.reject(new Error('adapter request failed'));
      }

      return Promise.resolve(adapter as GPUAdapter | null);
    },
  };
}

describe('probeWebGpu', () => {
  describe('negative cases', () => {
    it('reports no API when navigator.gpu is absent', async () => {
      expect(await probeWebGpu(undefined)).toBe('no-api');
      expect(await probeWebGpu(null)).toBe('no-api');
    });

    it('separates a refused ADAPTER from a missing API — the phone case is the first one', async () => {
      expect(await probeWebGpu(fakeGpu(null))).toBe('no-adapter');
    });

    it('treats a thrown request as a refused adapter: the API answered, so it is present', async () => {
      expect(await probeWebGpu(fakeGpu(null, true))).toBe('no-adapter');
    });
  });

  describe('positive cases', () => {
    it('reports ok for an adapter with BC texture compression', async () => {
      expect(await probeWebGpu(fakeGpu({ features: new Set(['texture-compression-bc']) }))).toBe('ok');
    });

    // The gate answers about the DEVICE only. A mobile adapter carries ASTC/ETC2 and no BC, and its browser
    // runs WebGPU fine — whether the world it is about to load is displayable is the manifest's question.
    it('reports ok for a mobile adapter without BC', async () => {
      expect(await probeWebGpu(fakeGpu({ features: new Set(['texture-compression-astc']) }))).toBe('ok');
    });
  });
});

describe('webGpuGateMessage', () => {
  describe('negative cases', () => {
    it('does not tell a browser that HAS WebGPU that it lacks it', () => {
      const message = webGpuGateMessage('no-adapter');

      expect(message).not.toMatch(/does not have it/);
      expect(message).not.toMatch(/use a recent Chrome/i);
    });
  });

  describe('positive cases', () => {
    it('names the browser as the thing to change when the API is absent', () => {
      expect(webGpuGateMessage('no-api')).toMatch(/recent Chrome or Edge/);
    });

    it('names the blocklist and the flags when the adapter is refused — the two real causes', () => {
      const message = webGpuGateMessage('no-adapter');

      expect(message).toMatch(/blocklist/);
      expect(message).toMatch(/flags/);
      expect(message).toMatch(/Android/);
    });
  });
});
