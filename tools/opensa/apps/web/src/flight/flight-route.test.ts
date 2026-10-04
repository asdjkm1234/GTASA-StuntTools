import type { Engine } from '@opensa/engine';

import { describe, expect, it, vi } from 'vitest';

import type { FlightTrack } from './csv';

import { parseFlightCsv } from './csv';
import { buildFlightRoute, FlightRoute, routeState } from './flight-route';

function fixture(): FlightTrack {
  const track = parseFlightCsv(
    [
      'local_timestamp,model,health,x,y,z,capture_elapsed_s',
      '2026-10-03T00:00:00.000,520,1000,0,0,40,0',
      '2026-10-03T00:00:01.000,520,1000,20,0,40,1',
      '2026-10-03T00:00:02.000,520,500,40,0,40,2',
      '2026-10-03T00:00:03.000,520,0,60,0,40,3',
    ].join('\n'),
    'route.csv',
  );
  for (const row of track.rows)
    row.surfaceDamage = { raw: 0, source: 'game_memory', states: [0, 0, 0, 0, 0], validMask: 31 };
  track.rows[1].surfaceDamage.states[4] = 1;
  track.rows[2].surfaceDamage.states[4] = 2;

  return track;
}

describe('flight route state and geometry', () => {
  it('gives red priority only below 25%, yellow for a measured damaged slot, and green for five intact slots', () => {
    const track = fixture();
    expect(routeState(track.rows[0])).toBe('green');
    expect(routeState(track.rows[1])).toBe('yellow');
    expect(routeState(track.rows[2], 250)).toBe('yellow');
    expect(routeState(track.rows[2], 249.99)).toBe('red');
    expect(routeState(track.rows[0], 250)).toBe('green');
    expect(routeState(track.rows[0], 0)).toBe('red');
  });

  it('keeps absent or partial damage unknown, while a valid damaged slot still establishes yellow', () => {
    const row = fixture().rows[0];
    row.surfaceDamage.validMask = 15;
    expect(routeState(row)).toBe('unknown');
    row.surfaceDamage.states[4] = 1;
    expect(routeState(row)).toBe('unknown');
    row.surfaceDamage.states[0] = 1;
    expect(routeState(row)).toBe('yellow');
    row.surfaceDamage.source = 'unknown';
    expect(routeState(row)).toBe('unknown');
  });

  it('uses exact world coordinates, discrete surface states, and a precise health crossing', () => {
    const lines = buildFlightRoute(fixture());
    expect(Array.from(lines.green)).toEqual([0, 40, 0, 20, 40, 0]);
    expect(Array.from(lines.yellow)).toEqual([20, 40, 0, 40, 40, 0, 40, 40, 0, 50, 40, 0]);
    expect(Array.from(lines.red)).toEqual([50, 40, 0, 60, 40, 0]);
    expect(lines.unknown.length).toBe(0);
  });

  it('adds finite arrows pointing forward even on vertical flight and omits stationary segments', () => {
    const track = fixture();
    track.rows[1].pos = [0, 0, 40];
    track.rows[2].pos = [0, 0, 240];
    track.rows[3].pos = [0, 0, 240];
    const lines = buildFlightRoute(track);
    expect(lines.green.length).toBe(0);
    const yellow = Array.from(lines.yellow);
    expect(yellow.length).toBe(30); // One segment and two pairs of arrow arms at 80 / 160 m.
    expect(yellow.every(Number.isFinite)).toBe(true);
    expect(yellow[10]).toBeGreaterThan(yellow[7]); // Arrow tip is higher than its tail.
  });
});

describe('selected route GPU lifetime', () => {
  it('uploads only once per track, restores visibility and destroys old buffers on switch', () => {
    let id = 0;
    const engine = {
      createDebugLines: vi.fn(() => ++id),
      destroyDebugLines: vi.fn(),
      setDebugLinesVisible: vi.fn(),
    };
    const route = new FlightRoute(engine as unknown as Engine);
    const track = fixture();
    route.setTrack(track);
    expect(engine.createDebugLines).toHaveBeenCalledTimes(3);
    expect(engine.setDebugLinesVisible.mock.calls).toEqual([
      [1, false],
      [2, false],
      [3, false],
    ]);
    route.setVisible(true);
    route.setTrack(track);
    expect(engine.createDebugLines).toHaveBeenCalledTimes(3);
    route.setVisible(false);
    route.setTrack(fixture());
    expect(engine.destroyDebugLines).toHaveBeenCalledTimes(3);
    expect(engine.setDebugLinesVisible.mock.calls.slice(-3)).toEqual([
      [4, false],
      [5, false],
      [6, false],
    ]);
    route.dispose();
    expect(engine.destroyDebugLines).toHaveBeenCalledTimes(6);
  });
});
