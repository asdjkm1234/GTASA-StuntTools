/**
 * "The camera shivers" → which channel is actually moving.
 *
 * Reads a harness log's `[diag]` lines (video mode's `?video=1&diag=1` full-rate capture) and reports, per
 * shot, the high-frequency energy in each channel: the car as it is DRAWN, the eye, the aim, and where the
 * car lands on screen. A field report cannot tell a noisy subject from a noisy camera; these numbers can, and
 * the `[mount]` line says whether the shot is riding the car rigidly or dragging behind it.
 *
 * Usage: npx tsx scripts/debug/video-shiver.ts <harness.log>
 */
import { readFileSync } from 'node:fs';

interface Capture {
  columns: string[];
  rows: (number | string)[][];
  scene: number;
}

const path = process.argv[2];
if (!path) {
  throw new Error('usage: video-shiver.ts <harness.log>');
}

const captures = new Map<number, Capture>();
for (const line of readFileSync(path, 'utf8').split('\n')) {
  const at = line.indexOf('[diag] {');
  if (at < 0) {
    continue;
  }
  const capture = JSON.parse(line.slice(at + '[diag] '.length)) as Capture;
  captures.set(capture.scene, capture); // the harness echoes each line twice — dedupe by scene
}

/**
 * The view basis `screenBasis` builds (`apps/web/src/ui/camera/engine-camera.ts`) — kept in step with it by
 * hand, because a debug script may not import the app layer.
 */
function basisOf(forward: readonly number[]): { right: number[]; up: number[] } {
  const length = Math.hypot(forward[2], forward[0]) || 1;
  const right = [-forward[2] / length, 0, forward[0] / length];

  return {
    right,
    up: [-forward[1] * right[2], forward[0] * right[2] - forward[2] * right[0], forward[1] * right[0]],
  };
}

/** RMS of the second difference: how much a channel CHANGES ITS RATE frame to frame. Smooth motion is small
 *  whatever its speed; a per-frame buzz is not. Reported in the channel's own units per frame². */
function jitter(values: number[]): number {
  if (values.length < 3) {
    return 0;
  }
  let sum = 0;
  for (let i = 2; i < values.length; i += 1) {
    const second = values[i] - 2 * values[i - 1] + values[i - 2];
    sum += second * second;
  }

  return Math.sqrt(sum / (values.length - 2));
}

/**
 * Where a point sits relative to a pose's view axis, as ANGLES (deg, right-positive / up-positive) — no lens
 * needed, so a capture that never recorded its fov can still be read.
 */
function offAxis(
  eye: readonly number[],
  target: readonly number[],
  point: readonly number[],
): { x: number; y: number } {
  const forward = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
  const length = Math.hypot(...forward) || 1;
  const unit = forward.map((value) => value / length);
  const { right, up } = basisOf(unit);
  const delta = [point[0] - eye[0], point[1] - eye[1], point[2] - eye[2]];
  const depth = Math.max(0.01, delta[0] * unit[0] + delta[1] * unit[1] + delta[2] * unit[2]);
  const dotRight = delta[0] * right[0] + delta[1] * right[1] + delta[2] * right[2];
  const dotUp = delta[0] * up[0] + delta[1] * up[1] + delta[2] * up[2];

  return { x: (Math.atan2(dotRight, depth) * 180) / Math.PI, y: (Math.atan2(dotUp, depth) * 180) / Math.PI };
}

function unwrap(values: number[]): number[] {
  const out = [values[0]];
  for (let i = 1; i < values.length; i += 1) {
    let delta = values[i] - values[i - 1];
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    out.push(out[i - 1] + delta);
  }

  return out;
}

const DEG = 180 / Math.PI;
/** The field run's frame: what a screen-space number means in pixels for the user's own window. */
const WIDTH_PX = 1440;

