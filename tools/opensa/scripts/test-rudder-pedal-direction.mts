/** Check direction against real local rudder geometry, rather than assumed key mappings. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { buildVehicleModel } from '@opensa/renderware/vehicle/build-vehicle-model';
import { VehicleTextures } from '@opensa/renderware/vehicle/textures';

import { cockpitPedalMotion } from '../apps/web/src/flight/cockpit-pedals';
import { parseFlightCsv, sampleTrack } from '../apps/web/src/flight/csv';
import { quatMultiply, rotateVec, type Quat, type Vec3 } from '../apps/web/src/flight/math';

const bytes = (name: string): ArrayBuffer => new Uint8Array(readFileSync(`map-pak/aircraft/${name}`)).buffer;
const data = buildVehicleModel(
  parseDff(bytes('hydra.dff')),
  new VehicleTextures([bytes('hydra.txd'), bytes('vehicle.txd')]),
  {},
);
const partIndex = data.parts.findIndex((p) => p.name === 'rudder' || p.name === 'rudder_dummy');
assert(partIndex >= 0);
const part = data.parts[partIndex];
const vertices = new Set<number>();
for (const mesh of data.submeshes.filter((m) => m.part === partIndex && m.kind === 'body'))
  for (const i of data.indices.subarray(mesh.indexOffset, mesh.indexOffset + mesh.indexCount)) vertices.add(i);
assert(vertices.size > 0);
const points = [...vertices].map((i) => Array.from(data.positions.subarray(i * 3, i * 3 + 3)) as Vec3);
const native = points.map((p) => rotateVec(part.localRotation, p));
const trailing = native.reduce((a, b) => (a[1] < b[1] ? a : b));
assert(trailing[1] < -0.1, 'Rudder trailing edge extends aft of hinge in aircraft-local -Y');
for (const angle of [-0.4, 0.4]) {
  const delta: Quat = [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
  const motion = cockpitPedalMotion(quatMultiply(delta, part.localRotation), part.localRotation);
  const displacement = rotateVec(delta, trailing)[0] - trailing[0];
  console.log(JSON.stringify({ angle, trailing, displacement, motion }));
  assert.equal(
    Math.sign(motion.rightTravel),
    displacement > 0 ? 1 : 0,
    'Right (+X) trailing-edge deflection must advance right pedal (+Y)',
  );
  assert.equal(Math.sign(motion.leftTravel), displacement < 0 ? 1 : 0);
}
const track = parseFlightCsv(
  readFileSync('../../GTA San Andreas/flight_recordings/flight_20260930_220316_220_m520_002.csv', 'utf8'),
  'real.csv',
);
const pose = sampleTrack(track, 1.499);
const motion = cockpitPedalMotion(pose.nodes[0], part.localRotation);
console.log('screenshot-time', JSON.stringify({ s: 1.499, node: pose.nodes[0], motion }));
console.log('PASS: real Hydra trailing-edge geometry and both pedal directions');
