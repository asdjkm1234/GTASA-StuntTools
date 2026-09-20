import { describe, expect, it, vi } from 'vitest';

import type { Config } from '../interfaces/config.interface';
import type { Vec3 } from '../interfaces/world-adapter.interface';

import { FakeVehicleHandle } from './vehicle-handle.fake';
import { type SpawnedVehicle, VehicleLodSystem, type VehiclePlacement } from './vehicle-lod.system';

const CONFIG = {
  // Shorter than lodDistance on purpose: that is the real shape (150 vs 250) and it bounds where a car may
  // be CREATED — a body spawned past the collision radius has nothing to stand on.
  streaming: { collisionDrawDistance: 150 },
  vehicle: { hdDistance: 80, lodDistance: 250, unloadDistance: 500 },
} as unknown as Readonly<Config>;
const PLACEMENT: VehiclePlacement = { heading: 0, model: 'admiral', position: [0, 0, 0] };

/** A spawned car whose model carries a `_vlo`, so every LOD band is reachable. */
function makeCar(position: Vec3, despawn = vi.fn()): { handle: FakeVehicleHandle; spawned: SpawnedVehicle } {
  const handle = new FakeVehicleHandle([], [], true);

  return { handle, spawned: { despawn, handle, position } };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('VehicleLodSystem', () => {
  describe('negative cases', () => {
    it('culls the car (hides it) beyond lodDistance, without unloading it', () => {
      const car = makeCar([300, 0, 0]);
      const spawn = vi.fn();
      const system = new VehicleLodSystem(() => [0, 0, 0], CONFIG, spawn);
      system.add(PLACEMENT, car.spawned);
      system.update();
      expect(car.handle.band).toBe('culled');
      expect(car.spawned.despawn).not.toHaveBeenCalled();
      expect(spawn).not.toHaveBeenCalled();
    });

    it('does not respawn a car that is still loaded and in range', () => {
      const car = makeCar([10, 0, 0]);
      const spawn = vi.fn();
      const system = new VehicleLodSystem(() => [0, 0, 0], CONFIG, spawn);
      system.add(PLACEMENT, car.spawned);
      system.update();
      expect(spawn).not.toHaveBeenCalled();
    });

    it('does not spawn a lazily-registered car while the view is out of range', () => {
      const spawn = vi.fn();
      const system = new VehicleLodSystem(() => [0, 0, 0], CONFIG, spawn);
      system.register({ heading: 0, model: 'admiral', position: [300, 0, 0] }); // beyond lodDistance
      system.update();
      expect(spawn).not.toHaveBeenCalled();
    });

    it('does not spawn a car that is inside lodDistance but outside the collision radius', () => {
      const spawn = vi.fn();
      const system = new VehicleLodSystem(() => [0, 0, 0], CONFIG, spawn);
      system.register({ heading: 0, model: 'admiral', position: [200, 0, 0] }); // < lodDistance, > collision
      system.update();
      expect(spawn).not.toHaveBeenCalled();
    });

    it('counts consecutive spawn rejections and starts over after one succeeds', async () => {
      const car = makeCar([0, 0, 0]);
      const spawn = vi
        .fn<() => Promise<SpawnedVehicle>>()
        .mockRejectedValueOnce(new Error('vehicle spawn deferred: no ground yet'))
        .mockRejectedValueOnce(new Error('vehicle spawn deferred: no ground yet'))
        .mockResolvedValueOnce(car.spawned)
        .mockRejectedValueOnce(new Error('vehicle spawn deferred: no ground yet'));
      const attempts: number[] = [];
      const system = new VehicleLodSystem(
        () => [0, 0, 0],
        CONFIG,
        spawn,
        (_placement, _error, count) => attempts.push(count),
      );
      system.register(PLACEMENT);

      for (let tick = 0; tick < 3; tick++) {
        system.update();
        await flush();
      }
      car.spawned.position[0] = 900; // shunted away -> unloaded, and the next spawn is rejected again
      system.update();
      await flush();
      system.update();
      await flush();

      expect(attempts).toEqual([1, 2, 1]);
    });
  });

  describe('positive cases', () => {
    it('shows the HD body within hdDistance', () => {
      const car = makeCar([10, 0, 0]);
      const system = new VehicleLodSystem(() => [0, 0, 0], CONFIG, vi.fn());
      system.add(PLACEMENT, car.spawned);
      system.update();
      expect(car.handle.band).toBe('hd');
    });

    it('swaps to the _vlo between hdDistance and lodDistance', () => {
      const car = makeCar([150, 0, 0]);
      const system = new VehicleLodSystem(() => [0, 0, 0], CONFIG, vi.fn());
      system.add(PLACEMENT, car.spawned);
      system.update();
      expect(car.handle.band).toBe('vlo');
    });

    it('unloads the car beyond unloadDistance', () => {
      const despawn = vi.fn();
      const car = makeCar([600, 0, 0], despawn);
      const system = new VehicleLodSystem(() => [0, 0, 0], CONFIG, vi.fn());
      system.add({ ...PLACEMENT, position: [600, 0, 0] }, car.spawned);
      system.update();
      expect(despawn).toHaveBeenCalledOnce();
      system.update(); // already unloaded → no second despawn
      expect(despawn).toHaveBeenCalledOnce();
    });

    it('respawns at its PLACEMENT after the car was displaced and unloaded', async () => {
      const displaced: Vec3 = [0, 0, 0];
      const car = makeCar(displaced);
      const respawned = makeCar([0, 0, 0]);
      const spawn = vi.fn(async () => Promise.resolve(respawned.spawned));
      const system = new VehicleLodSystem(() => [0, 0, 0], CONFIG, spawn);
      system.add(PLACEMENT, car.spawned); // the spot is [0, 0, 0], under the view

      displaced[0] = 900; // shunted, ejected or fallen while the view never left its spot
      system.update();
      expect(car.spawned.despawn).toHaveBeenCalledOnce();

      system.update(); // the SPOT is still in range, so the spot repopulates
      expect(spawn).toHaveBeenCalledOnce();
      await flush();
      system.update();
      expect(respawned.handle.band).toBe('hd');
    });

    it('spawns a lazily-registered car once the view comes within lodDistance', async () => {
      let view: Vec3 = [600, 0, 0];
      const spawned = makeCar([0, 0, 0]);
      const spawn = vi.fn(async () => Promise.resolve(spawned.spawned));
      const system = new VehicleLodSystem(() => view, CONFIG, spawn);
      system.register({ heading: 0, model: 'admiral', position: [0, 0, 0] });

      system.update(); // out of range → not spawned yet
      expect(spawn).not.toHaveBeenCalled();

      view = [10, 0, 0];
      system.update(); // in range → lazily spawned
      expect(spawn).toHaveBeenCalledOnce();
      await flush();
      system.update();
      expect(spawned.handle.band).not.toBe('culled');
    });

    it('respawns an unloaded car once the view returns within lodDistance', async () => {
      let view: Vec3 = [600, 0, 0];
      const respawned = makeCar([0, 0, 0]);
      const spawn = vi.fn(async () => Promise.resolve(respawned.spawned));
      const system = new VehicleLodSystem(() => view, CONFIG, spawn);
      system.add(PLACEMENT, makeCar([0, 0, 0]).spawned);

      system.update(); // far → unload
      view = [10, 0, 0];
      system.update(); // back in range → kick off respawn
      expect(spawn).toHaveBeenCalledOnce();

      await flush();
      system.update(); // respawned car now shown HD
      expect(respawned.handle.band).toBe('hd');
    });
  });
});
