/** Verify the fix against the owner's baked models; no game files are changed. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { buildVehicleModel } from '@opensa/renderware/vehicle/build-vehicle-model';
import { VehicleTextures } from '@opensa/renderware/vehicle/textures';

import { prepareAircraftInterior } from '../apps/web/src/flight/aircraft-interior';

const bytes = (name: string): ArrayBuffer => new Uint8Array(readFileSync(`map-pak/aircraft/${name}`)).buffer;
for (const [name, model] of [
  ['hydra', 520],
  ['rustler', 476],
] as const) {
  const build = () =>
    buildVehicleModel(
      parseDff(bytes(`${name}.dff`)),
      new VehicleTextures([bytes(`${name}.txd`), bytes('vehicle.txd')]),
      {},
    );
  const data = build();
  const original = structuredClone(data);
  assert.equal(prepareAircraftInterior(data, model), model === 520 ? 16 : 0);
  const changed = [];
  for (let v = 0; v < data.meta.length / 4; v++) {
    if (data.meta[v * 4 + 3] !== original.meta[v * 4 + 3]) {
      changed.push(v);
      assert.equal(data.meta[v * 4 + 3], 0);
      assert.deepEqual(Array.from(data.reflect.subarray(v * 4, v * 4 + 4)), [0, 0, 0, 0]);
    } else {
      assert.deepEqual(
        data.reflect.subarray(v * 4, v * 4 + 4),
        original.reflect.subarray(v * 4, v * 4 + 4),
        'Exterior and glass reflection stay authored',
      );
    }
    assert.deepEqual(data.meta.subarray(v * 4, v * 4 + 3), original.meta.subarray(v * 4, v * 4 + 3));
  }
  for (const key of ['positions', 'normals', 'uvs', 'colors', 'night', 'indices', 'parts', 'submeshes'] as const)
    assert.deepEqual(data[key], original[key], key);
  if (model === 520) {
    assert.deepEqual(
      changed,
      Array.from({ length: 16 }, (_, i) => i),
    );
    const incomplete = build();
    incomplete.normals[0] = 1;
    const incompleteMeta = incomplete.meta.slice();
    assert.equal(prepareAircraftInterior(incomplete, model), 0, 'Partial mod match must not mutate');
    assert.deepEqual(incomplete.meta, incompleteMeta);
    const shared = build();
    shared.indices[36] = 0;
    assert.equal(prepareAircraftInterior(shared, model), 0, 'Shared exterior vertex must not mutate');
    assert.deepEqual(shared.meta, original.meta);
  }
  console.log(`${name}: isolated lining, exterior preservation, geometry and mod guards PASS`);
}
