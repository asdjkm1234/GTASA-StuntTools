import { Matrix4 } from '@opensa/math';
import { describe, expect, it } from 'vitest';

import type { ColliderShape, ModelColliders } from '../interfaces/collider.interface';
import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { VehicleController, VehicleMassProperties } from './physics-world';

import { PhysicsWorld } from './physics-world';
import { initRapier } from './rapier';

const STEP = 1 / 60;

async function makeWorld(): Promise<PhysicsWorld> {
  return new PhysicsWorld(await initRapier());
}

function model(colliderShape: ColliderShape, transforms: Matrix4[]): ModelColliders {
  return { name: 'm', shape: colliderShape, transforms };
}

function shape(partial: Partial<ColliderShape> = {}): ColliderShape {
  return { boxes: [], indices: new Uint32Array(), spheres: [], vertices: new Float32Array(), ...partial };
}

describe('PhysicsWorld', () => {
  describe('positive cases', () => {
    it('drops a dynamic box under gravity until it rests on a static ground', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [10, 10, 0.5]); // top surface at z = 0.5
      const box = physics.createBox([0, 0, 5], [0.5, 0.5, 0.5]);

      for (let i = 0; i < 240; i += 1) {
        physics.step(STEP);
      }

      // rests with its centre at ground-top (0.5) + half-height (0.5) = 1.0
      expect(physics.readBody(box).position[2]).toBeCloseTo(1, 1);
      physics.dispose();
    });

    it('reports the body falling before it lands', async () => {
      const physics = await makeWorld();
      const box = physics.createBox([0, 0, 5], [0.5, 0.5, 0.5]); // no ground

      physics.step(STEP);
      const { position } = physics.readBody(box);

      expect(position[2]).toBeLessThan(5);
      expect(position[0]).toBe(0);
      physics.dispose();
    });
  });
});

describe('PhysicsWorld.groundBelow', () => {
  describe('negative cases', () => {
    it('returns null when nothing is below within maxDrop', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [10, 10, 0.5]); // top at z = 0.5
      physics.step(STEP); // build the query pipeline so the ray sees the ground

      expect(physics.groundBelow([0, 0, 5], 2)).toBeNull(); // ground is 4.5 below, beyond maxDrop 2
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('finds the Z of the ground directly below the position', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [10, 10, 0.5]); // top surface at z = 0.5
      physics.step(STEP);

      expect(physics.groundBelow([0, 0, 10], 100)).toBeCloseTo(0.5, 3);
      physics.dispose();
    });

    it('excludeBody skips the caster so a ray can start inside its own capsule (074/10 B3 feet ray)', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [10, 10, 0.5]); // top surface at z = 0.5
      const capsule = physics.createKinematicCapsule([0, 0, 1.4], 0.35, 0.55); // resting on the ground
      physics.step(STEP);

      // From inside the capsule: without the exclusion the ray reports the capsule itself (its own
      // surface right at the origin); with it, the true ground below.
      expect(physics.groundBelow([0, 0, 1.4], 5)).toBeCloseTo(1.4, 2);
      expect(physics.groundBelow([0, 0, 1.4], 5, capsule.body)).toBeCloseTo(0.5, 3);
      physics.dispose();
    });
  });
});

describe('PhysicsWorld.raycast', () => {
  describe('negative cases', () => {
    it('returns null when nothing is hit within maxDist', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([10, 0, 0], [0.5, 10, 10]); // a wall at x = 10
      physics.step(STEP);

      expect(physics.raycast([0, 0, 0], [1, 0, 0], 5)).toBeNull(); // wall face is 9.5 away, beyond 5
      physics.dispose();
    });

    it('returns null for a zero direction', async () => {
      const physics = await makeWorld();
      expect(physics.raycast([0, 0, 0], [0, 0, 0], 5)).toBeNull();
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('reports the distance to the first solid hit', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([10, 0, 0], [0.5, 10, 10]); // near face at x = 9.5
      physics.step(STEP);

      expect(physics.raycast([0, 0, 0], [1, 0, 0], 20)?.dist).toBeCloseTo(9.5, 3);
      physics.dispose();
    });

    it('excludes a body so the camera never collides with its own subject', async () => {
      const physics = await makeWorld();
      const capsule = physics.createKinematicCapsule([2, 0, 0], 0.35, 0.55);
      physics.createStaticBox([10, 0, 0], [0.5, 10, 10]); // wall behind the capsule
      physics.step(STEP);

      // The capsule sits 2 m ahead; excluded, the ray reaches the wall at 9.5.
      expect(physics.raycast([0, 0, 0], [1, 0, 0], 20)?.dist).toBeLessThan(3);
      expect(physics.raycast([0, 0, 0], [1, 0, 0], 20, capsule.body)?.dist).toBeCloseTo(9.5, 3);
      physics.dispose();
    });
  });
});

describe('PhysicsWorld.sphereCast', () => {
  describe('negative cases', () => {
    it('returns null when the swept ball hits nothing within maxDist', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([10, 0, 0], [0.5, 10, 10]);
      physics.step(STEP);

      expect(physics.sphereCast([0, 0, 0], [1, 0, 0], 0.3, 5)).toBeNull();
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('stops the eye radius-short of the wall (the near plane never clips through)', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([10, 0, 0], [0.5, 10, 10]); // near face at x = 9.5
      physics.step(STEP);

      // A zero-width ray would report 9.5; the 0.3 ball stops 0.3 short of it.
      expect(physics.sphereCast([0, 0, 0], [1, 0, 0], 0.3, 20)?.dist).toBeCloseTo(9.2, 2);
      physics.dispose();
    });

    it('excludes the subject body', async () => {
      const physics = await makeWorld();
      const capsule = physics.createKinematicCapsule([2, 0, 0], 0.35, 0.55);
      physics.createStaticBox([10, 0, 0], [0.5, 10, 10]);
      physics.step(STEP);

      expect(physics.sphereCast([0, 0, 0], [1, 0, 0], 0.3, 20, capsule.body)?.dist).toBeCloseTo(9.2, 2);
      physics.dispose();
    });

    it('reports whether the hit can MOVE — a kinematic body is dynamic, world geometry is not (080/09 §4.2)', async () => {
      const physics = await makeWorld();
      physics.createKinematicCapsule([5, 0, 0], 0.35, 0.55);
      physics.createStaticBox([10, 0, 0], [0.5, 10, 10]);
      physics.step(STEP);

      // The capsule sits first along the cast (a ped crossing the camera line); the wall is the world.
      expect(physics.sphereCast([0, 0, 0], [1, 0, 0], 0.3, 20)?.dynamic).toBe(true);
      expect(physics.sphereCast([0, 2, 0], [1, 0, 0], 0.3, 20)?.dynamic).toBe(false);
      physics.dispose();
    });
  });
});

/** Authored mass properties for a test car (plan 081/02) — mass only unless a test cares about the rest. */
function massProps(over: Partial<VehicleMassProperties> = {}): VehicleMassProperties {
  return {
    centreOfMass: [0, 0, 0],
    mass: 1500,
    suspension: { bias: 0.5, damping: 0.15, force: 1.1, restLength: 0.15, travel: 0.25 },
    traction: { bias: 0.5, loss: 0.8, mult: 0.7 },
    turnMass: 3000,
    ...over,
  };
}

