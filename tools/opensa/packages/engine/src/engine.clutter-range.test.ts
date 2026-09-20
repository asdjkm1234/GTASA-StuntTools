import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { CameraState, ClutterModelInit } from './engine';
import type { FakeGpu } from './test/fake-device';

import { Engine } from './engine';
import { installFakeWebGpu } from './test/fake-device';

/**
 * The per-category clutter RANGE (P2, 2026-08-10). These exist because the range was dead config for as long
 * as it existed — written by the debug slider, read by nothing — so what has to be pinned is the READ, in
 * both of its halves: the whole-group skip on the CPU, and the squared radius reaching the GPU for the shader
 * to cull instances with. A test that only checked the config value would have passed against the bug.
 */
const cameraLookingDownX = (eyeX: number): CameraState => ({
  aspect: 16 / 9,
  eye: [eyeX, 0, 0],
  far: 1500,
  fovYRad: Math.PI / 3,
  near: 0.3,
  target: [eyeX + 10, 0, 0],
  up: [0, 1, 0],
});

/** A one-triangle clutter species — enough to own a pipeline, a bind group and an index count. */
const model = (): ClutterModelInit => {
  const floats = (values: number[]): Uint8Array => new Uint8Array(new Float32Array(values).buffer);

  return {
    colors: new Uint8Array(12),
    cutout: false,
    indices: new Uint8Array(new Uint16Array([0, 1, 2]).buffer),
    meta: new Uint8Array(12),
    night: new Uint8Array(12),
    normals: floats([0, 1, 0, 0, 1, 0, 0, 1, 0]),
    positions: floats([0, 0, 0, 1, 0, 0, 0, 0, 1]),
    texture: { height: 1, kind: 'rgba', layers: 1, rgba: new Uint8Array([255, 255, 255, 255]), width: 1 },
    uvs: floats([0, 0, 1, 0, 0, 1]),
  };
};

/** One instance parked at `x` on the engine's +x axis (column-major, translation in the last column). */
const instanceAt = (x: number): Float32Array => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1]);

const clutterDraws = (gpu: FakeGpu): unknown[] =>
  gpu.draws.filter((draw) => String(draw.pipeline).startsWith('clutter'));

let harness: ReturnType<typeof installFakeWebGpu>;
let gpu: FakeGpu;

beforeEach(() => {
  harness = installFakeWebGpu();
  gpu = harness.gpu;
});

afterEach(() => {
  harness.restore();
});

describe('Engine clutter draw distance', () => {
  describe('negative cases', () => {
    it('issues no draw for a group that lies entirely beyond its range', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      const id = engine.createClutterModel(model());
      engine.setCellClutter('far', [{ drawDistance: 50, matrices: instanceAt(400), model: id }]);

      gpu.reset();
      engine.frame(cameraLookingDownX(0));

      expect(clutterDraws(gpu)).toEqual([]);
    });

    it('counts no triangles for the skipped group — the skip is before the draw, not inside the shader', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      const id = engine.createClutterModel(model());
      engine.setCellClutter('far', [{ drawDistance: 50, matrices: instanceAt(400), model: id }]);

      const stats = engine.frame(cameraLookingDownX(0));

      expect(stats.trianglesRecorded).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('draws the same group once the range covers it — the range is what decides, not the geometry', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      const id = engine.createClutterModel(model());
      engine.setCellClutter('near', [{ drawDistance: 500, matrices: instanceAt(400), model: id }]);

      gpu.reset();
      engine.frame(cameraLookingDownX(0));

      expect(clutterDraws(gpu)).toHaveLength(1);
    });

    it('uploads the range SQUARED for the shader, per group — this is the read that was missing', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      const id = engine.createClutterModel(model());

      gpu.reset();
      engine.setCellClutter('cell', [{ drawDistance: 300, matrices: instanceAt(0), model: id }]);

      const upload = gpu.writes.find((write) => String(write.label).startsWith('clutter-range:'));
      expect(upload).toBeDefined();
      expect(new Float32Array(upload!.data.buffer, upload!.data.byteOffset, 1)[0]).toBe(300 * 300);
    });

    it('gives each category its OWN range in one cell — a shared uniform would defeat the feature', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      const near = engine.createClutterModel(model());
      const far = engine.createClutterModel(model());

      gpu.reset();
      engine.setCellClutter('cell', [
        { drawDistance: 100, matrices: instanceAt(0), model: near },
        { drawDistance: 300, matrices: instanceAt(0), model: far },
      ]);

      const ranges = gpu.writes
        .filter((write) => String(write.label).startsWith('clutter-range:'))
        .map((write) => new Float32Array(write.data.buffer, write.data.byteOffset, 1)[0]);
      expect(ranges).toEqual([100 * 100, 300 * 300]);
    });
  });
});

/**
 * The map viewer's "Show procobj" gate. It shares this file's rig because it acts on the same draw, and what
 * has to be pinned is that it is a DRAW gate: the scatter survives it, so switching back costs no re-upload.
 */
describe('Engine clutter gate', () => {
  describe('negative cases', () => {
    it('issues no draw and counts no triangles while the gate is off', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      const id = engine.createClutterModel(model());
      engine.setCellClutter('near', [{ drawDistance: 500, matrices: instanceAt(0), model: id }]);
      engine.clutterEnabled = false;

      gpu.reset();
      const stats = engine.frame(cameraLookingDownX(0));

      expect(clutterDraws(gpu)).toEqual([]);
      expect(stats.trianglesRecorded).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('draws again from the SAME buffers once it is back on', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      const id = engine.createClutterModel(model());
      engine.setCellClutter('near', [{ drawDistance: 500, matrices: instanceAt(0), model: id }]);

      engine.clutterEnabled = false;
      engine.frame(cameraLookingDownX(0));

      engine.clutterEnabled = true;
      gpu.reset();
      engine.frame(cameraLookingDownX(0));

      expect(clutterDraws(gpu)).toHaveLength(1);
      // A re-upload would mean the gate dropped the scatter — the whole point is that it did not.
      expect(gpu.writes.filter((write) => String(write.label).startsWith('clutter-range:'))).toEqual([]);
    });
  });
});
