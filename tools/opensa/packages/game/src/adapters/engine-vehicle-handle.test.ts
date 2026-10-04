import type { VehicleInstance } from '@opensa/engine';
import type { VehicleModelData } from '@opensa/renderware';

import { describe, expect, it } from 'vitest';

import { LIGHT_FRONT_LEFT, LIGHT_FRONT_RIGHT, LIGHT_REAR_LEFT } from '../vehicle/vehicle-lamps';
import { EngineVehicleHandle } from './engine-vehicle-handle';

/** How far a posed wheel's AXLE (its local +X) tips out of the horizontal — the camber, seen from outside
 *  the composition. Steering rotates the axle within the ground plane and spin turns about it, so neither
 *  may move this number. */
function axleTilt(quat: readonly number[]): number {
  const [x, y, z, w] = quat;

  return 2 * (x * z - y * w); // the z component of the rotated +X axis
}

/** A recording engine instance: the handle's whole job is to poke exactly these. */
function instance(): {
  matrices: Float32Array;
  probe: VehicleInstance;
  rotations: Map<number, readonly number[]>;
  translations: Map<number, readonly number[]>;
  visible: Map<number, boolean>;
} {
  const matrices = new Float32Array(4 * 16);
  const visible = new Map<number, boolean>();
  const rotations = new Map<number, readonly number[]>();
  const translations = new Map<number, readonly number[]>();
  const entity = {
    matrices,
    setPartRotation: (part: number, quat: readonly number[]): void => {
      rotations.set(part, [...quat]);
    },
    setPartTranslation: (part: number, translation: readonly number[]): void => {
      translations.set(part, [...translation]);
    },
    setPartWorldMatrix: (part: number, matrix: Float32Array | null): void => {
      if (matrix) {
        matrices.set(matrix, part * 16);
      }
    },
    setRoot: (matrix: Float32Array): void => {
      matrices.set(matrix, 0); // the test reads the root back out of part 0's slot
    },
  };

  return {
    matrices,
    probe: {
      entity,
      model: 0,
      setLamps: (): undefined => undefined,
      setPaint: (): undefined => undefined,
      setSubmeshVisible: (submesh: number, on: boolean): void => {
        visible.set(submesh, on);
      },
    } as unknown as VehicleInstance,
    rotations,
    translations,
    visible,
  };
}

/**
 * A model with one damageable part (bonnet: body + dam submeshes) and one `_vlo` submesh — enough to
 * exercise the visibility composition, which is the handle's trickiest job.
 */
function model(): VehicleModelData {
  return {
    doors: [{ name: 'door_lf', part: 2, side: 'lf' }],
    dummies: [
      { name: 'headlights', position: [0.8, 1.8, 0], rotation: [0, 0, 0, 1] },
      { name: 'taillights', position: [0.6, -2.4, 0], rotation: [0, 0, 0, 1] },
    ],
    parts: [
      { localRotation: [0, 0, 0, 1], localTranslation: [0, 0, 0], name: 'chassis' },
      { localRotation: [0, 0, 0, 1], localTranslation: [0, 1.5, 0.4], name: 'bonnet' },
      { localRotation: [0, 0, 0, 1], localTranslation: [-0.9, 0.5, 0], name: 'door_lf' },
    ],
    submeshes: [
      { damageGroup: null, indexCount: 3, indexOffset: 0, kind: 'body', lamp: null, part: 0, translucent: false },
      { damageGroup: 'bonnet', indexCount: 3, indexOffset: 3, kind: 'body', lamp: null, part: 1, translucent: false },
      { damageGroup: 'bonnet', indexCount: 3, indexOffset: 6, kind: 'dam', lamp: null, part: 1, translucent: false },
      { damageGroup: null, indexCount: 3, indexOffset: 9, kind: 'lod', lamp: null, part: 0, translucent: false },
    ],
    wheels: [{ front: true, part: 0, radius: 0.35 }],
  } as unknown as VehicleModelData;
}

