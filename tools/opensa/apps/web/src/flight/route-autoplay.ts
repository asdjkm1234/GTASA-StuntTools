import type { CameraStateOut } from './camera';
import type { Quat, Vec3 } from './math';

import { quatFromColumns, rotateVec, slerp } from './math';

export const ROUTE_END_WAIT_MS = 2000;
export const ROUTE_TRAVEL_MS = 1200;

/** Only a natural playback ending arms the real-time delay; manual seeks never arm it. */
export class RouteAutoplay {
  enabled = false;
  phase: 'idle' | 'loading' | 'moving' | 'waiting' = 'idle';
  get progress(): number {
    return this.progressAt(performance.now());
  }
  private deadline = 0;
  private from: CameraStateOut | null = null;
  private started = 0;
  private to: CameraStateOut | null = null;
  camera(now: number): CameraStateOut | null {
    if (this.phase === 'loading') return this.from;

    return this.phase === 'moving' && this.from && this.to
      ? travelCamera(this.from, this.to, this.progressAt(now))
      : null;
  }
  cancel(): void {
    this.phase = 'idle';
    this.from = null;
    this.to = null;
  }
  end(now: number, hasNext: boolean, camera: CameraStateOut): void {
    if (!this.enabled || !hasNext || this.phase !== 'idle') return;
    this.from = structuredClone(camera);
    this.deadline = now + ROUTE_END_WAIT_MS;
    this.phase = 'waiting';
  }
  finish(now: number): boolean {
    if (this.phase !== 'moving' || this.progressAt(now) < 1) return false;
    this.cancel();

    return true;
  }
  prepare(now: number): boolean {
    if (!this.enabled || this.phase !== 'waiting' || now < this.deadline) return false;
    this.phase = 'loading';

    return true;
  }
  progressAt(now: number): number {
    return this.phase === 'moving' ? Math.max(0, Math.min(1, (now - this.started) / ROUTE_TRAVEL_MS)) : 0;
  }
  travel(to: CameraStateOut, now: number): void {
    if (this.phase !== 'loading') return;
    this.to = structuredClone(to);
    this.started = now;
    this.phase = 'moving';
  }
}
/** Rotation is interpolated as a quaternion, keeping rolled/axial views finite during travel. */
export function travelCamera(from: CameraStateOut, to: CameraStateOut, progress: number): CameraStateOut {
  if (progress <= 0) return structuredClone(from);
  if (progress >= 1) return structuredClone(to);
  const t = progress * progress * (3 - 2 * progress);
  const eye = from.eye.map((n, i) => n + (to.eye[i] - n) * t) as Vec3;
  const orientation = slerp(cameraOrientation(from), cameraOrientation(to), t);
  const direction = rotateVec(orientation, [0, 0, -1]);
  const distance = (state: CameraStateOut): number =>
    Math.max(1, Math.hypot(...state.eye.map((n, i) => n - state.target[i])));
  const length = distance(from) + (distance(to) - distance(from)) * t;

  return {
    ...to,
    eye,
    fovYRad: from.fovYRad + (to.fovYRad - from.fovYRad) * t,
    near: from.near + (to.near - from.near) * t,
    target: eye.map((n, i) => n + direction[i] * length) as Vec3,
    up: rotateVec(orientation, [0, 1, 0]),
  };
}
function cameraOrientation(state: CameraStateOut): Quat {
  const back = normal(state.eye.map((n, i) => n - state.target[i]) as Vec3);
  let right = cross(state.up, back);
  if (Math.hypot(...right) < 1e-8) right = cross(Math.abs(back[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], back);
  right = normal(right);

  return quatFromColumns(right, normal(cross(back, right)), back);
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normal(v: Vec3): Vec3 {
  const length = Math.hypot(...v);

  return length > 1e-8 ? (v.map((n) => n / length) as Vec3) : [0, 0, 1];
}