for (const [scene, capture] of [...captures].sort((a, b) => a[0] - b[0])) {
  const index = (name: string): number => capture.columns.indexOf(name);
  const col = (row: (number | string)[], name: string): number => Number(row[index(name)]);
  console.log(`\n=== scene ${scene} — ${capture.rows.length} frames ===`);

  // Split on the DECLARED cut, not on the shot name: a cut is a discontinuity and measuring across one
  // measures the cut, and the same preset can play twice in a scene (`chase → wing-l → chase → wing-l`), so a
  // name change is neither necessary nor sufficient. Captures older than the `cut` column fall back to the
  // name — they predate the split and their repeated shots ARE merged.
  const segments: { rows: (number | string)[][]; shot: string }[] = [];
  for (const row of capture.rows) {
    const shot = String(row[index('shot')]);
    const cut = index('cut') >= 0 ? Number(row[index('cut')]) === 1 : false;
    const last = segments[segments.length - 1];
    if (!last || cut || (index('cut') < 0 && last.shot !== shot)) {
      segments.push({ rows: [row], shot });
    } else {
      last.rows.push(row);
    }
  }

  for (const segment of segments) {
    const rows = segment.rows.slice(2); // the first frames of a shot SNAP by design
    if (rows.length < 30) {
      continue;
    }
    const t = rows.map((row) => col(row, 't'));
    const dts = t.slice(1).map((value, i) => value - t[i]);
    const meanDt = dts.reduce((a, b) => a + b, 0) / dts.length;
    const heading = unwrap(rows.map((row) => col(row, 'heading')));
    const renderYaw = unwrap(rows.map((row) => col(row, 'renderYaw')));
    const lag = heading.map((value, i) => (value - renderYaw[i]) * DEG);
    const sx = rows.map((row) => col(row, 'sx'));
    const sy = rows.map((row) => col(row, 'sy'));
    // The aim as an ANGLE (what the viewer sees swing), not as a point in space.
    const aim = unwrap(
      rows.map((row) => Math.atan2(col(row, 'tgtX') - col(row, 'eyeX'), col(row, 'tgtZ') - col(row, 'eyeZ'))),
    );
    // WHICH FRAME'S CAMERA the drawn car is paired with — the measurement that decides whether a shiver is
    // the director's or the wiring's, and the one a "the pose looks smooth" check cannot make.
    //
    // `same-frame` is what the shipped build renders: the director is stepped from inside the host loop,
    // between the car's render pose and the camera snapshot. `frame-late` is what it renders if that step is
    // ever moved back out to its own rAF pass — the pose then reaches the screen a frame after the car it was
    // composed from, the pairing carries the car's whole travel for that frame, and frame-clock jitter turns
    // it into shiver. 096 field round 1 shipped that way and measured 0.33° of it against a 0.005° intent, so
    // this column is a REGRESSION TRIPWIRE, not history.
    const eyeAt = (row: (number | string)[]): number[] => [col(row, 'eyeX'), col(row, 'eyeY'), col(row, 'eyeZ')];
    const targetAt = (row: (number | string)[]): number[] => [col(row, 'tgtX'), col(row, 'tgtY'), col(row, 'tgtZ')];
    const carAt = (row: (number | string)[]): number[] => [col(row, 'carX'), col(row, 'carY'), col(row, 'carZ')];
    const sameFrame = rows.map((row) => offAxis(eyeAt(row), targetAt(row), carAt(row)));
    const frameLate = rows.map((row, at) => {
      const pose = rows[Math.max(0, at - 1)];

      return offAxis(eyeAt(pose), targetAt(pose), carAt(row));
    });
    const channels = {
      'aim yaw (deg)': jitter(aim.map((value) => value * DEG)),
      'car x (m)': jitter(rows.map((row) => col(row, 'carX'))),
      'car y (m)': jitter(rows.map((row) => col(row, 'carY'))),
      'car z (m)': jitter(rows.map((row) => col(row, 'carZ'))),
      'eye x (m)': jitter(rows.map((row) => col(row, 'eyeX'))),
      'eye y (m)': jitter(rows.map((row) => col(row, 'eyeY'))),
      'eye z (m)': jitter(rows.map((row) => col(row, 'eyeZ'))),
      'frame-late off-axis x (deg)': jitter(frameLate.map((value) => value.x)),
      'frame-late off-axis y (deg)': jitter(frameLate.map((value) => value.y)),
      'same-frame off-axis x (deg)': jitter(sameFrame.map((value) => value.x)),
      'same-frame off-axis y (deg)': jitter(sameFrame.map((value) => value.y)),
      'screen x (px)': jitter(sx) * WIDTH_PX,
      'screen y (px)': jitter(sy) * WIDTH_PX,
    };
    // Where the eye actually stands in the CAR's own heading frame. A rigid mount would hold the authored
    // offset exactly; what it holds instead is the offset minus `smoothDamp`'s steady-state lag against a
    // moving subject — and that lag is what frame-time jitter has to modulate.
    const rel = rows.map((row) => {
      const h = col(row, 'heading');
      const fx = -Math.sin(h);
      const fz = -Math.cos(h);
      const dx = col(row, 'eyeX') - col(row, 'carX');
      const dz = col(row, 'eyeZ') - col(row, 'carZ');

      return { forward: dx * fx + dz * fz, lateral: dx * -fz + dz * fx };
    });
    const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;
    console.log(
      `    [mount] forward ${mean(rel.map((r) => r.forward)).toFixed(2)}m lateral ` +
        `${mean(rel.map((r) => r.lateral)).toFixed(2)}m · jitter fwd ${jitter(rel.map((r) => r.forward)).toFixed(4)} ` +
        `lat ${jitter(rel.map((r) => r.lateral)).toFixed(4)} · dt jitter ${jitter(t).toFixed(3)}ms ` +
        `(spread ${(Math.max(...dts) - Math.min(...dts)).toFixed(1)}ms)`,
    );
    const lagAbs = lag.map(Math.abs);
    console.log(
      `\n  ${segment.shot.padEnd(8)} ${rows.length} frames @ ${meanDt.toFixed(1)} ms ` +
        `(${(1000 / meanDt).toFixed(0)} fps)  heading-vs-drawn: mean ${(
          lagAbs.reduce((a, b) => a + b, 0) / lagAbs.length
        ).toFixed(3)}° max ${Math.max(...lagAbs).toFixed(3)}°`,
    );
    for (const [name, value] of Object.entries(channels).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${name.padEnd(16)} ${value.toFixed(4)}`);
    }
  }
}
