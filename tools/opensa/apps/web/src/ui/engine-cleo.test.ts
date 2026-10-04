import { ScriptRunner, TraceRing } from '@opensa/cleo';
import { buildScript, int } from '@opensa/cleo/vm/test-script';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import type { CleoHostDeps, CleoObjectInstance } from './engine-cleo';

import { CleoRunnerSystem, createCleoEngineHost, discoverAndSpawn } from './engine-cleo';
import { createGameRuntimeConfig } from './game-runtime-config';

const FERRIS = 'fixtures/original/cleo/ferris.cs';

interface FakeInstance extends CleoObjectInstance {
  destroyed: boolean;
  roots: Float32Array[];
  visible: boolean[];
}

function fakeInstance(): FakeInstance {
  const instance: FakeInstance = {
    destroy: (): void => {
      instance.destroyed = true;
    },
    destroyed: false,
    roots: [],
    setRoot: (root): void => {
      instance.roots.push(Float32Array.from(root));
    },
    setVisible: (visible): void => {
      instance.visible.push(visible);
    },
    visible: [],
  };

  return instance;
}

/** Ferris's four models under their real ids; everything else resolves to nothing. */
const FERRIS_IDS: Readonly<Record<number, { drawDistance: number; modelName: string; txdName: string }>> = {
  14644: { drawDistance: 299, modelName: 'ferriswheel_wheel', txdName: 'ferriswheel_wheel' },
  14645: { drawDistance: 299, modelName: 'ferriswheel_seat', txdName: 'ferriswheel_seat' },
  14646: { drawDistance: 299, modelName: 'ferriswheel_lights', txdName: 'ferriswheel_lights' },
  14647: { drawDistance: 299, modelName: 'ferriswheel_base', txdName: 'ferriswheel_base' },
};

function makeDeps(overrides: Partial<CleoHostDeps> = {}): CleoHostDeps & { spawned: FakeInstance[] } {
  const spawned: FakeInstance[] = [];

  return {
    cameraGta: () => [389.773, -2028.55, 25],
    cars: {
      anyCar: () => null,
      carInSphere: () => null,
      carModel: () => 0,
      isCarModel: () => false,
      playerCar: () => null,
    },
    ensureModel: () => true,
    flush: () => undefined,
    hour: () => 12,
    nativeWorld: {
      doorAngleRatio: () => null,
      lightStatus: () => 0,
      lodDistMultiplier: () => 1,
      nextSiblingPart: () => null,
      partForward: () => [0, 1, 0],
      partIndex: () => null,
      partTranslation: () => [0, 0, 0],
      setLightStatus: () => undefined,
      setPartRotation: () => undefined,
      setPartTranslationComponent: () => undefined,
      vehicleHandles: () => [],
      wind: () => 0,
    },
    playerGta: () => [389, -2028, 14],
    print: () => undefined,
    resolveById: (id) => FERRIS_IDS[id] ?? null,
    resolveByName: () => null,
    spawn: (): FakeInstance => {
      const instance = fakeInstance();
      spawned.push(instance);

      return instance;
    },
    spawned,
    ...overrides,
  };
}

describe('createCleoEngineHost', () => {
  describe('negative cases', () => {
    it('a deleted handle no-ops with a once-log (detach-safe)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const deps = makeDeps();
      const host = createCleoEngineHost(deps);
      const handle = host.objects.create(14644, 0, 0, 0);
      host.objects.delete(handle);
      host.objects.setRotation(handle, 0, 0, 90);
      host.objects.setCoordinates(handle, 1, 2, 3);
      expect(deps.spawned[0].destroyed).toBe(true);
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it('an unresolvable model id creates nothing and the handle reads as non-existent', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const deps = makeDeps();
      const host = createCleoEngineHost(deps);
      const handle = host.objects.create(99999, 0, 0, 0);
      expect(handle).toBe(-1);
      expect(host.objects.exists(handle)).toBe(false);
      expect(host.models.isAvailable(99999)).toBe(false);
      warn.mockRestore();
    });
  });

  describe('positive cases', () => {
    it('create places the instance at the converted engine position', () => {
      const deps = makeDeps();
      const host = createCleoEngineHost(deps);
      host.objects.create(14644, 10, 20, 30);
      const root = deps.spawned[0].roots[0];
      // gtaPositionToEngine: engine = (x, z, -y).
      expect([root[12], root[13], root[14]]).toEqual([10, 30, -20]);
    });

    it('setRotation writes a new root (the wheel visibly turns), translation intact', () => {
      const deps = makeDeps();
      const host = createCleoEngineHost(deps);
      const handle = host.objects.create(14644, 10, 20, 30);
      host.objects.setRotation(handle, 0, 45, 90);
      const [first, second] = deps.spawned[0].roots;
      expect(second).not.toEqual(first);
      expect([second[12], second[13], second[14]]).toEqual([10, 30, -20]);
    });

    it('CONNECT_LODS hides the far half until the camera leaves the near draw distance', () => {
      const deps = makeDeps({ cameraGta: () => [0, 0, 0] });
      const host = createCleoEngineHost(deps);
      const near = host.objects.create(14644, 0, 100, 0); // 100 m away, drawDistance 299
      const far = host.objects.create(14644, 0, 100, 0);
      host.objects.connectLods(near, far);
      expect(deps.spawned[1].visible).toEqual([false]);
      host.update();
      // Still within 299 m — nothing swaps.
      expect(deps.spawned[0].visible).toEqual([]);
      // Move the OBJECT out of range instead of the camera (same distance test).
      host.objects.setCoordinates(near, 0, 400, 0);
      host.update();
      expect(deps.spawned[0].visible).toEqual([false]);
      expect(deps.spawned[1].visible).toEqual([false, true]);
    });

    it('world.cameraWithin measures against the injected camera', () => {
      const host = createCleoEngineHost(makeDeps({ cameraGta: () => [0, 0, 0] }));
      expect(host.world.cameraWithin(0, 500, 0, 600)).toBe(true);
      expect(host.world.cameraWithin(0, 500, 0, 400)).toBe(false);
    });
  });
});

