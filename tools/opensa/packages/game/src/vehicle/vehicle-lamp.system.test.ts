import { describe, expect, it } from 'vitest';

import type { HeadlightConfig } from '../interfaces/config.interface';
import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { EnterableVehicle, EnterVehicleSystem } from './enter-vehicle.system';
import type { LampCorona, LampLight } from './vehicle-lamp.system';

import { FakeVehicleHandle } from './vehicle-handle.fake';
import { VehicleLampSystem } from './vehicle-lamp.system';
import { LIGHT_FRONT_LEFT, LIGHT_FRONT_RIGHT, LIGHT_REAR_LEFT, LIGHT_REAR_RIGHT } from './vehicle-lamps';
import { VehicleRig } from './vehicle-rig';

const CONFIG: HeadlightConfig = {
  beamIntensity: 2.2,
  beamRange: 34,
  brakeIntensity: 1.6,
  coronaIntensity: 0.8,
  coronaSize: 0.28,
  intensity: 1,
};

/** A car at the origin facing +Y, with authored lamp dummies. Its rig is real — the lamps drive the
 *  retractable-headlight travel through it. */
function car(popUps = false): EnterableVehicle {
  const handle = new FakeVehicleHandle();
  handle.lampAnchors.set('head', [0.8, 1.8, 0]);
  handle.lampAnchors.set('tail', [0.6, -2.4, 0]);
  handle.hasPopUpLights = popUps;

  return {
    halfExtents: [1, 2, 0.7],
    handle,
    heading: 0,
    orientation: [0, 0, 0, 1],
    position: [0, 0, 0],
    rig: new VehicleRig(handle),
  } as unknown as EnterableVehicle;
}

/** The enter/exit system, reduced to what the lamps actually ask it. */
function enter(active: EnterableVehicle | null, seated: boolean, braking = false): EnterVehicleSystem {
  return {
    getActive: (): EnterableVehicle | null => active,
    isBraking: (): boolean => braking,
    isSeated: (): boolean => seated,
  } as unknown as EnterVehicleSystem;
}

/** Recording sinks; `eye` sits well in FRONT of the car (+Y) so the headlight coronas face it. */
function harness(
  system: (sinks: ConstructorParameters<typeof VehicleLampSystem>[3]) => VehicleLampSystem,
  eye: Vec3 = [0, 20, 1],
): { coronas: LampCorona[]; lights: LampLight[]; run: () => void } {
  const coronas: LampCorona[] = [];
  const lights: LampLight[] = [];
  const built = system({
    corona: (corona) => coronas.push(corona),
    eye: () => eye,
    light: (light) => lights.push(light),
    reset: () => {
      coronas.length = 0;
      lights.length = 0;
    },
  });

  return { coronas, lights, run: () => built.update() };
}

