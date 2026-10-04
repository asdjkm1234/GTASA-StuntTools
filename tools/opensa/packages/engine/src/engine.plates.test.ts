import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { VehicleModelInit } from './engine';
import type { FakeGpu } from './test/fake-device';

import { Engine } from './engine';
import { installFakeWebGpu } from './test/fake-device';

/** What the builder writes for a plate face: MaterialClass.plateFace (5) in the HIGH nibble of meta.w. */
const META_PLATE_FACE = 5 << 4;
const PLATE_TEXT_BYTES = 64 * 16 * 4;
/** A detached panel's own world matrix (identity, translated) — what `detachPart` hands the entity. */
const DETACHED_WORLD = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 3, 0, 4, 1];

/** A one-triangle car whose single submesh is a plate face. */
function plateCarInit(): VehicleModelInit {
  const vertexCount = 3;
  const positions = new Float32Array([-1, 20, 0, 1, 20, 0, 0, 20, 2]);
  const meta = new Uint8Array(vertexCount * 4);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    meta[vertex * 4 + 3] = META_PLATE_FACE;
  }

  return {
    colors: new Uint8Array(vertexCount * 4).fill(255),
    indexCount: 3,
    indices: new Uint8Array(new Uint16Array([0, 1, 2]).buffer),
    meta,
    night: new Uint8Array(vertexCount * 4).fill(255),
    normals: new Uint8Array(new Float32Array([0, -1, 0, 0, -1, 0, 0, -1, 0]).buffer),
    parts: [{ localRotation: [0, 0, 0, 1], localTranslation: [0, 0, 0], name: 'body' }],
    positions: new Uint8Array(positions.buffer),
    reflect: new Uint8Array(vertexCount * 4),
    submeshes: [{ indexCount: 3, indexOffset: 0, part: 0, plate: 'face', translucent: false }],
    textures: [{ height: 1, kind: 'rgba', layers: 1, rgba: new Uint8Array(4).fill(255), width: 1 }],
    uvs: new Uint8Array(vertexCount * 8),
    vertexCount,
  };
}

/** The `vehicle-plates` row bytes written for one instance, as floats. */
function plateRows(gpu: FakeGpu): Float32Array[] {
  return gpu.writes
    .filter((write) => write.label === 'vehicle-plates')
    .map((write) => new Float32Array(write.data.buffer, write.data.byteOffset, write.data.byteLength / 4));
}

let harness: ReturnType<typeof installFakeWebGpu>;
let gpu: FakeGpu;

beforeEach(() => {
  harness = installFakeWebGpu();
  gpu = harness.gpu;
});

afterEach(() => {
  harness.restore();
});

