import type { AudioListener } from './audio-engine';
import type { CameraStateOut } from './camera';
import type { FlightTrack } from './csv';
import type { Vec3 } from './math';
import type { ShotProgram } from './shot-sequence';

const mix = (a: Vec3, b: Vec3, t: number): Vec3 => a.map((v, i) => v + (b[i] - v) * t) as Vec3;
const gta = (v: Vec3): Vec3 => [v[0], -v[2], v[1]];
const unit = (v: Vec3): Vec3 => {
  const length = Math.hypot(...v) || 1;

  return v.map((n) => n / length) as Vec3;
};

/** Position/capture-time derivative in m/s. CSV velocity uses game units on some recordings. */
export function aircraftVelocityAt(track: FlightTrack, seconds: number): Vec3 {
  const rows = track.rows;
  if (rows.length < 2) return [0, 0, 0];
  let hi = rows.length - 1,
    lo = 0;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].s <= seconds) lo = mid;
    else hi = mid;
  }
  const a = rows[lo],
    b = rows[hi],
    dt = Math.max(1e-3, b.s - a.s);

  return b.pos.map((v, i) => (v - a.pos[i]) / dt) as Vec3;
}

/** Camera cuts change the observer; they must never become a fictitious listener velocity. */
export function audioCameraCuts(program?: ShotProgram): number[] {
  if (!program) return [];
  const clips = program.kind === 'sequence' ? program.clips : [{ end: Infinity, start: 0, view: program }];

  return clips.flatMap((clip, index) => [
    ...(index ? [clip.start] : []),
    ...(clip.view.kind === 'cockpit'
      ? []
      : (clip.view.segments ?? [])
          .slice(1)
          .filter((part) => part.transition <= 0 && part.start > clip.start && part.start < clip.end)
          .map((part) => part.start)),
  ]);
}

/** Fixed capture-time sampling, interpolated per PCM sample. Each cut has two independent sides. */
export function cameraAudioListenerAt(
  duration: number,
  stateAt: (seconds: number) => CameraStateOut,
  cuts: readonly number[] = [],
): (seconds: number) => AudioListener {
  if (!Number.isFinite(duration) || duration <= 0) {
    const camera = stateAt(0);

    return () => ({
      forward: gta(unit(camera.target.map((v, i) => v - camera.eye[i]) as Vec3)),
      pos: gta(camera.eye),
      up: gta(camera.up),
      velocity: [0, 0, 0],
    });
  }
  const boundaries = [0, ...new Set(cuts.filter((s) => s > 0 && s < duration).sort((a, b) => a - b)), duration];
  const segments = boundaries.slice(0, -1).map((start, index) => {
    const end = boundaries[index + 1],
      count = Math.max(1, Math.ceil((end - start) * 100));
    const states = Array.from({ length: count + 1 }, (_, i) => {
      const s = start + ((end - start) * i) / count;
      const camera = stateAt(i === count && end < duration ? end - Math.min(1e-8, (end - start) / 2) : s);

      return {
        forward: gta(unit(camera.target.map((v, axis) => v - camera.eye[axis]) as Vec3)),
        pos: gta(camera.eye),
        up: gta(camera.up),
        velocity: [0, 0, 0] as Vec3,
      };
    });
    const dt = (end - start) / count;
    for (let i = 0; i <= count; i++) {
      const a = Math.max(0, i - 1),
        b = Math.min(count, i + 1);
      states[i].velocity = states[b].pos.map((v, axis) => (v - states[a].pos[axis]) / ((b - a) * dt)) as Vec3;
    }

    return { count, end, start, states };
  });

  return (seconds) => {
    const s = Math.max(0, Math.min(duration, seconds));
    let hi = segments.length - 1,
      lo = 0;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (segments[mid].start <= s) lo = mid;
      else hi = mid - 1;
    }
    const segment = segments[lo],
      at = ((s - segment.start) / (segment.end - segment.start)) * segment.count;
    const first = Math.min(segment.count, Math.floor(at)),
      next = Math.min(segment.count, first + 1);
    const a = segment.states[first],
      b = segment.states[next],
      t = at - first;

    return {
      forward: unit(mix(a.forward, b.forward, t)),
      pos: mix(a.pos, b.pos, t),
      up: unit(mix(a.up, b.up, t)),
      velocity: mix(a.velocity, b.velocity, t),
    };
  };
}
