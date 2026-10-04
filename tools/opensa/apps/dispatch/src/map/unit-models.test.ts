import type { Engine, VehicleInstance, VehicleModelId } from '@opensa/engine';
import type { OptimizedModel } from '@opensa/loaders/model-osm';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Unit } from '../ops/types';
import type { ModelSource } from '../world/model-source';

import { UNIT_MODEL_TEXTURE_BYTES } from '../ops/budget';
import { UnitModels } from './unit-models';

/** Let the model load's promise chain (`then` → `finally`) run to completion. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The wake the layer calls when a model arrives — nothing to do in a test that is not asserting on it. */
const noWake = (): void => undefined;

/** Records what the engine was asked to upload, create and destroy — the layer's whole GPU-side effect. */
function fakeEngine(): {
  engine: Engine;
  instances: Map<VehicleInstance, { model: VehicleModelId; roots: number[][]; visible: Map<number, boolean> }>;
  models: Map<VehicleModelId, { alive: boolean }>;
  uploads: number;
} {
  const models = new Map<VehicleModelId, { alive: boolean }>();
  const instances = new Map<
    VehicleInstance,
    { model: VehicleModelId; roots: number[][]; visible: Map<number, boolean> }
  >();
  let nextModel = 0;
  let uploads = 0;
  const engine = {
    createVehicle: (id: VehicleModelId): VehicleInstance => {
      const record = { model: id, roots: [] as number[][], visible: new Map<number, boolean>() };
      const instance = {
        entity: { setRoot: (matrix: ArrayLike<number>): void => void record.roots.push([...(matrix as number[])]) },
        setSubmeshVisible: (submesh: number, visible: boolean): void => void record.visible.set(submesh, visible),
      } as unknown as VehicleInstance;
      instances.set(instance, record);

      return instance;
    },
    createVehicleModel: (): VehicleModelId => {
      nextModel += 1;
      uploads += 1;
      models.set(nextModel, { alive: true });

      return nextModel;
    },
    destroyVehicle: (instance: VehicleInstance): void => void instances.delete(instance),
    destroyVehicleModel: (id: VehicleModelId): void => {
      const entry = models.get(id);
      if (entry) {
        entry.alive = false;
      }
      models.delete(id);
    },
    updateVehicles: (): void => undefined,
  };

  return {
    engine: engine as unknown as Engine,
    instances,
    models,
    get uploads(): number {
      return uploads;
    },
  };
}

/** A source that answers `models` by name and reports everything else as absent, counting every read. */
function fakeSource(models: Record<string, () => OptimizedModel | Promise<OptimizedModel>>): {
  reads: string[];
  source: ModelSource;
} {
  const reads: string[] = [];
  const missing = new Set<string>();

  return {
    reads,
    source: {
      missing,
      read: async (name: string): Promise<null | OptimizedModel> => {
        reads.push(name);
        const found = models[name];
        if (!found) {
          missing.add(name);

          return null;
        }

        return await found();
      },
    },
  };
}

/** A converted model with `body` submeshes, one damaged twin and one unchosen extra. */
function model(textureBytes = 1024): OptimizedModel {
  return {
    fixture: {
      submeshes: [
        { kind: 'body' },
        { kind: 'dam' },
        { extra: 'extra1', kind: 'body' },
        { kind: 'lod' },
        { kind: 'body' },
      ],
    },
    model: { textures: [{ bytes: new Uint8Array(textureBytes), kind: 'ostex' }] },
  } as unknown as OptimizedModel;
}

