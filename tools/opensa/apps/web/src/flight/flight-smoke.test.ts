import type { FxBakedEmitter, VehicleModelData } from '@opensa/renderware';

import { describe, expect, it } from 'vitest';

import type { FlightTrack } from './csv';

import { parseFlightCsv, sampleTrack, SURFACE_NAMES } from './csv';
import { flightSmokeAt, flightSmokeCount, flightSmokeEmitter, flightSmokeSources } from './flight-smoke';

/** Synthetic parts with known pivots and a one-unit geometry offset, independent of local game assets. */
function model(): VehicleModelData {
  return {
    dummies: [{ name: 'engine', position: [0, -2, 0] }],
    indices: Uint16Array.from({ length: 10 }, (_, i) => i),
    parts: SURFACE_NAMES.map((name, i) => ({ localRotation: [0, 0, 0, 1], localTranslation: [i * 10, -i, 0], name })),
    positions: Float32Array.from(SURFACE_NAMES.flatMap(() => [-0.5, -1, 0, 0.5, -1, 0])),
    submeshes: SURFACE_NAMES.map((_, i) => ({ indexCount: 2, indexOffset: i * 2, kind: 'body', part: i })),
  } as unknown as VehicleModelData;
}

function track(samples: readonly [number, number, number][]): FlightTrack {
  return parseFlightCsv(
    '# gtasa_flight_recorder,version=12\n' +
      'local_timestamp,model,x,y,z,capture_elapsed_s,health,smoke_active\n' +
      samples.map(([s, health, smoke]) => `2026-10-03T00:00:00.000,520,0,0,100,${s},${health},${smoke}`).join('\n'),
    'damage-smoke.csv',
  );
}

