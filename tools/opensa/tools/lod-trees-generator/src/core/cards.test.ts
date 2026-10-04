import { describe, expect, it } from 'vitest';

import type { Impostor } from './types';

import { buildCardGeometry } from './cards';

/** A baked impostor of `count` cards over a 2×2×10 tree, tiled in a 512² atlas. */
function impostor(count: number): Impostor {
  return {
    bbox: { max: [1, 1, 10], min: [-1, -1, 0] },
    cardAlpha: 1,
    cards: Array.from({ length: count }, (_, i) => ({
      angle: (Math.PI * i) / count,
      uvRect: { h: 256, w: 256, x: (i % 2) * 256, y: Math.floor(i / 2) * 256 },
      worldU: [-1, 1] as [number, number],
      worldZ: [0, 10] as [number, number],
    })),
    dayColor: [86, 86, 86, 255],
    height: 512,
    image: new Uint8Array(0),
    imageLinear: new Uint8Array(0),
    name: 'lodtest',
    width: 512,
  };
}

describe('buildCardGeometry', () => {
  describe('negative cases', () => {
    it('does not emit a mirrored winding — the IDE row draws the back face (plan 013 step 02)', () => {
      const { triangles } = buildCardGeometry(impostor(4));
      const key = (t: { a: number; b: number; c: number }): string => [t.a, t.b, t.c].sort().join('-');

      expect(triangles).toHaveLength(8); // 4 cards × 2, not × 4
      expect(new Set(triangles.map(key)).size).toBe(triangles.length); // no triangle drawn twice
    });
  });

  describe('positive cases', () => {
    it('emits one quad per card: 4 vertices, 2 triangles, its atlas tile in UV', () => {
      const geometry = buildCardGeometry(impostor(2));

      expect(geometry.positions).toHaveLength(2 * 4 * 3);
      expect(geometry.uvs).toHaveLength(2 * 4 * 2);
      expect(geometry.triangles).toHaveLength(2 * 2);
      expect([...geometry.uvs.slice(0, 4)]).toEqual([0, 0, 0.5, 0]); // card 0: left half, top row
    });

    it('gives every vertex the tree day colour (the atlas is normalized — plan 012)', () => {
      const { prelit } = buildCardGeometry(impostor(4));

      expect(prelit).toHaveLength(4 * 4 * 4);
      expect([...prelit.slice(0, 4)]).toEqual([86, 86, 86, 255]);
      expect([...prelit.slice(-4)]).toEqual([86, 86, 86, 255]);
    });
  });
});
