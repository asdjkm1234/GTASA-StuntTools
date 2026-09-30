import { describe, expect, it } from 'vitest';

import type { Quat } from './math';

import { buildCockpitPedalMesh, cockpitPedalMotion } from './cockpit-pedals';
import { quatMultiply } from './math';

const identity: Quat = [0, 0, 0, 1];
const z = (angle: number): Quat => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];

describe('virtual Hydra rudder pedals', () => {
  it('presses the left pedal for positive GTA rudder and the right pedal for negative rudder', () => {
    const left = cockpitPedalMotion(z((40 * Math.PI) / 180), identity, 0.28);
    expect(left.leftTravel).toBeCloseTo(0.07);
    expect(left.rightTravel).toBeCloseTo(-0.07);
    expect(left.source).toBe('recorded');
    const right = cockpitPedalMotion(z((-40 * Math.PI) / 180), identity, -0.28);
    expect(right.control).toBeCloseTo(1);
    expect(right.leftTravel + right.rightTravel).toBe(0);
    expect(cockpitPedalMotion(identity, identity, 0.28).control).toBe(0);
  });

  it('removes the authored bind, accepts both quaternion signs and has no seek history', () => {
    const bind: Quat = [Math.sin(0.2), 0, 0, Math.cos(0.2)];
    const node = quatMultiply(z(0.2), bind);
    const motion = cockpitPedalMotion(node, bind, 0);
    expect(motion.control).toBeCloseTo(-0.2 / ((40 * Math.PI) / 180));
    cockpitPedalMotion(identity, identity, 0);
    expect(cockpitPedalMotion(node, bind, 0)).toEqual(motion);
    expect(cockpitPedalMotion(node.map((v) => -v) as Quat, bind, 0).control).toBeCloseTo(motion.control);
  });

  it('falls back only when the node is missing/invalid and bounds excessive travel', () => {
    expect(cockpitPedalMotion(null, identity, -0.28)).toMatchObject({ control: -1, source: 'inferred' });
    expect(cockpitPedalMotion([NaN, 0, 0, 1], identity, 0.28).control).toBe(1);
    expect(cockpitPedalMotion(null, null, Infinity).control).toBe(0);
    expect(Math.abs(cockpitPedalMotion(z(2), identity, 0).leftTravel)).toBe(0.07);
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
});
