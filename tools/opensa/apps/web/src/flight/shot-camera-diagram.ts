import type { DebugLineSetId, Engine } from '@opensa/engine';

import type { CameraStateOut } from './camera';
import type { FlightTrack } from './csv';
import type { Vec3 } from './math';
import type { ExteriorShotView, ShotKind, ShotView } from './shot-camera';

import { sampleTrack } from './csv';
import { viewProjection } from './endpoint-picking';
import { gtaToEngine } from './math';
import { segmentInspectTime, segmentShot, SHOT_LABELS, shotCameraState, shotSegmentIndex } from './shot-camera';
import { sequenceIndex, type ShotProgram } from './shot-sequence';

export interface DiagramSegment {
  end: number;
  index: number;
  kind?: ShotKind;
  path: Vec3[];
  seconds: number;
  start: number;
  state: CameraStateOut;
}
export const SEGMENT_COLORS: readonly (readonly [number, number, number, number])[] = [
  [0.35, 0.8, 1, 0.8],
  [0.85, 0.6, 1, 0.8],
  [0.4, 1, 0.65, 0.8],
  [1, 0.7, 0.4, 0.8],
  [1, 0.5, 0.7, 0.8],
];

/** Each moving camera has a clearly labelled representative capture time; its route uses actual rows. */
export function buildDiagramSegments(
  view: ShotProgram,
  track: FlightTrack,
  stateAt?: (shot: ShotView, seconds: number) => CameraStateOut | null,
): DiagramSegment[] {
  const parts = view.kind === 'sequence' ? view.clips : view.kind !== 'cockpit' ? (view.segments ?? []) : [];

  return parts.flatMap((part, index) => {
    const rows = track.rows.filter((row) => row.s > part.start && row.s < part.end),
      seconds =
        view.kind === 'sequence'
          ? (part.start + part.end) / 2
          : segmentInspectTime(part as Parameters<typeof segmentInspectTime>[0]);
    const step = Math.max(1, Math.ceil(rows.length / 512));

    const shot = view.kind === 'sequence' ? view.clips[index].view : segmentShot(view as ExteriorShotView, index);
    const state = stateAt ? stateAt(shot, seconds) : shotCameraState(shot, track, seconds, 16 / 9);
    if (!state) return [];

    return [
      {
        end: part.end,
        index,
        kind: shot.kind,
        path: [
          gtaToEngine(...sampleTrack(track, part.start).pos),
          ...rows.filter((_, i) => i % step === 0).map((row) => gtaToEngine(...row.pos)),
          gtaToEngine(...sampleTrack(track, part.end).pos),
        ],
        seconds,
        start: part.start,
        state,
      },
    ];
  });
}

/** The diagram's drawing distance is illustrative, not the renderer's far clip. */
export const DIAGRAM_DEPTH = 40;
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normal = (v: Vec3): Vec3 => {
  const length = Math.hypot(...v);

  return length > 1e-8 ? (v.map((n) => n / length) as Vec3) : [0, 0, -1];
};

