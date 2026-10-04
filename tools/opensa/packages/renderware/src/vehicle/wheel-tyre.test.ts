import { describe, expect, it } from 'vitest';

import type { RWGeometry, RWMaterial } from '../parsers/binary/types';

import { GeometryFlag } from '../parsers/binary/constants';
import { tyreMaterials } from './wheel-tyre';

function material(): RWMaterial {
  return { color: [255, 255, 255, 255], texture: null, textured: false };
}

/**
 * A wheel as a ring of triangles per BAND, axle along X: `bands` are [innerRadius, outerRadius] pairs, one
 * material each — the shape every wheel in the game has, at the resolution this test needs.
 */
function wheel(bands: readonly [number, number][]): RWGeometry {
  const positions: number[] = [];
  const triangles: RWGeometry['triangles'] = [];
  bands.forEach((band, materialIndex) => {
    const segments = 16;
    for (let segment = 0; segment < segments; segment += 1) {
      const angle = (segment / segments) * Math.PI * 2;
      const next = ((segment + 1) / segments) * Math.PI * 2;
      const corner = (radius: number, at: number): number => {
        positions.push(0, Math.cos(at) * radius, Math.sin(at) * radius);

        return positions.length / 3 - 1;
      };
      const a = corner(band[0], angle);
      const b = corner(band[1], angle);
      const c = corner(band[1], next);
      triangles.push({ a, b, c, materialIndex });
    }
  });

  return {
    flags: GeometryFlag.POSITIONS,
    lights: [],
    materials: bands.map(() => material()),
    nightColors: null,
    normals: null,
    numUVLayers: 0,
    positions: new Float32Array(positions),
    prelitColors: null,
    triangles,
    uvLayers: [],
  };
}

describe('tyreMaterials', () => {
  describe('negative cases', () => {
    it('finds nothing in a missing geometry', () => {
      expect(tyreMaterials(undefined).size).toBe(0);
    });

    it('finds no tyre when ONE material covers the whole wheel — some cars have none', () => {
      expect(tyreMaterials(wheel([[0, 0.35]])).size).toBe(0);
    });

    it('does not call a hub cap with a long spoke a tyre', () => {
      // Reaches the rim, but its mass sits at the middle — the rim is supposed to keep its reflection.
      expect(tyreMaterials(wheel([[0.02, 0.33]])).size).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('picks the outer band and leaves the rim alone', () => {
      // 0.24-0.35 over a 0.35 wheel = the measured tyre band (mean 0.87-0.98 of max); the disc is 0-0.24.
      const tyres = tyreMaterials(
        wheel([
          [0, 0.24],
          [0.24, 0.35],
        ]),
      );

      expect([...tyres]).toEqual([1]);
    });

    it('picks BOTH tyre materials when the tread is authored apart from the sidewall (the comet case)', () => {
      const tyres = tyreMaterials(
        wheel([
          [0, 0.22],
          [0.28, 0.34],
          [0.34, 0.36],
        ]),
      );

      expect([...tyres]).toEqual([1, 2]);
    });
  });
});
