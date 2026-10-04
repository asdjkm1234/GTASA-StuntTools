import { describe, expect, it } from 'vitest';

import type { VehicleController, VehicleWheelReading, VehicleWheelSlip } from '../physics/physics-world';
import type { TyreSmokeCar, TyreSmokePuff } from './vehicle-tyre-smoke.system';

import { TYRE_SMOKE_DEFAULTS, VehicleTyreSmokeSystem } from './vehicle-tyre-smoke.system';

const STEP = 1 / 60;

/** The reading with its readonly stripped — the fake road mutates contact between steps. */
type MutableWheel = { -readonly [K in keyof VehicleWheelReading]: VehicleWheelReading[K] };

function wheel(overrides: Partial<VehicleWheelReading> = {}): MutableWheel {
  return {
    contact: true,
    forwardImpulse: 0,
    maxTravel: 0.2,
    radius: 0.3,
    restLength: 0.3,
    rotation: 0,
    sideImpulse: 0,
    suspensionForce: 4000,
    suspensionLength: 0.25,
    ...overrides,
  };
}

const gripping = (): { brakeExcess: number; spinExcess: number } => ({ brakeExcess: 0, spinExcess: 0 });

/** A driveable stand-in: identity orientation, so forward = +Y and lateral = +X in the linvel. */
function harness(dials = TYRE_SMOKE_DEFAULTS): {
  puffs: TyreSmokePuff[];
  run: (steps: number) => void;
  state: {
    car: null | TyreSmokeCar;
    enabled: boolean;
    linvel: [number, number, number];
    slips: null | { brakeExcess: number; spinExcess: number }[];
    wheels: MutableWheel[];
  };
} {
  const state = {
    car: {
      body: 1,
      controller: {} as VehicleController,
      orientation: [0, 0, 0, 1] as [number, number, number, number],
    } as null | TyreSmokeCar,
    enabled: true,
    linvel: [0, 0, 0] as [number, number, number],
    slips: [gripping(), gripping(), gripping(), gripping()] as null | { brakeExcess: number; spinExcess: number }[],
    wheels: [wheel(), wheel(), wheel(), wheel()],
  };
  const puffs: TyreSmokePuff[] = [];
  const system = new VehicleTyreSmokeSystem(
    () => state.car,
    {
      getLinvel: (): [number, number, number] => state.linvel,
      readVehicleWheels: (): readonly VehicleWheelReading[] => state.wheels,
      readVehicleWheelSlip: (): null | readonly VehicleWheelSlip[] => state.slips,
      wheelContactPoint: (): [number, number, number] => [10, 20, 30],
    },
    (puff) => puffs.push(puff),
    dials,
    () => state.enabled,
  );

  return {
    puffs,
    run: (steps: number): void => {
      for (let index = 0; index < steps; index += 1) {
        system.fixedUpdate(STEP);
      }
    },
    state,
  };
}

const totalCount = (puffs: readonly TyreSmokePuff[]): number => puffs.reduce((sum, puff) => sum + puff.count, 0);

