import type { CameraStateOut } from './camera';
import type { FlightTrack } from './csv';
import type { Vec3 } from './math';

import { viewProjection } from './endpoint-picking';
import { gtaToEngine } from './math';

export interface RoutePick {
  depth: number;
  distancePx: number;
  seconds: number;
  segmentIndex: number;
}
export interface RoutePickOptions {
  currentSeconds?: number;
  height: number;
  radiusPx?: number;
  width: number;
  x: number;
  y: number;
}
type ClipPoint = [number, number, number, number];

/** Pick the drawn polyline in CSS pixels; perspective-correct interpolation recovers capture time. */
export function pickFlightRoute(
  track: FlightTrack,
  camera: CameraStateOut,
  options: RoutePickOptions,
): null | RoutePick {
  const { currentSeconds = 0, height, radiusPx = 8, width, x, y } = options;
  if (
    ![width, height, x, y, radiusPx].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0 ||
    radiusPx < 0 ||
    x < 0 ||
    y < 0 ||
    x > width ||
    y > height
  )
    return null;
  const matrix = viewProjection(camera);
  const clip = (position: Vec3): ClipPoint => {
    const [px, py, pz] = gtaToEngine(...position);

    return [0, 1, 2, 3].map(
      (axis) => matrix[axis] * px + matrix[axis + 4] * py + matrix[axis + 8] * pz + matrix[axis + 12],
    ) as ClipPoint;
  };
  let best: null | RoutePick = null;
  for (let i = 1; i < track.rows.length; i++) {
    const a = track.rows[i - 1],
      b = track.rows[i];
    if (
      ![...a.pos, ...b.pos, a.s, b.s].every(Number.isFinite) ||
      b.s <= a.s ||
      Math.hypot(...a.pos.map((value, axis) => b.pos[axis] - value)) < 0.001
    )
      continue;
    const end = clip(b.pos),
      start = clip(a.pos);
    const bounds = clipSegment(start, end);
    if (!bounds) continue;
    const [from, to] = bounds;
    const point = (t: number): ClipPoint => start.map((value, axis) => value + (end[axis] - value) * t) as ClipPoint;
    const first = point(from),
      last = point(to);
    const ax = ((first[0] / first[3] + 1) * width) / 2,
      ay = ((1 - first[1] / first[3]) * height) / 2;
    const bx = ((last[0] / last[3] + 1) * width) / 2,
      by = ((1 - last[1] / last[3]) * height) / 2;
    const dx = bx - ax,
      dy = by - ay,
      length2 = dx * dx + dy * dy;
    const screenT =
      length2 > 1e-8
        ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length2))
        : first[3] <= last[3]
          ? 0
          : 1;
    const distancePx = Math.hypot(x - ax - dx * screenT, y - ay - dy * screenT);
    if (distancePx > radiusPx) continue;
    // Screen-space t is not world-space t when the endpoints have different depths.
    const localT = (screenT * first[3]) / ((1 - screenT) * last[3] + screenT * first[3]);
    const t = from + (to - from) * localT;
    const candidate: RoutePick = {
      depth: start[3] + (end[3] - start[3]) * t,
      distancePx,
      seconds: a.s + (b.s - a.s) * t,
      segmentIndex: i - 1,
    };
    // Prefer the nearest line. At a projected crossing prefer the nearer 3D
    // branch; identical retraced paths use the pass closest to current progress.
    if (
      !best ||
      distancePx < best.distancePx - 0.25 ||
      (Math.abs(distancePx - best.distancePx) <= 0.25 &&
        (candidate.depth < best.depth - 0.01 ||
          (Math.abs(candidate.depth - best.depth) <= 0.01 &&
            Math.abs(candidate.seconds - currentSeconds) < Math.abs(best.seconds - currentSeconds))))
    )
      best = candidate;
  }

  return best;
}

/** Homogeneous clipping matches the GPU, including segments with both endpoints outside the viewport. */
export function clipSegment(a: ClipPoint, b: ClipPoint): [number, number] | null {
  if (![...a, ...b].every(Number.isFinite)) return null;
  const planes = ([x, y, z, w]: ClipPoint): number[] => [w + x, w - x, w + y, w - y, z, w - z, w - 1e-3];
  const end = planes(b),
    start = planes(a);
  let from = 0,
    to = 1;
  for (let i = 0; i < start.length; i++) {
    if (start[i] < 0 && end[i] < 0) return null;
    if (start[i] < 0) from = Math.max(from, start[i] / (start[i] - end[i]));
    else if (end[i] < 0) to = Math.min(to, start[i] / (start[i] - end[i]));
    if (from > to) return null;
  }

  return [from, to];
}