describe('PhysicsWorld.createDynamicVehicle', () => {
  const HALF: [number, number, number] = [1.2, 2.5, 0.7];

  describe('negative cases', () => {
    it('does not crash when the model has no COL (null shape) — falls back to the halfExtents box', async () => {
      const physics = await makeWorld();
      expect(() => physics.createDynamicVehicle([0, 0, 5], 0, null, massProps(), [], HALF)).not.toThrow();
      physics.dispose();
    });

    it('does not crash for a shape with no primitives and no vertices', async () => {
      const physics = await makeWorld();
      expect(() => physics.createDynamicVehicle([0, 0, 5], 0, shape(), massProps(), [], HALF)).not.toThrow();
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('takes its centre of mass from the AUTHORED value, not from where the COL boxes sit (081/02)', async () => {
      // A car whose collision is a low floor pan plus a HIGH cabin box. The old rule shared the mass equally
      // per primitive, so the centre of mass came out at the mean of their centres — high, and wherever the
      // modeller happened to leave it. The same shape must now hang from whatever handling.cfg authored.
      const physics = await makeWorld();
      const cabin = shape({
        boxes: [
          { max: [1, 2, -0.2], min: [-1, -2, -0.6] }, // floor pan, low
          { max: [0.9, 0.5, 1.4], min: [-0.9, -1, 0.2] }, // cabin, high — this used to dominate
        ],
      });
      const low = physics.createDynamicVehicle(
        [0, 0, 5],
        0,
        cabin,
        massProps({ centreOfMass: [0, 0, -0.4] }),
        [],
        HALF,
      );
      const high = physics.createDynamicVehicle(
        [9, 0, 5],
        0,
        cabin,
        massProps({ centreOfMass: [0, 0, 1.2] }),
        [],
        HALF,
      );

      physics.step(1 / 60);

      // World COM = spawn position + the authored offset (no rotation at heading 0), minus the little the
      // step itself moved it under gravity.
      expect(physics.readMassProperties(low.body).centreOfMass[2]).toBeCloseTo(4.6, 2);
      expect(physics.readMassProperties(high.body).centreOfMass[2]).toBeCloseTo(6.2, 2);
      // And the mass is the authored total, not the sum of what the primitives implied.
      expect(physics.readMassProperties(low.body).mass).toBeCloseTo(1500, 5);
      physics.dispose();
    });

    it('is born carrying its authored mass, so a car spawned BETWEEN steps is never solved massless', async () => {
      // Rapier folds a descriptor's mass properties in at the next `world.step`, and our step updates the
      // raycast controllers BEFORE stepping the world — so without the recompute at creation, every car
      // spawned by streaming (which is every car in a moving world) had its first suspension solved against
      // a body of mass 0 and zero inertia. That returns NaN, and the NaN panics Rapier's own tree walk with
      // a bare wasm `unreachable` that poisons the world for the rest of the session
      // (`docs/open-issues/fixed/map-car-generators-poison-physics.md`).
      const physics = await makeWorld();
      const born = physics.createDynamicVehicle([0, 0, 5], 0, null, massProps(), [], HALF);

      expect(physics.readMassProperties(born.body).mass).toBeCloseTo(1500, 5);

      physics.step(STEP);
      const afterAStep = physics.createDynamicVehicle([9, 0, 5], 0, null, massProps(), [], HALF);

      expect(physics.readMassProperties(afterAStep.body).mass).toBeCloseTo(1500, 5);
      physics.dispose();
    });

    it('builds a convex hull from a vertices-only shape and rests it on the ground', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [20, 20, 0.5]); // top surface at z = 0.5
      // eight corners of a 1m cube → a valid convex hull (half-height 0.5)
      const cube = new Float32Array([
        -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5,
        0.5, 0.5, 0.5, 0.5,
      ]);
      const { body } = physics.createDynamicVehicle([0, 0, 5], 0, shape({ vertices: cube }), massProps(), [], HALF);

      for (let i = 0; i < 240; i += 1) {
        physics.step(STEP);
      }

      expect(physics.readBody(body).position[2]).toBeCloseTo(1, 0); // ground-top 0.5 + half-height 0.5
      physics.dispose();
    });
  });
});

describe('PhysicsWorld.sphereCast — the second exclusion', () => {
  describe('negative cases', () => {
    it('still reports a body that is NOT excluded', async () => {
      const physics = await makeWorld();
      const wall = physics.createStaticBox([0, 10, 0], [5, 0.5, 5]); // near face at y = 9.5
      physics.step(STEP); // build the query pipeline so the cast sees it

      expect(physics.sphereCast([0, 0, 0], [0, 1, 0], 0.3, 30)?.dist).toBeCloseTo(9.2, 1);
      physics.dispose();
      expect(wall).toBeGreaterThanOrEqual(0);
    });
  });

  describe('positive cases', () => {
    it('ignores BOTH bodies — the framed subject and the car the player just left', async () => {
      const physics = await makeWorld();
      // Two walls in line: the near one is the "car" (excluded second), the far one is real geometry.
      const car = physics.createStaticBox([0, 4, 0], [5, 0.5, 5]);
      physics.createStaticBox([0, 12, 0], [5, 0.5, 5]);
      // The subject sits at the cast origin and must always be excluded — that is why one exclusion was
      // never enough (plan 080/06 field round 2).
      const subject = physics.createBox([0, 0, 0], [0.4, 0.4, 0.4]);
      physics.step(STEP);

      const near = physics.sphereCast([0, 0, 0], [0, 1, 0], 0.3, 30, subject);
      const far = physics.sphereCast([0, 0, 0], [0, 1, 0], 0.3, 30, subject, car);

      expect(near?.dist).toBeCloseTo(3.2, 1); // stopped by the "car"
      expect(far?.dist).toBeCloseTo(11.2, 1); // straight past it to the real wall
      physics.dispose();
    });
  });
});