/** The same model plus two mutually-exclusive optional parts, which only a SPAWN may choose between. */
function modelWithExtras(): VehicleModelData {
  const base = model();

  return {
    ...base,
    parts: [...base.parts, { localRotation: [0, 0, 0, 1], localTranslation: [0, -2, 0.5], name: 'extra1' }],
    submeshes: [
      ...base.submeshes,
      {
        damageGroup: null,
        extra: 'extra1',
        indexCount: 3,
        indexOffset: 12,
        kind: 'body',
        lamp: null,
        part: 3,
        translucent: false,
      },
      {
        damageGroup: null,
        extra: 'extra2',
        indexCount: 3,
        indexOffset: 15,
        kind: 'body',
        lamp: null,
        part: 3,
        translucent: false,
      },
    ],
  } as unknown as VehicleModelData;
}

/** The same model plus a VehFuncs group: `f_extras:1 → a | b`, one mesh each — the spawn shows exactly one. */
function modelWithVariants(): VehicleModelData {
  const base = model();
  const option = (variant: string, indexOffset: number): VehicleModelData['submeshes'][number] =>
    ({
      damageGroup: null,
      indexCount: 3,
      indexOffset,
      kind: 'body',
      lamp: null,
      part: 0,
      translucent: false,
      variant,
    }) as never;

  return {
    ...base,
    submeshes: [...base.submeshes, option('a', 12), option('b', 15)],
    variants: {
      classes: [],
      extras: [
        {
          children: [
            { children: [], id: 'a', name: 'a', select: [1, 1] },
            { children: [], id: 'b', name: 'b', select: [1, 1] },
          ],
          id: 'root',
          name: 'f_extras',
          select: [1, 1],
        },
      ],
    },
  } as unknown as VehicleModelData;
}

const BONNET_OK = 1;
const BONNET_DAM = 2;
const LOD = 3;
const EXTRA_1 = 4;
const EXTRA_2 = 5;
const VARIANT_A = 4;
const VARIANT_B = 5;

