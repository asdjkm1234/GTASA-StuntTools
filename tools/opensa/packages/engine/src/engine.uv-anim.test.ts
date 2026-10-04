/**
 * The rigid UV-animation lane on a fake device (plan 099/02).
 *
 * What has to hold: a model that animates nothing costs NOTHING (no buffer, no per-frame write) and still
 * draws; an animated one advances its transform on the shared frame clock; and each submesh binds its own
 * slot, because the slot is a dynamic OFFSET that a bind-group label cannot distinguish.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { VehicleModelInit, VehicleSubmesh } from './engine';
import type { FakeGpu } from './test/fake-device';

import { Engine } from './engine';
import { UV_ANIM_STRIDE } from './render/uv-anim';
import { installFakeWebGpu } from './test/fake-device';

/** The ferris ring's cadence, verbatim from the mod's `f13d`: hold 0.225 s, then jump 1/13 of the strip. */
const STEP_ANIMATION = {
  duration: 0.45,
  keyframes: [
    { time: 0, uv: [0, 1, 1, 0, 0, 0] },
    { time: 0.225, uv: [0, 1, 1, 0, 0, 0] },
    { time: 0.225, uv: [0, 1, 1, 0, 1 / 13, 0] },
    { time: 0.45, uv: [0, 1, 1, 0, 1 / 13, 0] },
  ],
};

/** A two-submesh model: submesh 0 static, submesh 1 driven by `uvAnimations[0]` unless told otherwise. */
function modelInit(options: { animated?: boolean } = {}): VehicleModelInit {
  const vertexCount = 6;
  const positions = new Float32Array([-1, 20, 0, 1, 20, 0, 0, 20, 2, -1, 22, 0, 1, 22, 0, 0, 22, 2]);
  const submeshes: VehicleSubmesh[] = [
    { indexCount: 3, indexOffset: 0, part: 0, translucent: false },
    { indexCount: 3, indexOffset: 3, part: 0, translucent: false, ...(options.animated ? { uvAnim: 0 } : {}) },
  ];

  return {
    colors: new Uint8Array(vertexCount * 4).fill(255),
    indexCount: 6,
    indices: new Uint8Array(new Uint16Array([0, 1, 2, 3, 4, 5]).buffer),
    meta: new Uint8Array(vertexCount * 4),
    night: new Uint8Array(vertexCount * 4).fill(255),
    normals: new Uint8Array(new Float32Array(vertexCount * 3).fill(0).buffer),
    parts: [{ localRotation: [0, 0, 0, 1], localTranslation: [0, 0, 0], name: 'body' }],
    positions: new Uint8Array(positions.buffer),
    reflect: new Uint8Array(vertexCount * 4),
    submeshes,
    textures: [{ height: 1, kind: 'rgba', layers: 1, rgba: new Uint8Array(4).fill(255), width: 1 }],
    ...(options.animated ? { uvAnimations: [STEP_ANIMATION] } : {}),
    uvs: new Uint8Array(vertexCount * 8),
    vertexCount,
  };
}

/** The per-model transform writes of one frame, as (tx, ty, sx, sy). */
function uvAnimWrites(gpu: FakeGpu): { offset: number; values: number[] }[] {
  return gpu.writes
    .filter((write) => write.label === 'vehicle-uv-anim')
    .map((write) => ({
      offset: write.offset,
      values: [...new Float32Array(write.data.buffer, write.data.byteOffset, write.data.byteLength / 4)],
    }));
}

let harness: ReturnType<typeof installFakeWebGpu>;
let gpu: FakeGpu;
let clock = 0;
let realNow: () => number;

beforeEach(() => {
  harness = installFakeWebGpu();
  gpu = harness.gpu;
  // The engine reads `performance.now()` for its frame clock, so the only way to step two frames a known
  // distance apart is to own that clock — a test that slept would be non-deterministic by construction.
  realNow = performance.now.bind(performance);
  clock = 0;
  performance.now = (): number => clock;
});

afterEach(() => {
  performance.now = realNow;
  harness.restore();
});