describe('PhysicsWorld.readVehicleWheelSurfaces', () => {
  const HALF: [number, number, number] = [1.2, 2.5, 0.7];
  const WHEELS = [
    { connection: [-0.8, 1.4, -0.5] as Vec3, front: true, radius: 0.35 },
    { connection: [0.8, 1.4, -0.5] as Vec3, front: true, radius: 0.35 },
    { connection: [-0.8, -1.4, -0.5] as Vec3, front: false, radius: 0.35 },
    { connection: [0.8, -1.4, -0.5] as Vec3, front: false, radius: 0.35 },
  ];
  /** Ground of one material, wide enough for the whole car to stand on. */
  const groundOf = (material: number): ColliderShape =>
    shape({ boxes: [{ material, max: [20, 20, 0.5], min: [-20, -20, -0.5] }] });

  describe('negative cases', () => {
    it('reports null under every wheel of a car in mid-air', async () => {
      const physics = await makeWorld();
      const { body, controller } = physics.createDynamicVehicle([0, 0, 50], 0, null, massProps(), WHEELS, HALF);
      physics.step(STEP);

      expect(physics.readVehicleWheelSurfaces(controller, body)).toEqual([null, null, null, null]);
      physics.dispose();
    });

    it('reports null on ground whose collision carries no material — unknown, not surface 0', async () => {
      const physics = await makeWorld();
      physics.createStaticColliders([
        model(shape({ boxes: [{ max: [20, 20, 0.5], min: [-20, -20, -0.5] }] }), [new Matrix4()]),
      ]);
      const { body, controller } = physics.createDynamicVehicle([0, 0, 2], 0, null, massProps(), WHEELS, HALF);
      for (let i = 0; i < 120; i += 1) {
        physics.step(STEP);
      }

      expect(physics.readVehicleWheelSurfaces(controller, body).every((surface) => surface === null)).toBe(true);
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('reports the surface each wheel is resting on', async () => {
      const physics = await makeWorld();
      physics.createStaticColliders([model(groundOf(27), [new Matrix4()])]); // 27 = dirttrack
      const { body, controller } = physics.createDynamicVehicle([0, 0, 2], 0, null, massProps(), WHEELS, HALF);
      for (let i = 0; i < 120; i += 1) {
        physics.step(STEP);
      }

      const surfaces = physics.readVehicleWheelSurfaces(controller, body);

      expect(surfaces).toHaveLength(4);
      expect(surfaces.every((surface) => surface === 27)).toBe(true);
      physics.dispose();
    });

    it('tells the wheels apart when the car straddles two surfaces', async () => {
      const physics = await makeWorld();
      // Tarmac to the car's left (−X), sand to its right — the axle spans the join.
      physics.createStaticColliders([
        model(shape({ boxes: [{ material: 1, max: [0, 20, 0.5], min: [-20, -20, -0.5] }] }), [new Matrix4()]),
        model(shape({ boxes: [{ material: 33, max: [20, 20, 0.5], min: [0, -20, -0.5] }] }), [new Matrix4()]),
      ]);
      const { body, controller } = physics.createDynamicVehicle([0, 0, 2], 0, null, massProps(), WHEELS, HALF);
      for (let i = 0; i < 120; i += 1) {
        physics.step(STEP);
      }

      const surfaces = physics.readVehicleWheelSurfaces(controller, body);

      expect(surfaces[0]).toBe(1); // left front, x = −0.8
      expect(surfaces[1]).toBe(33); // right front, x = +0.8
      physics.dispose();
    });
  });
});

describe('PhysicsWorld.readVehicleWheels', () => {
  const HALF: [number, number, number] = [1.2, 2.5, 0.7];
  const WHEELS = [
    { connection: [-1, 1.6, -0.4] as Vec3, front: true, radius: 0.35 },
    { connection: [1, 1.6, -0.4] as Vec3, front: true, radius: 0.35 },
    { connection: [-1, -1.6, -0.4] as Vec3, front: false, radius: 0.35 },
    { connection: [1, -1.6, -0.4] as Vec3, front: false, radius: 0.35 },
  ];

  describe('negative cases', () => {
    it('reads no contact from a car dropped in mid-air, with the springs fully extended', async () => {
      const physics = await makeWorld();
      const { controller } = physics.createDynamicVehicle([0, 0, 50], 0, null, massProps(), WHEELS, HALF);
      physics.step(STEP);

      const wheels = physics.readVehicleWheels(controller);

      expect(wheels).toHaveLength(4);
      expect(wheels.every((wheel) => !wheel.contact)).toBe(true);
      expect(wheels[0].suspensionForce).toBe(0);
      physics.dispose();
    });

    it('gives both axles the same spring when the row authors a neutral bias', async () => {
      const physics = await makeWorld();
      const props = massProps({ suspension: { bias: 0.5, damping: 0.15, force: 1.1, restLength: 0.15, travel: 0.25 } });
      const { controller } = physics.createDynamicVehicle([0, 0, 50], 0, null, props, WHEELS, HALF);

      const springs = physics.readVehicleSprings(controller);

      expect(springs[0].stiffness).toBeCloseTo(springs[2].stiffness, 6);
      physics.dispose();
    });

    it('reports an empty reading for a controller with no wheels', async () => {
      const physics = await makeWorld();
      const { controller } = physics.createDynamicVehicle([0, 0, 5], 0, null, massProps(), [], HALF);

      expect(physics.readVehicleWheels(controller)).toEqual([]);
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('stiffens the axle its row leans on (fSuspensionBias)', async () => {
      const physics = await makeWorld();
      // 0.65 front: the original turns that into 2 × 0.65 on the front springs and 2 − 1.3 on the rear.
      const props = massProps({ suspension: { bias: 0.65, damping: 0.15, force: 2, restLength: 0.15, travel: 0.25 } });
      const { controller } = physics.createDynamicVehicle([0, 0, 50], 0, null, props, WHEELS, HALF);

      const springs = physics.readVehicleSprings(controller);

      expect(springs[0].stiffness).toBeCloseTo(springs[1].stiffness, 6); // same axle, same spring
      expect(springs[2].stiffness).toBeCloseTo(springs[3].stiffness, 6);
      expect(springs[0].stiffness / springs[2].stiffness).toBeCloseTo(1.3 / 0.7, 4);
      physics.dispose();
    });

    it('lets the bump stop catch the light axle of a soft, strongly biased row', async () => {
      const physics = await makeWorld();
      // The same bias on a SOFT row: the rear's own rate would sag past its travel, so the bump stop holds
      // it and the axles end up closer together than the bias asks. That is the floor doing its job, not the
      // bias failing — and it is why a car cannot be biased into sitting on its stops.
      const props = massProps({
        suspension: { bias: 0.65, damping: 0.15, force: 1.1, restLength: 0.15, travel: 0.25 },
      });
      const { controller } = physics.createDynamicVehicle([0, 0, 50], 0, null, props, WHEELS, HALF);

      const springs = physics.readVehicleSprings(controller);

      expect(springs[0].stiffness).toBeGreaterThan(springs[2].stiffness);
      expect(springs[0].stiffness / springs[2].stiffness).toBeLessThan(1.3 / 0.7);
      physics.dispose();
    });

    it('reads contact, a compressed spring and a real load off a car resting on the ground', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [40, 40, 0.5]);
      const { controller } = physics.createDynamicVehicle([0, 0, 2], 0, null, massProps(), WHEELS, HALF);
      for (let i = 0; i < 240; i += 1) {
        physics.step(STEP);
      }

      const wheels = physics.readVehicleWheels(controller);

      expect(wheels.every((wheel) => wheel.contact)).toBe(true);
      // Every corner carries part of the 1500 kg: the four loads must add up to roughly its weight.
      const load = wheels.reduce((total, wheel) => total + wheel.suspensionForce, 0);
      expect(load).toBeGreaterThan(1500 * 9.81 * 0.5);
      // Resting means compressed: shorter than the rest length the wheels were built with.
      expect(wheels[0].suspensionLength).toBeLessThan(wheels[0].restLength);
      expect(wheels[0].radius).toBeCloseTo(0.35, 6);
      expect(wheels[0].maxTravel).toBeGreaterThan(0);
      physics.dispose();
    });
  });
});

describe('PhysicsWorld kinematic character controller', () => {
  describe('positive cases', () => {
    it('lands a kinematic capsule on a static ground and reports grounded', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [10, 10, 0.5]); // top surface at z = 0.5
      const controller = physics.createCharacterController();
      const { body, collider } = physics.createKinematicCapsule([0, 0, 3], 0.3, 0.6);

      let grounded = false;
      for (let i = 0; i < 240; i += 1) {
        grounded = physics.moveCharacter(controller, body, collider, [0, 0, -0.05]).grounded;
        physics.step(STEP);
      }

      expect(grounded).toBe(true);
      // centre rests at ground-top (0.5) + capsule half-height (0.6 + radius 0.3) = 1.4
      expect(physics.readBody(body).position[2]).toBeCloseTo(1.4, 1);
      physics.dispose();
    });

    it('slides along a wall instead of penetrating it', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [10, 10, 0.5]); // ground
      physics.createStaticBox([2, 0, 1.5], [0.5, 5, 2]); // wall, front face at x = 1.5
      const controller = physics.createCharacterController();
      const { body, collider } = physics.createKinematicCapsule([0, 0, 1.4], 0.3, 0.6);

      for (let i = 0; i < 120; i += 1) {
        physics.moveCharacter(controller, body, collider, [0.1, 0, -0.02]); // push into the wall
        physics.step(STEP);
      }

      // stopped in front of the wall (front 1.5 − radius 0.3 − offset), never penetrating it
      expect(physics.readBody(body).position[0]).toBeLessThan(1.25);
      physics.dispose();
    });
  });
});

