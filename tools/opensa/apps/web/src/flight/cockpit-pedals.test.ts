import type { Engine, VehicleModelInit } from '@opensa/engine';

import { RigidEntity } from '@opensa/engine/entities/rigid';
import { describe, expect, it } from 'vitest';

import type { Quat } from './math';

import { buildCockpitPedalMesh, cockpitPedalMotion, createCockpitPedals } from './cockpit-pedals';
import { quatMultiply } from './math';

const identity: Quat = [0, 0, 0, 1];
const z = (angle: number): Quat => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];

describe('virtual Hydra rudder pedals', () => {
  it('presses the left pedal for left trailing-edge deflection and the right pedal for right deflection', () => {
    const left = cockpitPedalMotion(z((-40 * Math.PI) / 180), identity);
    expect(left.leftTravel).toBeCloseTo(0.07);
    expect(left.rightTravel).toBe(0);
    expect(left.rightAngle).toBe(0);
    expect(left.source).toBe('recorded');
    const right = cockpitPedalMotion(z((40 * Math.PI) / 180), identity);
    expect(right.control).toBeCloseTo(1);
    expect(right.leftTravel).toBe(0);
    expect(right.leftAngle).toBe(0);
    expect(cockpitPedalMotion(identity, identity).control).toBe(0);
  });

  it('removes the authored bind, accepts both quaternion signs and has no seek history', () => {
    const bind: Quat = [Math.sin(0.2), 0, 0, Math.cos(0.2)];
    const node = quatMultiply(z(0.2), bind);
    const motion = cockpitPedalMotion(node, bind);
    expect(motion.control).toBeCloseTo(0.2 / ((40 * Math.PI) / 180));
    cockpitPedalMotion(identity, identity);
    expect(cockpitPedalMotion(node, bind)).toEqual(motion);
    expect(cockpitPedalMotion(node.map((v) => -v) as Quat, bind).control).toBeCloseTo(motion.control);
  });

  it('marks missing/invalid nodes unknown and bounds excessive travel', () => {
    expect(cockpitPedalMotion(null, identity)).toMatchObject({ control: 0, source: 'unknown' });
    expect(cockpitPedalMotion([NaN, 0, 0, 1], identity).control).toBe(0);
    expect(cockpitPedalMotion(null, null).control).toBe(0);
    expect(cockpitPedalMotion(z(2), identity).rightTravel).toBe(0.07);
  });

  it('swings the actual rigid plates about fixed upper pivots without stretching the linkage', () => {
    let model!: VehicleModelInit;
    let entity!: RigidEntity;
    const visible: boolean[] = [];
    const engine = {
      createVehicle() {
        entity = new RigidEntity(model.parts);

        return {
          entity,
          setSubmeshVisible: (index: number, value: boolean): void => {
            visible[index] = value;
          },
        };
      },
      createVehicleModel(init: VehicleModelInit): number {
        model = init;

        return 0;
      },
    } as unknown as Engine;
    const pedals = createCockpitPedals(engine);
    const positions = new Float32Array(model.positions.buffer);
    const indices = new Uint16Array(model.indices.buffer);
    // Read each rear attachment boss from the mesh, rather than duplicating its anchor formula.
    const centers = model.submeshes.slice(1).map((mesh) => {
      const vertices = [...new Set(indices.subarray(mesh.indexOffset, mesh.indexOffset + mesh.indexCount))].filter(
        (index) => model.colors[index * 4] === 100,
      );

      return [0, 1, 2].map(
        (axis) => vertices.reduce((sum, index) => sum + positions[index * 3 + axis], 0) / vertices.length,
      );
    });
    const points = (): number[][] => {
      entity.flatten();

      return centers.map((point, index) => {
        const matrix = entity.matrices.subarray((index + 1) * 16, (index + 2) * 16);

        return [0, 1, 2].map(
          (axis) =>
            matrix[axis] * point[0] + matrix[axis + 4] * point[1] + matrix[axis + 8] * point[2] + matrix[axis + 12],
        );
      });
    };
    pedals.update(identity, identity);
    const neutral = points();
    const original = entity.matrices.slice();
    for (const sign of [-1, 1]) {
      pedals.update(z((sign * 40 * Math.PI) / 180), identity);
      const moved = points();
      expect(entity.matrices.subarray(0, 16)).toEqual(original.subarray(0, 16));
      moved.forEach((point, index) => {
        const pivot = model.parts[index + 1].localTranslation;
        expect(entity.matrices.subarray((index + 1) * 16 + 12, (index + 1) * 16 + 15)).toEqual(
          original.subarray((index + 1) * 16 + 12, (index + 1) * 16 + 15),
        );
        expect(Math.hypot(...point.map((value, axis) => value - pivot[axis]))).toBeCloseTo(
          Math.hypot(...neutral[index].map((value, axis) => value - pivot[axis])),
          6,
        );
        const active = (index === 0 && sign < 0) || (index === 1 && sign > 0);
        expect(point[1] - neutral[index][1]).toBeCloseTo(active ? 0.07 : 0, 2);
        if (active) expect(point[2]).not.toBeCloseTo(neutral[index][2], 3);
        else expect(point).toEqual(neutral[index]);
      });
    }
    pedals.update(identity, identity);
    points();
    expect(entity.matrices).toEqual(original);
    pedals.update(null, identity);
    expect(visible).toEqual([true, false, false]);
  });

  it('builds closed solid pedals with outward faces and symmetric placement below the dashboard', () => {
    const model = buildCockpitPedalMesh();
    const positions = new Float32Array(model.positions.buffer);
    const normals = new Float32Array(model.normals.buffer);
    const indices = new Uint16Array(model.indices.buffer);
    expect(model.parts[1].localTranslation[0]).toBe(-model.parts[2].localTranslation[0]);
    expect(model.parts[1].localTranslation.slice(1)).toEqual(model.parts[2].localTranslation.slice(1));
    expect(model.submeshes.every((s) => !s.translucent)).toBe(true);
    expect(model.reflect.every((v) => v === 0)).toBe(true);
    expect(model.colors.filter((_, i) => i % 4 === 3).every((v) => v === 255)).toBe(true);
    // Winding must match supplied normals or culling makes a pedal face disappear.
    for (let i = 0; i < indices.length; i += 3) {
      const [a, b, c] = Array.from(indices.subarray(i, i + 3), (v) => Array.from(positions.subarray(v * 3, v * 3 + 3)));
      const u = b.map((v, j) => v - a[j]),
        v = c.map((p, j) => p - a[j]);
      const cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const n = normals.subarray(indices[i] * 3, indices[i] * 3 + 3);
      expect(cross.reduce((sum, p, j) => sum + p * n[j], 0)).toBeGreaterThan(0);
    }
  });

  it('keeps the thick arm and attachment boss behind the actual pedal face', () => {
    const model = buildCockpitPedalMesh();
    const positions = new Float32Array(model.positions.buffer);
    const normals = new Float32Array(model.normals.buffer);
    const indices = new Uint16Array(model.indices.buffer);
    for (const mesh of model.submeshes.slice(1)) {
      const vertices = [...new Set(indices.subarray(mesh.indexOffset, mesh.indexOffset + mesh.indexCount))];
      const face = vertices.find((index) => model.colors[index * 4] === 135)!;
      const origin = positions.subarray(face * 3, face * 3 + 3);
      const normal = normals.subarray(face * 3, face * 3 + 3);
      const linkage = vertices.filter((index) => [85, 100].includes(model.colors[index * 4]));
      expect(linkage.length).toBeGreaterThan(0);
      for (const index of linkage) {
        // Both pieces rotate with the plate; this clearance holds over the whole pedal stroke.
        const distance = normal.reduce(
          (sum, value, axis) => sum + value * (positions[index * 3 + axis] - origin[axis]),
          0,
        );
        expect(distance).toBeLessThan(-0.002);
      }
    }
  });
});