describe('rigid UV animations on a fake device', () => {
  describe('negative cases', () => {
    it('a model that animates nothing allocates no uniform of its own', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      gpu.reset();

      engine.createVehicleModel(modelInit());

      expect([...gpu.bufferUsage.keys()]).not.toContain('vehicle-uv-anim');
    });

    it('a model that animates nothing performs ZERO transform writes per frame', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      const model = engine.createVehicleModel(modelInit());
      engine.createVehicle(model);
      gpu.reset();

      clock = 300;
      engine.frame(camera());

      expect(uvAnimWrites(gpu)).toHaveLength(0);
      // …and it still draws: the identity binding is a no-op, not a gate.
      expect(gpu.draws.filter((draw) => draw.pipeline === 'rigid-opaque')).toHaveLength(2);
    });

    it('an animated model with no LIVE instance is not stepped — nothing can sample its buffer', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      engine.createVehicleModel(modelInit({ animated: true }));
      gpu.reset();

      clock = 300;
      engine.frame(camera());

      expect(uvAnimWrites(gpu)).toHaveLength(0);
    });

    it('a submesh naming a slot the model does not have draws STATIC, not off the end of the buffer', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      // A `.osm` is a file a mod ships: this is the number nobody validated. Binding (3 + 1) × 256 into a
      // 512-byte buffer is a WebGPU validation error INSIDE the pass — it takes the frame down.
      const init = modelInit({ animated: true });
      const lying = {
        ...init,
        submeshes: init.submeshes.map((submesh, at) => (at === 1 ? { ...submesh, uvAnim: 3 } : submesh)),
      };
      const model = engine.createVehicleModel(lying);
      engine.createVehicle(model);
      gpu.reset();

      engine.frame(camera());

      const draws = gpu.draws.filter((draw) => draw.pipeline === 'rigid-opaque');
      expect(draws.map((draw) => draw.bindGroupOffsets[1])).toEqual([[0], [0]]);
    });

    it('destroying an animated model frees its uniform, and a plain one frees no shared buffer', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      const animated = engine.createVehicleModel(modelInit({ animated: true }));
      const plain = engine.createVehicleModel(modelInit());
      gpu.reset();

      engine.destroyVehicleModel(plain);
      // The shared identity must survive the plain model — every other model still binds it.
      expect(gpu.destroyed).not.toContain('uv-anim-identity');
      expect(gpu.destroyed).not.toContain('vehicle-uv-anim');

      engine.destroyVehicleModel(animated);
      expect(gpu.destroyed).toContain('vehicle-uv-anim');
      expect(gpu.destroyed).not.toContain('uv-anim-identity');
    });
  });

  describe('positive cases', () => {
    it('writes the animated slot each frame, leaving slot 0 as the identity written at creation', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      const model = engine.createVehicleModel(modelInit({ animated: true }));
      engine.createVehicle(model);
      gpu.reset();

      clock = 0;
      engine.frame(camera());

      const writes = uvAnimWrites(gpu);
      expect(writes).toHaveLength(1);
      // Slot 1, not slot 0: the model's own static submeshes keep binding the identity at offset 0.
      expect(writes[0].offset).toBe(UV_ANIM_STRIDE);
      expect(writes[0].values).toEqual([0, 0, 1, 1]);
    });

    it("advances the transform between frames 0.3 s apart — the strip's step is 0.225 s", async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      const model = engine.createVehicleModel(modelInit({ animated: true }));
      engine.createVehicle(model);

      clock = 0;
      engine.frame(camera());
      gpu.reset();
      clock = 300;
      engine.frame(camera());

      const writes = uvAnimWrites(gpu);
      expect(writes).toHaveLength(1);
      // Past the 0.225 s step: the paired keyframes hold, then the u offset jumps a full frame of 13.
      expect(writes[0].values[0]).toBeCloseTo(1 / 13, 6);
    });

    it('binds each submesh its own slot as a dynamic offset — static 0, animated its slot', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      const model = engine.createVehicleModel(modelInit({ animated: true }));
      engine.createVehicle(model);
      gpu.reset();

      engine.frame(camera());

      const draws = gpu.draws.filter((draw) => draw.pipeline === 'rigid-opaque');
      expect(draws).toHaveLength(2);
      // Both submeshes share one texture array, so the ARRAY alone would have bound group 1 once and drawn
      // them at the same transform — the offset has to be part of what triggers a rebind.
      expect(draws.map((draw) => draw.bindGroupOffsets[1])).toEqual([[0], [UV_ANIM_STRIDE]]);
    });

    it('a model with no animations binds offset 0 on every submesh', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      const model = engine.createVehicleModel(modelInit());
      engine.createVehicle(model);
      gpu.reset();

      engine.frame(camera());

      const draws = gpu.draws.filter((draw) => draw.pipeline === 'rigid-opaque');
      expect(draws.map((draw) => draw.bindGroupOffsets[1])).toEqual([[0], [0]]);
    });
  });
});

function camera(): Parameters<Engine['frame']>[0] {
  return {
    aspect: 16 / 9,
    eye: [0, 0, 50],
    far: 1500,
    fovYRad: Math.PI / 3,
    near: 0.3,
    target: [100, 0, 50],
    up: [0, 0, 1],
  };
}