describe('EngineVehicleHandle', () => {
  describe('negative cases', () => {
    it("the damaged twin and the `_vlo` mesh start HIDDEN (they share the car's buffers)", () => {
      const { probe, visible } = instance();

      new EngineVehicleHandle(probe, model(), () => undefined);

      expect(visible.get(BONNET_OK)).toBe(true);
      expect(visible.get(BONNET_DAM)).toBe(false);
      expect(visible.get(LOD)).toBe(false);
    });

    it('never draws two `extraN` alternatives at once — they occupy the same spot', () => {
      // Twenty spawns, because the pick is random: any of them showing both (or neither) is the jumble the
      // rule exists to prevent.
      for (let spawn = 0; spawn < 20; spawn += 1) {
        const { probe, visible } = instance();

        new EngineVehicleHandle(probe, modelWithExtras(), () => undefined);

        expect([visible.get(EXTRA_1), visible.get(EXTRA_2)].filter(Boolean)).toHaveLength(1);
      }
    });

    it('never draws two options of one VehFuncs `:1` group at once — the spawn walks the tree', () => {
      for (let spawn = 0; spawn < 20; spawn += 1) {
        const { probe, visible } = instance();

        new EngineVehicleHandle(probe, modelWithVariants(), () => undefined);

        expect([visible.get(VARIANT_A), visible.get(VARIANT_B)].filter(Boolean)).toHaveLength(1);
      }
    });

    it('an unknown part cannot be detached', () => {
      const { probe } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);

      expect(handle.detachPart('spoiler')).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('an LOD swap does NOT resurrect a damaged panel (damage and LOD compose through ONE decision)', () => {
      const { probe, visible } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);
      handle.setPartDamaged('bonnet', true);

      handle.setLodBand('vlo'); // far away: only the `_vlo` mesh shows
      expect(visible.get(BONNET_OK)).toBe(false);
      expect(visible.get(BONNET_DAM)).toBe(false);
      expect(visible.get(LOD)).toBe(true);

      handle.setLodBand('hd'); // back in close: the panel must still be the DAMAGED one
      expect(visible.get(BONNET_OK)).toBe(false);
      expect(visible.get(BONNET_DAM)).toBe(true);
      expect(visible.get(LOD)).toBe(false);
    });

    it('keeps the SAME extra across an LOD swap and a damage change (one decision owns visibility)', () => {
      const { probe, visible } = instance();
      const handle = new EngineVehicleHandle(probe, modelWithExtras(), () => undefined);
      const chosen = visible.get(EXTRA_1) === true ? EXTRA_1 : EXTRA_2;
      const other = chosen === EXTRA_1 ? EXTRA_2 : EXTRA_1;

      handle.setPartDamaged('bonnet', true);
      handle.setLodBand('vlo');
      handle.setLodBand('hd');

      expect(visible.get(chosen)).toBe(true);
      expect(visible.get(other)).toBe(false);
    });

    it('keeps the SAME VehFuncs pick across an LOD swap and a damage change', () => {
      const { probe, visible } = instance();
      const handle = new EngineVehicleHandle(probe, modelWithVariants(), () => undefined);
      const chosen = visible.get(VARIANT_A) === true ? VARIANT_A : VARIANT_B;
      const other = chosen === VARIANT_A ? VARIANT_B : VARIANT_A;

      handle.setPartDamaged('bonnet', true);
      handle.setLodBand('vlo');
      handle.setLodBand('hd');

      expect(visible.get(chosen)).toBe(true);
      expect(visible.get(other)).toBe(false);
    });

    it('a culled car draws nothing at all', () => {
      const { probe, visible } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);

      handle.setLodBand('culled');

      expect([...visible.values()].some(Boolean)).toBe(false);
    });

    it('the chassis pose carries the GTA Z-up → engine Y-up change: e = (x, z, −y)', () => {
      const { matrices, probe } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);

      handle.setTransform([10, 20, 3], [0, 0, 0, 1]);

      expect([...matrices.subarray(12, 15)]).toEqual([10, 3, -20]);
    });

    it('a detached panel inherits the BODY rotation, not identity (it would snap flat mid-drive)', () => {
      const { probe } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);
      const half = Math.SQRT1_2;
      handle.setTransform([0, 0, 0], [0, 0, half, half]); // car turned 90°

      const pose = handle.detachPart('bonnet');

      expect(pose?.rotation).toEqual([0, 0, half, half]);
    });

    it('exposes the lamp anchors the shared lamp logic reads', () => {
      const { probe } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);

      expect(handle.lampAnchor('head')).toEqual([0.8, 1.8, 0]);
      expect(handle.lampAnchor('tail')).toEqual([0.6, -2.4, 0]);
    });

    it('a door hinge reports the PIVOT (the builder put the hinge frame there), not the door mesh', () => {
      const { probe } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);

      expect(handle.doorHinge('lf')).toEqual([-0.9, 0.5, 0]);
      expect(handle.doorHinge('rf')).toBeNull();
    });

    it('a door swing carries every part of its hinge subtree — a mod glass atomic must not hang in the air', () => {
      // The comet authors `glass_lf_ok` as a separate atomic under `door_lf_dummy`; SA rotates the whole
      // frame subtree. The glass pivot sits ON the hinge (the export the builder measured), so it gets the
      // same rotation and a zero compensation translation.
      const base = model();
      const data = {
        ...base,
        doors: [{ name: 'door_lf', part: 2, parts: [2, 3], side: 'lf' }],
        parts: [...base.parts, { localRotation: [0, 0, 0, 1], localTranslation: [-0.9, 0.5, 0], name: 'glass_lf' }],
      } as unknown as VehicleModelData;
      const { probe, rotations, translations } = instance();
      const handle = new EngineVehicleHandle(probe, data, () => undefined);

      handle.setDoorAngle('lf', Math.PI / 4);

      expect(rotations.get(3)).toBeDefined();
      expect(rotations.get(3)).toEqual(rotations.get(2));
      const compensation = translations.get(3)!;
      expect(Math.hypot(compensation[0], compensation[1], compensation[2])).toBeCloseTo(0);
    });

    it('a subtree member with a pivot OFF the hinge still orbits the hinge, not its own pivot', () => {
      // Pivot 0.2 m outboard of the hinge along X, swing 90° about Z: the member's pivot must land where a
      // hinge rotation puts it — the offset (−0.2, 0) turns into (0, −0.2) — so the compensation is
      // (target − pivot) = (hinge + R·(pivot − hinge)) − pivot.
      const base = model();
      const data = {
        ...base,
        doors: [{ name: 'door_lf', part: 2, parts: [2, 3], side: 'lf' }],
        parts: [...base.parts, { localRotation: [0, 0, 0, 1], localTranslation: [-1.1, 0.5, 0], name: 'glass_lf' }],
      } as unknown as VehicleModelData;
      const { probe, translations } = instance();
      const handle = new EngineVehicleHandle(probe, data, () => undefined);

      handle.setDoorAngle('lf', Math.PI / 2);

      const compensation = translations.get(3)!;
      // pivot − hinge = (−0.2, 0, 0); rotated 90° about Z → (0, −0.2, 0); compensation = rotated − offset.
      expect(compensation[0]).toBeCloseTo(0.2);
      expect(compensation[1]).toBeCloseTo(-0.2);
      expect(compensation[2]).toBeCloseTo(0);
    });
  });
});