describe('PhysicsWorld.surfaceBelow', () => {
  /** Two triangles of ground, side by side in X, each with its own SA surface id. */
  const twoSurfaces = (materials: Uint8Array): ColliderShape =>
    shape({
      indices: new Uint32Array([0, 1, 2, 1, 3, 2]),
      materials,
      // A 4 m × 4 m quad from (−2,−2) to (2,2) at z = 0, split into two triangles along x = 0… the split
      // runs corner to corner, so the two halves are told apart by sampling well inside each.
      vertices: new Float32Array([-2, -2, 0, 2, -2, 0, -2, 2, 0, 2, 2, 0]),
    });

  describe('negative cases', () => {
    it('answers null where nothing is below', async () => {
      const physics = await makeWorld();

      expect(physics.surfaceBelow([0, 0, 5], 10)).toBeNull();
      physics.dispose();
    });

    it('answers null — UNKNOWN, not surface 0 — for collision that carries no materials', async () => {
      const physics = await makeWorld();
      physics.createStaticColliders([
        model(shape({ boxes: [{ max: [5, 5, 0.5], min: [-5, -5, -0.5] }] }), [new Matrix4()]),
      ]);
      physics.step(STEP); // a ray sees nothing until the world has stepped once

      expect(physics.surfaceBelow([0, 0, 5], 10)).toBeNull();
      physics.dispose();
    });

    it('forgets a cell surface when its body goes, so a recycled handle cannot answer for it', async () => {
      const physics = await makeWorld();
      const handles = physics.createStaticColliders([model(twoSurfaces(new Uint8Array([33, 33])), [new Matrix4()])]);
      physics.step(STEP);

      physics.removeBodies(handles);
      physics.step(STEP);

      expect(physics.surfaceBelow([0, 0, 5], 10)).toBeNull();
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('reads the surface of the TRIANGLE the ray hit, not of the model', async () => {
      const physics = await makeWorld();
      // 1 = tarmac, 33 = sand_beach in SA's table; the ids are opaque here, the point is they differ.
      physics.createStaticColliders([model(twoSurfaces(new Uint8Array([1, 33])), [new Matrix4()])]);
      physics.step(STEP);

      expect(physics.surfaceBelow([-1.5, -1.5, 5], 10)).toBe(1);
      expect(physics.surfaceBelow([1.5, 1.5, 5], 10)).toBe(33);
      physics.dispose();
    });

    // parry reports a back-face hit as `featureId + triangleCount`, and that is how every road in the game
    // is actually hit — measured in-game before this test existed.
    it('reads the surface through a triangle wound AWAY from the ray', async () => {
      const physics = await makeWorld();
      // The same quad as `twoSurfaces`, with each triangle's winding reversed.
      physics.createStaticColliders([
        model(
          shape({
            indices: new Uint32Array([2, 1, 0, 2, 3, 1]),
            materials: new Uint8Array([1, 33]),
            vertices: new Float32Array([-2, -2, 0, 2, -2, 0, -2, 2, 0, 2, 2, 0]),
          }),
          [new Matrix4()],
        ),
      ]);
      physics.step(STEP);

      expect(physics.surfaceBelow([-1.5, -1.5, 5], 10)).toBe(1);
      expect(physics.surfaceBelow([1.5, 1.5, 5], 10)).toBe(33);
      physics.dispose();
    });

    it('reads a box primitive own single surface', async () => {
      const physics = await makeWorld();
      const boxes = [
        { material: 26, max: [5, 5, 0.5] as [number, number, number], min: [-5, -5, -0.5] as [number, number, number] },
      ];
      physics.createStaticColliders([model(shape({ boxes }), [new Matrix4()])]);
      physics.step(STEP);

      expect(physics.surfaceBelow([0, 0, 5], 10)).toBe(26);
      physics.dispose();
    });
  });
});

describe('PhysicsWorld.createStaticColliders / removeBodies', () => {
  describe('negative cases', () => {
    it('creates no bodies for no models', async () => {
      const physics = await makeWorld();
      expect(physics.createStaticColliders([])).toHaveLength(0);
      physics.dispose();
    });

    it('creates no body for a placement with only degenerate shapes', async () => {
      const physics = await makeWorld();
      expect(physics.createStaticColliders([model(shape(), [new Matrix4()])])).toHaveLength(0);
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('returns one body handle per placement', async () => {
      const physics = await makeWorld();
      const colliderShape = shape({
        boxes: [{ max: [1, 1, 1], min: [-1, -1, -1] }],
        indices: new Uint32Array([0, 1, 2]),
        spheres: [{ center: [0, 0, 0], radius: 1 }],
        vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      });
      const transforms = [new Matrix4(), new Matrix4().makeTranslation(10, 0, 0)];

      // one body per placement (each carrying trimesh + box + sphere)
      expect(physics.createStaticColliders([model(colliderShape, transforms)])).toHaveLength(2);
      physics.dispose();
    });

    it('removeBodies frees the ground so a resting box falls again', async () => {
      const physics = await makeWorld();
      const ground = model(shape({ boxes: [{ max: [10, 10, 0.5], min: [-10, -10, -0.5] }] }), [new Matrix4()]);
      const handles = physics.createStaticColliders([ground]); // top surface at z = 0.5
      const box = physics.createBox([0, 0, 2], [0.5, 0.5, 0.5]);

      for (let i = 0; i < 180; i += 1) {
        physics.step(STEP);
      }
      expect(physics.readBody(box).position[2]).toBeCloseTo(1, 1); // rests on the ground

      physics.removeBodies(handles);
      for (let i = 0; i < 180; i += 1) {
        physics.step(STEP);
      }
      expect(physics.readBody(box).position[2]).toBeLessThan(0); // ground gone → falls through
      physics.dispose();
    });

    it('hands each breakable placement key back with the body that carries it (plan 045)', async () => {
      const physics = await makeWorld();
      const box = shape({ boxes: [{ max: [1, 1, 1], min: [-1, -1, -1] }] });
      const breakable: ModelColliders = {
        ...model(box, [new Matrix4(), new Matrix4().makeTranslation(5, 0, 0)]),
        instanceKeys: ['bin@0', 'bin@5'],
      };
      const seen: [string, number][] = [];

      const handles = physics.createStaticColliders([breakable], (key, handle) => seen.push([key, handle]));

      // key → handle, in placement order: a smashed prop must be able to drop exactly its own body.
      expect(seen).toEqual([
        ['bin@0', handles[0]],
        ['bin@5', handles[1]],
      ]);
      physics.dispose();
    });

    it('does not report a breakable key for a placement that produced no body', async () => {
      const physics = await makeWorld();
      const degenerate: ModelColliders = { ...model(shape(), [new Matrix4()]), instanceKeys: ['ghost@0'] };
      const seen: string[] = [];

      expect(physics.createStaticColliders([degenerate], (key) => seen.push(key))).toHaveLength(0);
      expect(seen).toEqual([]); // no body was kept, so no key may be registered against one
      physics.dispose();
    });
  });
});

describe('PhysicsWorld.census', () => {
  describe('negative cases', () => {
    it('counts nothing in a fresh world', async () => {
      const physics = await makeWorld();
      expect(physics.census()).toEqual({ bodies: 0, colliders: 0, vehicles: 0 });
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('counts every body and collider, and drops back after a removal', async () => {
      const physics = await makeWorld();
      const ground = physics.createStaticBox([0, 0, 0], [10, 10, 0.5]);
      physics.createBox([0, 0, 5], [0.5, 0.5, 0.5]);

      expect(physics.census()).toEqual({ bodies: 2, colliders: 2, vehicles: 0 });

      physics.removeBodies([ground]);

      expect(physics.census()).toEqual({ bodies: 1, colliders: 1, vehicles: 0 }); // the collider goes with its body
      physics.dispose();
    });
  });
});

describe('PhysicsWorld.createCharacterBody', () => {
  describe('positive cases', () => {
    it('stays upright when shoved off-centre (rotations are locked)', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [10, 10, 0.5]);
      const body = physics.createCharacterBody([0, 0, 1.5], [0.3, 0.3, 0.9]);

      physics.pushAt(body, [500, 0, 0], [0, 0, 2.4]); // a hard shove high up would topple a free body
      for (let i = 0; i < 120; i += 1) {
        physics.step(STEP);
      }

      expect(physics.readBody(body).quaternion).toEqual([0, 0, 0, 1]);
      physics.dispose();
    });
  });
});

describe('PhysicsWorld velocity helpers', () => {
  describe('positive cases', () => {
    it('reads back the velocity it was given', async () => {
      const physics = await makeWorld();
      const body = physics.createBox([0, 0, 5], [0.5, 0.5, 0.5]);

      physics.setLinvel(body, [1, 2, 3]);

      expect(physics.getLinvel(body)).toEqual([1, 2, 3]);
      physics.dispose();
    });

    it('seedReverse drives the body backwards along its heading, keeping the vertical velocity', async () => {
      const physics = await makeWorld();
      const body = physics.createBox([0, 0, 5], [0.5, 0.5, 0.5]);
      physics.setLinvel(body, [0, 0, -4]);

      physics.seedReverse(body, 0, 3); // heading 0 = facing +Y, so reverse is −Y

      const [x, y, z] = physics.getLinvel(body);
      expect(x).toBeCloseTo(0, 5);
      expect(y).toBeCloseTo(-3, 5);
      expect(z).toBeCloseTo(-4, 5); // gravity component untouched
      physics.dispose();
    });

    it('holdBody pins a moving body at a pose with zero velocity (the player slides in undisturbed)', async () => {
      const physics = await makeWorld();
      const body = physics.createBox([0, 0, 5], [0.5, 0.5, 0.5]);
      physics.setLinvel(body, [10, 10, 10]);

      physics.holdBody(body, [1, 2, 3], [0, 0, 0, 1]);

      expect(physics.getLinvel(body)).toEqual([0, 0, 0]);
      expect(physics.readBody(body).position).toEqual([1, 2, 3]);
      physics.dispose();
    });

    it('teleport also sets the kinematic target so the next step cannot pull the body back', async () => {
      const physics = await makeWorld();
      const { body } = physics.createKinematicCapsule([0, 0, 5], 0.3, 0.6);

      physics.teleport(body, [4, 5, 6]);
      physics.step(STEP);

      expect(physics.readBody(body).position).toEqual([4, 5, 6]);
      physics.dispose();
    });
  });
});

describe('PhysicsWorld.isGrounded', () => {
  describe('negative cases', () => {
    it('is false with nothing under the body within half-height + epsilon', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [10, 10, 0.5]); // top at z = 0.5
      const box = physics.createBox([0, 0, 5], [0.5, 0.5, 0.5]);
      physics.step(STEP);

      expect(physics.isGrounded(box, 0.5)).toBe(false);
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('is true for a body resting on the ground (and ignores the body own collider)', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [10, 10, 0.5]); // top at z = 0.5
      const box = physics.createBox([0, 0, 1], [0.5, 0.5, 0.5]); // resting
      physics.step(STEP);

      expect(physics.isGrounded(box, 0.5)).toBe(true);
      physics.dispose();
    });
  });
});

describe('PhysicsWorld.overlapsBox', () => {
  describe('negative cases', () => {
    it('is false on an empty spot (the spawn is free)', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [1, 1, 1]);
      physics.step(STEP);

      expect(physics.overlapsBox([20, 0, 0], 0, [1.2, 2.5, 0.7])).toBe(false);
      physics.dispose();
    });

    it('is false when the heading rotates the long axis away from an obstacle', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 2.5, 0], [0.5, 0.5, 0.5]); // obstacle 2.5 m along +Y
      physics.step(STEP);

      // Unrotated the 2.5-long half-axis is +Y and reaches it; turned 90° that axis points along X.
      expect(physics.overlapsBox([0, 0, 0], 0, [1.2, 2.5, 0.7])).toBe(true);
      expect(physics.overlapsBox([0, 0, 0], Math.PI / 2, [1.2, 2.5, 0.7])).toBe(false);
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('is true where a body already stands (a car spawned there would be ejected)', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [1, 1, 1]);
      physics.step(STEP);

      expect(physics.overlapsBox([0, 0, 0], 0, [1.2, 2.5, 0.7])).toBe(true);
      physics.dispose();
    });
  });
});

