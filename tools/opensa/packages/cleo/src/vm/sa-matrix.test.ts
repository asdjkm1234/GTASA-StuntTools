import { describe, expect, it } from 'vitest';

import { quatAxes, quatFromSaEuler, quatRotateX, quatRotateY, quatRotateZ } from './sa-matrix';

/** The reversed-source expressions from `CMatrix::SetRotate(x,y,z)` (gta-reversed Core/Matrix.cpp). */
function saMatrixColumns(x: number, y: number, z: number): { forward: number[]; right: number[]; up: number[] } {
  const [sx, cx] = [Math.sin(x), Math.cos(x)];
  const [sy, cy] = [Math.sin(y), Math.cos(y)];
  const [sz, cz] = [Math.sin(z), Math.cos(z)];

  return {
    forward: [-(sz * cx), cz * cx, sx],
    right: [cz * cy - sz * sx * sy, cz * sx * sy + sz * cy, -(sy * cx)],
    up: [cz * sy + sz * sx * cy, sz * sy - cz * sx * cy, cy * cx],
  };
}

const close = (a: readonly number[], b: readonly number[]): void => {
  for (let index = 0; index < 3; index += 1) {
    expect(a[index]).toBeCloseTo(b[index], 6);
  }
};

describe('SA matrix conventions', () => {
  describe('negative cases', () => {
    it('the naive Rz·Ry·Rx order does NOT reproduce SetRotate (the recovered order is Rz·Rx·Ry)', () => {
      // With x and y both non-zero the two orders diverge — this is the 04 helper's caught bug.
      const [x, y, z] = [0.5, 0.8, 0.3];
      const expected = saMatrixColumns(x, y, z);
      const naive = quatAxes([
        // qz ⊗ qy ⊗ qx (the wrong guess)
        ...((): [number, number, number, number] => {
          const qz = quatRotateZ(z);
          const qy = quatRotateY(y);
          const qx = quatRotateX(x);
          const mul = (a: readonly number[], b: readonly number[]): [number, number, number, number] => [
            a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
            a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
            a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
            a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
          ];

          return mul(qz, mul(qy, qx));
        })(),
      ] as never);
      expect(Math.abs(naive.right[0] - expected.right[0])).toBeGreaterThan(1e-3);
    });
  });

  describe('positive cases', () => {
    it('SetRotateXOnly(a): forward=(0,cos,sin), up=(0,-sin,cos) — the reversed expressions', () => {
      const angle = Math.PI / 4;
      const axes = quatAxes(quatRotateX(angle));
      close(axes.right, [1, 0, 0]);
      close(axes.forward, [0, Math.cos(angle), Math.sin(angle)]);
      close(axes.up, [0, -Math.sin(angle), Math.cos(angle)]);
    });

    it('SetRotate(x,y,z) matches the reversed matrix term for term across angle triples', () => {
      for (const [x, y, z] of [
        [0.3, 0, 0],
        [0, 0.7, 0],
        [0, 0, 1.1],
        [0.5, 0.8, 0.3],
        [-0.4, 1.2, -2.0],
      ] as const) {
        const axes = quatAxes(quatFromSaEuler(x, y, z));
        const expected = saMatrixColumns(x, y, z);
        close(axes.right, expected.right);
        close(axes.forward, expected.forward);
        close(axes.up, expected.up);
      }
    });
  });
});