describe('EngineVehicleHandle model surface', () => {
  describe('negative cases', () => {
    it('a model with no `_vlo` submesh reports no LOD (the LOD system must not band it)', () => {
      const { probe } = instance();
      const data = model();
      data.submeshes = data.submeshes.filter((submesh) => submesh.kind !== 'lod');

      expect(new EngineVehicleHandle(probe, data, () => undefined).hasLod).toBe(false);
    });

    it('a model with no damageable part exposes no parts', () => {
      const { probe } = instance();
      const data = model();
      data.submeshes = data.submeshes.map((submesh) => ({ ...submesh, damageGroup: null }));

      expect(new EngineVehicleHandle(probe, data, () => undefined).parts).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('lists each damage group ONCE, at the pivot of the part it was paired under', () => {
      const { probe } = instance();

      const handle = new EngineVehicleHandle(probe, model(), () => undefined);

      // `bonnet` has both a body and a `_dam` submesh — it must still appear as a single part.
      expect(handle.parts).toEqual([{ name: 'bonnet', position: [0, 1.5, 0.4] }]);
      expect(handle.hasLod).toBe(true);
    });

    it('mirrors the wheel roster the vehicle physics needs (front flag + radius)', () => {
      const { probe } = instance();

      expect(new EngineVehicleHandle(probe, model(), () => undefined).wheels).toEqual([{ front: true, radius: 0.35 }]);
    });
  });
});

describe('EngineVehicleHandle detached parts', () => {
  describe('negative cases', () => {
    it('poses and removals for an unknown part are silently ignored (no stray matrix writes)', () => {
      const { matrices, probe, visible } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);
      visible.clear();

      handle.setDetachedPose('spoiler', { position: [5, 5, 5], rotation: [0, 0, 0, 1] });
      handle.removeDetached('spoiler');

      expect([...matrices].every((value) => value === 0)).toBe(true);
      expect(visible.size).toBe(0);
    });

    it('an out-of-range wheel index is ignored rather than throwing mid-frame', () => {
      const { probe } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);

      expect(() => handle.setWheel(7, { camber: 0, lift: 0, spin: 1, steer: 0.2 })).not.toThrow();
    });

    it('a door side the model does not have is ignored', () => {
      const { probe } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);

      expect(() => handle.setDoorAngle('rr', 1)).not.toThrow();
    });
  });

  describe('positive cases', () => {
    it('cambers a STEERED wheel about its own forward axis, not the body’s (081/06 §3.3)', () => {
      const { probe, rotations } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);
      const camber = 0.2;

      // Full lock one way, then the other: the axle must tip out of the horizontal by the SAME camber both
      // times. Compose the camber outside the steer instead and the tilt swings with the steering angle.
      const tilts = [0.9, -0.9].map((steer) => {
        handle.setWheel(0, { camber, lift: 0, spin: 0, steer });

        return axleTilt(rotations.get(0) ?? [0, 0, 0, 1]);
      });

      expect(tilts[0]).toBeCloseTo(-Math.sin(camber), 6);
      expect(tilts[1]).toBeCloseTo(-Math.sin(camber), 6);
    });

    it('reports a wheel to SCRIPTS at its DRAWN pose, not at the bind pose it was seeded with', () => {
      // SA rebuilds each wheel node's modelling matrix every frame, so a script reading
      // `m_aCarNodes[CAR_WHEEL_*]`'s m_forward sees the live roll. Ours drove the entity and left the
      // script-visible state frozen: rhino's tread read a CONSTANT angle and never advanced
      // (field 2026-08-07). The forward column is what that script actually reads.
      const { probe } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);
      const forwardZ = (): number => {
        const [x, y, z, w] = handle.scriptPartLocalRotation(0);

        return 2 * (y * z + x * w); // z of the rotated +Y axis — quatAxes().forward[2]
      };

      expect(forwardZ()).toBeCloseTo(0, 6); // unrotated: forward = (0, 1, 0)
      handle.setWheel(0, { camber: 0, lift: 0, spin: 0.5, steer: 0 });
      expect(forwardZ()).toBeCloseTo(Math.sin(0.5), 6);
      handle.setWheel(0, { camber: 0, lift: 0, spin: 1.1, steer: 0 });
      expect(forwardZ()).toBeCloseTo(Math.sin(1.1), 6);
      // Suspension travel rides the same accessor — an absolute part-local translation.
      handle.setWheel(0, { camber: 0, lift: -0.08, spin: 1.1, steer: 0 });
      expect(handle.scriptPartLocalTranslation(0)[2]).toBeCloseTo(-0.08, 6);
    });

    it("leaves a NON-wheel part reporting the script's own absolute pose", () => {
      const { probe } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);
      handle.setWheel(0, { camber: 0, lift: 0, spin: 1.1, steer: 0 });
      handle.scriptSetPartLocalRotation(2, [0, 0, 0.7071, 0.7071]);

      expect(handle.scriptPartLocalRotation(2)[2]).toBeCloseTo(0.7071, 4);
      expect(handle.scriptPartLocalTranslation(2)).toEqual([-0.9, 0.5, 0]);
    });

    it('keeps the spin INNERMOST, so a rolling wheel does not drag its lean round with it', () => {
      const { probe, rotations } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);

      handle.setWheel(0, { camber: 0.2, lift: 0, spin: 0, steer: 0.4 });
      const still = axleTilt(rotations.get(0) ?? [0, 0, 0, 1]);
      handle.setWheel(0, { camber: 0.2, lift: 0, spin: 12.5, steer: 0.4 });

      expect(axleTilt(rotations.get(0) ?? [0, 0, 0, 1])).toBeCloseTo(still, 6);
    });

    it('a detached panel reads its position off its CURRENT part matrix, converted back to GTA space', () => {
      const { matrices, probe } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);
      // Part 1 (bonnet) sits where the engine last flattened it: engine (x, y, z) = (1, 2, -3).
      matrices.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, -3, 1], 1 * 16);

      const pose = handle.detachPart('bonnet');

      expect(pose?.position).toEqual([1, 3, 2]); // engine → GTA: (x, −z, y)
    });

    it('setDetachedPose writes a WORLD matrix that bypasses the car root', () => {
      const { matrices, probe } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);

      handle.setDetachedPose('bonnet', { position: [10, 20, 3], rotation: [0, 0, 0, 1] });

      // GTA (10, 20, 3) → engine (10, 3, −20), written into the bonnet part's own slot.
      expect([...matrices.subarray(1 * 16 + 12, 1 * 16 + 15)]).toEqual([10, 3, -20]);
    });

    it('a detached pose survives a round trip through detachPart (the panel does not jump)', () => {
      const { probe } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);

      handle.setDetachedPose('bonnet', { position: [10, 20, 3], rotation: [0, 0, 0, 1] });

      expect(handle.detachPart('bonnet')?.position).toEqual([10, 20, 3]);
    });

    it('removeDetached hides EVERY submesh of the part, not just the body one', () => {
      const { probe, visible } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);

      handle.removeDetached('bonnet');

      expect(visible.get(BONNET_OK)).toBe(false);
      expect(visible.get(BONNET_DAM)).toBe(false); // the `_dam` twin shares the part
    });

    it('clearing damage restores the undamaged panel', () => {
      const { probe, visible } = instance();
      const handle = new EngineVehicleHandle(probe, model(), () => undefined);

      handle.setPartDamaged('bonnet', true);
      expect(visible.get(BONNET_DAM)).toBe(true);

      handle.setPartDamaged('bonnet', false);

      expect(visible.get(BONNET_OK)).toBe(true);
      expect(visible.get(BONNET_DAM)).toBe(false);
    });

    it('dispose runs the owner callback exactly once per call (the instance is pooled)', () => {
      const { probe } = instance();
      let released = 0;
      const handle = new EngineVehicleHandle(probe, model(), () => {
        released += 1;
      });

      handle.dispose();

      expect(released).toBe(1);
    });

    it('forwards the lamp state to the engine instance verbatim', () => {
      const { calls, handle } = lampProbe();

      handle.setLamps({ brakes: true, headlights: false, intensity: 0.75, smashed: 0 });

      expect(calls).toEqual([[false, true, 0.75, 0]]);
    });
  });
});

