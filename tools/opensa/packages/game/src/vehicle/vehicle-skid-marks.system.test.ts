import { describe, expect, it } from 'vitest';

import type { VehicleController, VehicleWheelReading, VehicleWheelSlip } from '../physics/physics-world';
import type { SkidSegmentSample } from './vehicle-skid-marks.system';
import type { TyreSmokeCar } from './vehicle-tyre-smoke.system';

import { VehicleSkidMarkSystem } from './vehicle-skid-marks.system';

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

/** Identity orientation: forward = +Y, lateral = +X. All four wheels report the shared `point`. */
function harness(): {
  advance: (dx: number, steps?: number) => void;
  segments: SkidSegmentSample[];
  state: {
    car: null | TyreSmokeCar;
    enabled: boolean;
    linvel: [number, number, number];
    point: [number, number, number];
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
    point: [100, 200, 5] as [number, number, number],
    slips: [gripping(), gripping(), gripping(), gripping()] as null | { brakeExcess: number; spinExcess: number }[],
    wheels: [wheel(), wheel(), wheel(), wheel()],
  };
  const segments: SkidSegmentSample[] = [];
  const system = new VehicleSkidMarkSystem(
    () => state.car,
    {
      getLinvel: (): [number, number, number] => state.linvel,
      readVehicleWheels: (): readonly VehicleWheelReading[] => state.wheels,
      readVehicleWheelSlip: (): null | readonly VehicleWheelSlip[] => state.slips,
      wheelContactPoint: (): [number, number, number] => [...state.point],
    },
    (segment) => segments.push(segment),
    () => state.enabled,
  );

  return {
    advance: (dx: number, steps = 1): void => {
      for (let index = 0; index < steps; index += 1) {
        state.point[0] += dx;
        system.fixedUpdate();
      }
    },
    segments,
    state,
  };
}

/** Only wheel 0's ribbon (all four report the same point, so per-wheel streams are interleaved ×4). */
const perWheel = (segments: readonly SkidSegmentSample[]): SkidSegmentSample[] =>
  segments.filter((_, index) => index % 4 === 0);

describe('VehicleSkidMarkSystem', () => {
  describe('negative cases', () => {
    it('lays nothing on foot', () => {
      const h = harness();
      h.state.car = null;
      h.state.linvel = [10, 0, 0];

      h.advance(0.5, 10);

      expect(h.segments).toEqual([]);
    });

    it('lays nothing while the effects gate is off', () => {
      const h = harness();
      h.state.enabled = false;
      h.state.linvel = [10, 0, 0];

      h.advance(0.5, 10);

      expect(h.segments).toEqual([]);
    });

    it('a gripping car marks nothing, however far it travels', () => {
      const h = harness();
      h.state.linvel = [0, 30, 0]; // fast, dead ahead, everything inside its cap

      h.advance(0.5, 20);

      expect(h.segments).toEqual([]);
    });

    it('movement below the minimum segment length lays nothing yet', () => {
      const h = harness();
      h.state.linvel = [10, 0, 0];

      h.advance(0.1, 2); // anchor + 0.2 m — under the 0.3 m minimum

      expect(h.segments).toEqual([]);
    });

    it('airborne wheels break the ribbon instead of drawing through the air', () => {
      const h = harness();
      h.state.linvel = [10, 0, 0];
      for (const w of h.state.wheels) {
        w.contact = false;
      }

      h.advance(0.5, 10);

      expect(h.segments).toEqual([]);
    });

    it('a teleport-sized jump restarts the ribbon rather than laying a road-length quad', () => {
      const h = harness();
      h.state.linvel = [10, 0, 0];
      h.advance(0.5, 3); // a live ribbon

      const laid = h.segments.length;
      h.advance(10); // the jump — no segment may span it

      expect(h.segments.length).toBe(laid);
    });
  });

  describe('positive cases', () => {
    it('grows in from a fully transparent start', () => {
      const h = harness();
      h.state.linvel = [8, 0, 0]; // slide 8 → intensity 0.5

      h.advance(0.5, 2); // step 1 anchors, step 2 lays the first segment

      const first = perWheel(h.segments)[0];
      expect(first.alpha0).toBe(0); // the brief: transparent at the ribbon's start
      // Full darkness for intensity 0.5 is 0.25 + 0.6 × 0.5 = 0.55; the first segment carries 1/3 of it.
      expect(first.alpha1).toBeCloseTo(0.55 / 3, 3);
    });

    it('ramps to full darkness over three segments and stays there', () => {
      const h = harness();
      h.state.linvel = [8, 0, 0];

      h.advance(0.5, 5);

      const marks = perWheel(h.segments);
      expect(marks.length).toBe(4);
      expect(marks[2].alpha1).toBeCloseTo(0.55, 3); // segment 3 = ramp complete
      expect(marks[3].alpha1).toBeCloseTo(0.55, 3);
    });

    it('a harder slide lays a darker mark', () => {
      const gentle = harness();
      gentle.state.linvel = [8, 0, 0]; // intensity 0.5
      gentle.advance(0.5, 5);

      const hard = harness();
      hard.state.linvel = [16, 0, 0]; // intensity 1
      hard.advance(0.5, 5);

      expect(perWheel(hard.segments)[3].alpha1).toBeCloseTo(0.85, 3); // 0.25 + 0.6 × 1
      expect(perWheel(hard.segments)[3].alpha1).toBeGreaterThan(perWheel(gentle.segments)[3].alpha1);
    });

    it('segments share edges — a ribbon is seamless', () => {
      const h = harness();
      h.state.linvel = [8, 0, 0];

      h.advance(0.5, 4);

      const marks = perWheel(h.segments);
      expect(marks[1].left0).toEqual(marks[0].left1);
      expect(marks[1].right0).toEqual(marks[0].right1);
      expect(marks[1].v0).toBe(marks[0].v1);
    });

    it('the along-ribbon texture coordinate accumulates with distance', () => {
      const h = harness();
      h.state.linvel = [8, 0, 0];

      h.advance(0.5, 3);

      const marks = perWheel(h.segments);
      expect(marks[0].v0).toBe(0);
      expect(marks[0].v1).toBeCloseTo(0.5, 3);
      expect(marks[1].v1).toBeCloseTo(1, 3);
    });

    it('the mark lies across the path, lifted off the road', () => {
      const h = harness();
      h.state.linvel = [8, 0, 0]; // the path advances along +X, so the width axis is Y

      h.advance(0.5, 2);

      const first = perWheel(h.segments)[0];
      expect(first.left1[1]).toBeCloseTo(200 - 0.12, 3);
      expect(first.right1[1]).toBeCloseTo(200 + 0.12, 3);
      expect(first.left1[2]).toBeCloseTo(5.02, 3); // + LIFT off the surface
    });
  });
});
