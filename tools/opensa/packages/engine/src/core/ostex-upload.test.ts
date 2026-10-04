import { encodeOstex, type Ostex, OstexAlphaClass, OstexFormat, ostexLayerBytes } from '@opensa/engine-formats';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Resources } from './resources';

import { installFakeWebGpu } from '../test/fake-device';
import { beginOstexUpload, uploadOstexTexture } from './ostex-upload';

// The recorder below stands in for the device, but the WebGPU CONSTANTS (`GPUTextureUsage`) are globals the
// fake harness installs — the upload builds its descriptor from them.
let harness: ReturnType<typeof installFakeWebGpu>;

beforeEach(() => {
  harness = installFakeWebGpu();
});

afterEach(() => {
  harness.restore();
});

/**
 * A car-sized dictionary — 128×128, the size the real writer emits. NOT a 4×4 toy: `bytesPerRow` is padded
 * to WebGPU's 256-byte alignment, which at 4×4 swamps the payload and hides the compression entirely.
 *
 * At 128×128: BC3 = 32 block-rows × 512 B = 16 384 B/layer; RGBA8 = 128 rows × 512 B = 65 536 B/layer.
 * That 4× is the whole point of the format, and the assertions below pin it.
 */
const SIZE = 128;
const BC3_LAYER_BYTES = 16_384;
const RGBA8_LAYER_BYTES = 65_536;

interface RecordedWrite {
  bytes: Uint8Array;
  bytesPerRow: number | undefined;
  layer: number;
}

function ostexOf(format: Ostex['format'], layers: number): Uint8Array {
  const payload = new Uint8Array(ostexLayerBytes(format, SIZE, SIZE, 1) * layers);
  payload.forEach((_, index) => {
    payload[index] = index % 251;
  });

  return encodeOstex({
    format,
    height: SIZE,
    layers: Array.from({ length: layers }, () => ({
      alphaClass: OstexAlphaClass.OPAQUE,
      cutoutRef: 0,
      nameHash: 1,
      wrap: 0,
    })),
    mipCount: 1,
    payload,
    premultiplied: true,
    width: SIZE,
  });
}

/** Records what reached the GPU: every texture descriptor and every `writeTexture` payload.
 *
 *  The feature set is the whole point of these tests: a desktop carries BC and no ASTC, a phone carries ASTC
 *  and no BC, and the upload must read the CONTENT's demand rather than assume either. `features` overrides
 *  the `hasBc` shorthand for the mobile case. */
function recorder(
  hasBc = true,
  features?: readonly string[],
): {
  descriptors: GPUTextureDescriptor[];
  device: GPUDevice;
  resources: Resources;
  writes: RecordedWrite[];
} {
  const descriptors: GPUTextureDescriptor[] = [];
  const writes: RecordedWrite[] = [];
  const device = {
    features: new Set<string>(features ?? (hasBc ? ['texture-compression-bc'] : [])),
    queue: {
      writeTexture: (
        destination: { origin?: { z?: number } },
        data: Uint8Array,
        layout: GPUTexelCopyBufferLayout,
      ): void => {
        writes.push({ bytes: data.slice(), bytesPerRow: layout.bytesPerRow, layer: destination.origin?.z ?? 0 });
      },
    },
  } as unknown as GPUDevice;
  const resources = {
    createTexture: (_category: string, descriptor: GPUTextureDescriptor): GPUTexture => {
      descriptors.push(descriptor);

      return {} as GPUTexture;
    },
  } as unknown as Resources;

  return { descriptors, device, resources, writes };
}