/** Reusable line groups grow only when needed. Paused frames and hidden/export views retain their buffers. */
export class ShotCameraDiagram {
  activeIndex = 0;
  key = '';
  segments: DiagramSegment[] = [];
  state: CameraStateOut | null = null;
  private geometryKey = '';
  private kind: ShotKind = 'fixed';
  private readonly label: HTMLCanvasElement;
  private labelKey = '';
  private seconds = 0;
  private sets = new Map<string, { capacity: number; id: DebugLineSetId }>();
  private sourceKey = '';
  private sourceTrack: FlightTrack | null = null;
  private staticKey = '';
  constructor(private readonly engine: Engine) {
    this.label = document.createElement('canvas');
    this.label.id = 'shotCameraLabels';
    this.label.dataset.capture = 'exclude';
    this.label.hidden = true;
    this.label.setAttribute('aria-hidden', 'true');
    document.body.append(this.label);
  }
  dispose(): void {
    for (const { id } of this.sets.values()) this.engine.destroyDebugLines(id);
    this.sets.clear();
    this.label.remove();
  }
  drawLabel(observer: CameraStateOut, width: number, height: number): void {
    if (!this.state) {
      this.label.hidden = true;

      return;
    }
    const key = JSON.stringify([this.key, observer, width, height]);
    if (key === this.labelKey) return;
    this.labelKey = key;
    this.label.width = width;
    this.label.height = height;
    this.label.hidden = false;
    const context = this.label.getContext('2d')!,
      m = viewProjection(observer);
    const placed: { width: number; x: number; y: number }[] = [];
    const draw = (p: Vec3, text: string, color: string, below = false): void => {
      const [x, y, z, w] = [0, 1, 2, 3].map((a) => m[a] * p[0] + m[a + 4] * p[1] + m[a + 8] * p[2] + m[a + 12]);
      if (w <= 0 || z < 0 || z > w || Math.abs(x) > w || Math.abs(y) > w) return;
      context.font = '12px "Microsoft YaHei", sans-serif';
      const textWidth = context.measureText(text).width;
      const sx = Math.max(6, Math.min(width - textWidth - 18, ((x / w + 1) * width) / 2 - textWidth / 2));
      let sy = Math.max(6, Math.min(height - 32, ((1 - y / w) * height) / 2 + (below ? 8 : -26)));
      // Coincident cameras remain separately labelled; stagger nearby projected boxes.
      for (
        let attempt = 0;
        attempt < 64 &&
        placed.some((box) => sx < box.x + box.width && sx + textWidth + 12 > box.x && Math.abs(sy - box.y) < 27);
        attempt++
      )
        sy += 27;
      if (sy > height - 26) return;
      placed.push({ width: textWidth + 12, x: sx, y: sy });
      context.fillStyle = '#071827e8';
      context.fillRect(sx, sy, textWidth + 12, 25);
      context.fillStyle = color;
      context.fillText(text, sx + 6, sy + 17);
    };
    if (!this.segments.length) {
      const geometry = diagramGeometry(this.state);
      const p = this.state.eye.map((n, i) => n + geometry.up[i] * 3) as Vec3;
      draw(
        p,
        SHOT_LABELS[this.kind] +
          ' · 垂直 ' +
          ((this.state.fovYRad * 180) / Math.PI).toFixed(1) +
          '° / 水平 ' +
          ((geometry.horizontal * 180) / Math.PI).toFixed(1) +
          '°',
        '#a7f6ff',
      );

      return;
    }
    // Camera labels have priority over boundary labels in dense groups.
    for (const part of this.segments) {
      const active = part.index === this.activeIndex,
        state = active ? this.state : part.state;
      draw(
        state.eye,
        '机位 ' +
          (part.index + 1) +
          (part.kind ? ' · ' + SHOT_LABELS[part.kind] : '') +
          ' · ' +
          part.start.toFixed(2) +
          '–' +
          part.end.toFixed(2) +
          ' s · ' +
          (active ? '当前 ' : '示意 ') +
          (active ? this.seconds : part.seconds).toFixed(2) +
          ' s',
        active ? '#ffcf73' : '#a7f6ff',
      );
    }
    for (const part of this.segments)
      draw(part.path[0], '第 ' + (part.index + 1) + ' 段起点 · ' + part.start.toFixed(2) + ' s', '#d6f6ff', true);
    const last = this.segments[this.segments.length - 1];
    draw(last.path[last.path.length - 1], '末段终点 · ' + last.end.toFixed(2) + ' s', '#d6f6ff', true);
  }
  update(
    state: CameraStateOut | null,
    kind: ShotKind = 'fixed',
    view?: ShotProgram,
    track?: FlightTrack,
    seconds = 0,
    stateAt?: (shot: ShotView, seconds: number) => CameraStateOut | null,
  ): void {
    this.state = state;
    if (!state) {
      this.key = '';
      this.label.hidden = true;
      this.labelKey = '';
      this.geometryKey = '';
      this.staticKey = '';
      for (const { id } of this.sets.values()) this.engine.setDebugLinesVisible(id, false);

      return;
    }
    const sourceKey = JSON.stringify(view);
    if (sourceKey !== this.sourceKey || track !== this.sourceTrack) {
      this.segments = view && track ? buildDiagramSegments(view, track, stateAt) : [];
      this.sourceKey = sourceKey;
      this.sourceTrack = track ?? null;
      this.staticKey = '';
    }
    this.activeIndex =
      view?.kind === 'sequence'
        ? sequenceIndex(view, seconds)
        : view && view.kind !== 'cockpit'
          ? shotSegmentIndex(view, seconds)
          : 0;
    this.seconds = seconds;
    this.kind = kind;
    this.key = JSON.stringify([state, kind, sourceKey, this.activeIndex, this.segments.length ? seconds : 0]);
    const staticKey = JSON.stringify([sourceKey, this.activeIndex]);
    if (this.staticKey !== staticKey) {
      this.rebuildStatic(track);
      this.staticKey = staticKey;
    }
    const geometryKey = JSON.stringify([state, kind, this.activeIndex, this.segments.length ? seconds : 0]);
    if (this.geometryKey !== geometryKey) {
      this.updateCurrent(state, track, seconds);
      this.geometryKey = geometryKey;
    }
  }
  private rebuildStatic(track?: FlightTrack): void {
    for (const [name, { id }] of this.sets) if (!name.startsWith('active')) this.engine.setDebugLinesVisible(id, false);
    const body: number[] = [],
      cone: number[] = [],
      links: number[] = [],
      routes = SEGMENT_COLORS.map(() => [] as number[]);
    for (const part of this.segments) {
      if (part.index !== this.activeIndex) {
        const geometry = diagramGeometry(part.state);
        body.push(...geometry.body);
        cone.push(...geometry.cone);
        links.push(...part.state.eye, ...gtaToEngine(...sampleTrack(track!, part.seconds).pos));
      }
      const route = routes[part.index % routes.length];
      for (let i = 1; i < part.path.length; i++) route.push(...part.path[i - 1], ...part.path[i]);
      // A vertical tick makes the exact start/end point visible in the 3D line itself.
      for (const p of [part.path[0], part.path[part.path.length - 1]]) route.push(...p, p[0], p[1] + 5, p[2]);
    }
    this.write('other-body', new Float32Array(body), [0.45, 0.65, 1, 0.85]);
    this.write('other-cone', new Float32Array(cone), [0.35, 0.7, 1, 0.4]);
    this.write('links', new Float32Array(links), [0.6, 0.75, 0.9, 0.45]);
    routes.forEach((route, i) => this.write('route-' + i, new Float32Array(route), SEGMENT_COLORS[i]));
    const activePath: number[] = [],
      selected = this.segments[this.activeIndex];
    if (selected)
      for (let i = 1; i < selected.path.length; i++) activePath.push(...selected.path[i - 1], ...selected.path[i]);
    this.write('selected-route', new Float32Array(activePath), [1, 0.82, 0.35, 1]);
  }
  private updateCurrent(state: CameraStateOut, track: FlightTrack | undefined, seconds: number): void {
    const geometry = diagramGeometry(state);
    this.write('active-body', geometry.body, [1, 0.7, 0.22, 1]);
    this.write('active-cone', geometry.cone, [0.25, 0.95, 1, 0.85]);
    const aircraft = track && this.segments.length ? gtaToEngine(...sampleTrack(track, seconds).pos) : null;
    this.write(
      'active-link',
      aircraft ? new Float32Array([...state.eye, ...aircraft]) : new Float32Array(),
      [1, 0.82, 0.35, 0.65],
    );
  }
  private write(name: string, vertices: Float32Array, color: readonly [number, number, number, number]): void {
    let set = this.sets.get(name);
    if (!vertices.length) {
      if (set) this.engine.setDebugLinesVisible(set.id, false);

      return;
    }
    if (!set || set.capacity < vertices.length) {
      if (set) this.engine.destroyDebugLines(set.id);
      const capacity = 2 ** Math.ceil(Math.log2(vertices.length));
      const id = this.engine.createDebugLines(new Float32Array(capacity), color, { throughDepth: true });
      set = { capacity, id };
      this.sets.set(name, set);
    }
    this.engine.updateDebugLines(set.id, vertices);
    this.engine.setDebugLinesVisible(set.id, true);
  }
}

