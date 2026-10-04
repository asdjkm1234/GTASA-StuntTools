import { describe, expect, it } from 'vitest';

import type { Vec3 } from './math';

import { canopyCoordinates, packCanopyCoordinate } from './canopy-surface';

describe('canopy surface coordinates', () => {
  it('wraps over the roof symmetrically and preserves longitudinal metres', () => {
    const points: Vec3[] = [
      [-1, 0, 0],
      [1, 0, 0],
      [0, 0, 1],
      [0, 2, 1],
      [Math.SQRT1_2, 1, Math.SQRT1_2],
    ];
    const uv = canopyCoordinates(points);
    expect(uv[0][0]).toBeCloseTo(-Math.PI / 2, 5);
    expect(uv[1][0]).toBeCloseTo(Math.PI / 2, 5);
    expect(uv[2]).toEqual([0, 0]);
    expect(uv[3]).toEqual([0, 2]);
    expect(uv[4][0]).toBeCloseTo(Math.PI / 4, 5);
  });

  it('is independent of the aircraft rest-position origin', () => {
    const points: Vec3[] = [
      [-0.4, 1, 0.3],
      [0.4, 1, 0.3],
      [0, 2, 1],
    ];
    const moved = points.map((p) => [p[0] + 3, p[1] - 5, p[2] + 2] as Vec3);
    const a = canopyCoordinates(points),
      b = canopyCoordinates(moved);
    a.forEach((uv, i) => uv.forEach((value, j) => expect(b[i][j]).toBeCloseTo(value, 8)));
  });

  it('round-trips signed coordinates below 0.13 mm and rejects oversized surfaces', () => {
    for (const uv of [
      [-1.321, 2.987],
      [0, 0],
      [7.999, -7.999],
    ] as const) {
      const p = packCanopyCoordinate(uv);
      const decoded = [(p[0] + p[1] * 256 - 32768) / 4096, (p[2] + p[3] * 256 - 32768) / 4096];
      uv.forEach((value, axis) => expect(Math.abs(decoded[axis] - value)).toBeLessThan(0.00013));
      expect(p.some((value) => value !== 0)).toBe(true);
    }
    expect([...packCanopyCoordinate([9, 0])]).toEqual([0, 0, 0, 0]);
    expect(canopyCoordinates([])).toEqual([]);
  });
});