describe('PhysicsWorld collider toggles', () => {
  /** Drop a box onto the player's capsule; returns where the box ended up after `mutate`. */
  async function drop(mutate: (physics: PhysicsWorld, collider: number) => void): Promise<number> {
    const physics = await makeWorld();
    const { collider } = physics.createKinematicCapsule([0, 0, 0], 2, 2); // a fat obstacle
    mutate(physics, collider);
    const box = physics.createBox([0, 0, 6], [0.5, 0.5, 0.5]);

    for (let i = 0; i < 240; i += 1) {
      physics.step(STEP);
    }
    const z = physics.readBody(box).position[2];
    physics.dispose();

    return z;
  }

  describe('negative cases', () => {
    // How the seated rider stops shoving his car (`enter-vehicle.system`): a sensor, not a disabled collider.
    it('a sensor collider applies no contact force, so a box falls straight through it', async () => {
      expect(await drop((physics, collider) => physics.setColliderSensor(collider, true))).toBeLessThan(-2);
    });

    it('turning the sensor back off makes it solid again (the player back on foot)', async () => {
      const solidAgain = await drop((physics, collider) => {
        physics.setColliderSensor(collider, true);
        physics.setColliderSensor(collider, false);
      });

      expect(solidAgain).toBeCloseTo(4.5, 1);
    });
  });

  describe('positive cases', () => {
    it('an untouched collider holds the box up (the control for the toggles above)', async () => {
      expect(await drop(() => undefined)).toBeCloseTo(4.5, 1); // capsule top 4 + box half 0.5
    });
  });
});

