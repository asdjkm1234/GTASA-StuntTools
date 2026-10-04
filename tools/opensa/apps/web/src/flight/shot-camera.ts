import type { CameraStateOut } from './camera';
import type { CockpitLookPose } from './cockpit-look';
import type { FlightTrack } from './csv';
import type { Vec3 } from './math';

import { sampleTrack } from './csv';
import { gtaToEngine, rotateVec } from './math';

export interface FollowSegment {
  end: number;
  fovYDeg: number;
  heading: 'aircraft' | 'world';
  offset: Vec3;
  start: number;
  transition: number;
}
export type ShotKind = 'cockpit' | 'fixed' | 'follow' | 'tracking';
export interface ShotRange {
  end: number;
  start: number;
}
export interface WorldShotSegment extends ShotRange {
  fovYDeg: number;
  pitch: number;
  position: Vec3;
  transition: number;
  yaw: number;
}
export const SHOT_LABELS: Record<ShotKind, string> = {
  cockpit: '座舱镜头',
  fixed: '固定镜头',
  follow: '伴飞机位',
  tracking: '定点跟拍',
};
export const SHOT_KINDS: ShotKind[] = ['fixed', 'tracking', 'follow', 'cockpit'];
export type ExteriorShotView = Exclude<ShotView, { kind: 'cockpit' }>;
export type ShotSegment = FollowSegment | WorldShotSegment;
export type ShotView =
  | { cockpitLookPose: CockpitLookPose; fovYDeg: number; kind: 'cockpit' }
  | { fovYDeg: number; kind: 'fixed'; pitch: number; position: Vec3; segments?: WorldShotSegment[]; yaw: number }
  | { fovYDeg: number; kind: 'follow'; offset: Vec3; segments?: FollowSegment[] }
  | { fovYDeg: number; kind: 'tracking'; pitch: number; position: Vec3; segments?: WorldShotSegment[]; yaw: number };

/** Content identity survives renaming/importing the same recording; no game assets enter the plan. */
export function shotRecordingId(track: FlightTrack): string {
  let hash = 2166136261;
  for (const row of track.rows)
    for (const c of `${row.s},${row.pos.join(',')},${row.orientation.join(',')};`) {
      hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
    }

  return `${track.model}:${track.rows.length}:${track.duration}:${(hash >>> 0).toString(16)}`;
}

export function validShotRange(range: ShotRange, duration: number): boolean {
  return (
    Number.isFinite(range.start) &&
    Number.isFinite(range.end) &&
    range.start >= 0 &&
    range.end > range.start &&
    range.end <= duration + 1e-6
  );
}

/** Validate saved JSON before it can change an interactive or exported camera. */
export function validShotView(value: unknown): value is ShotView {
  if (!value || typeof value !== 'object') return false;
  const view = value as Record<string, unknown>;
  const finite = (v: unknown, min: number, max: number): boolean =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  const vector = (v: unknown, limit: number): v is Vec3 =>
    Array.isArray(v) && v.length === 3 && v.every((n) => finite(n, -limit, limit));
  if (!finite(view.fovYDeg, 20, 110)) return false;
  if (view.kind === 'follow') {
    if (!vector(view.offset, 2000) || Math.hypot(...view.offset) < 1) return false;

    return validSegments(view.segments, 'follow');
  }
  if (view.kind === 'fixed' || view.kind === 'tracking')
    return (
      vector(view.position, 99999) &&
      finite(view.yaw, -99999, 99999) &&
      finite(view.pitch, -1.56, 1.56) &&
      validSegments(view.segments, view.kind)
    );
  if (view.kind !== 'cockpit' || !view.cockpitLookPose || typeof view.cockpitLookPose !== 'object') return false;
  const pose = view.cockpitLookPose as Record<string, unknown>;

  return (
    view.segments === undefined &&
    finite(pose.yaw, -99999, 99999) &&
    finite(pose.pitch, -1.45, 1.45) &&
    finite(pose.height, -0.08, 0.08) &&
    finite(pose.lateral, -0.1, 0.1) &&
    finite(pose.longitudinal, -0.08, 0.12)
  );
}

function validSegments(segments: unknown, kind: ExteriorShotView['kind']): boolean {
  const view = { segments };
  const finite = (v: unknown, min: number, max: number): boolean =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  const vector = (v: unknown, limit: number): v is Vec3 =>
    Array.isArray(v) && v.length === 3 && v.every((n) => finite(n, -limit, limit));
  if (view.segments === undefined) return true;
  if (!Array.isArray(view.segments) || !view.segments.length || view.segments.length > 64) return false;
  let previousEnd: null | number = null;
  for (const item of view.segments as unknown[]) {
    if (!item || typeof item !== 'object') return false;
    const part = item as Record<string, unknown>;
    if (
      !finite(part.start, 0, 99999) ||
      !finite(part.end, 0, 99999) ||
      Number(part.end) <= Number(part.start) ||
      !finite(part.fovYDeg, 20, 110) ||
      !finite(part.transition, 0, Number(part.end) - Number(part.start)) ||
      (kind === 'follow'
        ? !['aircraft', 'world'].includes(String(part.heading)) ||
          !vector(part.offset, 2000) ||
          Math.hypot(...part.offset) < 1
        : !vector(part.position, 99999) || !finite(part.yaw, -99999, 99999) || !finite(part.pitch, -1.56, 1.56)) ||
      (previousEnd !== null && Math.abs(Number(part.start) - previousEnd) > 1e-6)
    )
      return false;
    previousEnd = Number(part.end);
  }

  return true;
}

