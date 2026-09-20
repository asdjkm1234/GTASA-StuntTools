import type { Vec3 } from '@opensa/game';

import { describe, expect, it, vi } from 'vitest';

import type { CleoRunnerSystem } from './engine-cleo';

import {
  cleoReadout,
  createEngineDebugActions,
  type EngineDebugActionsDeps,
  engineStatRows,
} from './engine-debug-actions';
import { createGameRuntimeConfig } from './game-runtime-config';

function deps(overrides: Partial<EngineDebugActionsDeps> = {}): EngineDebugActionsDeps {
  let hour = 12;

  return {
    breakNearest: vi.fn(() => true),
    cameraDistance: () => 7,
    city: () => 'LA',
    cleo: () => null,
    config: createGameRuntimeConfig(),
    flipVehicle: vi.fn(),
    getHour: () => hour,
    gpuTimings: () => [],
    isFlying: () => false,
    missingTextureHighlight: () => false,
    perfHud: () => true,
    perfLogs: () => true,
    perfSnapshot: () => null,
    perfStats: () => null,
    physicsReadout: () => null,
    placePlayer: vi.fn(),
    playerCoords: (): Vec3 => [10, 20, 30],
    reloadClutter: vi.fn(),
    setDebugNormals: vi.fn(),
    setFlyMode: vi.fn(),
    setHour: (value: number): void => {
      hour = value;
    },
    setMissingTextureHighlight: vi.fn(),
    setPerfHud: vi.fn(),
    setPerfLogs: vi.fn(),
    setPhysicsCapture: vi.fn(),
    setWeather: vi.fn(),
    spawn: [1, 2, 3],
    spawnVehicle: vi.fn(() => Promise.resolve()),
    topDownView: vi.fn(),
    vehicleModels: () => ['infernus'],
    weather: () => 0,
    ...overrides,
  };
}

describe('createEngineDebugActions', () => {
  describe('negative cases', () => {
    it('does not reload clutter for a procobj change that touches no live knob', () => {
      const reloadClutter = vi.fn();
      const actions = createEngineDebugActions(deps({ reloadClutter }));

      actions.setProcObj('grass', {});

      expect(reloadClutter).not.toHaveBeenCalled();
    });

    it('reports no perf stats before a frame was measured', () => {
      expect(createEngineDebugActions(deps()).perfStats()).toBeNull();
    });

    it('leaves the three-only overrides inert (no engine debug pipeline yet)', () => {
      const actions = createEngineDebugActions(deps());

      expect(() => {
        actions.setShowNormals(true);
        actions.topDownView();
        actions.setPerfEnabled(true);
      }).not.toThrow();
    });

    it('spawns with NO plate when the F2 field is empty — the placement resolves its own', async () => {
      const spawnVehicle = vi.fn(() => Promise.resolve());
      const actions = createEngineDebugActions(deps({ spawnVehicle }));

      await actions.spawnVehicle('infernus');

      // The argument is ABSENT, not an empty string: the host reads `plate === undefined` to leave the
      // placement's own hash in charge, and '' would give the car a blank plate instead (plan 082/04).
      expect(spawnVehicle).toHaveBeenCalledWith('infernus');
    });

    it('answers inertly for CLEO when no runner booted (a build without cleo/*.cs)', () => {
      const actions = createEngineDebugActions(deps());

      expect(actions.cleoReadout?.()).toBeNull();
      expect(actions.cleoTraceLines?.()).toEqual([]);
      expect(() => {
        actions.setCleoEnabled?.(true);
        actions.setCleoTracing?.(true);
        actions.cleoStep?.('any');
      }).not.toThrow();
    });
  });

  describe('positive cases', () => {
    it('mutates the shared config in place, so the environment driver sees it next frame', () => {
      const config = createGameRuntimeConfig();
      const actions = createEngineDebugActions(deps({ config }));

      actions.setBloom({ intensity: 1.4 });
      actions.setNight({ emissiveBoost: 2 });
      actions.setFogDistance(650);

      expect(config.graphics.bloom.intensity).toBe(1.4);
      expect(config.graphics.night.emissiveBoost).toBe(2);
      expect(config.fog.distance).toBe(650);
      expect(actions.bloom()).toBe(config.graphics.bloom); // getters read the live object
    });

    it('converts between the host hour and the debugger minutes', () => {
      const actions = createEngineDebugActions(deps());

      expect(actions.gameTime()).toBe(720);
      actions.setGameTime(90);
      expect(actions.gameTime()).toBe(90);
    });

    it('re-scatters clutter when a category is toggled or its density changes', () => {
      const reloadClutter = vi.fn();
      const config = createGameRuntimeConfig();
      const actions = createEngineDebugActions(deps({ config, reloadClutter }));

      actions.setProcObj('grass', { enabled: false });
      actions.setProcObj('rocks', { density: 0.5 });

      expect(config.graphics.procobj.grass.enabled).toBe(false);
      expect(config.graphics.procobj.rocks.density).toBe(0.5);
      expect(reloadClutter).toHaveBeenCalledTimes(2);
    });

    it('re-issues the cells when a draw distance changes — the range is baked in per draw', () => {
      const reloadClutter = vi.fn();
      const config = createGameRuntimeConfig();
      const actions = createEngineDebugActions(deps({ config, reloadClutter }));

      actions.setProcObj('grass', { drawDistance: 90 });

      expect(config.graphics.procobj.grass.drawDistance).toBe(90);
      expect(reloadClutter).toHaveBeenCalledTimes(1);
    });

    it('re-drops the player slightly above their spot on respawn and teleports to the spawn point', () => {
      const placePlayer = vi.fn();
      const actions = createEngineDebugActions(deps({ placePlayer, spawn: [7, 8, 9] }));

      actions.respawnPlayer();
      actions.teleportToGanton();

      expect(placePlayer).toHaveBeenNthCalledWith(1, [10, 20, 31], true);
      expect(placePlayer).toHaveBeenNthCalledWith(2, [7, 8, 9], true);
    });

    it('smashes the prop nearest the player', () => {
      const breakNearest = vi.fn(() => true);
      const actions = createEngineDebugActions(deps({ breakNearest }));

      actions.breakNearest();

      expect(breakNearest).toHaveBeenCalledWith([10, 20, 30], 8);
    });

    it('carries the typed plate through to the spawn, unchanged', async () => {
      const spawnVehicle = vi.fn(() => Promise.resolve());
      const actions = createEngineDebugActions(deps({ spawnVehicle }));

      await actions.spawnVehicle('infernus', 'LVA 123');

      expect(spawnVehicle).toHaveBeenCalledWith('infernus', 'LVA 123');
    });

    it('lists every timecyc weather, marking the live one by index', () => {
      const actions = createEngineDebugActions(deps({ weather: () => 4 }));

      expect(actions.weather()).toBe(4);
      expect(actions.weatherList().length).toBeGreaterThan(4);
      expect(actions.weatherList()[0].index).toBe(0);
      expect(typeof actions.weatherList()[0].label).toBe('string');
    });
  });
});