describe('PhysicsWorld raycast vehicle', () => {
  const HALF: [number, number, number] = [1.2, 2.5, 0.7];
  const WHEELS = [
    // Hubs BELOW the hull bottom (−0.7), so the wheels carry the car instead of the chassis box grinding.
    { connection: [-0.8, 1.4, -0.5] as Vec3, front: true, radius: 0.35 },
    { connection: [0.8, 1.4, -0.5] as Vec3, front: true, radius: 0.35 },
    { connection: [-0.8, -1.4, -0.5] as Vec3, front: false, radius: 0.35 },
    { connection: [0.8, -1.4, -0.5] as Vec3, front: false, radius: 0.35 },
  ];
  const FRONT = [{ front: true }, { front: true }, { front: false }, { front: false }];

  /** A ground plane + one car resting on it. */
  async function car(): Promise<{
    body: number;
    controller: VehicleController;
    physics: PhysicsWorld;
  }> {
    const physics = await makeWorld();
    physics.createStaticBox([0, 0, -0.5], [200, 200, 0.5]); // top surface at z = 0
    const chassis = shape({ boxes: [{ max: [1.2, 2.5, 0.7], min: [-1.2, -2.5, -0.7] }] });
    const { body, controller } = physics.createDynamicVehicle([0, 0, 1.2], 0, chassis, massProps(), WHEELS, HALF);
    for (let i = 0; i < 120; i += 1) {
      physics.step(STEP);
    }

    return { body, controller, physics };
  }

  /** Idle controls at a given forward speed — the 081/09 boost tests read frictionSlip after this. */
  function coastAt(physics: PhysicsWorld, controller: VehicleController, speed: number): void {
    physics.setVehicleControls(controller, FRONT, {
      brake: 0,
      brakeBias: 0.5,
      drive: '4',
      engine: 0,
      handbrake: false,
      speed,
      steer: 0,
      step: STEP,
      traction: { bias: 0.5, loss: 0.8, mult: 0.7 },
    });
  }

  describe('negative cases', () => {
    it('a parked car stays put — the parking brake is on from creation', async () => {
      const { body, physics } = await car();
      const start = physics.readBody(body).position;

      for (let i = 0; i < 180; i += 1) {
        physics.step(STEP);
      }

      const now = physics.readBody(body).position;
      expect(Math.hypot(now[0] - start[0], now[1] - start[1])).toBeLessThan(0.1);
      physics.dispose();
    });

    it('stepping after removeVehicle does not panic on the orphaned controller', async () => {
      const { body, controller, physics } = await car();

      physics.removeVehicle(controller); // documented order: controller first, THEN the chassis body
      physics.removeBodies([body]);

      expect(() => physics.step(STEP)).not.toThrow();
      expect(physics.census().bodies).toBe(1); // only the ground is left — no leaked chassis
      physics.dispose();
    });

    it('removeVehicle is safe for a controller that was already removed', async () => {
      const { controller, physics } = await car();
      physics.removeVehicle(controller);

      expect(() => physics.removeVehicle(controller)).not.toThrow();
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('rests on its suspension above the road (the hull does not sink into it)', async () => {
      const { body, physics } = await car();

      expect(physics.readBody(body).position[2]).toBeGreaterThan(0.5);
      physics.dispose();
    });

    it('scales the tyre by the SURFACE under it, tarmac unchanged (081/10 step 5)', async () => {
      const { body, controller, physics } = await car();
      // Rubber-on-X from surface.dat: road 4.5, loose (grass, dirt) 3.2. Two materials, road first.
      physics.setTyreAdhesion(new Float32Array([4.5, 3.2]), 4.5);

      physics.setVehicleControls(controller, FRONT, {
        brake: 0,
        brakeBias: 0.5,
        drive: '4',
        engine: 0,
        handbrake: false,
        speed: 0,
        steer: 0,
        step: STEP,
        traction: { bias: 0.5, loss: 0.8, mult: 0.7 },
        wheelAdhesion: [4.5, 4.5, 4.5, 4.5],
      });
      expect(controller.wheelFrictionSlip(0)).toBeCloseTo(0.7, 5); // tarmac IS the old number

      physics.setVehicleControls(controller, FRONT, {
        brake: 0,
        brakeBias: 0.5,
        drive: '4',
        engine: 0,
        handbrake: false,
        speed: 0,
        steer: 0,
        step: STEP,
        traction: { bias: 0.5, loss: 0.8, mult: 0.7 },
        wheelAdhesion: [3.2, 3.2, 3.2, 3.2],
      });
      expect(controller.wheelFrictionSlip(0)).toBeCloseTo(0.7 * (3.2 / 4.5), 5); // grass: 71 % of it

      expect(physics.readVehicleWheelAdhesion(controller, body)).toHaveLength(4);
      physics.dispose();
    });

    it('puts every wheel back on tarmac when the field turns the lookup off (?surfGrip=0)', async () => {
      const { body, controller, physics } = await car();
      physics.setTyreAdhesion(new Float32Array([4.5, 3.2]), 4.5);

      physics.tuneSurfaceGrip(false);

      expect(physics.surfaceGripActive()).toBe(false);
      expect(physics.readVehicleWheelAdhesion(controller, body).every((value) => value === 4.5)).toBe(true);
      physics.dispose();
    });

    it('hands the tyre the baseline scale at rest — the assist must never move the low-speed feel (081/09)', async () => {
      const { controller, physics } = await car();

      coastAt(physics, controller, 0);

      // The field-liked baseline (both derived SA scales were rejected under 1 g — see the 081/08
      // postmortem): at rest the boost is exactly 1 and the raw multiplier reaches Rapier untouched.
      expect(controller.wheelFrictionSlip(0)).toBeCloseTo(0.7, 5);
      physics.dispose();
    });

    it('grows the LATERAL grip with speed and caps it — and leaves town speeds nearly alone (081/09)', async () => {
      const { controller, physics } = await car();

      coastAt(physics, controller, 6); // ~22 km/h: 1 + (6/12)² = 1.25 — town feel within a quarter
      expect(controller.wheelFrictionSlip(0)).toBeCloseTo(0.7 * 1.25, 4);
      coastAt(physics, controller, 30); // 108 km/h: 1 + 6.25 → capped at 3 — the corner/evasion case
      expect(controller.wheelFrictionSlip(0)).toBeCloseTo(0.7 * 3, 4);
      coastAt(physics, controller, -30); // reverse counts by magnitude
      expect(controller.wheelFrictionSlip(0)).toBeCloseTo(0.7 * 3, 4);
      physics.dispose();
    });

    it('the session dials move the boost — and reject nonsense values (081/09)', async () => {
      const { controller, physics } = await car();

      physics.tuneSpeedGrip({ cap: 0, reference: Number.NaN }); // both invalid → dials unchanged
      expect(physics.speedGripTuning()).toEqual({ cap: 3, reference: 12 });

      physics.tuneSpeedGrip({ cap: 1.5 });
      coastAt(physics, controller, 30);
      expect(controller.wheelFrictionSlip(0)).toBeCloseTo(0.7 * 1.5, 4);
      physics.dispose();
    });

    it('stands a large-|lower| row HIGHER above the road — the original rests wheels near droop, not at the hub', async () => {
      // Twin cars differing only in `fSuspensionLowerLimit`. SA's standing pose hangs the wheel
      // `|lower| − share/(forceLevel×axleBias) × span` BELOW its dummy (`SetupSuspensionLines`), so the body
      // of the 0.20 row must ride visibly higher than the 0.10 one — the turismo-vs-infernus gradient the
      // 2026-07-27 audit traced ("the turismo is slammed" while the fleet looked right).
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, -0.5], [200, 200, 0.5]);
      const chassis = shape({ boxes: [{ max: [1.2, 2.5, 0.7], min: [-1.2, -2.5, -0.7] }] });
      const twin = (x: number, restLength: number): number =>
        physics.createDynamicVehicle(
          [x, 0, 1.2],
          0,
          chassis,
          massProps({ suspension: { bias: 0.5, damping: 0.15, force: 1.1, restLength, travel: 0.25 } }),
          WHEELS,
          HALF,
        ).body;
      const deepDroop = twin(0, 0.2);
      const shallowDroop = twin(8, 0.1);
      for (let i = 0; i < 240; i += 1) {
        physics.step(STEP);
      }

      const risen = physics.readBody(deepDroop).position[2] - physics.readBody(shallowDroop).position[2];
      // The wheel rests `lower + share/(force×axle) × span` from the hub, so the extra 0.10 m of |lower|
      // lifts the body by 0.10 × (1 − 0.25/1.1) ≈ 7.7 cm. (Under the old wheel-at-hub rule this reads 0:
      // both twins stood at the same height whatever their row said.)
      expect(risen).toBeGreaterThan(0.06);
      expect(risen).toBeLessThan(0.09);
      physics.dispose();
    });

    it('engine force drives it forward, and parkVehicle brings it back to a stop', async () => {
      const { controller, physics } = await car();

      physics.setVehicleControls(controller, FRONT, {
        brake: 0,
        brakeBias: 0.5,
        drive: '4',
        engine: 12000,
        handbrake: false,
        speed: 0,
        steer: 0,
        step: STEP,
        traction: { bias: 0.5, loss: 0.8, mult: 0.7 },
      });
      for (let i = 0; i < 180; i += 1) {
        physics.step(STEP);
      }
      expect(physics.vehicleSpeed(controller)).toBeGreaterThan(1);

      physics.parkVehicle(controller);
      for (let i = 0; i < 300; i += 1) {
        physics.step(STEP);
      }

      expect(Math.abs(physics.vehicleSpeed(controller))).toBeLessThan(0.5);
      physics.dispose();
    });
  });
});

