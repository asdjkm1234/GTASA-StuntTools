/** Check the replay camera against the recorded Hydra reversal without starting a GPU. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ReplayCamera, type CameraMode } from '../apps/web/src/flight/camera';
import { parseFlightCsv, sampleTrack } from '../apps/web/src/flight/csv';
import { gtaDirToEngine, rotateVec, type Vec3 } from '../apps/web/src/flight/math';

const path = resolve('..', '..', 'GTA San Andreas', 'flight_recordings', 'flight_20260918_021607_017_m520_003.csv');
const track = parseFlightCsv(readFileSync(path, 'utf8'), 'reversal.csv');
const camera = new ReplayCamera();
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

function frame(at: number, snap = false) {
  const pose = sampleTrack(track, at);
  const position: Vec3 = [pose.pos[0], pose.pos[2], -pose.pos[1]];
  const forward = rotateVec(pose.orientation, [0, 1, 0]);
  const velocity = gtaDirToEngine(pose.velocity);
  const state = camera.state({
    aspect: 1.6, dt: 0.04, forward, modelLength: 16, modelTop: 3,
    position, snap, up: rotateVec(pose.orientation, [0, 0, 1]), velocity,
    firstPersonPosition: [position[0] + 1, position[1] + 2, position[2] + 3],
  });
  return { forward, position, state, velocity };
}

const normal = frame(117, true);
assert(dot(minus(normal.state.eye, normal.position), normal.forward) < 0, 'forward flight: camera should trail the nose');
let reverse = normal;
for (let at = 117.04; at <= 124; at += 0.04) reverse = frame(at);
assert(dot(minus(reverse.state.eye, reverse.position), reverse.forward) > 0, 'backwards flight: camera should orbit to the nose side');
assert(dot(minus(reverse.state.target, reverse.state.eye), reverse.velocity) > 0, 'backwards flight: camera should look along travel');
const sample123 = frame(123, true);
const travel = minus(sample123.state.target, sample123.state.eye);
assert(dot(travel, sample123.velocity) / (Math.hypot(...travel) * Math.hypot(...sample123.velocity)) > 0.5,
  'at 123 seconds the view should point along backwards travel');
console.log('reversal follows travel at 124 seconds');

const distances: number[] = [];
for (const mode of ['chase-near', 'chase-mid', 'chase-far'] as CameraMode[]) {
  camera.mode = mode;
  const { state } = frame(124, true);
  distances.push(Math.hypot(...minus(state.target, state.eye)));
}
assert(distances[0] < distances[1] && distances[1] < distances[2], 'near < middle < far');
camera.mode = 'first-person';
const first = frame(124, true);
assert.deepEqual(first.state.eye, [first.position[0] + 1, first.position[1] + 2, first.position[2] + 3]);
assert(Math.abs(first.state.fovYRad - Math.PI / 3) < 1e-6, 'original first-person FOV');
camera.mode = 'cockpit';
assert(Math.abs(frame(124, true).state.fovYRad - (68 * Math.PI) / 180) < 1e-6, 'preserved cockpit FOV');
console.log('five modes and first-person anchor OK', distances.map((value) => value.toFixed(2)));