/** A system over the fake deps: WAIT-loop thread `sleeper` + self-terminating thread `oneshot`. */
function makeSystem(): { system: CleoRunnerSystem; trace: TraceRing } {
  const config = createGameRuntimeConfig();
  config.cleo.enabled = true;
  const trace = new TraceRing();
  const host = createCleoEngineHost({ ...makeDeps(), trace });
  const runner = new ScriptRunner({ host, trace });
  runner.spawn(
    buildScript([
      { op: 0x0001, operands: [int(10_000)] }, // WAIT 10s — stays asleep for every test tick
      { op: 0x0002, operands: [int(0)] }, // GOTO start
    ]),
    'sleeper',
  );
  runner.spawn(buildScript([{ op: 0x004e }]), 'oneshot'); // TERMINATE immediately

  return { system: new CleoRunnerSystem(config, runner, host, trace), trace };
}

describe('CleoRunnerSystem debug surface (the F2 screen, plan 097/07)', () => {
  describe('negative cases', () => {
    it('step on a thread name nobody spawned is a no-op', () => {
      const { system } = makeSystem();
      system.fixedUpdate(1 / 60);
      const before = system.threadRows();
      system.step('ghost');

      expect(system.threadRows()).toEqual(before);
    });

    it('a paused runner (enabled false) dispatches nothing on fixedUpdate', () => {
      const { system } = makeSystem();
      system.setEnabled(false);
      system.fixedUpdate(1 / 60);

      expect(system.instructionsLastTick()).toBe(0);
      expect(system.enabled).toBe(false);
    });

    it('stopping the trace clears the story (no stale lines for the next open)', () => {
      const { system } = makeSystem();
      system.setTracing(true);
      system.fixedUpdate(1 / 60);
      expect(system.traceLines().length).toBeGreaterThan(0);
      system.setTracing(false);

      expect(system.traceLines()).toEqual([]);
      expect(system.tracing).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('threadRows names each thread with its state, wait and per-tick cost', () => {
      const { system } = makeSystem();
      system.fixedUpdate(1 / 60);
      const rows = system.threadRows();

      expect(rows).toHaveLength(2);
      const sleeper = rows.find((row) => row.name === 'sleeper');
      const oneshot = rows.find((row) => row.name === 'oneshot');
      expect(sleeper?.state).toBe('sleep');
      expect(sleeper?.waitMs).toBeGreaterThan(9000);
      expect(sleeper?.instructions).toBe(1); // the WAIT itself
      expect(oneshot?.state).toBe('done');
    });

    it('step dispatches ONE instruction on the named thread even while the runner is paused', () => {
      const { system } = makeSystem();
      system.fixedUpdate(1 / 60); // sleeper dispatched its WAIT and sleeps
      system.setEnabled(false);
      system.setTracing(true);
      system.step('sleeper');

      expect(system.traceLines('sleeper')).toHaveLength(1); // the GOTO after the WAIT, nothing more
    });

    it('the trace toggle writes config.cleo.trace and the ring records the tick story', () => {
      const { system } = makeSystem();
      system.setTracing(true);
      system.fixedUpdate(1 / 60);
      const lines = system.traceLines('sleeper');

      expect(lines[0]).toContain('WAIT 10000');
    });
  });
});

describe.skipIf(!existsSync(FERRIS))('ferris on the REAL host facets (headless integration)', () => {
  describe('positive cases', () => {
    it('builds the wheel and turns it: 21 instances, LOD pairs, an advancing wheel root', () => {
      const deps = makeDeps();
      const host = createCleoEngineHost(deps);
      const runner = new ScriptRunner({ host });
      const spawned = discoverAndSpawn(['cleo/ferris.cs'], () => new Uint8Array(readFileSync(FERRIS)), runner, 32);
      expect(spawned).toEqual(['cleo/ferris.cs']);
      for (let frame = 0; frame < 120; frame += 1) {
        runner.tick(1000 / 60);
        host.update();
      }
      expect(runner.faults).toEqual([]);
      expect(host.objectCount()).toBe(21);
      // The wheel is the SECOND spawn (base first) — its root keeps changing while its translation
      // holds still: the exact transform sequence the field checkpoint will show as a turning wheel.
      const wheel = deps.spawned[1];
      expect(wheel.roots.length).toBeGreaterThan(60);
      const [first, last] = [wheel.roots[0], wheel.roots[wheel.roots.length - 1]];
      expect(last).not.toEqual(first);
      expect([last[12], last[13], last[14]]).toEqual([first[12], first[13], first[14]]);
      // A seat (spawn index 5+) RIDES the rim: its translation moves between ticks.
      const seat = deps.spawned[6];
      const seatFirst = seat.roots[0];
      const seatLast = seat.roots[seat.roots.length - 1];
      expect([seatFirst[12], seatFirst[13], seatFirst[14]]).not.toEqual([seatLast[12], seatLast[13], seatLast[14]]);
    });
  });
});
