import { describe, expect, it } from 'vitest';

import type { SurfaceRecord } from '../interfaces/world-adapter.interface';
import type { VehicleController, VehicleWheelReading, VehicleWheelSlip } from '../physics/physics-world';
import type { SurfaceFxClass, SurfaceFxPuff } from './vehicle-surface-fx.system';
import type { TyreSmokeCar } from './vehicle-tyre-smoke.system';

import { surfaceFxClassOf, VehicleSurfaceFxSystem } from './vehicle-surface-fx.system';

const STEP = 1 / 60;

/** Surface ids the fake table understands. */
const TARMAC = 0;
const DIRT = 1;
const BEACH = 2;
const BOG = 3;

const CLASSES: Record<number, null | SurfaceFxClass> = {
  [BEACH]: 'sand',
  [BOG]: 'mud',
  [DIRT]: 'dust',
  [TARMAC]: null,
};

type MutableWheel = { -readonly [K in keyof VehicleWheelReading]: VehicleWheelReading[K] };

/** A surfinfo row with every wheel flag off, overridable per test. */
function record(overrides: Partial<SurfaceRecord> = {}): SurfaceRecord {
  return {
    adhesionGroup: 'road',
    name: 'tarmac',
    skidmark: 'default',
    tyreGrip: 1,
    wetGrip: 0,
    wheelDust: false,
    wheelGrass: false,
    wheelGravel: false,
    wheelMud: false,
    wheelSand: false,
    wheelSpray: false,
    ...overrides,
  };
}

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

const gripping = (): VehicleWheelSlip => ({ brakeExcess: 0, spinExcess: 0 });

/** Identity orientation: forward = +Y, lateral = +X. All four wheels share one surface id. */
function harness(): {
  puffs: SurfaceFxPuff[];
  run: (steps: number) => void;
  state: {
    car: null | TyreSmokeCar;
    enabled: boolean;
    linvel: [number, number, number];
    slips: null | VehicleWheelSlip[];
    surface: null | number;
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
    slips: [gripping(), gripping(), gripping(), gripping()] as null | VehicleWheelSlip[],
    surface: DIRT as null | number,
    wheels: [wheel(), wheel(), wheel(), wheel()],
  };
  const puffs: SurfaceFxPuff[] = [];
  const system = new VehicleSurfaceFxSystem(
    () => state.car,
    {
      getLinvel: (): [number, number, number] => state.linvel,
      readVehicleWheels: (): readonly VehicleWheelReading[] => state.wheels,
      readVehicleWheelSlip: (): null | readonly VehicleWheelSlip[] => state.slips,
      readVehicleWheelSurfaces: (): readonly (null | number)[] => state.wheels.map(() => state.surface),
      wheelContactPoint: (): [number, number, number] => [10, 20, 30],
    },
    (surface) => (surface === null ? null : (CLASSES[surface] ?? null)),
    (puff) => puffs.push(puff),
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

const totalCount = (puffs: readonly SurfaceFxPuff[]): number => puffs.reduce((sum, puff) => sum + puff.count, 0);

describe('surfaceFxClassOf', () => {
  describe('negative cases', () => {
    it('REAL tarmac maps to nothing — its wheelSpray flag is wetness-gated in SA, and we track no wetness', () => {
      // The field bug: default and every tarmac* row carry W_SPRAY, and reading it unconditionally
      // sprayed every road ("white snowflakes on asphalt").
      expect(surfaceFxClassOf(record({ wheelSpray: true }))).toBeNull();
    });

    it('a missing row maps to nothing', () => {
      expect(surfaceFxClassOf(undefined)).toBeNull();
    });

    it('a row with no wheel flags maps to nothing', () => {
      expect(surfaceFxClassOf(record())).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('each W_ flag picks its class', () => {
      expect(surfaceFxClassOf(record({ wheelDust: true }))).toBe('dust');
      expect(surfaceFxClassOf(record({ wheelGrass: true }))).toBe('grass');
      expect(surfaceFxClassOf(record({ wheelGravel: true }))).toBe('gravel');
      expect(surfaceFxClassOf(record({ wheelMud: true }))).toBe('mud');
      expect(surfaceFxClassOf(record({ wheelSand: true }))).toBe('sand');
    });
  });
});

describe('VehicleSurfaceFxSystem', () => {
  describe('negative cases', () => {
    it('does nothing on foot', () => {
      const h = harness();
      h.state.car = null;
      h.state.linvel = [0, 20, 0];

      h.run(120);

      expect(h.puffs).toEqual([]);
    });

    it('does nothing while the effects gate is off', () => {
      const h = harness();
      h.state.enabled = false;
      h.state.linvel = [0, 20, 0];

      h.run(120);

      expect(h.puffs).toEqual([]);
    });

    it('tarmac throws nothing at any speed — no W_ flag, no effect', () => {
      const h = harness();
      h.state.surface = TARMAC;
      h.state.linvel = [0, 40, 0];

      h.run(120);

      expect(h.puffs).toEqual([]);
    });

    it('a wheel in the air throws nothing, whatever it hangs over', () => {
      const h = harness();
      h.state.linvel = [0, 20, 0];
      for (const w of h.state.wheels) {
        w.contact = false;
      }

      h.run(120);

      expect(h.puffs).toEqual([]);
    });

    it('crawling over a flagged surface stays silent — the throw starts with speed', () => {
      const h = harness();
      h.state.linvel = [0, 3, 0]; // under DRIVE_START 4

      h.run(120);

      expect(h.puffs).toEqual([]);
    });

    it('an unknown surface id (no table row) throws nothing', () => {
      const h = harness();
      h.state.surface = 99;
      h.state.linvel = [0, 20, 0];

      h.run(120);

      expect(h.puffs).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('rolling fast on dirt dusts with NO slide at all, at the contact point', () => {
      const h = harness();
      h.state.linvel = [0, 20, 0]; // full drive term, zero slide

      h.run(60);

      expect(totalCount(h.puffs)).toBeGreaterThan(0);
      for (const puff of h.puffs) {
        expect(puff.fx).toBe('dust');
        expect(puff.position).toEqual([10, 20, 30]);
        expect(puff.intensity).toBe(1); // 20 m/s = DRIVE_FULL
      }
    });

    it('the surface picks the class: beach throws sand, a bog throws mud', () => {
      const sand = harness();
      sand.state.surface = BEACH;
      sand.state.linvel = [0, 15, 0];
      sand.run(60);

      const mud = harness();
      mud.state.surface = BOG;
      mud.state.linvel = [0, 15, 0];
      mud.run(60);

      expect(sand.puffs.every((puff) => puff.fx === 'sand')).toBe(true);
      expect(mud.puffs.every((puff) => puff.fx === 'mud')).toBe(true);
      expect(sand.puffs.length).toBeGreaterThan(0);
      expect(mud.puffs.length).toBeGreaterThan(0);
    });

    it('a slide on the surface throws harder than rolling at the same speed', () => {
      const rolling = harness();
      rolling.state.linvel = [0, 8, 0];
      rolling.run(120);

      const sliding = harness();
      sliding.state.linvel = [8, 0, 0]; // the same 8 m/s, but sideways — slide counts double
      sliding.run(120);

      expect(totalCount(sliding.puffs)).toBeGreaterThan(totalCount(rolling.puffs));
    });
  });
});
