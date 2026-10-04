import { describe, expect, it } from 'vitest';

import { cameraProjection, cameraSkyInverse } from './camera';
import { mat4Identity, mat4LookAt, type Vec3 } from './math';

function ray(m: Float32Array, x: number, y: number): number[] {
  const v = [0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[12 + r]);
  const length = Math.hypot(...v);

  return v.map((c) => c / length);
}

function sky(eye: Vec3, near = 0.03, far = 3000, fovYRad = Math.PI / 3, aspect = 16 / 9): Float32Array {
  const view = mat4Identity();
  const projection = mat4Identity();
  const target: Vec3 = [eye[0] + 3, eye[1] + 2, eye[2] - 5];
  mat4LookAt(view, eye, target, [0, 1, 0]);
  cameraProjection(projection, { aspect, eye, far, fovYRad, near, target, up: [0, 1, 0] });

  return cameraSkyInverse(mat4Identity(), projection, view);
}

describe('sky camera precision', () => {
  it('keeps every sky ray unchanged while flying at map-scale coordinates', () => {
    const expected = sky([0, 0, 0]);
    for (let i = 0; i < 120; i++) {
      const moving = sky([2900 + i * 0.125, 800 + i * 0.25, -2700 - i * 0.5]);
      expect(moving).toEqual(expected);
      for (const [x, y] of [
        [0, 0],
        [-0.9, 0.7],
        [0.8, -0.6],
      ]) {
        expect(ray(moving, x, y)).toEqual(ray(expected, x, y));
      }
    }
  });

  it('preserves the forward direction and perspective field of view at all clip distances', () => {
    const forward = [3, 2, -5].map((v) => v / Math.sqrt(38));
    for (const near of [0.01, 0.03, 0.1]) {
      for (const far of [1200, 6000]) {
        const m = sky([2800, 800, -2900], near, far);
        ray(m, 0, 0).forEach((v, i) => expect(v).toBeCloseTo(forward[i], 7));
        const top = ray(m, 0, 1);
        const cosine = top.reduce((sum, v, i) => sum + v * forward[i], 0);
        expect(Math.acos(cosine)).toBeCloseTo(Math.PI / 6, 6);
      }
    }
    const wide = sky([0, 0, 0], 0.03, 3000, Math.PI / 2, 1);
    const side = ray(wide, 1, 0);
    expect(Math.acos(side.reduce((sum, v, i) => sum + v * forward[i], 0))).toBeCloseTo(Math.PI / 4, 6);
  });
});
