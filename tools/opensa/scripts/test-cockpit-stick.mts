/** Validate the actual locally baked Hydra geometry; no game assets are changed or exported. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { buildVehicleModel } from '@opensa/renderware/vehicle/build-vehicle-model';
import { VehicleTextures } from '@opensa/renderware/vehicle/textures';
import { RigidEntity } from '@opensa/engine/entities/rigid';

import { COCKPIT_STICK_PART, cockpitStickMotion, prepareCockpitStick } from '../apps/web/src/flight/cockpit-stick';
import type { Quat } from '../apps/web/src/flight/math';

const bytes = (name: string) => new Uint8Array(readFileSync(`map-pak/aircraft/${name}`)).buffer;
for (const [name, model] of [
  ['hydra', 520],
  ['rustler', 476],
] as const) {
  const data = buildVehicleModel(
    parseDff(bytes(`${name}.dff`)),
    new VehicleTextures([bytes(`${name}.txd`), bytes('vehicle.txd')]),
    {},
  );
  const positions = data.positions.slice();
  const normals = data.normals.slice();
  const uvs = data.uvs.slice();
  const colors = data.colors.slice();
  const meta = data.meta.slice();
  const indices = data.indices.slice();
  const meshes = data.submeshes.length;
  const parts = data.parts.length;
  const originalEntity = new RigidEntity(data.parts);
  originalEntity.flatten();
  const count = prepareCockpitStick(data, model);
  assert.deepEqual(data.positions, positions);
  assert.deepEqual(data.normals, normals);
  assert.deepEqual(data.uvs, uvs);
  const triangles = (input: ArrayLike<number>) =>
    Array.from({ length: input.length / 3 }, (_, i) =>
      [input[i * 3], input[i * 3 + 1], input[i * 3 + 2]].join(','),
    ).sort();
  assert.deepEqual(triangles(data.indices), triangles(indices), 'Every triangle must remain exactly once');
  if (model === 476) {
    assert.equal(count, 0);
    assert.deepEqual(data.colors, colors);
    assert.deepEqual(data.meta, meta);
    assert.equal(data.submeshes.length, meshes);
    assert.equal(data.parts.length, parts);
  } else {
    assert.equal(count, 48, 'Only the stock stick grip and stalk are selected');
    assert.equal(data.submeshes.length, meshes + 1);
    assert.equal(data.parts.length, parts + 1);
    assert.equal(data.parts[parts].name, COCKPIT_STICK_PART);
    const blend = data.submeshes[meshes];
    const selected = new Set(data.indices.subarray(blend.indexOffset, blend.indexOffset + blend.indexCount));
    assert.equal(selected.size, count);
    assert(data.submeshes[meshes].translucent);
    assert.equal(blend.part, parts);
    const entity = new RigidEntity(data.parts);
    entity.flatten();
    const neutral = entity.matrices.slice(parts * 16, parts * 16 + 16);
    const chassis = originalEntity.matrices.subarray(0, 16);
    for (let i = 0; i < 16; i++) assert(Math.abs(neutral[i] - chassis[i]) < 1e-6, 'Neutral stick remains authored');
    const motion = cockpitStickMotion(
      [null, [Math.sin(-0.15), 0, 0, Math.cos(-0.15)], null, [Math.sin(0.19), 0, 0, Math.cos(0.19)]],
      Array.from({ length: 5 }, () => [0, 0, 0, 1] as Quat),
    );
    entity.setPartRotation(parts, motion.rotation);
    entity.flatten();
    assert.deepEqual(entity.matrices.subarray(0, parts * 16), originalEntity.matrices, 'Only the stick can move');
    const matrix = entity.matrices.subarray(parts * 16, parts * 16 + 16);
    const pivot = data.parts[parts].localTranslation;
    for (let axis = 0; axis < 3; axis++) {
      const moved =
        matrix[axis] * pivot[0] + matrix[axis + 4] * pivot[1] + matrix[axis + 8] * pivot[2] + matrix[axis + 12];
      assert(Math.abs(moved - pivot[axis]) < 1e-6, 'The base pivot stays fixed');
    }
    assert.equal(prepareCockpitStick(data, model), 0, 'Preparation is idempotent');
    for (let vertex = 0; vertex < data.colors.length / 4; vertex++) {
      if (selected.has(vertex)) {
        assert.equal(data.colors[vertex * 4 + 3], 64);
        assert.equal(data.night[vertex * 4 + 3], 64);
      } else {
        assert.deepEqual(data.colors.subarray(vertex * 4, vertex * 4 + 4), colors.subarray(vertex * 4, vertex * 4 + 4));
        assert.deepEqual(data.meta.subarray(vertex * 4, vertex * 4 + 4), meta.subarray(vertex * 4, vertex * 4 + 4));
      }
    }
  }
  console.log(`${name}: ${count} stick vertices; original geometry, panel, seat and exterior preserved`);
}
