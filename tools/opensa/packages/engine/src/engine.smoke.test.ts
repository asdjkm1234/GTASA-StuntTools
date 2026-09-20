import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CameraState } from './engine';
import type { FakeGpu } from './test/fake-device';

import { Engine } from './engine';
import { installFakeWebGpu } from './test/fake-device';

/** A camera looking east along +X from a rooftop height, in engine coords. */
const cameraAt = (eye: [number, number, number], target: [number, number, number] = [100, 0, 50]): CameraState => ({
  aspect: 16 / 9,
  eye,
  far: 1500,
  fovYRad: Math.PI / 3,
  near: 0.3,
  target,
  up: [0, 0, 1],
});

/**
 * The seam check (plan 077 phase 3): proves the engine BOOTS and renders a frame against a recording
 * stand-in device, which is what every behavioural engine test below it depends on. If this file fails,
 * the fake has drifted from the WebGPU surface the engine actually uses — fix the fake, not the engine.
 */
let harness: ReturnType<typeof installFakeWebGpu>;
let gpu: FakeGpu;

beforeEach(() => {
  harness = installFakeWebGpu();
  gpu = harness.gpu;
});

afterEach(() => {
  harness.restore();
});

describe('Engine on a fake device', () => {
  describe('positive cases', () => {
    it('initialises without a real GPU', async () => {
      const engine = new Engine();
      await expect(engine.init(harness.canvas)).resolves.toBeUndefined();
    });

    it('compiles its pipelines once at init, not per frame', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      const afterInit = gpu.draws.length;

      gpu.reset();
      engine.frame(cameraAt([0, 0, 50]));

      expect(afterInit).toBe(0); // init draws nothing
      expect(gpu.passes.length).toBeGreaterThan(0); // the frame does
    });

    it('renders an empty world without throwing and still runs its passes', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      gpu.reset();

      engine.frame(cameraAt([0, 0, 50]));

      // With no cells loaded there is nothing to draw, but the fixed frame graph still runs:
      // the sky/post chain is unconditional.
      expect(gpu.passes.map((pass) => pass.label).filter(Boolean).length).toBeGreaterThan(0);
    });

    it('writes the frame uniform every frame — the camera must not go stale', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);

      gpu.reset();
      engine.frame(cameraAt([0, 0, 50]));
      const first = gpu.writes.filter((write) => write.label === 'frame').length;

      gpu.reset();
      engine.frame(cameraAt([10, 0, 50]));
      const second = gpu.writes.filter((write) => write.label === 'frame').length;

      expect(first).toBeGreaterThan(0);
      expect(second).toBe(first);
    });
  });
});

describe('debugViewMode', () => {
  describe('negative cases', () => {
    it('is 0 with no debug view selected — normal play must not take a debug branch', () => {
      expect(new Engine().debugViewMode()).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('reports 1 for unlit and 2 for normals', () => {
      const unlit = new Engine();
      unlit.debugUnlit = true;
      const normals = new Engine();
      normals.debugNormals = true;

      expect(unlit.debugViewMode()).toBe(1);
      expect(normals.debugViewMode()).toBe(2);
    });

    it('carries the mode INTO the frame uniform, not just the getter', async () => {
      // `debugViewMode()` being right is worth nothing if the lane it rides is never written.
      const engine = new Engine();
      await engine.init(harness.canvas);
      engine.debugNormals = true;
      gpu.reset();
      engine.frame(cameraAt([0, 0, 50]));

      const write = gpu.writes.find((entry) => entry.label?.includes('frame'));
      expect(write).toBeDefined();
      const floats = new Float32Array(write!.data.buffer, write!.data.byteOffset);
      expect(floats[71]).toBe(2); // moonColor.w — the debug VIEW lane
    });

    it('lets NORMALS win when both are set — one lane carries one view', () => {
      const engine = new Engine();
      engine.debugUnlit = true;
      engine.debugNormals = true;

      expect(engine.debugViewMode()).toBe(2);
    });
  });
});