describe('PhysicsWorld impacts', () => {
  /** Slam a heavy dynamic box into a static wall hard enough to clear the contact-force threshold. */
  async function collide(): Promise<PhysicsWorld> {
    const physics = await makeWorld();
    physics.createStaticBox([0, 0, -0.5], [50, 50, 0.5]);
    const chassis = shape({ boxes: [{ max: [1, 1, 1], min: [-1, -1, -1] }] });
    const { body } = physics.createDynamicVehicle([0, 0, 1.2], 0, chassis, massProps(), [], [1, 1, 1]);
    physics.createStaticBox([0, 6, 1], [5, 0.5, 3]); // wall ahead
    physics.setLinvel(body, [0, 15, 0]); // 1500 kg at 15 m/s — well past the 400 N event threshold
    for (let i = 0; i < 120; i += 1) {
      physics.step(STEP);
    }

    return physics;
  }

  describe('negative cases', () => {
    it('drains empty when nothing touched anything', async () => {
      const physics = await makeWorld();
      physics.step(STEP);

      expect(physics.takeImpacts()).toEqual([]);
      expect(physics.takeBreakableImpacts()).toEqual([]);
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('the vehicle-damage and breakable buffers drain INDEPENDENTLY (neither starves the other)', async () => {
      const physics = await collide();

      const damage = physics.takeImpacts();
      const breakable = physics.takeBreakableImpacts();

      expect(damage.length).toBeGreaterThan(0);
      expect(breakable).toEqual(damage); // the same events reached both, in the same order
      expect(physics.takeImpacts()).toEqual([]); // and each drains once
      expect(physics.takeBreakableImpacts()).toEqual([]);
      physics.dispose();
    });

    it('an impact names both bodies and a world-space contact point', async () => {
      const physics = await collide();

      const [impact] = physics.takeImpacts();

      expect(impact.bodyA).not.toBeNull();
      expect(impact.bodyB).not.toBeNull();
      expect(impact.force).toBeGreaterThan(0);
      expect(impact.point).not.toBeNull();
      physics.dispose();
    });
  });
});

describe('PhysicsWorld.createFalling', () => {
  const BOX = { centre: [0, 0, 0] as Vec3, half: [0.2, 0.2, 4] as Vec3 };
  /** Eight corners of a 1 m cube — a hull Rapier accepts. */
  const CUBE = new Float32Array([
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5, 0.5,
    0.5, 0.5, 0.5,
  ]);

  describe('negative cases', () => {
    it('falls back to the BOX for a mesh Rapier cannot hull, instead of throwing', async () => {
      // Rapier's `convexHull` returns a non-null but INVALID desc for degenerate input, so a bare
      // `?? cuboid(...)` never fires and `createCollider` throws — which took the whole frame down when a
      // prop with an unhullable mesh toppled. Guarded like `addConvexChassis` since plan 077.
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, -0.5], [50, 50, 0.5]); // ground, top at z = 0

      const prop = physics.createFalling([0, 0, 6], [0, 0, 0, 1], 50, new Float32Array(), {
        centre: [0, 0, 0],
        half: [0.2, 0.2, 0.5],
      });

      for (let i = 0; i < 300; i += 1) {
        physics.step(STEP);
      }
      // It exists AND behaves: the fallback box lands on the ground rather than falling forever.
      expect(physics.readBody(prop).position[2]).toBeCloseTo(0.5, 1);
      physics.dispose();
    });

    it('falls back to the box for a mesh with too FEW points to hull (under 4)', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, -0.5], [50, 50, 0.5]);

      const twoPoints = new Float32Array([0, 0, 0, 1, 0, 0]);
      const prop = physics.createFalling([0, 0, 6], [0, 0, 0, 1], 50, twoPoints, {
        centre: [0, 0, 0],
        half: [0.2, 0.2, 0.5],
      });

      for (let i = 0; i < 300; i += 1) {
        physics.step(STEP);
      }
      expect(physics.readBody(prop).position[2]).toBeCloseTo(0.5, 1);
      physics.dispose();
    });

    it('a felled prop passes THROUGH a car instead of solving against it (PROP_GROUPS)', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, -0.5], [50, 50, 0.5]); // top at z = 0
      const chassis = shape({ boxes: [{ max: [1.2, 2.5, 0.7], min: [-1.2, -2.5, -0.7] }] });
      physics.createDynamicVehicle([0, 0, 0.7], 0, chassis, massProps(), [], [1.2, 2.5, 0.7]);
      // Dropped straight onto the car's roof: if it collided with the chassis it would rest at ~1.9.
      const prop = physics.createFalling([0, 0, 5], [0, 0, 0, 1], 50, CUBE, BOX);

      for (let i = 0; i < 300; i += 1) {
        physics.step(STEP);
      }

      expect(physics.readBody(prop).position[2]).toBeCloseTo(0.5, 1); // reached the GROUND, not the roof
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('keeps the placed heading instead of snapping upright the instant it becomes a body', async () => {
      const physics = await makeWorld();
      const tilt: [number, number, number, number] = [Math.sin(Math.PI / 8), 0, 0, Math.cos(Math.PI / 8)];

      const prop = physics.createFalling([0, 0, 20], tilt, 50, CUBE, BOX);

      const { quaternion } = physics.readBody(prop);
      expect(quaternion[0]).toBeCloseTo(tilt[0], 5);
      expect(quaternion[3]).toBeCloseTo(tilt[3], 5);
      physics.dispose();
    });
  });
});

