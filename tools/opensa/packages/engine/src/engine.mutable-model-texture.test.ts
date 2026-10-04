import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildCockpitInstrumentMesh } from '../../../apps/web/src/flight/cockpit-instrument-mesh';
import { Engine } from './engine';
import { installFakeWebGpu } from './test/fake-device';

let harness: ReturnType<typeof installFakeWebGpu>;
beforeEach(() => {
  harness = installFakeWebGpu();
});
afterEach(() => {
  harness.restore();
});
describe('private model texture updates', () => {
  it('rewrites the same private allocation, rejecting invalid, shared and destroyed targets', async () => {
    const engine = new Engine();
    await engine.init(harness.canvas);
    const init = buildCockpitInstrumentMesh(new Uint8Array(1024 ** 2 * 4));
    init.textures = [{ height: 2, kind: 'rgba', layers: 2, rgba: new Uint8Array(64 * 2 * 4 * 2), width: 64 }];
    const id = engine.createVehicleModel(init);
    const textures = harness.gpu.liveTextures();
    harness.gpu.reset();
    const pixels = new Uint8Array(64 * 2 * 4).fill(117);
    engine.updateVehicleTextureLayer(id, 0, 1, pixels);
    expect(harness.gpu.textureWrites).toHaveLength(1);
    expect(harness.gpu.textureWrites[0]).toMatchObject({ label: 'vehicle-texture', z: 1 });
    expect(harness.gpu.textureWrites[0].data).toEqual(pixels);
    expect(harness.gpu.liveTextures()).toEqual(textures);
    expect(harness.gpu.destroyed).toHaveLength(0);
    for (const [array, layer, data] of [
      [0, -1, pixels],
      [0, 2, pixels],
      [0, 0.5, pixels],
      [1, 0, pixels],
      [0, 0, new Uint8Array(1)],
    ] as const)
      expect(() => engine.updateVehicleTextureLayer(id, array, layer, data)).toThrow();
    const shared = engine.createVehicleModel({ ...init, textures: [] });
    expect(() => engine.updateVehicleTextureLayer(shared, 0, 0, pixels)).toThrow();
    engine.destroyVehicleModel(id);
    expect(() => engine.updateVehicleTextureLayer(id, 0, 0, pixels)).toThrow();
    engine.destroyVehicleModel(shared);
  });
});
