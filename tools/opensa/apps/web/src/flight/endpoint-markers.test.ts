import type { Engine } from '@opensa/engine';

import { describe, expect, it, vi } from 'vitest';

import { parseFlightCsv } from './csv';
import { EndpointMarkers } from './endpoint-markers';

function setup() {
  let nextId = 0;
  const buffers = new Map<number, Float32Array>();
  const createDebugLines = vi.fn((positions: Float32Array) => {
    const id = ++nextId;
    buffers.set(id, positions.slice());

    return id;
  });
  const updateDebugLines = vi.fn((id: number, positions: Float32Array) => {
    expect(positions.length).toBe(buffers.get(id)?.length);
    buffers.set(id, positions.slice());
  });
  const destroyDebugLines = vi.fn((id: number) => buffers.delete(id));
  const setDebugLinesVisible = vi.fn();
  const engine = { createDebugLines, destroyDebugLines, setDebugLinesVisible, updateDebugLines };
  const markers = new EndpointMarkers(engine as unknown as Engine);
  const track = parseFlightCsv(
    'local_timestamp,model,health,x,y,z\n2026-01-01T00:00:00.000,520,1000,10,20,30\n2026-01-01T00:00:00.040,520,1000,10,20,30\n',
    'endpoint.csv',
  );

  return { buffers, engine, markers, track };
}

describe('spherical endpoint beacons', () => {
  it('centres an outward-wound solid sphere on the exact picking anchor', () => {
    const { buffers, engine, markers, track } = setup();
    markers.setTracks([track]);
    expect(markers.markerPositions).toEqual([[10, 30, -20]]);
    expect(engine.createDebugLines.mock.calls[0]).toEqual([
      expect.any(Float32Array),
      expect.any(Array),
      { throughDepth: true, triangles: true },
    ]);
    const vertices = buffers.get(1)!;
    for (let at = 0; at < vertices.length; at += 18) {
      const a = [vertices[at] - 10, vertices[at + 1] - 30, vertices[at + 2] + 20];
      const b = [vertices[at + 6] - 10, vertices[at + 7] - 30, vertices[at + 8] + 20];
      const c = [vertices[at + 12] - 10, vertices[at + 13] - 30, vertices[at + 14] + 20];
      expect(Math.hypot(...a)).toBeCloseTo(0.75, 4);
      expect(Math.hypot(vertices[at + 3], vertices[at + 4], vertices[at + 5])).toBeCloseTo(1, 6);
      const ab = b.map((v, i) => v - a[i]);
      const ac = c.map((v, i) => v - a[i]);
      const normal = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      expect(normal.reduce((sum, v, i) => sum + v * a[i], 0)).toBeGreaterThan(0);
    }
  });

  it('animates with the supplied independent clock and skips unchanged geometry', () => {
    const { buffers, engine, markers, track } = setup();
    markers.setTracks([track]);
    const start = [...buffers.values()].map((b) => b.slice());
    markers.update(0.8);
    expect(buffers.get(1)).not.toEqual(start[0]);
    expect(buffers.get(2)).not.toEqual(start[1]);
    engine.updateDebugLines.mockClear();
    markers.update(0.8);
    expect(engine.updateDebugLines).not.toHaveBeenCalled();
    markers.update(0);
    expect([...buffers.values()]).toEqual(start);
    expect(markers.markerPositions).toEqual([[10, 30, -20]]);
  });

  it('starts hidden and carries explicit visibility across allocation changes', () => {
    const { engine, markers, track } = setup();
    markers.setTracks([track]);
    expect(engine.setDebugLinesVisible.mock.calls).toEqual([
      [1, false],
      [2, false],
    ]);
    markers.setVisible(true);
    expect(engine.setDebugLinesVisible.mock.calls.slice(-2)).toEqual([
      [1, true],
      [2, true],
    ]);
    markers.setTracks([track, track]);
    expect(engine.setDebugLinesVisible.mock.calls.slice(-2)).toEqual([
      [3, true],
      [4, true],
    ]);
    markers.setVisible(false);
    expect(engine.setDebugLinesVisible.mock.calls.slice(-2)).toEqual([
      [3, false],
      [4, false],
    ]);
    markers.setTracks([track]);
    expect(engine.setDebugLinesVisible.mock.calls.slice(-2)).toEqual([
      [5, false],
      [6, false],
    ]);
  });

  it('resizes both allocations and retains coincident endpoints and density', () => {
    const { buffers, engine, markers, track } = setup();
    markers.setTracks([track]);
    const single = markers.stats();
    markers.setTracks([track, track]);
    expect(engine.destroyDebugLines).toHaveBeenCalledTimes(2);
    expect(markers.stats()).toMatchObject({
      capacity: single.capacity * 2,
      count: 2,
      densityMax: 2,
      halos: 1,
      recreates: 2,
      trackIds: [0, 1],
    });
    markers.update(0.4);
    markers.setTracks([]);
    expect(buffers.size).toBe(0);
    expect(markers.stats()).toMatchObject({ capacity: 0, count: 0, densityMax: 0, halos: 0, trackIds: [] });
  });

  it('shares halos within dense groups while keeping distant groups and every endpoint separate', () => {
    const { markers, track } = setup();
    const shifted = (offset: number): typeof track => ({
      ...track,
      rows: track.rows.map((row) => ({
        ...row,
        pos: [row.pos[0] + offset, row.pos[1], row.pos[2]] as [number, number, number],
      })),
    });
    markers.setTracks([track, track, shifted(1000), shifted(1000), shifted(2000)]);
    expect(markers.stats()).toMatchObject({ count: 5, densityMax: 2, halos: 2, trackIds: [0, 1, 2, 3, 4] });
    expect(markers.markerPositions).toEqual([
      [10, 30, -20],
      [10, 30, -20],
      [1010, 30, -20],
      [1010, 30, -20],
      [2010, 30, -20],
    ]);
  });
});
