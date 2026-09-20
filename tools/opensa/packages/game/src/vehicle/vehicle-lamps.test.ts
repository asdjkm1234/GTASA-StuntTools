import { describe, expect, it } from 'vitest';

import type { EnterableVehicle } from './enter-vehicle.system';

import { FakeVehicleHandle } from './vehicle-handle.fake';
import {
  lampAnchorsOf,
  lampsOf,
  lampStateFor,
  LIGHT_FRONT_LEFT,
  LIGHT_FRONT_RIGHT,
  LIGHT_REAR_LEFT,
  LIGHT_REAR_RIGHT,
  quatFromHeading,
  withLightSmashed,
} from './vehicle-lamps';

/** A car at the origin facing +Y (heading 0), with authored lamp dummies unless `anchors` says otherwise. */
function car(heading = 0, anchors = true): EnterableVehicle {
  const handle = new FakeVehicleHandle();
  if (anchors) {
    handle.lampAnchors.set('head', [0.8, 1.8, 0]);
    handle.lampAnchors.set('tail', [0.6, -2.4, 0]);
  }

  return {
    halfExtents: [1, 2, 0.7],
    handle,
    heading,
    orientation: quatFromHeading(heading),
    position: [0, 0, 0],
  } as unknown as EnterableVehicle;
}

/** The same car, ROLLED onto its roof (180° about its own +Y axis) — heading is unchanged by a roll. */
function rolledCar(): EnterableVehicle {
  return { ...car(), orientation: [0, 1, 0, 0] } as unknown as EnterableVehicle;
}

