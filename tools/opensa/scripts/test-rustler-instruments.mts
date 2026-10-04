/** Real locally baked geometry: complete five-face guard, mesh winding and isolated moving stick. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { buildVehicleModel } from '@opensa/renderware/vehicle/build-vehicle-model';
import { VehicleTextures } from '@opensa/renderware/vehicle/textures';

import { ATLAS_SIZE } from '../apps/web/src/flight/cockpit-instrument-mesh';
import { COCKPIT_CONTROL_ALPHA, COCKPIT_STICK_PART, prepareCockpitStick } from '../apps/web/src/flight/cockpit-stick';
import {
  buildRustlerInstrumentMesh,
  fitsRustlerDashboard,
  RUSTLER_DIAL_NORMAL,
  RUSTLER_DIALS,
} from '../apps/web/src/flight/rustler-instrument-mesh';

const bytes = (name: string): ArrayBuffer => new Uint8Array(readFileSync(`map-pak/aircraft/${name}`)).buffer;
const build = (name = 'rustler') =>
  buildVehicleModel(
    parseDff(bytes(`${name}.dff`)),
    new VehicleTextures([bytes(`${name}.txd`), bytes('vehicle.txd')]),
    {},
  );
const model = build();
const original = structuredClone(model);
assert.equal(fitsRustlerDashboard(model, 476), true);
assert.equal(fitsRustlerDashboard(model, 520), false);
assert.equal(fitsRustlerDashboard(build('hydra'), 476), false);
const centerVertex = RUSTLER_DIALS.map(({ center }) => {
  for (let i = 0; i < model.positions.length; i += 3)
    if (Math.hypot(...Array.from(model.positions.subarray(i, i + 3), (v, axis) => v - center[axis])) < 0.0001)
      return i / 3;
  throw new Error('Missing real dial center');
});
for (const vertex of centerVertex) {
  for (const mutate of [
    (data: ReturnType<typeof build>) => {
      data.positions[vertex * 3 + 1] += 0.003;
    },
    (data: ReturnType<typeof build>) => {
      data.normals[vertex * 3 + 1] = 1;
    },
    (data: ReturnType<typeof build>) => {
      data.meta[vertex * 4] = 255;
    },
  ]) {
    const mod = structuredClone(original);
    mutate(mod);
    const before = structuredClone(mod);
    assert.equal(fitsRustlerDashboard(mod, 476), false);
    assert.equal(prepareCockpitStick(mod, 476), 0);
    assert.deepEqual(mod, before, 'Incompatible geometry/material must remain untouched');
  }
}
assert.equal(prepareCockpitStick(model, 476), 52);
assert.equal(prepareCockpitStick(model, 476), 0, 'Preparation is idempotent');
assert.equal(fitsRustlerDashboard(model, 476), true, 'Stick splitting preserves every dial face');
assert.deepEqual(model.positions, original.positions);
assert.deepEqual(model.normals, original.normals);
assert.deepEqual(model.uvs, original.uvs);
const moved = model.submeshes.filter((mesh) => model.parts[mesh.part].name === COCKPIT_STICK_PART);
assert.equal(moved.length, 2);
const selected = new Set(
  moved.flatMap((mesh) => Array.from(model.indices.subarray(mesh.indexOffset, mesh.indexOffset + mesh.indexCount))),
);
assert.equal(selected.size, 52);
for (let v = 0; v < model.positions.length / 3; v++) {
  if (selected.has(v)) {
    assert.equal(model.colors[v * 4 + 3], COCKPIT_CONTROL_ALPHA);
    assert.equal(model.night[v * 4 + 3], COCKPIT_CONTROL_ALPHA);
  } else {
    for (const key of ['colors', 'night', 'meta', 'reflect'] as const)
      assert.deepEqual(model[key].subarray(v * 4, v * 4 + 4), original[key].subarray(v * 4, v * 4 + 4));
  }
}
assert.equal(prepareCockpitStick(build('hydra'), 520), 48, 'Hydra stick stays supported');
const mesh = buildRustlerInstrumentMesh(new Uint8Array(ATLAS_SIZE ** 2 * 4));
const positions = new Float32Array(mesh.positions.buffer),
  indices = new Uint16Array(mesh.indices.buffer);
assert.equal(mesh.submeshes.length, 1);
assert.equal(mesh.indexCount, 5 * 24 * 3);
assert.equal(Math.max(...indices) < mesh.vertexCount, true);
for (let at = 0; at < indices.length; at += 3) {
  const p = Array.from(indices.subarray(at, at + 3), (v) => Array.from(positions.subarray(v * 3, v * 3 + 3)));
  const a = p[1].map((v, i) => v - p[0][i]),
    b = p[2].map((v, i) => v - p[0][i]);
  const cross = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  assert(cross.reduce((sum, v, i) => sum + v * RUSTLER_DIAL_NORMAL[i], 0) > 0, 'Every face points toward the pilot');
}
for (let i = 0; i < positions.length; i += 3) {
  const p = Array.from(positions.subarray(i, i + 3));
  const dial = RUSTLER_DIALS.find(({ center }) => Math.hypot(...p.map((v, axis) => v - center[axis])) < 0.083);
  assert(dial);
  const depth = p.reduce((sum, v, axis) => sum + (v - dial.center[axis]) * RUSTLER_DIAL_NORMAL[axis], 0);
  assert(depth > 0.0009 && depth < 0.0021, 'Dial overlay stays just in front of the authored plane');
}
console.log(
  'PASS: complete five stock dials, mod guards, outward mesh winding, isolated 52-vertex translucent Rustler stick; Hydra preserved',
);
