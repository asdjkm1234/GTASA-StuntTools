import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CameraState } from './engine';
import type { FakeGpu } from './test/fake-device';

import { Engine } from './engine';
import { installFakeWebGpu } from './test/fake-device';

/**
 * The render-target seam (plan todo 21) and the deterministic frame clock it needs.
 *
 * `frame()` used to acquire the canvas swapchain unconditionally. An offline host (headless export, frame
 * readback) has no canvas, so it can now inject its own texture: the seam renders the post pass there and
 * sizes the internal scene targets to it. The readback assertion is the point of the test — a green run
 * proves nothing if the copy targets the wrong texture, so it inspects the bytes that come back.
 */

let harness: ReturnType<typeof installFakeWebGpu>;
let gpu: FakeGpu;

/** Readback rows are 256-byte aligned (WebGPU's `bytesPerRow` requirement for `copyTextureToBuffer`). */
const ROW_ALIGNMENT = 256;
const BYTES_PER_PIXEL = 4;

const camera = (): CameraState => ({
  aspect: 16 / 9,
  eye: [0, 0, 30],
  far: 1500,
  fovYRad: Math.PI / 3,
  near: 0.3,
  target: [100, 0, 30],
  up: [0, 0, 1],
});

async function bootedEngine(): Promise<Engine> {
  const engine = new Engine();
  await engine.init(harness.canvas);

  return engine;
}

/** A host-owned target of `width`×`height`, viewable as sRGB — the shape the seam documents. */
function injectedTarget(label: string, width: number, height: number, usage: number): GPUTexture {
  return gpu.device.createTexture({
    format: 'bgra8unorm',
    label,
    size: { height, width },
    usage,
    viewFormats: ['bgra8unorm-srgb'],
  });
}

const rowPitchFor = (width: number): number => Math.ceil((width * BYTES_PER_PIXEL) / ROW_ALIGNMENT) * ROW_ALIGNMENT;

/** The host half of the seam: copy the injected target into a mappable buffer and hand back the bytes. */
async function readback(
  texture: GPUTexture,
  width: number,
  height: number,
): Promise<{ bytes: Uint8Array; rowPitch: number }> {
  const rowPitch = rowPitchFor(width);
  const buffer = gpu.device.createBuffer({
    label: 'readback',
    size: rowPitch * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = gpu.device.createCommandEncoder({ label: 'readback' });
  encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow: rowPitch, rowsPerImage: height }, { height, width });
  gpu.device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);

  return { bytes: new Uint8Array(buffer.getMappedRange()), rowPitch };
}

beforeEach(() => {
  harness = installFakeWebGpu();
  gpu = harness.gpu;
});

afterEach(() => {
  harness.restore();
});