describe('vehicle-lamps', () => {
  describe('negative cases', () => {
    it('a car with no lamp dummies has NO lamps — nothing is invented for it', () => {
      // The half-extents fallback this replaces gave headlights to every trailer, tow box and aeroplane
      // in the game (15 stock models carry no head dummy at all). SA lights what the model authors.
      const vehicle = car(0, false);

      expect(lampAnchorsOf(vehicle)).toEqual({ front: null, rear: null });
      expect(lampsOf(vehicle)).toEqual([]);
    });

    it('a dummy AT the model origin means "no lamp here", not "a lamp in the middle of the car"', () => {
      // SA's own test — CVehicle::DoHeadLightBeam returns early on IsZero. A missing dummy reads back as
      // (0,0,0), and taking that literally put both tail lamps inside the bodywork (the modded hotring).
      const vehicle = car();
      (vehicle.handle as FakeVehicleHandle).lampAnchors.set('tail', [0, 0, 0]);

      expect(lampAnchorsOf(vehicle).rear).toBeNull();
      expect(lampsOf(vehicle).map((lamp) => lamp.kind)).toEqual(['head', 'head']);
    });

    it('lamps stay dark unless the car is being DRIVEN at night', () => {
      const vehicle = car();

      expect(lampStateFor(vehicle, false, false, true, 1).car).toBeNull(); // in range but not seated
      expect(lampStateFor(vehicle, true, false, false, 1).car).toBeNull(); // seated, but daytime
      expect(lampStateFor(null, true, false, true, 1).car).toBeNull(); // on foot
    });

    it('a dark car never reports brakes (the state must not leak from the last driven frame)', () => {
      expect(lampStateFor(car(), true, true, false, 1).state).toEqual({
        brakes: false,
        headlights: false,
        intensity: 1,
        smashed: 0,
      });
    });

    it('an index outside SA’s four lamps cannot reach the mask', () => {
      let mask = 0;
      for (const light of [-1, 4, 99, 2.5, Number.NaN]) {
        mask = withLightSmashed(mask, light, true);
      }

      expect(mask).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('each anchor yields a LEFT and a RIGHT lamp (SA authors one per end and mirrors it)', () => {
      const lamps = lampsOf(car());

      expect(lamps).toHaveLength(4);
      const heads = lamps.filter((lamp) => lamp.kind === 'head');
      expect(heads.map((lamp) => lamp.position[0]).sort()).toEqual([-0.8, 0.8]);
      expect(heads.every((lamp) => lamp.position[1] === 1.8)).toBe(true);
    });

    it('heads face forward and tails face backward — a corona must not glow through the boot', () => {
      const lamps = lampsOf(car());

      for (const lamp of lamps) {
        expect(lamp.facing[1]).toBeCloseTo(lamp.kind === 'head' ? 1 : -1, 5);
      }
    });

    it('the whole lamp rig rotates with the car', () => {
      const lamps = lampsOf(car(Math.PI / 2)); // turned 90° left: the car now faces −X
      const head = lamps.find((lamp) => lamp.kind === 'head')!;

      expect(head.facing[0]).toBeCloseTo(-1, 5);
      expect(head.facing[1]).toBeCloseTo(0, 5);
      // Its position swung with it: the +Y-forward anchor is now out along −X.
      expect(head.position[0]).toBeCloseTo(-1.8, 5);
    });

    it('a driven car at night lights up, and brakes ride the driving state', () => {
      const vehicle = car();

      const lit = lampStateFor(vehicle, true, true, true, 0.5);

      expect(lit.car).toBe(vehicle);
      expect(lit.state).toEqual({ brakes: true, headlights: true, intensity: 0.5, smashed: 0 });
    });

    it('each lamp carries its own SA light index, right and left the way SA numbers them', () => {
      const lamps = lampsOf(car());
      const at = (light: number): (typeof lamps)[number] => lamps.find((lamp) => lamp.light === light)!;

      // +X is the car's RIGHT. Get this pairing wrong and a script smashing the front left puts out the
      // front right instead — silently, since both are headlights.
      expect(at(LIGHT_FRONT_RIGHT).position[0]).toBeCloseTo(0.8, 5);
      expect(at(LIGHT_FRONT_LEFT).position[0]).toBeCloseTo(-0.8, 5);
      expect(at(LIGHT_REAR_RIGHT).position[0]).toBeCloseTo(0.6, 5);
      expect(at(LIGHT_REAR_LEFT).position[0]).toBeCloseTo(-0.6, 5);
      expect(at(LIGHT_FRONT_LEFT).kind).toBe('head');
      expect(at(LIGHT_REAR_LEFT).kind).toBe('tail');
    });

    it('damage belongs to the CAR, so an unlit car still reports its smashed lamps', () => {
      const vehicle = car();
      vehicle.handle.setLightSmashed(LIGHT_REAR_RIGHT, true);

      // Daytime, nobody driving — the lamps are off, but the damage must not read as repaired.
      expect(lampStateFor(vehicle, false, false, false, 1).state.smashed).toBe(1 << LIGHT_REAR_RIGHT);
    });
  });
});

describe('lampsOf (a rolled car)', () => {
  describe('positive cases', () => {
    it('the lamps ride the BODY, not the heading — a car on its roof has its lamps under it', () => {
      // A roll leaves `heading` untouched, so anything driven off the heading alone stays upright while the
      // car does not: the coronas visibly slid off the wreck in the field. The lamps must follow the chassis's
      // full orientation.
      const upright = lampsOf(car());
      const rolled = lampsOf(rolledCar());

      for (let lamp = 0; lamp < upright.length; lamp += 1) {
        // Rolled 180° about +Y: the lamp's own X and Z flip, its Y (fore/aft) does not.
        expect(rolled[lamp].position[0]).toBeCloseTo(-upright[lamp].position[0], 5);
        expect(rolled[lamp].position[1]).toBeCloseTo(upright[lamp].position[1], 5);
        expect(rolled[lamp].position[2]).toBeCloseTo(-upright[lamp].position[2], 5);
      }
      // And they still face fore/aft — the beam does not point into the ground because the car flipped.
      expect(rolled[0].facing[1]).toBeCloseTo(1, 5);
    });
  });
});
