import type { Engine } from '@opensa/engine';

import { describe, expect, it, vi } from 'vitest';

import type { CameraStateOut } from './camera';

import { parseFlightCsv } from './csv';
import { viewProjection } from './endpoint-picking';
import { type ExteriorShotView, recommendShots, shotCameraState } from './shot-camera';
import {
  buildDiagramSegments,
  DIAGRAM_DEPTH,
  diagramGeometry,
  diagramOverview,
  diagramSegmentsOverview,
  ShotCameraDiagram,
} from './shot-camera-diagram';

const state: CameraStateOut = {
  aspect: 16 / 9,
  eye: [1200, 400, 800],
  far: 3000,
  fovYRad: Math.PI / 3,
  near: 0.03,
  target: [1200, 400, 700],
  up: [0, 1, 0],
};
describe('camera diagram geometry', () => {
  it('shows every segment at a labelled capture time with exact shared route boundaries and fits them together', () => {
    const track = parseFlightCsv(
      'local_timestamp,model,health,x,y,z,capture_elapsed_s\n2026-10-04T00:00:00.000,520,1000,0,0,100,0\n2026-10-04T00:00:01.000,520,1000,100,0,100,1\n2026-10-04T00:00:02.000,520,1000,200,100,100,2\n2026-10-04T00:00:03.000,520,1000,300,100,100,3',
      'segments.csv',
    );
    for (const kind of ['fixed', 'tracking', 'follow'] as const) {
      const view = recommendShots(track, { end: 3, start: 0 })[kind] as ExteriorShotView;
      if (view.kind === 'follow')
        view.segments = [
          { end: 1, fovYDeg: 60, heading: 'aircraft', offset: [20, 10, 5], start: 0, transition: 0 },
          { end: 3, fovYDeg: 60, heading: 'aircraft', offset: [-20, 10, 5], start: 1, transition: 1 },
        ];
      else
        view.segments = [
          { end: 1, fovYDeg: 60, pitch: 0, position: [-100, 150, 0], start: 0, transition: 0, yaw: 0 },
          { end: 3, fovYDeg: 60, pitch: 0, position: [400, 150, 0], start: 1, transition: 1, yaw: Math.PI },
        ];
      const before = structuredClone(view),
        parts = buildDiagramSegments(view, track);
      expect(parts).toHaveLength(2);
      expect(parts.map((p) => p.seconds)).toEqual([0.5, 2.5]);
      expect(parts[0].path[parts[0].path.length - 1]).toEqual(parts[1].path[0]);
      const current = shotCameraState(view, track, 2.5, 16 / 9)!,
        observer = diagramSegmentsOverview(current, parts),
        m = viewProjection(observer);
      for (const part of parts)
        for (const p of [part.state.eye, ...diagramGeometry(part.state).corners, ...part.path]) {
          const [x, y, w] = [0, 1, 3].map((a) => m[a] * p[0] + m[a + 4] * p[1] + m[a + 8] * p[2] + m[a + 12]);
          expect(w).toBeGreaterThan(0);
          expect(Math.abs(x / w)).toBeLessThan(1);
          expect(Math.abs(y / w)).toBeLessThan(1);
        }
      expect(view).toEqual(before);
    }
  });
  it('grows reusable GPU groups safely for 64 segments and hides every group during preview/export', () => {
    const buffers = new Map<number, { capacity: number; visible: boolean }>();
    let next = 0;
    const engine = {
      createDebugLines: (vertices: Float32Array) => {
        const id = ++next;
        buffers.set(id, { capacity: vertices.length, visible: true });

        return id;
      },
      destroyDebugLines: (id: number) => {
        buffers.delete(id);
      },
      setDebugLinesVisible: (id: number, visible: boolean) => {
        buffers.get(id)!.visible = visible;
      },
      updateDebugLines: (id: number, vertices: Float32Array) => {
        expect(vertices.length).toBeLessThanOrEqual(buffers.get(id)!.capacity);
      },
    };
    vi.stubGlobal('document', {
      body: { append: vi.fn() },
      createElement: () => ({ dataset: {}, hidden: true, remove: vi.fn(), setAttribute: vi.fn() }),
    });
    try {
      const diagram = new ShotCameraDiagram(engine as unknown as Engine);
      const track = parseFlightCsv(
        'local_timestamp,model,health,x,y,z,capture_elapsed_s\n2026-10-04T00:00:00.000,520,1000,0,0,100,0\n2026-10-04T00:01:04.000,520,1000,100,0,100,64',
        'many.csv',
      );
      const view = recommendShots(track, { end: 64, start: 0 }).fixed;
      if (view.kind !== 'fixed') throw new Error('fixed');
      view.segments = Array.from({ length: 64 }, (_, i) => ({
        end: i + 1,
        fovYDeg: 60,
        pitch: 0,
        position: [i * 10, 120, 0] as [number, number, number],
        start: i,
        transition: 0,
        yaw: 0,
      }));
      diagram.update(shotCameraState(view, track, 0.5, 16 / 9), 'fixed', view, track, 0.5);
      expect(diagram.segments).toHaveLength(64);
      const allocations = next;
      diagram.update(shotCameraState(view, track, 0.6, 16 / 9), 'fixed', view, track, 0.6);
      expect(next).toBe(allocations);
      diagram.update(null);
      expect([...buffers.values()].every((b) => !b.visible)).toBe(true);
      diagram.update(shotCameraState(view, track, 2.5, 16 / 9), 'fixed', view, track, 2.5);
      expect(diagram.activeIndex).toBe(2);
      expect([...buffers.values()].some((b) => b.visible)).toBe(true);
      diagram.dispose();
      expect(buffers.size).toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('places the lens at the saved eye and projects the 16:9 frustum onto exact frame corners, including roll', () => {
    for (const camera of [state, { ...state, up: [1, 0, 0] as [number, number, number] }]) {
      const geometry = diagramGeometry(camera),
        matrix = viewProjection(camera);
      expect([...geometry.cone.slice(24, 27)]).toEqual(camera.eye);
      for (const p of geometry.corners) {
        const clip = [0, 1, 3].map(
          (a) => matrix[a] * p[0] + matrix[a + 4] * p[1] + matrix[a + 8] * p[2] + matrix[a + 12],
        );
        expect(Math.abs(clip[0] / clip[2])).toBeCloseTo(1, 4);
        expect(Math.abs(clip[1] / clip[2])).toBeCloseTo(1, 4);
        expect(clip[2]).toBeCloseTo(DIAGRAM_DEPTH);
      }
      expect(geometry.horizontal).toBeCloseTo(2 * Math.atan((Math.tan(Math.PI / 6) * 16) / 9));
    }
  });
  it('retains a fixed buffer shape across FOV/pose changes and finite bases for axial views', () => {
    const wide = diagramGeometry({ ...state, fovYRad: (110 * Math.PI) / 180 });
    const axial = diagramGeometry({ ...state, target: [1200, 500, 800], up: [0, 1, 0] });
    expect(wide.body.length).toBe(axial.body.length);
    expect(wide.cone.length).toBe(axial.cone.length);
    expect([...axial.body, ...axial.cone].every(Number.isFinite)).toBe(true);
    expect(wide.corners[0][0]).toBeLessThan(diagramGeometry(state).corners[0][0]);
  });
  it('constructs an outside observer without changing the saved camera', () => {
    const original = structuredClone(state);
    const observer = diagramOverview(state);
    expect(state).toEqual(original);
    expect(observer.eye).not.toEqual(state.eye);
    const matrix = viewProjection(observer);
    for (const p of [state.eye, ...diagramGeometry(state).corners]) {
      const clip = [0, 1, 3].map(
        (a) => matrix[a] * p[0] + matrix[a + 4] * p[1] + matrix[a + 8] * p[2] + matrix[a + 12],
      );
      expect(clip[2]).toBeGreaterThan(0);
      expect(Math.abs(clip[0] / clip[2])).toBeLessThan(0.95);
      expect(Math.abs(clip[1] / clip[2])).toBeLessThan(0.95);
    }
  });
});