export function diagramGeometry(state: CameraStateOut): {
  body: Float32Array;
  cone: Float32Array;
  corners: Vec3[];
  forward: Vec3;
  horizontal: number;
  right: Vec3;
  up: Vec3;
} {
  const forward = normal(state.target.map((n, i) => n - state.eye[i]) as Vec3);
  let right = cross(forward, state.up);
  if (Math.hypot(...right) < 1e-8) right = cross(forward, Math.abs(forward[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]);
  right = normal(right);
  const up = normal(cross(right, forward));
  const at = (x: number, y: number, z: number): Vec3 =>
    state.eye.map((n, i) => n + right[i] * x + up[i] * y + forward[i] * z) as Vec3;
  const body: number[] = [],
    cone: number[] = [];
  const segment = (list: number[], a: Vec3, b: Vec3): void => {
    list.push(...a, ...b);
  };
  const rectangle = (x: number, y: number, z: number): Vec3[] => [
    at(-x, -y, z),
    at(x, -y, z),
    at(x, y, z),
    at(-x, y, z),
  ];
  const ring = (list: number[], points: Vec3[]): void => {
    points.forEach((p, i) => segment(list, p, points[(i + 1) % points.length]));
  };
  const back = rectangle(1.7, 1.1, -3.4),
    front = rectangle(1.7, 1.1, -1.3),
    lens = rectangle(0.8, 0.65, 0);
  ring(body, back);
  ring(body, front);
  ring(body, lens);
  for (let i = 0; i < 4; i++) {
    segment(body, back[i], front[i]);
    segment(body, front[i], lens[i]);
  }
  // Top handle and an optical-centre cross make the wireframe read as a camera.
  for (const [a, b] of [
    [
      [-0.8, 1.1, -2.8],
      [-0.8, 1.8, -2.8],
    ],
    [
      [-0.8, 1.8, -2.8],
      [0.8, 1.8, -2.8],
    ],
    [
      [0.8, 1.8, -2.8],
      [0.8, 1.1, -2.8],
    ],
    [
      [-0.4, 0, 0],
      [0.4, 0, 0],
    ],
    [
      [0, -0.4, 0],
      [0, 0.4, 0],
    ],
  ] as [Vec3, Vec3][])
    segment(body, at(...a), at(...b));
  const halfY = DIAGRAM_DEPTH * Math.tan(state.fovYRad / 2),
    halfX = halfY * state.aspect;
  const corners = rectangle(halfX, halfY, DIAGRAM_DEPTH);
  ring(cone, corners);
  for (const corner of corners) segment(cone, state.eye, corner);
  segment(cone, state.eye, at(0, 0, DIAGRAM_DEPTH));
  const horizontal = 2 * Math.atan(Math.tan(state.fovYRad / 2) * state.aspect);
  for (const [angle, vertical] of [
    [state.fovYRad, true],
    [horizontal, false],
  ] as const) {
    let previous: null | Vec3 = null;
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24 - 0.5) * angle;
      const point = at(vertical ? 0 : 8 * Math.sin(a), vertical ? 8 * Math.sin(a) : 0, 8 * Math.cos(a));
      if (previous) segment(cone, previous, point);
      previous = point;
    }
  }

  return { body: new Float32Array(body), cone: new Float32Array(cone), corners, forward, horizontal, right, up };
}