function unit(id: string, patch: Partial<Unit> = {}): Unit {
  return {
    at: [1000, -1200],
    callsign: id.toUpperCase(),
    elevation: 13,
    heading: 0,
    id,
    incident: null,
    kind: 'patrol',
    model: 'copcarls',
    status: 'available',
    target: null,
    ...patch,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('UnitModels', () => {
  describe('negative cases', () => {
    it('asks for nothing when there is no model source — a pak served without its game dir', async () => {
      const { engine } = fakeEngine();
      const layer = new UnitModels(engine, null, noWake);
      layer.update([unit('u1')]);
      await settle();
      layer.update([unit('u1')]);

      expect(layer.stats()).toMatchObject({ drawn: 0, types: 0, withoutModel: 1 });
    });

    it('draws a unit that claims no model as a symbol alone, and asks for nothing', async () => {
      const { engine } = fakeEngine();
      const { reads, source } = fakeSource({});
      const layer = new UnitModels(engine, source, noWake);
      layer.update([unit('u1', { model: null })]);
      await settle();

      expect(reads).toEqual([]);
      expect(layer.stats()).toMatchObject({ drawn: 0, unresolved: 0, withoutModel: 1 });
    });

    it('reports a name this build cannot draw ONCE, and never asks for it again', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { engine } = fakeEngine();
      const { reads, source } = fakeSource({});
      const layer = new UnitModels(engine, source, noWake);
      for (let frame = 0; frame < 5; frame += 1) {
        layer.update([unit('u1'), unit('u2')]);
        await settle();
      }

      expect(reads).toEqual(['copcarls']);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(layer.stats()).toMatchObject({ drawn: 0, unresolved: 1, withoutModel: 2 });
    });

    it('leaves the unit as a symbol when the bytes are there but will not decode', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const { engine } = fakeEngine();
      const { source } = fakeSource({ copcarls: () => Promise.reject(new Error('missing its GEOM section')) });
      const layer = new UnitModels(engine, source, noWake);
      layer.update([unit('u1')]);
      await settle();
      layer.update([unit('u1')]);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(layer.stats()).toMatchObject({ drawn: 0, types: 0, withoutModel: 1 });
    });

    it('never trims a type that is on the board, however far past the allowance it is', async () => {
      const { engine, models } = fakeEngine();
      const { source } = fakeSource({ copcarls: () => model(UNIT_MODEL_TEXTURE_BYTES * 2) });
      const layer = new UnitModels(engine, source, noWake);
      layer.update([unit('u1')]);
      await settle();
      layer.update([unit('u1')]);

      expect(layer.stats().drawn).toBe(1);
      expect([...models.values()].every((entry) => entry.alive)).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('uploads one model per TYPE and gives every unit its own instance', async () => {
      const fake = fakeEngine();
      const { source } = fakeSource({ copcarls: () => model() });
      const layer = new UnitModels(fake.engine, source, noWake);
      const board = [unit('u1'), unit('u2'), unit('u3')];
      layer.update(board);
      await settle();
      layer.update(board);

      expect(fake.uploads).toBe(1);
      expect(fake.instances.size).toBe(3);
      expect(layer.stats()).toMatchObject({ drawn: 3, types: 1, withoutModel: 0 });
    });

    it('stands each car on its own fix, facing the heading the feed reported', async () => {
      const fake = fakeEngine();
      const { source } = fakeSource({ copcarls: () => model() });
      const layer = new UnitModels(fake.engine, source, noWake);
      layer.update([unit('u1', { at: [2495, -1687], elevation: 21, heading: Math.PI / 2 })]);
      await settle();
      layer.update([unit('u1', { at: [2495, -1687], elevation: 21, heading: Math.PI / 2 })]);

      const [record] = [...fake.instances.values()];
      const root = record.roots[record.roots.length - 1];
      expect([root[12], root[13], root[14]]).toEqual([2495, 21, 1687]);
      expect(root[4]).toBeCloseTo(1); // forward = engine +x, i.e. GTA east
    });

    it('shows the body and hides the damaged twin, the LOD and the unchosen extra', async () => {
      const fake = fakeEngine();
      const { source } = fakeSource({ copcarls: () => model() });
      const layer = new UnitModels(fake.engine, source, noWake);
      layer.update([unit('u1')]);
      await settle();
      layer.update([unit('u1')]);

      const [record] = [...fake.instances.values()];
      expect([...record.visible.entries()].sort()).toEqual([
        [0, true],
        [1, false],
        [2, false],
        [3, false],
        [4, true],
      ]);
    });

    it('wakes the frame when a model arrives, or the fleet appears whenever the operator next moves', async () => {
      const fake = fakeEngine();
      const { source } = fakeSource({ copcarls: () => model() });
      const wake = vi.fn();
      const layer = new UnitModels(fake.engine, source, wake);
      layer.update([unit('u1')]);
      await settle();

      expect(wake).toHaveBeenCalledTimes(1);
    });

    it('gives back the car of a unit that leaves the board, and keeps the type uploaded', async () => {
      const fake = fakeEngine();
      const { source } = fakeSource({ copcarls: () => model() });
      const layer = new UnitModels(fake.engine, source, noWake);
      layer.update([unit('u1'), unit('u2')]);
      await settle();
      layer.update([unit('u1'), unit('u2')]);
      layer.update([unit('u1')]);

      expect(fake.instances.size).toBe(1);
      expect(fake.uploads).toBe(1);
      expect(layer.stats()).toMatchObject({ drawn: 1, types: 1 });
    });

    it('trims an idle type once the board no longer drives it', async () => {
      const fake = fakeEngine();
      const { source } = fakeSource({
        ambulan: () => model(UNIT_MODEL_TEXTURE_BYTES),
        copcarls: () => model(UNIT_MODEL_TEXTURE_BYTES),
      });
      const layer = new UnitModels(fake.engine, source, noWake);
      layer.update([unit('u1')]);
      await settle();
      layer.update([unit('u1')]);
      // The patrol car goes off duty and a medic comes on: two full allowances, only one of them driven.
      layer.update([unit('u2', { model: 'ambulan' })]);
      await settle();
      layer.update([unit('u2', { model: 'ambulan' })]);

      expect(layer.stats()).toMatchObject({ drawn: 1, types: 1 });
      expect(fake.models.size).toBe(1);
    });

    it('drops every instance and every uploaded type on dispose', async () => {
      const fake = fakeEngine();
      const { source } = fakeSource({ copcarls: () => model() });
      const layer = new UnitModels(fake.engine, source, noWake);
      layer.update([unit('u1'), unit('u2')]);
      await settle();
      layer.update([unit('u1'), unit('u2')]);
      layer.dispose();

      expect(fake.instances.size).toBe(0);
      expect(fake.models.size).toBe(0);
    });
  });
});