describe('replay damage smoke', () => {
  it('shows damage despite an inactive or unavailable plane smoke flag, with increasing severity', () => {
    const t = track([
      [0, 1000, 0],
      [1, 767.227, 0],
      [2, 500, -1],
      [3, 250, 0],
    ]);
    expect(flightSmokeAt(t, 0)).toBe(0);
    expect(flightSmokeAt(t, 1)).toBeGreaterThan(0.42);
    expect(flightSmokeAt(t, 2)).toBeGreaterThan(flightSmokeAt(t, 1));
    expect(flightSmokeAt(t, 3)).toBe(1);
  });

  it('starts at the actual damage sample, even when sampled health already interpolates toward it', () => {
    const t = track([
      [0, 1000, 0],
      [0.04, 250, 0],
      [0.08, 250, 0],
    ]);
    expect(sampleTrack(t, 0.039).row.health).toBeLessThan(900);
    expect(flightSmokeAt(t, 0.039)).toBe(0);
    expect(flightSmokeAt(t, 0.04)).toBe(1);
  });

  it('retains recorded smoke on healthy planes and stops new emission after repair or destruction', () => {
    const t = track([
      [0, 1000, 1],
      [1, 600, 0],
      [2, 1000, 0],
      [3, 0, 1],
    ]);
    expect(flightSmokeAt(t, 0)).toBe(0.7);
    expect(flightSmokeAt(t, 1)).toBeGreaterThan(0);
    expect(flightSmokeAt(t, 2)).toBe(0);
    expect(flightSmokeAt(t, 3)).toBe(0);
    expect(flightSmokeAt(t, 1)).toBeGreaterThan(0); // seeking back has no accumulated state
    t.rows[3].health = NaN;
    expect(flightSmokeAt(t, 3)).toBe(0);
  });

  it('keeps smoke visible at birth and within the four-second reconstruction window', () => {
    const authored: FxBakedEmitter = {
      additive: true,
      colors: [[0, 0, 0, 0]],
      cone: { angle: 0, direction: [0, 0, 1] },
      force: [0, 0, 0],
      life: { bias: 0, seconds: 60 },
      perEmitter: 60,
      rate: 1,
      sizes: [0.35, 5.875, 9],
      speed: { bias: 0, magnitude: 0.4 },
      texture: 'local-smoke',
    };
    const plume = flightSmokeEmitter(authored);
    expect(plume.texture).toBe(authored.texture);
    expect(plume.additive).toBe(false);
    expect(plume.colors[0][3]).toBeGreaterThan(0.5);
    expect(plume.colors[2][3]).toBe(0);
    expect(plume.sizes[0]).toBeGreaterThan(1);
    expect(plume.life.seconds + plume.life.bias).toBeLessThanOrEqual(4);
    expect(authored.life.seconds).toBe(60);
  });

  it('binds only measured damaged surfaces to their geometry, node rotation and aircraft attitude', () => {
    const t = track([
      [0, 800, 0],
      [1, 800, 0],
    ]);
    t.rows[0].surfaceDamage = { raw: 0, source: 'game_memory', states: [0, 1, 0, 0, 1], validMask: 31 };
    const pose = sampleTrack(t, 0);
    pose.pos = [100, 200, 300];
    pose.orientation = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
    pose.nodes[1] = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
    const data = model();
    const sources = flightSmokeSources(t, 0, pose, data);
    expect(sources.map((s) => s.id)).toEqual([1, 4]); // no generic engine plume when a specific damage site is known
    expect(sources[0].position[0]).toBeCloseTo(101);
    expect(sources[0].position[1]).toBeCloseTo(311);
    expect(sources[0].position[2]).toBeCloseTo(-200);
    pose.nodes[1] = [0, 0, 0, 1];
    expect(flightSmokeSources(t, 0, pose, data)[0].position[0]).toBeCloseTo(102);
    pose.nodes[1] = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
    expect(flightSmokeSources(t, 0, pose, data)).toEqual(sources);
  });

  it('emits at detached attachment stumps, skips unknown slots and never invents a missing node', () => {
    const t = track([
      [0, 1000, 0],
      [1, 1000, 0],
    ]);
    const damage = { raw: 0, source: 'game_memory' as const, states: [2, 3, null, 0, 0], validMask: 31 };
    t.rows[0].surfaceDamage = damage;
    const pose = sampleTrack(t, 0);
    pose.orientation = [0, 0, 0, 1];
    pose.nodes[0] = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
    const data = model();
    expect(flightSmokeSources(t, 0, pose, data)).toMatchObject([{ id: 0, position: [0, 100, 0] }]);
    damage.validMask = 0;
    expect(flightSmokeSources(t, 0, pose, data)).toEqual([]);
    damage.validMask = 31;
    data.parts[0].name = 'unrelated_part';
    // New model identity rebuilds anchors; absent rudder cannot borrow an unrelated frame.
    expect(flightSmokeSources(t, 0, pose, { ...data })).toEqual([]);
  });

  it('does not anticipate surface damage and retains an engine fallback for older or unknown recordings', () => {
    const t = track([
      [0, 1000, 0],
      [0.04, 800, 0],
      [0.08, 800, 0],
    ]);
    t.rows[1].surfaceDamage = { raw: 0, source: 'game_memory', states: [1, 0, 0, 0, 0], validMask: 31 };
    const data = model();
    expect(flightSmokeSources(t, 0.039, sampleTrack(t, 0.039), data)).toEqual([]);
    expect(flightSmokeSources(t, 0.04, sampleTrack(t, 0.04), data).map((s) => s.id)).toEqual([0]);
    expect(flightSmokeSources(t, 0.08, sampleTrack(t, 0.08), data).map((s) => s.id)).toEqual([5]);
    expect(flightSmokeSources(t, 0.04, sampleTrack(t, 0.04), null).map((s) => s.id)).toEqual([5]);
  });

  it('doubles each plume while sharing a bounded, fair emission budget among all five nodes and engine', () => {
    expect(flightSmokeCount(1, 0, 0)).toBe(4);
    expect([0, 1].map((i) => flightSmokeCount(2, i, 0))).toEqual([4, 4]);
    for (let sources = 1; sources <= 6; sources++) {
      const counts = Array.from({ length: sources }, () => 0);
      for (let tick = 0; tick < sources; tick++) {
        const perTick = counts.map((_, i) => flightSmokeCount(sources, i, tick));
        expect(perTick.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(8);
        perTick.forEach((n, i) => {
          counts[i] += n;
          expect(n).toBeGreaterThan(0);
        });
      }
      expect(new Set(counts).size).toBe(1);
    }
    expect(8 * (Math.ceil(3.6 / 0.04) + 1)).toBeLessThan(1024 - 200);
  });
});
