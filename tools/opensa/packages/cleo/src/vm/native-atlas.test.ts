import { describe, expect, it } from 'vitest';

import type { NativeWorld } from './native-atlas';

import { AtlasMemory, SA } from './native-atlas';
import { quatRotateX } from './sa-matrix';

interface Recorded {
  lights: { car: number; light: number; status: number }[];
  rotations: { car: number; part: number; quat: readonly number[] }[];
  translations: { axis: number; car: number; part: number; value: number }[];
}

function makeWorld(overrides: Partial<NativeWorld> = {}): NativeWorld & Recorded {
  const lights: Recorded['lights'] = [];
  const rotations: Recorded['rotations'] = [];
  const translations: Recorded['translations'] = [];

  return {
    doorAngleRatio: () => 0.5,
    lights,
    lightStatus: (car, light) => lights.filter((row) => row.car === car && row.light === light).pop()?.status ?? 0,
    lodDistMultiplier: () => 1.25,
    nextSiblingPart: (car, part) => (part < 16 ? part + 1 : null),
    partForward: () => [0, 0.8, 0.6],
    partIndex: (car, name) => (name === 'missing' ? null : name.length),
    partTranslation: () => [1, 2, 3],
    rotations,
    setLightStatus: (car, light, status): void => {
      lights.push({ car, light, status });
    },
    setPartRotation: (car, part, quat): void => {
      rotations.push({ car, part, quat });
    },
    setPartTranslationComponent: (car, part, axis, value): void => {
      translations.push({ axis, car, part, value });
    },
    translations,
    vehicleHandles: () => [257, 1026], // slots 1 and 4, counters 1 and 2
    wind: () => 0.4,
    ...overrides,
  };
}