describe('VehicleLampSystem', () => {
  describe('negative cases', () => {
    it('emits nothing on foot', () => {
      const { coronas, lights, run } = harness(
        (sinks) =>
          new VehicleLampSystem(
            enter(null, false),
            () => true,
            () => CONFIG,
            sinks,
          ),
      );

      run();

      expect(lights).toHaveLength(0);
      expect(coronas).toHaveLength(0);
    });

    it('turns the lamps of the car the driver JUST LEFT back off', () => {
      // Lamp state lives on the VEHICLE, not on this system: without this the car drives away lit forever.
      const vehicle = car();
      const handle = vehicle.handle as FakeVehicleHandle;
      const seated = { value: true };
      const { run } = harness(
        (sinks) =>
          new VehicleLampSystem(
            {
              getActive: () => (seated.value ? vehicle : null),
              isBraking: () => false,
              isSeated: () => seated.value,
            } as unknown as EnterVehicleSystem,
            () => true,
            () => CONFIG,
            sinks,
          ),
      );

      run();
      expect(handle.lamps?.headlights).toBe(true);

      seated.value = false;
      run();

      expect(handle.lamps?.headlights).toBe(false);
    });

    it('lowers the retractable headlights of the car the driver just left', () => {
      const vehicle = car();
      const handle = vehicle.handle as FakeVehicleHandle;
      const seated = { value: true };
      const { run } = harness(
        (sinks) =>
          new VehicleLampSystem(
            {
              getActive: () => (seated.value ? vehicle : null),
              isBraking: () => false,
              isSeated: () => seated.value,
            } as unknown as EnterVehicleSystem,
            () => true,
            () => CONFIG,
            sinks,
          ),
      );

      run();
      vehicle.rig.update(1); // past the 0.7 s arc

      expect(handle.popUpLights).toBe(1);

      seated.value = false;
      run();
      vehicle.rig.update(1);

      expect(handle.popUpLights).toBe(0);
    });

    it('a pod car stays dark while its pods are still rising', () => {
      const vehicle = car(true);
      const handle = vehicle.handle as FakeVehicleHandle;
      const { lights, run } = harness(
        (sinks) =>
          new VehicleLampSystem(
            enter(vehicle, true),
            () => true,
            () => CONFIG,
            sinks,
          ),
      );

      run();
      vehicle.rig.update(0.35); // halfway up the 0.7 s arc

      expect(handle.lamps?.headlights).toBe(false);
      expect(lights.filter((light) => light.cone !== undefined)).toHaveLength(0); // no beam out of the nose
      expect(lights.filter((light) => light.cone === undefined)).toHaveLength(2); // the tails burn regardless
    });

    it('a corona seen from BEHIND its lamp is dropped (a headlight must not glow through the boot)', () => {
      const { coronas, run } = harness(
        (sinks) =>
          new VehicleLampSystem(
            enter(car(), true),
            () => true,
            () => CONFIG,
            sinks,
          ),
        [0, -20, 1], // eye behind the car: heads face away
      );

      run();

      expect(coronas.every((corona) => corona.color[1] < 0.5)).toBe(true); // only the red tails survive
    });

    it('a car whose model authors NO lamps emits nothing, even driven at night', () => {
      // The product-level guard for plan 098/11: the half-extents fallback used to invent anchors here,
      // so every trailer, tow box and aeroplane lit up. `car()` without anchors is that model.
      const vehicle = car();
      (vehicle.handle as FakeVehicleHandle).lampAnchors.clear();
      const { coronas, lights, run } = harness(
        (sinks) =>
          new VehicleLampSystem(
            enter(vehicle, true, true),
            () => true,
            () => CONFIG,
            sinks,
          ),
      );

      run();

      expect(lights).toHaveLength(0);
      expect(coronas).toHaveLength(0);
    });

    it('a SMASHED lamp emits no pool light and no corona — its three siblings still do', () => {
      const vehicle = car();
      vehicle.handle.setLightSmashed(LIGHT_FRONT_LEFT, true);
      const { coronas, lights, run } = harness(
        (sinks) =>
          new VehicleLampSystem(
            enter(vehicle, true),
            () => true,
            () => CONFIG,
            sinks,
          ),
      );

      run();

      const heads = lights.filter((light) => light.cone !== undefined);
      expect(heads).toHaveLength(1);
      expect(heads[0].position[0]).toBeCloseTo(0.8, 5); // the surviving one is the RIGHT headlight
      expect(lights.filter((light) => light.cone === undefined)).toHaveLength(2); // both tails untouched
      expect(coronas.filter((corona) => corona.color[1] > 0.5)).toHaveLength(1);
    });

    it('all four smashed leaves the car emitting nothing at all, driven or not', () => {
      const vehicle = car();
      for (const light of [LIGHT_FRONT_LEFT, LIGHT_FRONT_RIGHT, LIGHT_REAR_RIGHT, LIGHT_REAR_LEFT]) {
        vehicle.handle.setLightSmashed(light, true);
      }
      const { coronas, lights, run } = harness(
        (sinks) =>
          new VehicleLampSystem(
            enter(vehicle, true, true),
            () => true,
            () => CONFIG,
            sinks,
          ),
      );

      run();

      expect(lights).toHaveLength(0);
      expect(coronas).toHaveLength(0);
      // …and the mask reaches the renderer, which is what puts the lamp MESHES out.
      expect((vehicle.handle as FakeVehicleHandle).lamps?.smashed).toBe(0b1111);
    });
  });

  describe('positive cases', () => {
    it('gives the HEADLIGHTS a cone and leaves the tails as point lights', () => {
      const { lights, run } = harness(
        (sinks) =>
          new VehicleLampSystem(
            enter(car(), true),
            () => true,
            () => CONFIG,
            sinks,
          ),
      );

      run();

      const heads = lights.filter((light) => light.cone !== undefined);
      expect(heads).toHaveLength(2);
      expect(lights.filter((light) => light.cone === undefined)).toHaveLength(2);
      // The beam aims forward (+Y) and DOWN, so the pool lands on the asphalt ahead.
      expect(heads[0].cone!.direction[1]).toBeGreaterThan(0.9);
      expect(heads[0].cone!.direction[2]).toBeLessThan(0);
    });

    it('a car with NO pod lights at once — it must never wait for an arc it does not have', () => {
      // Every other case here happens to use a pod-less car, but this is the guarantee itself: a regression
      // would put every car in the game in the dark at night, and nothing else would say so.
      const { lights, run } = harness(
        (sinks) =>
          new VehicleLampSystem(
            enter(car(false), true),
            () => true,
            () => CONFIG,
            sinks,
          ),
      );

      run();

      expect(lights.filter((light) => light.cone !== undefined)).toHaveLength(2);
    });

    it('a pod car lights the moment its pods finish opening', () => {
      const vehicle = car(true);
      const handle = vehicle.handle as FakeVehicleHandle;
      const { lights, run } = harness(
        (sinks) =>
          new VehicleLampSystem(
            enter(vehicle, true),
            () => true,
            () => CONFIG,
            sinks,
          ),
      );

      run();
      vehicle.rig.update(1); // past the arc
      run();

      expect(handle.popUpLights).toBe(1);
      expect(handle.lamps?.headlights).toBe(true);
      expect(lights.filter((light) => light.cone !== undefined)).toHaveLength(2);
    });

    it('the pool light sits AT the lamp — not shoved metres ahead of the bumper', () => {
      const { lights, run } = harness(
        (sinks) =>
          new VehicleLampSystem(
            enter(car(), true),
            () => true,
            () => CONFIG,
            sinks,
          ),
      );

      run();

      const head = lights.find((light) => light.cone !== undefined)!;
      expect(head.position[1]).toBeCloseTo(1.8, 5); // the headlight dummy's own y
    });

    it('a corona is nudged along the VIEW RAY so the bodywork cannot slice it', () => {
      // The lamp dummy sits ON the lens; a camera-facing quad centred there is half-buried in the car and
      // the depth test cuts it along the car's own silhouette. The nudge must be toward the EYE (pure depth),
      // never outward along the lamp — that un-clips it but leaves the glow floating off the bumper.
      const { coronas, run } = harness(
        (sinks) =>
          new VehicleLampSystem(
            enter(car(), true),
            () => true,
            () => CONFIG,
            sinks,
          ),
      );

      run();

      const head = coronas.find((corona) => corona.color[1] > 0.5)!;
      expect(head.position[1]).toBeGreaterThan(1.8); // moved toward the eye at +Y…
      expect(head.position[1]).toBeLessThan(2.3); // …but only by the depth bias, not out of the car
    });

    it('braking brightens the tail lamps and swells their coronas', () => {
      const running = harness(
        (sinks) =>
          new VehicleLampSystem(
            enter(car(), true, false),
            () => true,
            () => CONFIG,
            sinks,
          ),
        [0, -20, 1],
      );
      const braking = harness(
        (sinks) =>
          new VehicleLampSystem(
            enter(car(), true, true),
            () => true,
            () => CONFIG,
            sinks,
          ),
        [0, -20, 1],
      );

      running.run();
      braking.run();

      const tailOf = (lights: LampLight[]): LampLight => lights.find((light) => light.cone === undefined)!;
      expect(tailOf(braking.lights).color[0]).toBeGreaterThan(tailOf(running.lights).color[0]);
      expect(braking.coronas[0].size).toBeGreaterThan(running.coronas[0].size);
    });
  });
});
