import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CameraState } from './engine';
import type { SkidSegment } from './render/skid-marks';
import type { FakeGpu } from './test/fake-device';

import { Engine } from './engine';
import { installFakeWebGpu } from './test/fake-device';

const camera: CameraState = {
  aspect: 16 / 9,
  eye: [0, 5, 0],
  far: 1500,
  fovYRad: Math.PI / 3,
  near: 0.3,
  target: [10, 5, 0],
  up: [0, 1, 0],
};

const sprite = (): { height: number; rgba: Uint8Array; width: number } => ({
  height: 2,
  rgba: new Uint8Array(2 * 2 * 4),
  width: 2,
});

const segment = (): SkidSegment => ({
  alpha0: 0,
  alpha1: 0.5,
  l0: [0, 0, 0],
  l1: [0, 0, 1],
  r0: [1, 0, 0],
  r1: [1, 0, 1],
  v0: 0,
  v1: 1,
});

let harness: ReturnType<typeof installFakeWebGpu>;
let gpu: FakeGpu;

beforeEach(() => {
  harness = installFakeWebGpu();
  gpu = harness.gpu;
});

afterEach(() => {
  harness.restore();
});

/** The skid-mark decal lane (plan 089/03): install once, tiny positional uploads, ranged draws. */
describe('Engine skid marks', () => {
  describe('negative cases', () => {
    it('drops a segment before the lane is installed', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);

      engine.addSkidSegment(segment());
      gpu.reset();
      engine.frame(camera);

      expect(gpu.draws.filter((draw) => draw.pipeline === 'skid')).toEqual([]);
    });

    it('draws nothing while the effects gate is off', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      engine.initSkidMarks(sprite());
      engine.addSkidSegment(segment());
      engine.particlesEnabled = false;

      gpu.reset();
      engine.frame(camera);

      expect(gpu.draws.filter((draw) => draw.pipeline === 'skid')).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('uploads exactly the laid segment and draws it through the skid pipeline', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      engine.initSkidMarks(sprite());

      gpu.reset();
      engine.addSkidSegment(segment());
      engine.frame(camera);

      const upload = gpu.writes.find((write) => write.label === 'skid-marks');
      expect(upload?.byteLength).toBe(6 * 7 * 4); // one segment: six 7-float vertices
      const draw = gpu.draws.find((entry) => entry.pipeline === 'skid');
      expect(draw?.vertexCount).toBe(6);
    });

    it('keeps drawing on later frames without re-uploading an unchanged ring', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      engine.initSkidMarks(sprite());
      engine.addSkidSegment(segment());

      engine.frame(camera);
      gpu.reset();
      engine.frame(camera);

      expect(gpu.writes.filter((write) => write.label === 'skid-marks')).toEqual([]);
      expect(gpu.draws.some((entry) => entry.pipeline === 'skid')).toBe(true);
    });
  });
});
