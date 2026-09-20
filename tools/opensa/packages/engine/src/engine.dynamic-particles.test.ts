import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CameraState } from './engine';
import type { DynamicParticleLibrary } from './render/dynamic-particles';
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

/** Two systems: index 0 alpha-blends (smoke), index 1 adds (sparks). Records/atlas can stay zeroed. */
const library = (): DynamicParticleLibrary => ({
  additive: [false, true],
  atlas: { height: 2, layers: 1, rgba: new Uint8Array(2 * 2 * 4), width: 2 },
  systems: new Float32Array(2 * 20),
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

/** The dynamic one-shot lane (plan 089/01): spawn → one partial upload → one instanced draw per blend mode. */
describe('Engine dynamic particles', () => {
  describe('negative cases', () => {
    it('drops a spawn before a library is installed', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);

      expect(engine.spawnParticle(0, 0, 0, 0, 0, 1, 0, 1)).toBe(false);
    });

    it('drops a spawn for an unknown system index', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      engine.initDynamicParticles(library());

      expect(engine.spawnParticle(2, 0, 0, 0, 0, 1, 0, 1)).toBe(false);
      expect(engine.spawnParticle(-1, 0, 0, 0, 0, 1, 0, 1)).toBe(false);
    });

    it('drops spawns and draws nothing while the effects gate is off', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      engine.initDynamicParticles(library());
      engine.particlesEnabled = false;

      expect(engine.spawnParticle(0, 0, 0, 0, 0, 1, 0, 100)).toBe(false);
      gpu.reset();
      engine.frame(camera);

      expect(gpu.draws.filter((draw) => draw.pipeline?.includes('particle'))).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('draws a spawned particle with the one-shot blend pipeline', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      engine.initDynamicParticles(library());

      expect(engine.spawnParticle(0, 1, 2, 3, 0, 1, 0, 100)).toBe(true);
      gpu.reset();
      engine.frame(camera);

      const upload = gpu.writes.find((write) => write.label === 'dyn-particle-blend');
      expect(upload?.byteLength).toBe(36); // one 9-float record
      const draw = gpu.draws.find((entry) => entry.pipeline === 'particle-blend-once');
      expect(draw?.instanceCount).toBe(1);
    });

    it('routes an additive system to the one-shot additive pipeline', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      engine.initDynamicParticles(library());

      expect(engine.spawnParticle(1, 0, 0, 0, 0, 1, 0, 100)).toBe(true);
      gpu.reset();
      engine.frame(camera);

      expect(gpu.draws.some((entry) => entry.pipeline === 'particle-add-once')).toBe(true);
      expect(gpu.draws.some((entry) => entry.pipeline === 'particle-blend-once')).toBe(false);
    });

    it('creates no buffers per frame and re-uploads only when the pool changed', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      engine.initDynamicParticles(library());
      engine.spawnParticle(0, 0, 0, 0, 0, 1, 0, 100); // outlives the test

      engine.frame(camera);
      gpu.reset();
      engine.frame(camera);

      // The pool did not change between the frames: the draw repeats, the upload does not.
      expect(gpu.writes.filter((write) => write.label?.startsWith('dyn-particle'))).toEqual([]);
      expect(gpu.draws.some((entry) => entry.pipeline === 'particle-blend-once')).toBe(true);
    });
  });
});
