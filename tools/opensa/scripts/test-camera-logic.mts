/** Check the replay camera against the recorded Hydra reversal without starting a GPU. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { ReplayCamera, type CameraMode } from '../apps/web/src/flight/camera';
import { ChaseCameraTimeline } from '../apps/web/src/flight/camera-track';
import { parseFlightCsv, sampleTrack } from '../apps/web/src/flight/csv';
import { gtaDirToEngine, rotateVec, type Vec3 } from '../apps/web/src/flight/math';

const path = resolve('..', '..', 'GTA San Andreas', 'flight_recordings', 'flight_20260918_021607_017_m520_003.csv');
const track = parseFlightCsv(readFileSync(path, 'utf8'), 'reversal.csv');
const camera = new ReplayCamera();
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const minus = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const pitchDeg = (state: ReturnType<ReplayCamera['state']>) => {
  const view = minus(state.target, state.eye);
  return Math.atan2(view[1], Math.hypot(view[0], view[2])) * 180 / Math.PI;
};

function frame(at: number, snap = false) {
  const pose = sampleTrack(track, at);
  const position: Vec3 = [pose.pos[0], pose.pos[2], -pose.pos[1]];
  const forward = rotateVec(pose.orientation, [0, 1, 0]);
  const velocity = gtaDirToEngine(pose.velocity);
  const state = camera.state({
    aspect: 1.6, dt: 0.04, forward, model: pose.row.model, modelLength: 16, modelTop: 3,
    position, snap,
    up: rotateVec(pose.orientation, [0, 0, 1]), velocity,
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

const levelPitch = pitchDeg(frame(0, true).state);
let climbPitch = 0;
frame(110, true);
for (let at = 110.04; at <= 116; at += 0.04) climbPitch = pitchDeg(frame(at).state);
let divePitch = 0;
for (let at = 116.04; at <= 124; at += 0.04) divePitch = pitchDeg(frame(at).state);
assert(levelPitch < 0 && levelPitch > -10, `level camera offset: ${levelPitch}`);
assert(climbPitch > 10 && climbPitch < 70, `climb should look up without going vertical: ${climbPitch}`);
assert(divePitch < climbPitch, `descending flight should lower the view: ${divePitch}`);
const seekPitch = pitchDeg(frame(115.977, true).state);
assert(seekPitch > 10, `seeking into a climb should still look up: ${seekPitch}`);
console.log('camera pitch level/climb/dive/seek', [levelPitch, climbPitch, divePitch, seekPitch].map((value) => value.toFixed(1)));

const directTimeline = new ChaseCameraTimeline(track, 16, 3);
const steppedTimeline = new ChaseCameraTimeline(track, 16, 3);
const direct = directTimeline.state(115.977, 'chase-mid', 1.6);
for (let at = 0; at < 115.977; at += 1 / 60) steppedTimeline.state(at, 'chase-mid', 1.6);
const stepped = steppedTimeline.state(115.977, 'chase-mid', 1.6);
assert(Math.hypot(...minus(direct.eye, stepped.eye)) < 1e-6, 'camera must be independent of render call rate and seek order');
assert(Math.hypot(...minus(direct.target, stepped.target)) < 1e-6, 'target must be independent of render call rate');

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
