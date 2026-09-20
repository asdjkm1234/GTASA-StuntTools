import { afterEach, describe, expect, it } from 'vitest';

import { installFakeWebGpu } from '../test/fake-device';
import { describeDevice, initDevice } from './device';

/**
 * The no-BC emulation gate (plan 200/1-03).
 *
 * A phone was unbootable until 2026-08-04 because `initDevice` listed `texture-compression-bc`
 * unconditionally, and `requestDevice` REJECTS a required feature the adapter does not carry. Nothing caught
 * that: the desktop it was written on has BC, so every test passed and every mobile GPU threw. The fake
 * adapter now rejects exactly the way a browser does, so reinstating the demand fails here instead of on
 * someone's phone.
 */

let installed: null | ReturnType<typeof installFakeWebGpu> = null;

function install(options: Parameters<typeof installFakeWebGpu>[0]): ReturnType<typeof installFakeWebGpu> {
  installed = installFakeWebGpu(options);

  return installed;
}

afterEach(() => {
  installed?.restore();
  installed = null;
});

describe('initDevice', () => {
  describe('negative cases', () => {
    it('boots on a MOBILE adapter, and never asks it for BC', async () => {
      const fake = install({ adapterFeatures: ['texture-compression-astc', 'texture-compression-etc2'] });

      const device = await initDevice();

      expect(fake.requestedFeatures).not.toContain('texture-compression-bc');
      expect(device.hasBc).toBe(false);
    });

    it('drops timestamp-query too when the adapter lacks it (the Mali row has no GPU timers)', async () => {
      const fake = install({ adapterFeatures: [], timestamps: false });

      const device = await initDevice();

      expect(fake.requestedFeatures).toEqual([]);
      expect(device.hasTimestamps).toBe(false);
    });

    it('fails with a specific message when the browser has no WebGPU at all', async () => {
      const fake = install({});
      Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {}, writable: true });

      await expect(initDevice()).rejects.toThrow(/WebGPU is not available/);
      expect(fake.requestedFeatures).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('takes BC and timestamps when the adapter offers them', async () => {
      const fake = install({});

      const device = await initDevice();

      expect(fake.requestedFeatures.sort()).toEqual(['texture-compression-bc', 'timestamp-query']);
      expect(device.hasBc).toBe(true);
      expect(device.hasTimestamps).toBe(true);
    });

    it('hands back a device carrying only what was granted', async () => {
      // Not a tautology: anything downstream that asks `device.features` (the `.ostex` upload rule does)
      // would otherwise be answered by the adapter's capability rather than the device's grant.
      install({ adapterFeatures: ['texture-compression-astc'], timestamps: false });

      const device = await initDevice();

      expect(device.device.features.has('texture-compression-bc')).toBe(false);
    });

    it('renders through the sRGB view of the swapchain format', async () => {
      install({});

      const device = await initDevice();

      expect(device.presentationFormat).toBe('bgra8unorm');
      expect(device.colorFormat).toBe('bgra8unorm-srgb');
    });
  });
});

describe('describeDevice', () => {
  describe('negative cases', () => {
    it('names what a MOBILE adapter lacks, which is what decides the row schema', async () => {
      install({ adapterFeatures: ['texture-compression-astc', 'texture-compression-etc2'], timestamps: false });
      const engineDevice = await initDevice();

      const report = describeDevice(engineDevice, { clientHeight: 800, clientWidth: 360 }, 2);

      expect(report.missing).toEqual(['texture-compression-bc', 'timestamp-query']);
      expect(report.featureLevel).toBe('compatibility');
      expect(report.css).toBe('360x800');
      expect(report.dpr).toBe(2);
    });
  });

  describe('positive cases', () => {
    it('reports a core adapter with nothing missing', async () => {
      install({
        adapterFeatures: [
          'core-features-and-limits',
          'texture-compression-astc',
          'texture-compression-bc',
          'texture-compression-etc2',
        ],
      });
      const engineDevice = await initDevice();

      const report = describeDevice(engineDevice, { clientHeight: 900, clientWidth: 1440 }, 2);

      expect(report.missing).toEqual([]);
      expect(report.featureLevel).toBe('core');
      expect(report.features).toContain('timestamp-query');
    });
  });
});