describe('license plates on a fake device', () => {
  describe('negative cases', () => {
    it('ignores a text slot past the atlas capacity instead of throwing', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      gpu.reset();

      expect(() => engine.uploadPlateText(999, new Uint8Array(PLATE_TEXT_BYTES))).not.toThrow();
      expect(gpu.textureWrites.filter((write) => write.label === 'plate-text')).toHaveLength(0);
    });

    it('ignores a raster that is not the 64x16 slot size', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      gpu.reset();

      engine.uploadPlateText(0, new Uint8Array(16));

      expect(gpu.textureWrites.filter((write) => write.label === 'plate-text')).toHaveLength(0);
    });

    it('ignores a dictionary that did not yield all three backgrounds', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      gpu.reset();

      engine.uploadPlateBackgrounds([{ height: 32, rgba: new Uint8Array(64 * 32 * 4), width: 64 }]);

      expect(gpu.textureWrites.filter((write) => write.label === 'plate-backgrounds')).toHaveLength(0);
    });

    it('does not re-write the row when the same plate is set again (a respawn re-requests it)', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      const model = engine.createVehicleModel(plateCarInit());
      const vehicle = engine.createVehicle(model);
      vehicle.setPlate(7, 2);
      gpu.reset();

      vehicle.setPlate(7, 2);

      expect(plateRows(gpu)).toHaveLength(0);
    });

    it('a car that was never given a plate leaves its row at slot 0', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      const model = engine.createVehicleModel(plateCarInit());
      gpu.reset();

      engine.createVehicle(model);

      // Spawn writes paint but no plate — the buffer is zeroed, which IS slot 0 of each array.
      expect(plateRows(gpu)).toHaveLength(0);
    });
  });

  describe('positive cases', () => {
    it('allocates the text atlas and a background placeholder at init', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);

      // Both must exist before the first car binds one — their views go into every vehicle bind group.
      expect(gpu.liveTextures()).toEqual(expect.arrayContaining(['plate-text', 'plate-backgrounds']));
    });

    it('writes the plate row for the instance, replicated across its part rows', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      const model = engine.createVehicleModel(plateCarInit());
      const vehicle = engine.createVehicle(model);
      gpu.reset();

      vehicle.setPlate(5, 2);

      const rows = plateRows(gpu);
      expect(rows).toHaveLength(1);
      expect([...rows[0]]).toEqual([5, 2, 0, 0]); // one part → one vec4: text slot, city, spare, spare
    });

    it('uploads a generated raster into the slot the host chose', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      gpu.reset();
      const rgba = new Uint8Array(PLATE_TEXT_BYTES).fill(3);

      engine.uploadPlateText(11, rgba);

      const writes = gpu.textureWrites.filter((write) => write.label === 'plate-text');
      expect(writes).toHaveLength(1);
      expect(writes[0].z).toBe(11);
      expect(writes[0].data).toEqual(rgba);
    });

    it('re-creates the background array at the size the game TXD ships, all three layers', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      gpu.reset();
      // The installed pack replaces the stock 64×32 backgrounds with 512×256 ones — the array has to
      // follow the ASSET, so this cannot be a constant.
      const modded = { height: 256, rgba: new Uint8Array(512 * 256 * 4), width: 512 };

      engine.uploadPlateBackgrounds([modded, modded, modded]);

      const writes = gpu.textureWrites.filter((write) => write.label === 'plate-backgrounds');
      expect(writes.map((write) => write.z)).toEqual([0, 1, 2]);
    });

    it('drops cached bind groups when the backgrounds arrive, so a model re-binds the real array', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      const model = engine.createVehicleModel(plateCarInit());
      engine.createVehicle(model);
      const raster = { height: 32, rgba: new Uint8Array(64 * 32 * 4), width: 64 };

      // A model built BEFORE the real backgrounds landed would otherwise keep the 1×1 placeholder view.
      expect(() => engine.uploadPlateBackgrounds([raster, raster, raster])).not.toThrow();
      expect(() => engine.frame(camera())).not.toThrow();
    });

    it('keeps the plate through a damage swap and a detach — the plate is instance state', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      const model = engine.createVehicleModel(plateCarInit());
      const vehicle = engine.createVehicle(model);
      vehicle.setPlate(6, 1);
      gpu.reset();

      // What the handle does to damage and then cut a panel loose: the `_ok` submeshes hide and the part
      // gets its own world matrix. A plate face lives INSIDE a part mesh, so both paths run over it.
      vehicle.setSubmeshVisible(0, false);
      vehicle.entity.setPartWorldMatrix(0, DETACHED_WORLD);

      expect(plateRows(gpu)).toHaveLength(0); // neither path rewrites the plate row
      // And the state is retained, not merely unwritten: a capacity grow re-sends every live plate.
      for (let at = 1; at < 9; at += 1) {
        engine.createVehicle(model);
      }
      expect(plateRows(gpu).some((row) => row[0] === 6 && row[1] === 1)).toBe(true);
    });

    it('restores the plate across a capacity grow, like paint', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      const model = engine.createVehicleModel(plateCarInit());
      const first = engine.createVehicle(model);
      first.setPlate(4, 1);
      // Fill the initial capacity of 8 exactly, so the NEXT spawn is the one that reallocates.
      for (let at = 1; at < 8; at += 1) {
        engine.createVehicle(model);
      }
      gpu.reset();
      engine.createVehicle(model);

      // The fresh buffer is uninitialised — the grow must re-send every live instance's plate.
      const rows = plateRows(gpu);
      expect(rows.some((row) => row[0] === 4 && row[1] === 1)).toBe(true);
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