describe('EngineVehicleHandle light damage', () => {
  describe('negative cases', () => {
    it('a light index that is not one of SA’s four leaves the mask alone', () => {
      const { calls, handle } = litProbe();

      for (const light of [-1, 4, 1.5, Number.NaN]) {
        handle.setLightSmashed(light, true);
      }

      expect(handle.lightsSmashed()).toBe(0);
      expect(calls).toEqual([]); // and nothing is pushed to the GPU for a lamp that does not exist
    });

    it('smashing an already-smashed lamp does not re-push the same mask', () => {
      const { calls, handle } = litProbe();
      handle.setLightSmashed(LIGHT_FRONT_LEFT, true);
      calls.length = 0;

      handle.setLightSmashed(LIGHT_FRONT_LEFT, true);

      expect(calls).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('smashing a lamp sets its own bit and pushes the mask to the engine', () => {
      const { calls, handle } = lampProbe();
      handle.setLamps({ brakes: false, headlights: true, intensity: 1, smashed: 0 });

      handle.setLightSmashed(LIGHT_FRONT_RIGHT, true);
      handle.setLightSmashed(LIGHT_REAR_LEFT, true);

      expect(handle.lightsSmashed()).toBe((1 << LIGHT_FRONT_RIGHT) | (1 << LIGHT_REAR_LEFT));
      // One push per CHANGE, on top of the setLamps call — a car nobody drives is never lit again
      // otherwise, and the GPU would keep reading the mask it had at spawn.
      expect(calls).toEqual([
        [true, false, 1, 0],
        [true, false, 1, 1 << LIGHT_FRONT_RIGHT],
        [true, false, 1, (1 << LIGHT_FRONT_RIGHT) | (1 << LIGHT_REAR_LEFT)],
      ]);
    });

    it('a lamp can be repaired back to OK', () => {
      const { handle } = lampProbe();
      handle.setLightSmashed(LIGHT_FRONT_LEFT, true);

      handle.setLightSmashed(LIGHT_FRONT_LEFT, false);

      expect(handle.lightsSmashed()).toBe(0);
    });
  });
});

/** A handle over an instance that records every `setLamps` call, arguments included. */
function lampProbe(): { calls: [boolean, boolean, number, number][]; handle: EngineVehicleHandle } {
  const { probe } = instance();
  const calls: [boolean, boolean, number, number][] = [];
  const lamped = {
    ...probe,
    setLamps: (headlights: boolean, brakes: boolean, intensity: number, smashed: number): void => {
      calls.push([headlights, brakes, intensity, smashed]);
    },
  };

  return { calls, handle: new EngineVehicleHandle(lamped, model(), () => undefined) };
}

/**
 * The same probe with its lamps already switched on and the call log cleared — so a test asserting that
 * NOTHING was pushed is asserting about a handle that would otherwise have pushed.
 */
function litProbe(): { calls: [boolean, boolean, number, number][]; handle: EngineVehicleHandle } {
  const probe = lampProbe();
  probe.handle.setLamps({ brakes: false, headlights: true, intensity: 1, smashed: 0 });
  probe.calls.length = 0;

  return probe;
}