describe('AtlasMemory', () => {
  describe('negative cases', () => {
    it('an unknown global read returns null and records ONE miss', () => {
      const atlas = new AtlasMemory(makeWorld());
      expect(atlas.read(0x123456, 4)).toBeNull();
      atlas.read(0x123456, 4);
      expect(atlas.misses).toHaveLength(1);
      expect(atlas.misses[0]).toMatchObject({ address: 0x123456, kind: 'read' });
    });

    it('an unknown function call returns null and records the address', () => {
      const atlas = new AtlasMemory(makeWorld());
      expect(atlas.call(0xdeadbf, null, [])).toBeNull();
      expect(atlas.misses[0].kind).toBe('call');
    });

    it('a write to an unmapped field is refused and recorded, never silently applied', () => {
      const world = makeWorld();
      const atlas = new AtlasMemory(world);
      const vehicle = atlas.pointerOf(257);
      expect(atlas.write(vehicle + 0x100, 4, { float: 1, int: 1 })).toBe(false);
      expect(world.translations).toHaveLength(0);
      expect(atlas.misses[0].kind).toBe('write');
    });

    it('GetFrameFromName on a MISSING frame name yields a null pointer (0), not a fault', () => {
      const atlas = new AtlasMemory(makeWorld());
      const clump = atlas.read(atlas.pointerOf(257) + 0x18, 4);
      const frame = atlas.call(SA.GET_FRAME_FROM_NAME, null, [
        { kind: 'string', value: 'missing' },
        { float: 0, int: clump && clump.kind === 'int' ? clump.value : 0, kind: 'raw' },
      ]);
      expect(frame).toEqual({ kind: 'int', value: 0 });
    });

    it('SetLightStatus on anything but a vehicle m_damageManager is refused, not applied', () => {
      const world = makeWorld();
      const atlas = new AtlasMemory(world);
      const vehicle = atlas.pointerOf(257);

      // The vehicle itself, a WRONG offset, and a raw address — none of them is the damage manager.
      for (const struct of [vehicle, vehicle + 0x5a4, 0x6c2100]) {
        atlas.call(SA.SET_LIGHT_STATUS, struct, [
          { kind: 'int', value: 0 },
          { kind: 'int', value: 1 },
        ]);
      }

      expect(world.lights).toHaveLength(0);
      expect(atlas.misses.every((miss) => miss.kind === 'call')).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('serves the named globals: wind and the LOD distance multiplier', () => {
      const atlas = new AtlasMemory(makeWorld());
      expect(atlas.read(SA.WEATHER_WIND, 4)).toEqual({ kind: 'float', value: 0.4 });
      expect(atlas.read(SA.LOD_DIST_MULTIPLIER, 4)).toEqual({ kind: 'float', value: 1.25 });
    });

    it('walks the vehicle pool exactly as rhino does: base → +4 byteMap → per-slot bytes', () => {
      const atlas = new AtlasMemory(makeWorld());
      const pool = atlas.read(SA.VEHICLE_POOL, 4);
      expect(pool?.kind).toBe('int');
      const poolToken = pool && pool.kind === 'int' ? pool.value : 0;
      const bytes = atlas.read(poolToken + 4, 4);
      const bytesToken = bytes && bytes.kind === 'int' ? bytes.value : 0;
      // Slot 1 holds handle 257 (counter 1), slot 4 holds 1026 (counter 2), slot 2 is free.
      expect(atlas.read(bytesToken + 1, 1)).toEqual({ kind: 'int', value: 1 });
      expect(atlas.read(bytesToken + 4, 1)).toEqual({ kind: 'int', value: 2 });
      expect(atlas.read(bytesToken + 2, 1)).toEqual({ kind: 'int', value: 0x80 });
    });

    it('vehicle + 0x5A0 is the damage manager: SetLightStatus lands, GetLightStatus reads it back', () => {
      const world = makeWorld();
      const atlas = new AtlasMemory(world);
      // no_lights' own shape: GET_VEHICLE_POINTER, then += 1440 with PLAIN arithmetic.
      const damage = atlas.pointerOf(257) + 1440;

      // Args arrive in the SA function's C order (light, status) — handlers/natives.ts already undid
      // CLEO's reversed push order.
      atlas.call(SA.SET_LIGHT_STATUS, damage, [
        { kind: 'int', value: 2 },
        { kind: 'int', value: 1 },
      ]);

      expect(world.lights).toEqual([{ car: 257, light: 2, status: 1 }]);
      expect(atlas.call(SA.GET_LIGHT_STATUS, damage, [{ kind: 'int', value: 2 }])).toEqual({ kind: 'int', value: 1 });
      expect(atlas.call(SA.GET_LIGHT_STATUS, damage, [{ kind: 'int', value: 3 }])).toEqual({ kind: 'int', value: 0 });
      expect(atlas.misses).toHaveLength(0);
    });

    it('vehicle+0x18 yields the clump; GetFrameFromName + 16 + SetRotateXOnly rotates the part', () => {
      const world = makeWorld();
      const atlas = new AtlasMemory(world);
      const clump = atlas.read(atlas.pointerOf(257) + 0x18, 4);
      const clumpToken = clump && clump.kind === 'int' ? clump.value : 0;
      const frame = atlas.call(SA.GET_FRAME_FROM_NAME, null, [
        { kind: 'string', value: 'misc_a' },
        { float: 0, int: clumpToken, kind: 'raw' },
      ]);
      const frameToken = frame && frame.kind === 'int' ? frame.value : 0;
      expect(frameToken).not.toBe(0);
      // firela: += 16 with PLAIN arithmetic, then CALL_METHOD SetRotateXOnly(π/4).
      atlas.call(SA.SET_ROTATE_X_ONLY, frameToken + 16, [{ kind: 'float', value: Math.PI / 4 }]);
      expect(world.rotations).toHaveLength(1);
      const expected = quatRotateX(Math.PI / 4);
      world.rotations[0].quat.forEach((component, index) => {
        expect(component).toBeCloseTo(expected[index], 6);
      });
    });

    it('vehicle+0x658 (carNodes[4]) resolves the RB wheel part; frame matrix reads serve forward and pos', () => {
      const world = makeWorld();
      const atlas = new AtlasMemory(world);
      const node = atlas.read(atlas.pointerOf(257) + 0x658, 4);
      const frameToken = node && node.kind === 'int' ? node.value : 0;
      expect(frameToken).not.toBe(0);
      // rhino: frame+32/36/40 = matrix m_forward; frame+64/68/72 = matrix m_pos.
      expect(atlas.read(frameToken + 36, 4)).toEqual({ kind: 'float', value: 0.8 });
      expect(atlas.read(frameToken + 64, 4)).toEqual({ kind: 'float', value: 1 });
      expect(atlas.read(frameToken + 72, 4)).toEqual({ kind: 'float', value: 3 });
    });

    it('frame+0x9C walks the sibling chain and ends with a null pointer', () => {
      const atlas = new AtlasMemory(makeWorld());
      const first = atlas.read(atlas.pointerOf(257) + 0x658, 4);
      let frameToken = first && first.kind === 'int' ? first.value : 0;
      const seen: number[] = [];
      for (let hops = 0; hops < 5 && frameToken !== 0; hops += 1) {
        seen.push(frameToken);
        const next = atlas.read(frameToken + 0x9c, 4);
        frameToken = next && next.kind === 'int' ? next.value : 0;
      }
      expect(seen.length).toBeGreaterThan(1);
      expect(frameToken).toBe(0);
    });

    it('matrix pos writes land as per-component translations (the vandoor slide)', () => {
      const world = makeWorld();
      const atlas = new AtlasMemory(world);
      const clump = atlas.read(atlas.pointerOf(257) + 0x18, 4);
      const frame = atlas.call(SA.GET_FRAME_FROM_NAME, null, [
        { kind: 'string', value: 'dvan_l' },
        { float: 0, int: clump && clump.kind === 'int' ? clump.value : 0, kind: 'raw' },
      ]);
      const frameToken = frame && frame.kind === 'int' ? frame.value : 0;
      expect(atlas.write(frameToken + 68, 4, { float: 0.5, int: 0 })).toBe(true);
      expect(world.translations).toEqual([{ axis: 1, car: 257, part: 'dvan_l'.length, value: 0.5 }]);
    });

    it('pointerOf/handleOf round-trip vehicle handles', () => {
      const atlas = new AtlasMemory(makeWorld());
      const token = atlas.pointerOf(1026);
      expect(atlas.handleOf(token)).toBe(1026);
      expect(atlas.handleOf(12345)).toBeNull();
    });
  });
});
