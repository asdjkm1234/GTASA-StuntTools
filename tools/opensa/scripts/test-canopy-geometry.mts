/** Check the owner's baked canopy without committing any game geometry. Run with tsx. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { buildVehicleModel } from '@opensa/renderware/vehicle/build-vehicle-model';
import { VehicleTextures } from '@opensa/renderware/vehicle/textures';
import { MaterialClass } from '@opensa/renderware/vehicle/types';

import { prepareAircraftCanopy } from '../apps/web/src/flight/aircraft-canopy';
import { prepareCanopySurface } from '../apps/web/src/flight/canopy-surface';
import { buildCanopyReflection } from '../apps/web/src/flight/canopy-reflection';
import { CockpitLookCamera } from '../apps/web/src/flight/cockpit-look';
import { FreeCamera } from '../apps/web/src/flight/free-camera';
import type { Vec3 } from '../apps/web/src/flight/math';

const root = process.argv[2] ?? 'map-pak';
const bytes = (name: string): ArrayBuffer => new Uint8Array(readFileSync(join(root, 'aircraft', name))).buffer;
const load = (name: string) =>
  buildVehicleModel(
    parseDff(bytes(`${name}.dff`)),
    new VehicleTextures([bytes(`${name}.txd`), bytes('vehicle.txd')]),
    {},
  );
for (const [name, model] of [
  ['hydra', 520],
  ['rustler', 476],
] as const) {
  const hydra = load(name);
  const before = hydra.meta.slice();
  const planes = prepareAircraftCanopy(hydra, model);
  assert(planes.length > 0, `No ${name} canopy found`);
  let canopyVertices = 0;
  let otherGlassVertices = 0;
  for (let vertex = 0; vertex < hydra.meta.length / 4; vertex += 1) {
    if (hydra.meta[vertex * 4 + 3] >> 4 === MaterialClass.canopy) {
      canopyVertices += 1;
      assert.equal(before[vertex * 4 + 3] >> 4, model === 520 ? MaterialClass.glass : MaterialClass.matte);
      assert.equal(hydra.reflect[vertex * 4], 0, 'Canopy must not reference a cockpit image');
    } else {
      assert.deepEqual(hydra.meta.subarray(vertex * 4, vertex * 4 + 4), before.subarray(vertex * 4, vertex * 4 + 4));
      if (hydra.meta[vertex * 4 + 3] >> 4 === MaterialClass.glass) otherGlassVertices += 1;
    }
  }
  assert(canopyVertices > 0);
  if (model === 520) assert(otherGlassVertices > 0, 'The detached nose lens must keep its own material');
  const positions = hydra.positions.slice();
  const normals = hydra.normals.slice();
  const uvs = hydra.uvs.slice();
  const reflect = hydra.reflect.slice();
  for (let vertex = 0; vertex < hydra.meta.length / 4; vertex += 1) {
    if (hydra.meta[vertex * 4 + 3] >> 4 === MaterialClass.canopy) hydra.reflect.fill(0, vertex * 4, vertex * 4 + 4);
  }
  prepareCanopySurface(hydra, model);
  for (let vertex = 0; vertex < hydra.meta.length / 4; vertex += 1) {
    const packed = hydra.reflect.subarray(vertex * 4, vertex * 4 + 4);
    if (hydra.meta[vertex * 4 + 3] >> 4 === MaterialClass.canopy) {
      assert.equal(
        packed.some((value) => value !== 0),
        model === 520,
        'Only Hydra receives surface coordinates',
      );
      if (model === 520) {
        const detail = [(packed[0] + packed[1] * 256 - 32768) / 4096, (packed[2] + packed[3] * 256 - 32768) / 4096];
        assert(
          detail.every((value) => Number.isFinite(value) && Math.abs(value) < 4),
          'Invalid stock surface coordinate',
        );
      }
    } else assert.deepEqual(packed, reflect.subarray(vertex * 4, vertex * 4 + 4));
  }
  assert.deepEqual(hydra.positions, positions, 'Surface fitting must not move the original glass');
  assert.deepEqual(hydra.normals, normals, 'Surface fitting must retain authored curvature normals');
  assert.deepEqual(hydra.uvs, uvs, 'Surface fitting must not replace base-material UVs');
  const reflection = buildCanopyReflection(hydra, planes);
  assert(reflection[0] > 0 && reflection[0] <= 1023, 'Missing or oversized cockpit BVH');
  assert(reflection.every(Number.isFinite), 'Invalid cockpit ray scene');
  assert.equal(reflection[3], hydra.parts.length, 'Reflection must address the same matrix rows');
  assert.deepEqual(hydra.positions, positions, 'Reflection must not change original geometry');
  console.log(
    `${name} reflection: ${(reflection.length / 4 - reflection[1]) / 8} triangles, ${reflection.byteLength} bytes`,
  );
  const seat = hydra.dummies.find((dummy) => dummy.name === 'ped_frontseat')!;
  const anchor: Vec3 = [0, seat.position[1] + 0.08 - 0.2, seat.position[2] + 0.62];
  let minimum = Infinity;
  let samples = 0;
  for (let degrees = -180; degrees <= 180; degrees += 5) {
    for (const height of [-0.08, 0.08])
      for (const lateral of [-0.1, 0.1])
        for (const longitudinal of [-0.08, 0.12]) {
          const look = new CockpitLookCamera(new FreeCamera({ fovYDeg: 68, near: 0.5 }), {
            height,
            lateral,
            longitudinal,
            pitch: 0.3,
            yaw: (degrees * Math.PI) / 180,
          });
          const state = look.state({
            aspect: 21 / 9,
            canopy: { anchor, planes },
            eye: anchor,
            forward: [0, 1, 0],
            right: [1, 0, 0],
            up: [0, 0, 1],
          });
          const radius = state.near * Math.sqrt(1 + Math.tan(state.fovYRad / 2) ** 2 * (1 + state.aspect ** 2));
          for (const plane of planes) {
            const gap = plane.distance - plane.normal.reduce((sum, value, axis) => sum + value * state.eye[axis], 0);
            minimum = Math.min(minimum, gap - radius);
            assert(gap >= radius + 0.0099, `Canopy crossing at yaw=${degrees}`);
          }
          samples += 1;
        }
  }
  console.log(
    `PASS ${name}: ${planes.length} canopy planes, ${canopyVertices} canopy vertices, ${otherGlassVertices} untouched lens vertices; ${samples} head poses, minimum near-corner gap ${minimum.toFixed(4)} m`,
  );
}