describe('PhysicsWorld.ignoreVehicles', () => {
  /** The player's capsule standing on the ground with a car dropped straight onto it. */
  async function scene(ignore: boolean): Promise<number> {
    const physics = await makeWorld();
    physics.createStaticBox([0, 0, -0.5], [50, 50, 0.5]); // top at z = 0
    const capsule = physics.createKinematicCapsule([0, 0, 0.9], 0.4, 0.5);
    physics.ignoreVehicles(capsule.collider, ignore);
    const chassisShape = shape({ boxes: [{ max: [1.2, 2.5, 0.7], min: [-1.2, -2.5, -0.7] }] });
    const { body } = physics.createDynamicVehicle([0, 0, 5], 0, chassisShape, massProps(), [], [1.2, 2.5, 0.7]);

    for (let i = 0; i < 300; i += 1) {
      physics.step(STEP);
    }
    const z = physics.readBody(body).position[2];
    physics.dispose();

    return z;
  }

  describe('negative cases', () => {
    it('while ignoring, the chassis passes through the player and lands on the road', async () => {
      expect(await scene(true)).toBeCloseTo(0.7, 1); // hull half-height above the ground
    });
  });

  describe('positive cases', () => {
    it('by default the chassis solves against the player and comes to rest ON him', async () => {
      expect(await scene(false)).toBeGreaterThan(1.5);
    });
  });
});

describe('PhysicsWorld kinematic character on a car', () => {
  describe('positive cases', () => {
    it('a walking player stands on a parked car roof (vanilla lets you climb on cars)', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, -0.5], [50, 50, 0.5]); // top at z = 0
      const chassisShape = shape({ boxes: [{ max: [1.2, 2.5, 0.7], min: [-1.2, -2.5, -0.7] }] });
      physics.createDynamicVehicle([0, 0, 0.7], 0, chassisShape, massProps(), [], [1.2, 2.5, 0.7]);
      const controller = physics.createCharacterController();
      const capsule = physics.createKinematicCapsule([0, 0, 3], 0.3, 0.6);

      let grounded = false;
      for (let i = 0; i < 240; i += 1) {
        grounded = physics.moveCharacter(controller, capsule.body, capsule.collider, [0, 0, -0.05]).grounded;
        physics.step(STEP);
      }

      expect(grounded).toBe(true);
      expect(physics.readBody(capsule.body).position[2]).toBeGreaterThan(2); // roof (1.4) + capsule half 0.9
      physics.dispose();
    });
  });
});

describe('PhysicsWorld.pathClear (plan 088/09d)', () => {
  describe('negative cases', () => {
    it('a solid box across the ray blocks it', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([2, 0, 1], [0.5, 2, 1]); // a wall between the points
      physics.step(STEP); // build the query pipeline
      expect(physics.pathClear([0, 0, 1], [4, 0, 1])).toBe(false);
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('an empty span is clear, and a zero-length ray is trivially clear', async () => {
      const physics = await makeWorld();
      expect(physics.pathClear([0, 0, 1], [4, 0, 1])).toBe(true);
      expect(physics.pathClear([1, 2, 3], [1, 2, 3])).toBe(true);
      physics.dispose();
    });

    it('the excluded body (the probing car itself) does not block its own ray', async () => {
      const physics = await makeWorld();
      const body = physics.createBox([0, 0, 1], [1, 1, 0.5]); // the ray STARTS inside this box
      physics.step(1 / 60);
      expect(physics.pathClear([0, 0, 1], [4, 0, 1], body)).toBe(true);
      physics.dispose();
    });

    it('an explicitly excluded collider (the seated rider) does not block the ray', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, -1], [10, 10, 0.5]);
      const { collider } = physics.createKinematicCapsule([2, 0, 1], 0.3, 0.6); // ON the ray path
      physics.step(1 / 60);
      expect(physics.pathClear([0, 0, 1], [4, 0, 1])).toBe(false); // it DOES block by default
      expect(physics.pathClear([0, 0, 1], [4, 0, 1], undefined, collider)).toBe(true);
      physics.dispose();
    });
  });
});

describe('PhysicsWorld.groundNormalBelow (plan 088/08)', () => {
  describe('negative cases', () => {
    it('returns null with nothing below the probe', async () => {
      const physics = await makeWorld();
      expect(physics.groundNormalBelow([0, 0, 10], 4)).toBeNull();
      physics.dispose();
    });
  });

  describe('positive cases', () => {
    it('a flat floor reports the up normal', async () => {
      const physics = await makeWorld();
      physics.createStaticBox([0, 0, 0], [10, 10, 0.5]);
      physics.step(STEP); // build the query pipeline
      const normal = physics.groundNormalBelow([0, 0, 2], 4);
      expect(normal).not.toBeNull();
      expect(normal?.[2]).toBeCloseTo(1, 5);
      physics.dispose();
    });
  });
});
