import type { Engine, VehicleModelInit } from '@opensa/engine';

import { RigidEntity } from '@opensa/engine/entities/rigid';
import { describe, expect, it } from 'vitest';

import { createCockpitPedals } from './cockpit-pedals';
import { buildRustlerPedalMesh, RUSTLER_PEDAL_ARM } from './rustler-pedals';

describe('Rustler P-51-inspired pedals', () => {
  it('keeps the complete rigid plate and linkage inside the footwell over both strokes', () => {
    const model = buildRustlerPedalMesh(new Uint8Array(256 ** 2 * 4));
    const entity = new RigidEntity(model.parts);
    const visible: boolean[] = [];
    const engine = {
      createVehicle: () => ({
        entity,
        setSubmeshVisible: (i: number, value: boolean): void => {
          visible[i] = value;
        },
      }),
      createVehicleModel: () => 0,
    } as unknown as Engine;
    const pedals = createCockpitPedals(engine, model, RUSTLER_PEDAL_ARM);
    const positions = new Float32Array(model.positions.buffer);
    const indices = new Uint16Array(model.indices.buffer);
    const world = (): number[][][] => {
      entity.flatten();

      return model.submeshes.slice(1).map((mesh) => {
        const matrix = entity.matrices.subarray(mesh.part * 16, mesh.part * 16 + 16);

        return [...new Set(indices.subarray(mesh.indexOffset, mesh.indexOffset + mesh.indexCount))].map((i) =>
          [0, 1, 2].map(
            (a) =>
              matrix[a] * positions[i * 3] +
              matrix[a + 4] * positions[i * 3 + 1] +
              matrix[a + 8] * positions[i * 3 + 2] +
              matrix[a + 12],
          ),
        );
      });
    };
    const identity = [0, 0, 0, 1] as const;
    pedals.update([...identity], [...identity]);
    const neutral = world();
    const fixed = entity.matrices.slice(0, 16);
    for (const sign of [-1, 1]) {
      const angle = (sign * 40 * Math.PI) / 180;
      pedals.update([0, 0, Math.sin(angle / 2), Math.cos(angle / 2)], [...identity]);
      const moved = world();
      expect(entity.matrices.subarray(0, 16)).toEqual(fixed);
      const active = sign < 0 ? 0 : 1;
      expect(moved[1 - active]).toEqual(neutral[1 - active]);
      const mesh = model.submeshes[active + 1];
      const ids = [...new Set(indices.subarray(mesh.indexOffset, mesh.indexOffset + mesh.indexCount))];
      // Center vertex of the real plate, read from its textured front rather than a duplicate formula.
      const face = ids.findIndex((i) => model.colors[i * 4] === 255);
      expect(moved[active][face][1] - neutral[active][face][1]).toBeCloseTo(0.07, 2);
      const pivot = model.parts[active + 1].localTranslation;
      moved[active].forEach((p, i) =>
        expect(Math.hypot(...p.map((v, a) => v - pivot[a]))).toBeCloseTo(
          Math.hypot(...neutral[active][i].map((v, a) => v - pivot[a])),
          6,
        ),
      );
      for (const p of moved.flat()) {
        expect(Math.abs(p[0])).toBeLessThan(0.26);
        expect(p[1]).toBeGreaterThan(0.4);
        expect(p[1]).toBeLessThan(0.72);
        expect(p[2]).toBeGreaterThan(-0.5);
        expect(p[2]).toBeLessThan(0);
      }
    }
    pedals.update([...identity], [...identity]);
    expect(world()).toEqual(neutral);
    pedals.update(null, [...identity]);
    expect(visible).toEqual([true, false, false]);
    pedals.update([...identity], [...identity], 2);
    expect(pedals.state?.source).toBe('unknown');
    pedals.setVisible(false);
    expect(visible).toEqual([false, false, false]);
    pedals.update([...identity], [...identity]);
    expect(visible).toEqual([false, false, false]);
    pedals.setVisible(true);
    expect(visible).toEqual([true, true, true]);
  });

  it('has opaque matte plates with outward triangle winding and the linkage behind each face', () => {
    const model: VehicleModelInit = buildRustlerPedalMesh(new Uint8Array(256 ** 2 * 4));
    const p = new Float32Array(model.positions.buffer);
    const normals = new Float32Array(model.normals.buffer);
    const indices = new Uint16Array(model.indices.buffer);
    expect(model.submeshes).toHaveLength(3);
    expect(model.submeshes.every((s) => !s.translucent)).toBe(true);
    expect(model.reflect.every((v) => v === 0)).toBe(true);
    for (let at = 0; at < indices.length; at += 3) {
      const points = Array.from(indices.subarray(at, at + 3), (i) => Array.from(p.subarray(i * 3, i * 3 + 3)));
      const u = points[1].map((v, i) => v - points[0][i]);
      const v = points[2].map((x, i) => x - points[0][i]);
      const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const n = normals.subarray(indices[at] * 3, indices[at] * 3 + 3);
      expect(cross.reduce((sum, value, i) => sum + value * n[i], 0)).toBeGreaterThan(0);
    }
    for (const mesh of model.submeshes.slice(1)) {
      const ids = [...new Set(indices.subarray(mesh.indexOffset, mesh.indexOffset + mesh.indexCount))];
      const face = ids.find((i) => model.colors[i * 4] === 255)!;
      const n = normals.subarray(face * 3, face * 3 + 3);
      for (const i of ids.filter((i) => [85, 100].includes(model.colors[i * 4])))
        expect(n.reduce((sum, value, a) => sum + value * (p[i * 3 + a] - p[face * 3 + a]), 0)).toBeLessThan(-0.002);
    }
  });
});
