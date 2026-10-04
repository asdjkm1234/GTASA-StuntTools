import { Quaternion, Vector3 } from '@opensa/math';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { PhysicsWorld } from '../physics/physics-world';
import type { EnterableVehicle } from './enter-vehicle.system';
import type { VehicleRig } from './vehicle-rig';

import { FakeVehicleHandle } from './vehicle-handle.fake';
import { VehiclePhysicsSystem } from './vehicle-physics.system';

interface Transform {
  position: Vec3;
  quaternion: [number, number, number, number];
}

const CAR_BODY = 3;

/** A physics world returning a settable body transform. */
function fakePhysics(transform: Transform): PhysicsWorld {
  return {
    readBody: (): Transform => transform,
    suspensionLengths: (): number[] => [],
    wheelContacts: (): boolean[] => [],
  } as unknown as PhysicsWorld;
}

/** A rig that records the last speed it was told to roll at. */
function fakeRig(): { rig: VehicleRig; speed: number } {
  const state = { rig: null as unknown as VehicleRig, speed: 0 };
  state.rig = {
    setContacts: (): void => undefined,
    setLift: (): void => undefined,
    setSpeed: (value: number): void => {
      state.speed = value;
    },
    update: (): void => undefined,
  } as unknown as VehicleRig;

  return state;
}

function vehicle(rig: VehicleRig, position: Vec3 = [0, 0, 0]): EnterableVehicle {
  return {
    body: CAR_BODY,
    handle: new FakeVehicleHandle(),
    heading: 0,
    orientation: [0, 0, 0, 1] as [number, number, number, number],
    position: [...position],
    renderOrientation: [0, 0, 0, 1] as [number, number, number, number],
    renderPosition: [...position],
    rig,
  } as unknown as EnterableVehicle;
}

/** Quaternion (as [x,y,z,w]) for a yaw of `angle` about GTA +Z. */
function yaw(angle: number): [number, number, number, number] {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle);

  return [q.x, q.y, q.z, q.w];
}

describe('VehiclePhysicsSystem', () => {
  let rig: ReturnType<typeof fakeRig>;

  beforeEach(() => {
    rig = fakeRig();
  });

  describe('negative cases', () => {
    it('stops sampling a removed vehicle', () => {
      const transform: Transform = { position: [5, 0, 0], quaternion: yaw(0) };
      const system = new VehiclePhysicsSystem(fakePhysics(transform));
      const car = vehicle(rig.rig);
      system.add(car);
      system.remove(car);
      transform.position = [99, 0, 0];
      system.snapshot(1);
      expect(car.position[0]).toBe(0); // never copied from the body after removal
    });

    it('keeps a parked car wheels still (no displacement → speed 0)', () => {
      const system = new VehiclePhysicsSystem(fakePhysics({ position: [0, 0, 0], quaternion: yaw(0) }));
      system.add(vehicle(rig.rig));
      system.snapshot(1); // body did not move from the add position
      expect(rig.speed).toBe(0);
    });

    it('treats sub-deadzone creep as still', () => {
      const system = new VehiclePhysicsSystem(fakePhysics({ position: [0, 0.05, 0], quaternion: yaw(0) }));
      system.add(vehicle(rig.rig));
      system.snapshot(1); // 0.05 m/s < ROLL_DEADZONE (0.1)
      expect(rig.speed).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('samples the body transform into the gameplay pose', () => {
      const system = new VehiclePhysicsSystem(fakePhysics({ position: [10, 20, 30], quaternion: yaw(0) }));
      const car = vehicle(rig.rig);
      system.add(car);
      system.snapshot(1);
      expect(car.position).toEqual([10, 20, 30]);
    });

    it('draws the car at the current pose when fully caught up (alpha 1)', () => {
      const system = new VehiclePhysicsSystem(fakePhysics({ position: [10, 20, 30], quaternion: yaw(0) }));
      const car = vehicle(rig.rig);
      system.add(car);
      system.snapshot(1);
      system.render(1);
      expect((car.handle as FakeVehicleHandle).position).toEqual([10, 20, 30]);
      expect(car.renderPosition).toEqual([10, 20, 30]);
    });

    it('interpolates the drawn pose HALFWAY between the last two steps', () => {
      const transform: Transform = { position: [0, 0, 0], quaternion: yaw(0) };
      const system = new VehiclePhysicsSystem(fakePhysics(transform));
      const car = vehicle(rig.rig);
      system.add(car);
      system.snapshot(1); // cur = [0,0,0]
      transform.position = [0, 4, 0];
      system.snapshot(1); // prev = [0,0,0], cur = [0,4,0]
      system.render(0.5);

      expect((car.handle as FakeVehicleHandle).position).toEqual([0, 2, 0]); // midway
      expect(car.renderPosition).toEqual([0, 2, 0]);
      expect(car.position).toEqual([0, 4, 0]); // gameplay stays on the live pose
    });

    it('interpolates the drawn ORIENTATION through a turn (coronas ride it)', () => {
      const transform: Transform = { position: [0, 0, 0], quaternion: yaw(0) };
      const system = new VehiclePhysicsSystem(fakePhysics(transform));
      const car = vehicle(rig.rig);
      system.add(car);
      system.snapshot(1); // cur yaw 0
      transform.quaternion = yaw(Math.PI / 2);
      system.snapshot(1); // prev yaw 0, cur yaw π/2
      system.render(0.5);

      // Halfway between yaw 0 and yaw π/2 is yaw π/4 — the drawn body and the lamps hung on it agree.
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4);
      expect(car.renderOrientation[2]).toBeCloseTo(q.z, 5);
      expect(car.renderOrientation[3]).toBeCloseTo(q.w, 5);
      expect(car.orientation).toEqual([...yaw(Math.PI / 2)]); // gameplay on the live pose
    });

    it('derives heading about Z from the body forward (+Y)', () => {
      const system = new VehiclePhysicsSystem(fakePhysics({ position: [0, 0, 0], quaternion: yaw(Math.PI / 2) }));
      const car = vehicle(rig.rig);
      system.add(car);
      system.snapshot(1);
      expect(car.heading).toBeCloseTo(Math.PI / 2, 5);
    });

    it('rolls the wheels forward at the car planar speed', () => {
      const system = new VehiclePhysicsSystem(fakePhysics({ position: [0, 2, 0], quaternion: yaw(0) }));
      system.add(vehicle(rig.rig)); // added at [0,0,0]; body now at [0,2,0]
      system.snapshot(1); // moved +2 in Y over 1s, facing +Y → +2 m/s
      expect(rig.speed).toBeCloseTo(2, 5);
    });

    it('signs the roll negative when moving against the facing (reversing)', () => {
      const system = new VehiclePhysicsSystem(fakePhysics({ position: [0, -2, 0], quaternion: yaw(0) }));
      system.add(vehicle(rig.rig)); // facing +Y but moving −Y
      system.snapshot(1);
      expect(rig.speed).toBeCloseTo(-2, 5);
    });
  });
});