describe('uploadOstexTexture', () => {
  describe('negative cases', () => {
    it('refuses a BC payload on a GPU without BC, naming the texture', () => {
      const { device, resources } = recorder(false);

      expect(() => uploadOstexTexture(device, resources, ostexOf(OstexFormat.BC3, 1), 'world-array-7')).toThrow(
        /world-array-7.*texture-compression-bc/s,
      );
    });

    it('creates no texture at all when the format is refused', () => {
      const { descriptors, device, resources } = recorder(false);

      expect(() => uploadOstexTexture(device, resources, ostexOf(OstexFormat.BC1, 1), 'world-array-7')).toThrow();
      expect(descriptors).toEqual([]);
    });

    it('refuses an ASTC payload on a GPU without ASTC, naming the format and the feature it needs', () => {
      const { device, resources } = recorder();

      expect(() => uploadOstexTexture(device, resources, ostexOf(OstexFormat.ASTC4x4, 1), 'world-array-3')).toThrow(
        /world-array-3.*astc-4x4-unorm-srgb.*texture-compression-astc/s,
      );
    });

    it('never expands a compressed payload — BC3 reaches the GPU at a quarter of RGBA8', () => {
      const { device, resources, writes } = recorder();

      uploadOstexTexture(device, resources, ostexOf(OstexFormat.BC3, 2), 'model-texture');

      expect(writes.map((write) => write.bytes.byteLength)).toEqual([BC3_LAYER_BYTES, BC3_LAYER_BYTES]);
      expect(BC3_LAYER_BYTES * 4).toBe(RGBA8_LAYER_BYTES);
    });
  });

  describe('positive cases', () => {
    it('creates a BC3 array texture for a dictionary that needs alpha', () => {
      const { descriptors, device, resources } = recorder();

      uploadOstexTexture(device, resources, ostexOf(OstexFormat.BC3, 3), 'model-texture');

      expect(descriptors).toHaveLength(1);
      expect(descriptors[0].format).toBe('bc3-rgba-unorm-srgb');
      expect(descriptors[0].label).toBe('model-texture');
      expect(descriptors[0].mipLevelCount).toBe(1);
      expect(descriptors[0].size).toEqual({ depthOrArrayLayers: 3, height: SIZE, width: SIZE });
    });

    it('creates a BC1 array texture for an all-opaque dictionary', () => {
      const { descriptors, device, resources } = recorder();

      uploadOstexTexture(device, resources, ostexOf(OstexFormat.BC1, 1), 'model-texture');

      expect(descriptors[0].format).toBe('bc1-rgba-unorm-srgb');
    });

    it('uploads an ASTC array on a phone that has ASTC and no BC — the 2026-08-12 field failure', () => {
      // The regression this pins: the check read `format !== RGBA8 ⇒ BC`, so an ASTC pak built for exactly
      // this GPU was refused on all 20 world arrays and the district streamed nothing.
      const { descriptors, device, resources } = recorder(false, ['texture-compression-astc']);

      uploadOstexTexture(device, resources, ostexOf(OstexFormat.ASTC4x4, 1), 'world-array-0');

      expect(descriptors).toHaveLength(1);
      expect(descriptors[0].format).toBe('astc-4x4-unorm-srgb');
    });

    it('uploads an RGBA8 dictionary on a GPU without BC — only BC CONTENT needs the feature', () => {
      const { descriptors, device, resources, writes } = recorder(false);

      uploadOstexTexture(device, resources, ostexOf(OstexFormat.RGBA8, 1), 'demo-texture');

      expect(descriptors[0].format).toBe('rgba8unorm-srgb');
      expect(writes).toHaveLength(1);
    });

    it('still handles the RGBA8 fallback a non-block-aligned model lands on', () => {
      const { descriptors, device, resources, writes } = recorder();

      uploadOstexTexture(device, resources, ostexOf(OstexFormat.RGBA8, 1), 'model-texture');

      expect(descriptors[0].format).toBe('rgba8unorm-srgb');
      expect(writes[0].bytes.byteLength).toBe(RGBA8_LAYER_BYTES);
    });

    it('uploads one layer per dictionary entry, in order', () => {
      const { device, resources, writes } = recorder();

      uploadOstexTexture(device, resources, ostexOf(OstexFormat.BC3, 4), 'model-texture');

      expect(writes.map((write) => write.layer)).toEqual([0, 1, 2, 3]);
    });
  });
});

/** The resumable form (the 15-85 ms hitch fix): the texture exists from `begin`, each `step()` lands ONE
 *  (layer, mip) write, and the payload reaches the GPU byte-for-byte as the eager loop sent it. */
describe('beginOstexUpload', () => {
  describe('negative cases', () => {
    it('writes nothing before the first step — begin is the cheap half', () => {
      const { descriptors, device, resources, writes } = recorder();

      beginOstexUpload(device, resources, ostexOf(OstexFormat.BC3, 2), 'model-texture');

      expect(descriptors).toHaveLength(1); // the texture is created up-front…
      expect(writes).toHaveLength(0); // …but not a byte moves until the caller drains
    });
  });

  describe('positive cases', () => {
    it('steps one (layer, mip) write at a time and reports done with the last one', () => {
      const { device, resources, writes } = recorder();
      const task = beginOstexUpload(device, resources, ostexOf(OstexFormat.BC3, 2), 'model-texture');

      expect(task.step()).toBe(false);
      expect(writes.map((write) => write.layer)).toEqual([0]);

      expect(task.step()).toBe(true);
      expect(writes.map((write) => write.layer)).toEqual([0, 1]);
      expect(writes.every((write) => write.bytes.byteLength === BC3_LAYER_BYTES)).toBe(true);
    });
  });
});
