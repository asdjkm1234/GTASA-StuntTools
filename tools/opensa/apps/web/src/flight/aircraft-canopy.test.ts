import { describe, expect, it } from 'vitest';

import type { Vec3 } from './math';

import { type CanopyPlane, constrainCanopyEye } from './aircraft-canopy';
import { CockpitLookCamera } from './cockpit-look';
import { FreeCamera } from './free-camera';

// Synthetic sloping canopy, deliberately with no game geometry.
const planes: CanopyPlane[] = [
  { distance: 0.2, normal: [0, 0.6, 0.8] },
  { distance: 0.3, normal: [1, 0, 0] },
  { distance: 0.3, normal: [-1, 0, 0] },
];
const anchor: Vec3 = [0, 0, 0];

describe('pilot canopy clearance', () => {
  it('can immediately move away from the roof after the automatic rear lean reaches it', () => {
    const input = new FreeCamera({ pitch: 0 });
    const look = new CockpitLookCamera(input, { yaw: Math.PI });
    const frame = {
      aspect: 16 / 9,
      canopy: { anchor, planes },
      eye: anchor,
      forward: [0, 0, -1] as Vec3,
      right: [1, 0, 0] as Vec3,
      up: [0, 1, 0] as Vec3,
    };
    const rear = look.state(frame);
    input.moveLevel(10, 0, 0);
    expect(look.state(frame).eye[2] - rear.eye[2]).toBeCloseTo(0.05);
  });

  it('keeps a small head movement and shortens a combined forward/up movement before the roof', () => {
    expect(constrainCanopyEye(planes, anchor, [0.1, 0.1, 0.02], 0.05)).toEqual([0.1, 0.1, 0.02]);
    const bounded = constrainCanopyEye(planes, anchor, [0.1, 0.67, 0.08], 0.05);
    expect(bounded[1]).toBeLessThan(0.67);
    expect(bounded[1] * 0.6 + bounded[2] * 0.8).toBeCloseTo(0.15);
    expect(bounded[0] / 0.1).toBeCloseTo(bounded[1] / 0.67);
  });

  it('does not teleport an unsupported mod eye to the opposite side of a surface', () => {
    expect(constrainCanopyEye(planes, [0, 0, 1], [0, 1, 1], 0.05)).toEqual([0, 0, 1]);
    expect(constrainCanopyEye([], anchor, [1, 2, 3], 0.05)).toEqual([1, 2, 3]);
  });

  it('keeps near-plane corners inside even when looking back with maximum forward/up nudges', () => {
    const input = new FreeCamera({ fovYDeg: 68, near: 0.5 });
    const look = new CockpitLookCamera(input, { height: 0.08, lateral: 0.1, longitudinal: 0.12, yaw: Math.PI });
    const state = look.state({
      aspect: 21 / 9,
      canopy: { anchor, planes },
      eye: [10, 20, 30],
      forward: [0, 0, -1],
      right: [1, 0, 0],
      up: [0, 1, 0],
    });
    expect(state.near).toBe(0.03);
    expect(input.near).toBe(0.5);
    const local: Vec3 = [state.eye[0] - 10, 30 - state.eye[2], state.eye[1] - 20];
    const radius = state.near * Math.sqrt(1 + Math.tan(state.fovYRad / 2) ** 2 * (1 + state.aspect ** 2));
    for (const plane of planes) {
      const gap = plane.distance - plane.normal.reduce((sum, value, axis) => sum + value * local[axis], 0);
      expect(gap).toBeGreaterThanOrEqual(radius + 0.0099);
    }
  });
});