describe('VehicleTyreSmokeSystem', () => {
  describe('negative cases', () => {
    it('does nothing on foot', () => {
      const h = harness();
      h.state.car = null;
      h.state.linvel = [30, 0, 0];

      h.run(120);

      expect(h.puffs).toEqual([]);
    });

    it('does nothing while the effects gate is off', () => {
      const h = harness();
      h.state.enabled = false;
      h.state.linvel = [30, 0, 0]; // a huge lateral slide, gate closed

      h.run(120);

      expect(h.puffs).toEqual([]);
    });

    it('does nothing before any controls were ever applied (no slip record)', () => {
      const h = harness();
      h.state.slips = null;
      h.state.linvel = [30, 0, 0];

      h.run(120);

      expect(h.puffs).toEqual([]);
    });

    it('a gripping tyre rolling fast never smokes — speed alone is not slide', () => {
      const h = harness();
      h.state.linvel = [0, 40, 0]; // 144 km/h dead ahead, every wheel inside its cap

      h.run(120);

      expect(h.puffs).toEqual([]);
    });

    it('a slide below the start dial stays silent', () => {
      const h = harness();
      h.state.linvel = [3.5, 0, 0]; // 3.5 m/s of lateral drift — an ordinary corner, under slideStart 4

      h.run(120);

      expect(h.puffs).toEqual([]);
    });

    it('a wheelspin surplus at cruising speed stays silent — gear-shift demand spikes are not burnouts', () => {
      const h = harness();
      h.state.slips = h.state.slips!.map(() => ({ brakeExcess: 0, spinExcess: 1 })); // full surplus…
      h.state.linvel = [0, 20, 0]; // …but at 72 km/h — past the spin fade

      h.run(120);

      expect(h.puffs).toEqual([]);
    });

    it('a full pedal that only RIDES the cap stays silent — ABS-shaped stops are not skids', () => {
      const h = harness();
      h.state.slips = h.state.slips!.map(() => ({ brakeExcess: 0.2, spinExcess: 0 })); // under the deadzone
      h.state.linvel = [0, 30, 0];

      h.run(120);

      expect(h.puffs).toEqual([]);
    });

    it('a full-throttle pull-away that grips stays silent — low gears demand past the cap every launch', () => {
      const h = harness();
      // A modest surplus while already rolling: the ramp and the speed fade keep it under slideStart.
      h.state.slips = h.state.slips!.map(() => ({ brakeExcess: 0, spinExcess: 0.6 }));
      h.state.linvel = [0, 5, 0];

      h.run(120);

      expect(h.puffs).toEqual([]);
    });

    it('locked brakes at STANDSTILL do not smoke — the patch is not moving over the road', () => {
      const h = harness();
      h.state.slips = [gripping(), gripping(), { brakeExcess: 1, spinExcess: 0 }, { brakeExcess: 1, spinExcess: 0 }];
      h.state.linvel = [0, 0, 0]; // parked with the lever up

      h.run(120);

      expect(h.puffs).toEqual([]);
    });

    it('an airborne wheel never smokes, whatever its slip record says', () => {
      const h = harness();
      h.state.slips = h.state.slips!.map(() => ({ brakeExcess: 1, spinExcess: 1 }));
      h.state.linvel = [0, 30, 0];
      for (const w of h.state.wheels) {
        w.contact = false;
      }

      h.run(120);

      expect(h.puffs).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('brake demand past the cap at speed smokes at the contact point', () => {
      const h = harness();
      h.state.slips = h.state.slips!.map(() => ({ brakeExcess: 2, spinExcess: 0 })); // pedal well past the tyre
      h.state.linvel = [0, 10, 0];

      h.run(60);

      // Past the deadzone in full: slide = 10 → intensity (10 − 4)/8 = 0.75 → 6 × 0.75 = 4.5/s per wheel.
      expect(totalCount(h.puffs)).toBeGreaterThanOrEqual(12);
      expect(totalCount(h.puffs)).toBeLessThanOrEqual(20);
      for (const puff of h.puffs) {
        expect(puff.position).toEqual([10, 20, 30]);
        expect(puff.intensity).toBeCloseTo(0.75, 2);
      }
    });

    it('the handbrake (brakeExcess 1) smokes the rear while the car still moves', () => {
      const h = harness();
      h.state.slips = [gripping(), gripping(), { brakeExcess: 1, spinExcess: 0 }, { brakeExcess: 1, spinExcess: 0 }];
      h.state.linvel = [0, 15, 0];

      h.run(60);

      expect(totalCount(h.puffs)).toBeGreaterThan(0);
      expect(h.puffs.every((puff) => puff.intensity === 1)).toBe(true); // slide 15 ≥ slideFull 12
    });

    it('a standstill burnout smokes through the wheelspin surplus', () => {
      const h = harness();
      h.state.slips = [gripping(), gripping(), { brakeExcess: 0, spinExcess: 1 }, { brakeExcess: 0, spinExcess: 1 }];
      h.state.linvel = [0, 0, 0];

      h.run(60);

      // A FULL surplus at standstill (no spin fade): slide = SPIN_TO_SLIDE 7 → intensity (7 − 4)/8 = 0.375.
      expect(totalCount(h.puffs)).toBeGreaterThan(0);
      expect(h.puffs[0].intensity).toBeCloseTo(0.375, 2);
    });

    it('the launch keeps smoking while the car is still slow — the fade must not close the window at once', () => {
      const h = harness();
      h.state.slips = [gripping(), gripping(), { brakeExcess: 0, spinExcess: 1 }, { brakeExcess: 0, spinExcess: 1 }];
      h.state.linvel = [0, 3, 0]; // already rolling at 3 m/s, wheels still lit

      h.run(120);

      expect(totalCount(h.puffs)).toBeGreaterThan(0);
    });

    it('a pure lateral slide (the drift) smokes with no longitudinal excess at all', () => {
      const h = harness();
      h.state.linvel = [8, 0, 0];

      h.run(60);

      expect(totalCount(h.puffs)).toBeGreaterThan(0);
      expect(h.puffs[0].intensity).toBeCloseTo(0.5, 2); // slide 8 → (8 − 4)/8
    });

    it('harder slides make more particles — the rate follows the intensity', () => {
      const gentle = harness();
      gentle.state.linvel = [6, 0, 0];
      gentle.run(120);

      const hard = harness();
      hard.state.linvel = [12, 0, 0];
      hard.run(120);

      expect(totalCount(hard.puffs)).toBeGreaterThan(totalCount(gentle.puffs));
    });
  });
});
