import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { VehicleModelInit } from './engine';
import type { FakeGpu } from './test/fake-device';

import { Engine } from './engine';
import { installFakeWebGpu } from './test/fake-device';

/** LampTag lives in the LOW nibble of meta.w: 0 body, 1 head lamp, 2 tail lamp. */
const TAG_HEAD_LAMP = 1;

/** A one-triangle car whose single submesh is a head lamp. */
function lampCarInit(): VehicleModelInit {
  const vertexCount = 3;
  const positions = new Float32Array([-1, 20, 0, 1, 20, 0, 0, 20, 2]);
  const meta = new Uint8Array(vertexCount * 4);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    meta[vertex * 4 + 3] = TAG_HEAD_LAMP;
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
    submeshes: [{ indexCount: 3, indexOffset: 0, part: 0, translucent: false }],
    textures: [{ height: 1, kind: 'rgba', layers: 1, rgba: new Uint8Array(4).fill(255), width: 1 }],
    uvs: new Uint8Array(vertexCount * 8),
    vertexCount,
  };
}

/** The `vehicle-lamps` rows written for one instance, as floats. */
function lampRows(gpu: FakeGpu): Float32Array[] {
  return gpu.writes
    .filter((write) => write.label === 'vehicle-lamps')
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

describe('vehicle lamp damage on a fake device', () => {
  describe('negative cases', () => {
    it('does not re-write the row when only the mask is re-sent unchanged', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      const model = engine.createVehicleModel(lampCarInit());
      const vehicle = engine.createVehicle(model);
      vehicle.setLamps(true, false, 1, 0b0011);
      gpu.reset();

      vehicle.setLamps(true, false, 1, 0b0011);

      expect(lampRows(gpu)).toHaveLength(0);
    });
  });

  describe('positive cases', () => {
    it('carries the smashed mask in the row the vertex stage reads', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      const model = engine.createVehicleModel(lampCarInit());
      const vehicle = engine.createVehicle(model);
      gpu.reset();

      vehicle.setLamps(true, false, 0.5, 0b1001);

      const [row] = lampRows(gpu);
      expect([...row]).toEqual([1, 0, 0.5, 0b1001]);
    });

    it('a mask change alone re-writes the row (the lamps themselves did not move)', async () => {
      const engine = new Engine();
      await engine.init(harness.canvas);
      const model = engine.createVehicleModel(lampCarInit());
      const vehicle = engine.createVehicle(model);
      vehicle.setLamps(true, false, 1, 0);
      gpu.reset();

      // The frame a script smashes a lamp, nothing else about the car's lamp state changes — if the mask
      // were left out of the change test, the smash would never reach the GPU at all.
      vehicle.setLamps(true, false, 1, 0b0011);

      expect(lampRows(gpu).map((row) => row[3])).toEqual([0b0011]);
    });
  });
});