// A prefix-derived heading survives vertical flight and is independent of seek order or wall time.
const headings = new WeakMap<FlightTrack, number[]>();
export function captureExteriorShot(
  kind: Exclude<ShotKind, 'cockpit'>,
  state: CameraStateOut,
  track: FlightTrack,
  seconds: number,
): ShotView {
  const direction = state.target.map((v, axis) => v - state.eye[axis]);
  const fovYDeg = (state.fovYRad * 180) / Math.PI;
  if (kind !== 'follow')
    return {
      fovYDeg,
      kind,
      pitch: Math.atan2(direction[1], Math.hypot(direction[0], direction[2])),
      position: [...state.eye],
      yaw: Math.atan2(direction[0], -direction[2]),
    };
  const pos = gtaToEngine(...sampleTrack(track, seconds).pos),
    yaw = shotHeading(track, seconds);
  const delta = state.eye.map((v, axis) => v - pos[axis]);

  return {
    fovYDeg,
    kind,
    offset: [
      delta[0] * Math.cos(yaw) + delta[2] * Math.sin(yaw),
      delta[0] * Math.sin(yaw) - delta[2] * Math.cos(yaw),
      delta[1],
    ],
  };
}

/** Capture-time interpolation, using the shortest angular arc rather than crossing the aircraft. */
export function followAt(
  view: Extract<ShotView, { kind: 'follow' }>,
  track: FlightTrack,
  seconds: number,
): { angle: number; distance: number; fovYDeg: number; height: number } {
  const parts = view.segments;
  const values = (part: Pick<FollowSegment, 'fovYDeg' | 'heading' | 'offset'>) => ({
    angle: Math.atan2(part.offset[0], part.offset[1]) + (part.heading === 'world' ? 0 : shotHeading(track, seconds)),
    distance: Math.hypot(part.offset[0], part.offset[1]),
    fovYDeg: part.fovYDeg,
    height: part.offset[2],
  });
  if (!parts?.length) return values({ ...view, heading: 'aircraft' });
  let index = 0;
  while (index + 1 < parts.length && seconds >= parts[index + 1].start) index++;
  const current = parts[index],
    to = values(current);
  if (index === 0 || current.transition <= 0) return to;
  const from = values(parts[index - 1]);
  const t = Math.max(0, Math.min(1, (seconds - current.start) / current.transition));
  const blend = t * t * (3 - 2 * t);

  return {
    angle: from.angle + Math.atan2(Math.sin(to.angle - from.angle), Math.cos(to.angle - from.angle)) * blend,
    distance: from.distance + (to.distance - from.distance) * blend,
    fovYDeg: from.fovYDeg + (to.fovYDeg - from.fovYDeg) * blend,
    height: from.height + (to.height - from.height) * blend,
  };
}

/** Geometry-based starting positions; the user previews and adjusts them before exporting. */
export function recommendShots(track: FlightTrack, range: ShotRange): Record<ShotKind, ShotView> {
  const middle = (range.start + range.end) / 2;
  const points = Array.from({ length: 65 }, (_, i) =>
    gtaToEngine(...sampleTrack(track, range.start + ((range.end - range.start) * i) / 64).pos),
  );
  const centre = [0, 1, 2].map(
    (axis) => (Math.min(...points.map((p) => p[axis])) + Math.max(...points.map((p) => p[axis]))) / 2,
  ) as Vec3;
  const radius = Math.max(15, ...points.map((p) => Math.hypot(...p.map((v, axis) => v - centre[axis]))));
  const distance = radius / Math.sin(Math.PI / 6) + 20,
    yaw = shotHeading(track, middle);
  const eye: Vec3 = [
    centre[0] - Math.cos(yaw) * distance,
    centre[1] + distance * 0.25,
    centre[2] - Math.sin(yaw) * distance,
  ];
  const fixed = captureExteriorShot('fixed', aimed(eye, centre, 60, 16 / 9), track, middle);
  const local = Math.max(40, Math.min(300, radius * 0.7)),
    pos = gtaToEngine(...sampleTrack(track, middle).pos);

  return {
    cockpit: {
      cockpitLookPose: {
        height: 0,
        lateral: 0,
        longitudinal: 0,
        pitch: track.model === 520 ? (-8 * Math.PI) / 180 : 0,
        yaw: 0,
      },
      fovYDeg: 60,
      kind: 'cockpit',
    },
    fixed,
    follow: { fovYDeg: 60, kind: 'follow', offset: [-35, -16, 10] },
    tracking: {
      fovYDeg: 60,
      kind: 'tracking',
      pitch: 0,
      position: [pos[0] - Math.cos(yaw) * local, pos[1] + local * 0.2, pos[2] - Math.sin(yaw) * local],
      yaw: 0,
    },
  };
}