describe('Engine render-target seam', () => {
  describe('negative cases', () => {
    it('fails the readback clearly when the injected target lacks COPY_SRC', async () => {
      const engine = await bootedEngine();
      const width = 64;
      const height = 48;
      const target = injectedTarget('injected-no-copy', width, height, GPUTextureUsage.RENDER_ATTACHMENT);
      engine.renderTarget = target;
      engine.frame(camera());

      const rowPitch = rowPitchFor(width);
      const buffer = gpu.device.createBuffer({
        size: rowPitch * height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });
      const encoder = gpu.device.createCommandEncoder();

      expect(() =>
        encoder.copyTextureToBuffer(
          { texture: target },
          { buffer, bytesPerRow: rowPitch, rowsPerImage: height },
          { height, width },
        ),
      ).toThrow(/COPY_SRC/);
    });
  });

  describe('positive cases', () => {
    it('renders the post pass into the injected target and reads its bytes back', async () => {
      const engine = await bootedEngine();
      const width = 64;
      const height = 48;
      const target = injectedTarget(
        'injected-64x48',
        width,
        height,
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      );
      engine.renderTarget = target;

      gpu.reset();
      engine.frame(camera());

      // The post composite landed in the injected target, and the swapchain was never touched.
      const post = gpu.passes.find((pass) => pass.label === 'post');
      expect(post?.colorTargets).toContain('injected-64x48');
      const everyColorTarget = gpu.passes.flatMap((pass) => pass.colorTargets);
      expect(everyColorTarget).not.toContain('swapchain');

      const { bytes, rowPitch } = await readback(target, width, height);
      expect(rowPitch).toBe(256);
      expect(bytes.byteLength).toBe(rowPitch * height);

      // CONTENT, not just a completed copy: the fake fills the destination deterministically, so a wrong
      // buffer / a missed copy would break both the byte-for-byte comparison AND the digest below.
      const expected = new Uint8Array(bytes.length);
      for (let index = 0; index < expected.length; index += 1) {
        expected[index] = index & 0xff;
      }
      expect(bytes).toEqual(expected);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        createHash('sha256').update(expected).digest('hex'),
      );

      const copy = gpu.textureCopies[gpu.textureCopies.length - 1];
      expect(copy.label).toBe('injected-64x48');
      expect(copy).toMatchObject({
        bytesPerRow: rowPitch,
        height,
        mappedBytes: rowPitch * height,
        rowsPerImage: height,
        width,
      });
    });

    it('creates the internal scene-color resolve target with COPY_SRC', async () => {
      const engine = await bootedEngine();
      engine.renderTarget = injectedTarget(
        'injected-32',
        32,
        32,
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      );
      engine.frame(camera());

      const usage = gpu.textureUsage.get('scene-color');
      expect(usage).toBeDefined();
      expect((usage ?? 0) & GPUTextureUsage.COPY_SRC).toBe(GPUTextureUsage.COPY_SRC);
    });

    it('rebuilds the internal scene targets when the injected target changes size', async () => {
      const engine = await bootedEngine();
      engine.renderTarget = injectedTarget(
        'injected-64x48',
        64,
        48,
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      );
      engine.frame(camera());

      gpu.reset();
      engine.renderTarget = injectedTarget(
        'injected-128x96',
        128,
        96,
        GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      );
      engine.frame(camera());

      // A different surface size must not reuse the old (now stale) resolve target.
      expect(gpu.destroyed).toContain('scene-color');
      expect(gpu.passes.find((pass) => pass.label === 'post')?.colorTargets).toContain('injected-128x96');
    });

    it('keeps a stable injected target when the same size is set again (idempotent seam)', async () => {
      const engine = await bootedEngine();
      const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC;
      engine.renderTarget = injectedTarget('injected-64x48', 64, 48, usage);
      engine.frame(camera());

      gpu.reset();
      engine.renderTarget = injectedTarget('injected-64x48', 64, 48, usage);
      engine.frame(camera());

      // Same dimensions → same internal target key → no teardown/rebuild of the scene targets.
      expect(gpu.destroyed).not.toContain('scene-color');
    });
  });
});

describe('Engine deterministic frame clock', () => {
  describe('negative cases', () => {
    it('overrides the injected clock when a replay particleClock is set', async () => {
      const engine = await bootedEngine();
      let now = 1000;
      engine.setTimeSource(() => now);
      engine.particleClock = 42;

      now = 9000;
      gpu.reset();
      engine.frame(camera());

      expect(frameSeconds()).toBeCloseTo(42, 5);
    });
  });

  describe('positive cases', () => {
    it('writes the injected clock into the frame uniform instead of performance.now()', async () => {
      const engine = await bootedEngine();
      let now = 5000;
      engine.setTimeSource(() => now);

      now = 9000;
      gpu.reset();
      engine.frame(camera());

      expect(frameSeconds()).toBeCloseTo(4, 5);
    });

    it('produces the same frame clock twice for the same injected time', async () => {
      const engine = await bootedEngine();
      engine.setTimeSource(() => 7500);

      gpu.reset();
      engine.frame(camera());
      const first = frameSeconds();

      gpu.reset();
      engine.frame(camera());
      const second = frameSeconds();

      expect(first).toBe(second);
      expect(Number.isFinite(first)).toBe(true);
    });

    it('re-origins uptime on each setTimeSource call', async () => {
      const engine = await bootedEngine();
      engine.setTimeSource(() => 1000);
      engine.setTimeSource(() => 2000);

      gpu.reset();
      engine.frame(camera());

      // The second call re-origins: seconds restart at 0, not at the 1000 ms gap.
      expect(frameSeconds()).toBeCloseTo(0, 5);
    });
  });
});

/** `frame.params2.z` (offsets 60..63) is the effect clock every time-driven shader reads. */
function frameSeconds(): number {
  const write = gpu.writes.find((entry) => entry.label === 'frame');
  if (!write) {
    throw new Error('frame uniform was not written');
  }
  const params2 = new Float32Array(write.data.buffer, write.data.byteOffset, write.data.byteLength / 4);

  return params2[62];
}