/** A spectator pose around the diagram; changing it never changes a stored shot. */
export function diagramOverview(state: CameraStateOut): CameraStateOut {
  const { corners, forward, right, up } = diagramGeometry(state);
  const target = state.eye.map((n, i) => n + forward[i] * DIAGRAM_DEPTH * 0.5) as Vec3;
  const radius = Math.max(10, ...corners.map((p) => Math.hypot(...p.map((n, i) => n - target[i]))));
  const eye = target.map(
    (n, i) => n + right[i] * radius * 1.8 + up[i] * radius * 1.15 - forward[i] * radius * 1.6,
  ) as Vec3;

  return { ...state, eye, fovYRad: Math.PI / 3, target, up: [0, 1, 0] };
}

/** Fit all saved segment cameras and their corresponding route into one observer frame. */
export function diagramSegmentsOverview(state: CameraStateOut, segments: DiagramSegment[]): CameraStateOut {
  if (!segments.length) return diagramOverview(state);
  const points = [
    state.eye,
    ...diagramGeometry(state).corners,
    ...segments.flatMap((part) => [part.state.eye, ...diagramGeometry(part.state).corners, ...part.path]),
  ];
  const target = [0, 1, 2].map(
    (axis) => (Math.min(...points.map((p) => p[axis])) + Math.max(...points.map((p) => p[axis]))) / 2,
  ) as Vec3;
  const radius = Math.max(10, ...points.map((p) => Math.hypot(...p.map((n, i) => n - target[i]))));
  const { forward, right, up } = diagramGeometry(state),
    direction = normal(right.map((n, i) => n * 1.8 + up[i] * 1.15 - forward[i] * 1.6) as Vec3);
  const eye = target.map((n, i) => n + direction[i] * radius * 2.7) as Vec3;

  return { ...state, eye, fovYRad: Math.PI / 3, target, up: [0, 1, 0] };
}
