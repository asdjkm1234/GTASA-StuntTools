/** Compare the temporary GTA camera trace with the replay's aircraft follow camera. */
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

import { ReplayCamera } from '../apps/web/src/flight/camera';
import { ChaseCameraTimeline } from '../apps/web/src/flight/camera-track';
import { parseFlightCsv, sampleTrack } from '../apps/web/src/flight/csv';
import { gtaDirToEngine, rotateVec, type Vec3 } from '../apps/web/src/flight/math';

const path = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Usage: tsx scripts/analyze-camera-trace.mts <recording.csv>');
const fps = Number(process.argv[3] ?? 100);
if (!Number.isFinite(fps) || fps < 10 || fps > 300) throw new Error('FPS must be 10-300');
const fixedTimeline = process.argv[3] === undefined;
const source = readFileSync(path, 'utf8');
const track = parseFlightCsv(source, basename(path));
const lines = source.split(/\r?\n/).filter((line) => line && !line.startsWith('#'));
const columns = lines[0].split(',');
const index = new Map(columns.map((column, i) => [column, i]));
const raw = lines.slice(1).map((line) => line.split(','));
if (track.rows.length !== raw.length) throw new Error('CSV parser discarded rows; trace comparison would misalign');
const value = (cells: string[], name: string) => Number(cells[index.get(name) ?? -1]);
const vec = (cells: string[], prefix: string): Vec3 => [value(cells, `${prefix}_x`), value(cells, `${prefix}_y`), value(cells, `${prefix}_z`)];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const difference = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const length = (a: Vec3) => Math.hypot(...a);
const normal = (a: Vec3): Vec3 => { const n = length(a); return [a[0] / n, a[1] / n, a[2] / n]; };
const angle = (a: Vec3, b: Vec3) => Math.acos(Math.max(-1, Math.min(1, dot(normal(a), normal(b))))) * 180 / Math.PI;
const pitch = (a: Vec3) => Math.atan2(a[1], Math.hypot(a[0], a[2])) * 180 / Math.PI;
const median = (numbers: number[]) => { const sorted = numbers.slice().sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? NaN; };
const percentile = (numbers: number[], p: number) => { const sorted = numbers.slice().sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) * p)] ?? NaN; };

const replay = new ReplayCamera();
replay.mode = 'chase-mid';
const timeline = new ChaseCameraTimeline(track, 14.2, 2.2);
const records: { time: number; eye: number; direction: number; pitch: number; referencePitch: number;
  replayPitch: number; expectedDistance: number;
  inferredHeight: number; inferredDistance: number; finalMatrixEye: number }[] = [];
let time = 0;
const firstPose = sampleTrack(track, 0);
let predicted = replay.state({ aspect: 1.6, dt: 0.001,
  forward: rotateVec(firstPose.orientation, [0, 1, 0]),
  up: rotateVec(firstPose.orientation, [0, 0, 1]),
  model: firstPose.row.model, modelLength: 14.2, modelTop: 2.2,
  position: [firstPose.pos[0], firstPose.pos[2], -firstPose.pos[1]],
  snap: true, velocity: gtaDirToEngine(firstPose.velocity) });
for (let i = 0; i < raw.length; i++) {
  const row = track.rows[i];
  while (!fixedTimeline && time < row.s - 1e-6) {
    const next = Math.min(row.s, time + 1 / fps);
    const pose = sampleTrack(track, next);
    const position: Vec3 = [pose.pos[0], pose.pos[2], -pose.pos[1]];
    predicted = replay.state({ aspect: 1.6, dt: next - time,
      forward: rotateVec(pose.orientation, [0, 1, 0]), up: rotateVec(pose.orientation, [0, 0, 1]),
      model: pose.row.model, modelLength: 14.2, modelTop: 2.2, position, snap: false, velocity: gtaDirToEngine(pose.velocity) });
    time = next;
  }
  if (fixedTimeline) predicted = timeline.state(row.s, 'chase-mid', 1.6);
  const cells = raw[i];
  if (value(cells, 'camera_valid') !== 1) continue;
  const position: Vec3 = [row.pos[0], row.pos[2], -row.pos[1]];
  const eye = [value(cells, 'camera_source_x'), value(cells, 'camera_source_z'), -value(cells, 'camera_source_y')] as Vec3;
  const front = gtaDirToEngine(vec(cells, 'camera_front'));
  const replayFront = difference(predicted.target, predicted.eye);
  const matrixEye = [value(cells, 'camera_matrix_x'), value(cells, 'camera_matrix_z'), -value(cells, 'camera_matrix_y')] as Vec3;
  const planarFrontSq = front[0] ** 2 + front[2] ** 2;
  const targetRange = planarFrontSq > 0.2
    ? ((position[0] - eye[0]) * front[0] + (position[2] - eye[2]) * front[2]) / planarFrontSq
    : NaN;
  records.push({ time: row.s, eye: length(difference(predicted.eye, eye)), direction: angle(replayFront, front),
    pitch: pitch(replayFront) - pitch(front), referencePitch: pitch(front), replayPitch: pitch(replayFront),
    expectedDistance: length(replayFront),
    inferredHeight: Number.isFinite(targetRange) ? eye[1] + front[1] * targetRange - position[1] : NaN,
    inferredDistance: targetRange,
    finalMatrixEye: length(difference(eye, matrixEye)) });
}
if (!records.length) throw new Error('No valid camera trace');
const group = (name: keyof typeof records[number]) => records.map((record) => record[name]);
console.log(`${basename(path)}: ${records.length} valid camera samples, ${track.duration.toFixed(2)} s, replay ${fixedTimeline ? 'fixed 100' : fps} FPS`);
for (const key of ['eye', 'direction', 'pitch', 'referencePitch', 'replayPitch', 'expectedDistance', 'finalMatrixEye'] as const) {
  const values = group(key).filter(Number.isFinite);
  console.log(`${key}: median=${median(values).toFixed(2)} p90=${percentile(values, 0.9).toFixed(2)}`);
}
for (const key of ['inferredHeight', 'inferredDistance'] as const) {
  const values = group(key).filter(Number.isFinite);
  console.log(`${key}: median=${median(values).toFixed(5)} p10=${percentile(values, 0.1).toFixed(5)} p90=${percentile(values, 0.9).toFixed(5)}`);
}
for (let second = 0; second < track.duration; second += 10) {
  const window = records.filter((record) => record.time >= second && record.time < second + 10);
  console.log(`${second}-${second + 10}s: angle=${median(window.map((record) => record.direction)).toFixed(1)}deg `
    + `pitchError=${median(window.map((record) => record.pitch)).toFixed(1)}deg `
    + `eye=${median(window.map((record) => record.eye)).toFixed(1)}m `
    + `referencePitch=${median(window.map((record) => record.referencePitch)).toFixed(1)}deg`);
}