const SNAPSHOT = {
  avgMs: 8.33,
  drawDistance: 1000,
  draws: 567,
  fog: { cut: 700, start: 0 },
  gpu: { pass: 2.11, post: 0.59, probe: 1.23, submit: 0.3 },
  p95Ms: 9.2,
  residency: 'cellIndex 5 · texture 763',
  residencyMb: 887.4,
  stream: { late: 0, loaded: 67, pending: 0 },
  weather: { id: 15, name: 'CLOUDY_CS' },
};

describe('cleoReadout', () => {
  /** The slice of CleoRunnerSystem the readout reads, canned (the system itself is engine-cleo's test). */
  const fakeSystem = {
    atlasMisses: () => [{ address: 0x590, detail: 'vehicle+0x590 (size 4)', kind: 'read' as const }],
    coverage: () => [{ count: 299, declared: true, opcode: 0x0af0, tier: 'conditional-false' as const }],
    enabled: true,
    faults: () => [{ message: 'boom', thread: 'cardoor' }],
    instructionsLastTick: () => 42,
    objectCount: () => 21,
    threadRows: () => [{ instructions: 1, name: 'ferris', state: 'sleep' as const, waitMs: 240 }],
    tracing: false,
  } as unknown as CleoRunnerSystem;

  describe('positive cases', () => {
    it('labels coverage rows from the opcode DB and joins atlas misses with their tier', () => {
      const readout = cleoReadout(fakeSystem);

      expect(readout.coverage).toEqual([
        { count: 299, declared: true, label: '0AF0 READ_INT_FROM_INI_FILE', tier: 'conditional-false' },
      ]);
      expect(readout.misses).toEqual([
        { declared: false, label: 'read vehicle+0x590 (size 4)', tier: 'conditional-false' },
      ]);
      expect(readout.faults).toEqual(['cardoor: boom']);
      expect(readout.threads).toEqual([{ instructions: 1, name: 'ferris', state: 'sleep', waitMs: 240 }]);
      expect(readout.enabled).toBe(true);
      expect(readout.instructionsLastTick).toBe(42);
      expect(readout.objects).toBe(21);
    });
  });
});

describe('engineStatRows', () => {
  describe('negative cases', () => {
    it('reports the probe as off when it did not run', () => {
      const rows = new Map(engineStatRows({ ...SNAPSHOT, gpu: { ...SNAPSHOT.gpu, probe: 0 } }));

      expect(rows.get('gpu probe')).toBe('off');
    });
  });

  describe('positive cases', () => {
    it('formats the engine ledger, not three renderer.info counters', () => {
      const rows = new Map(engineStatRows(SNAPSHOT));

      expect(rows.get('FPS')).toBe('120');
      expect(rows.get('frame p95')).toBe('9.20 ms');
      expect(rows.get('draws')).toBe('567');
      expect(rows.get('gpu world')).toBe('2.11 ms');
      expect(rows.get('cells')).toBe('67 loaded, 0 pending');
      expect(rows.get('residency')).toBe('887 MB');
      expect([...rows.keys()]).not.toContain('triangles');
    });

    it('states that draw distance is boot-only instead of offering a dead slider', () => {
      const rows = new Map(engineStatRows(SNAPSHOT));

      expect(rows.get('draw distance')).toBe('1000 m — boot-only, set with ?draw=N');
      expect(rows.get('fog start → cut')).toBe('0 → 700 m (timecyc)');
      expect(rows.get('weather')).toBe('15 CLOUDY_CS');
    });
  });
});

describe('the debug VIEW actions', () => {
  describe('positive cases', () => {
    it('forwards Show Normals to the engine, in both directions', () => {
      // It was a literal no-op before 074/22; a regression back to one would be invisible without this.
      const setDebugNormals = vi.fn();
      const actions = createEngineDebugActions(deps({ setDebugNormals }));

      actions.setShowNormals(true);
      actions.setShowNormals(false);

      expect(setDebugNormals.mock.calls).toEqual([[true], [false]]);
    });
  });
});