export function segmentInspectTime(part: ShotRange & { transition: number }): number {
  const span = part.end - part.start;

  return Math.min(part.end - Math.min(0.001, span / 1000), part.start + (span + part.transition) / 2);
}

/** An individual saved segment without its entering blend, used for the point/field-of-view diagram. */
export function segmentShot(view: ExteriorShotView, index: number): ExteriorShotView {
  if (!view.segments) return view;
  if (view.kind === 'follow') return { ...view, segments: [{ ...view.segments[index], transition: 0 }] };

  return { ...view, ...view.segments[index], segments: undefined };
}

/** Exterior shots keep the horizon stable. Aircraft roll never rotates their position offset. */
export function shotCameraState(
  view: ShotView,
  track: FlightTrack,
  seconds: number,
  aspect: number,
): CameraStateOut | null {
  if (view.kind === 'cockpit') return null;
  if (view.kind !== 'follow') view = worldShotAt(view, seconds);
  const pos = gtaToEngine(...sampleTrack(track, seconds).pos);
  if (view.kind === 'fixed') {
    const direction: Vec3 = [
      Math.sin(view.yaw) * Math.cos(view.pitch),
      Math.sin(view.pitch),
      -Math.cos(view.yaw) * Math.cos(view.pitch),
    ];

    return aimed(
      [...view.position],
      view.position.map((v, axis) => v + direction[axis] * 85) as Vec3,
      view.fovYDeg,
      aspect,
    );
  }
  if (view.kind === 'tracking') return aimed([...view.position], pos, view.fovYDeg, aspect);
  const follow = followAt(view, track, seconds);
  const eye: Vec3 = [
    pos[0] + Math.sin(follow.angle) * follow.distance,
    pos[1] + follow.height,
    pos[2] - Math.cos(follow.angle) * follow.distance,
  ];

  return aimed(eye, pos, follow.fovYDeg, aspect);
}

export function shotHeading(track: FlightTrack, seconds: number): number {
  let values = headings.get(track);
  if (!values) {
    let previous = 0;
    values = track.rows.map((row) => {
      const forward = rotateVec(row.orientation, [0, 1, 0]);
      if (Math.hypot(forward[0], forward[2]) > 0.05) {
        const yaw = Math.atan2(forward[0], -forward[2]);
        previous += Math.atan2(Math.sin(yaw - previous), Math.cos(yaw - previous));
      }

      return previous;
    });
    headings.set(track, values);
  }
  let high = track.rows.length - 1,
    low = 0;
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2);
    if (track.rows[middle].s <= seconds) low = middle;
    else high = middle - 1;
  }
  const next = Math.min(low + 1, track.rows.length - 1);
  const span = track.rows[next].s - track.rows[low].s;
  const t = span > 0 ? Math.max(0, Math.min(1, (seconds - track.rows[low].s) / span)) : 0;

  return values[low] + (values[next] - values[low]) * t;
}

/** Segment boundaries use capture time; time outside the list holds the first/last camera. */
export function shotSegmentIndex(view: ExteriorShotView, seconds: number): number {
  let index = 0;
  while (view.segments && index + 1 < view.segments.length && seconds >= view.segments[index + 1].start) index++;

  return index;
}

export function validShotForTrack(view: ShotView, duration: number): boolean {
  return (
    validShotView(view) &&
    (view.kind === 'cockpit' || !view.segments || view.segments.every((part) => part.end <= duration + 1e-6))
  );
}

function aimed(eye: Vec3, target: Vec3, fovYDeg: number, aspect: number): CameraStateOut {
  const direction = target.map((value, axis) => value - eye[axis]) as Vec3;
  const length = Math.hypot(...direction);
  if (length < 0.001) target = [eye[0], eye[1], eye[2] - 1];
  const axial = Math.hypot(direction[0], direction[2]) < Math.max(0.001, length * 1e-5);

  return {
    aspect,
    eye,
    far: 12000,
    fovYRad: (fovYDeg * Math.PI) / 180,
    near: 0.1,
    target,
    up: axial ? [0, 0, 1] : [0, 1, 0],
  };
}

function worldShotAt(view: Extract<ShotView, { kind: 'fixed' | 'tracking' }>, seconds: number): typeof view {
  if (!view.segments) return view;
  const index = shotSegmentIndex(view, seconds),
    to = view.segments[index];
  if (!index || to.transition <= 0) return { ...view, ...to };
  const from = view.segments[index - 1];
  const t = Math.max(0, Math.min(1, (seconds - to.start) / to.transition)),
    blend = t * t * (3 - 2 * t);

  return {
    ...view,
    fovYDeg: from.fovYDeg + (to.fovYDeg - from.fovYDeg) * blend,
    pitch: from.pitch + (to.pitch - from.pitch) * blend,
    position: from.position.map((n, axis) => n + (to.position[axis] - n) * blend) as Vec3,
    yaw: from.yaw + Math.atan2(Math.sin(to.yaw - from.yaw), Math.cos(to.yaw - from.yaw)) * blend,
  };
}
