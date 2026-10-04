/** Local stock geometry: isolate the upper back without changing shared lower-seat vertices. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { buildVehicleModel } from '@opensa/renderware/vehicle/build-vehicle-model';
import { VehicleTextures } from '@opensa/renderware/vehicle/textures';

import { prepareCockpitSeat } from '../apps/web/src/flight/cockpit-seat';
import { COCKPIT_CONTROL_ALPHA, prepareCockpitStick } from '../apps/web/src/flight/cockpit-stick';

const bytes = (name: string): ArrayBuffer => new Uint8Array(readFileSync(`map-pak/aircraft/${name}`)).buffer;
function build(name = 'hydra') {
  return buildVehicleModel(
    parseDff(bytes(`${name}.dff`)),
    new VehicleTextures([bytes(`${name}.txd`), bytes('vehicle.txd')]),
    {},
  );
}
const data = build();
prepareCockpitStick(data, 520);
const original = structuredClone(data);
const pair = prepareCockpitSeat(data, 520);
assert(pair);
assert.equal(data.submeshes.length, original.submeshes.length + 4);
assert.equal(data.positions.length, original.positions.length + 32 * 3);
assert.deepEqual(prepareCockpitSeat(data, 520), pair, 'Preparing twice must not append geometry again');
for (const key of ['positions', 'normals', 'uvs', 'colors', 'night', 'meta', 'reflect'] as const)
  assert.deepEqual(data[key].subarray(0, original[key].length), original[key], `Every authored ${key} stays intact`);
assert.deepEqual(data.parts, original.parts);
const opaque = pair.opaque.map((index) => data.submeshes[index]);
const blend = pair.translucent.map((index) => data.submeshes[index]);
assert.deepEqual(
  opaque.map((mesh) => mesh.indexCount),
  [12, 42],
);
assert.deepEqual(
  blend.map((mesh) => mesh.indexCount),
  [12, 42],
);
assert(opaque.every((mesh) => !mesh.translucent));
assert(blend.every((mesh) => mesh.translucent));
const back = opaque.flatMap((mesh) =>
  Array.from(data.indices.subarray(mesh.indexOffset, mesh.indexOffset + mesh.indexCount)),
);
const transparent = blend.flatMap((mesh) =>
  Array.from(data.indices.subarray(mesh.indexOffset, mesh.indexOffset + mesh.indexCount)),
);
for (let i = 0; i < back.length; i++) {
  const a = back[i],
    b = transparent[i];
  assert(b >= original.positions.length / 3);
  for (const key of ['positions', 'normals', 'uvs'] as const) {
    const stride = key === 'uvs' ? 2 : 3;
    assert.deepEqual(
      data[key].subarray(b * stride, (b + 1) * stride),
      data[key].subarray(a * stride, (a + 1) * stride),
    );
  }
  assert.equal(data.colors[b * 4 + 3], COCKPIT_CONTROL_ALPHA);
  assert.equal(data.night[b * 4 + 3], COCKPIT_CONTROL_ALPHA);
}
const triangleCounts = (indices: ArrayLike<number>) => {
  const counts = new Map<string, number>();
  for (let i = 0; i < indices.length; i += 3) {
    const key = [indices[i], indices[i + 1], indices[i + 2]].join(',');
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
};
assert.deepEqual(
  triangleCounts(data.indices.subarray(0, blend[0].indexOffset)),
  triangleCounts(original.indices),
  'Outside cockpit-look, every authored face is rendered exactly once',
);
for (const mutate of [
  (model: ReturnType<typeof build>) => {
    model.positions[359 * 3 + 2] += 0.02;
  },
  (model: ReturnType<typeof build>) => {
    model.indices[750] = 354;
  },
  (model: ReturnType<typeof build>) => {
    model.colors[359 * 4] = 64;
  },
]) {
  const mod = build();
  mutate(mod);
  const before = structuredClone(mod);
  assert.equal(prepareCockpitSeat(mod, 520), null);
  assert.deepEqual(mod, before, 'Incompatible mod stays untouched');
}
assert.equal(prepareCockpitSeat(build('rustler'), 476), null);
console.log(
  'PASS: stock upper-back shell (18 faces/32 vertices), matching day/night stick alpha, authored geometry/materials, idempotence, mod and Rustler guards',
);
