import { describe, expect, it } from 'vitest';

import type { Image } from './texture-probe';

import { smearSpread } from './texture-probe';

/** A width×1 strip whose texels take the given lumas — the row a collapsed UV drags across a face. */
const strip = (lumas: readonly number[]): Image => {
  const rgba = new Uint8Array(lumas.length * 4);
  lumas.forEach((l, i) => {
    rgba[i * 4] = l;
    rgba[i * 4 + 1] = l;
    rgba[i * 4 + 2] = l;
    rgba[i * 4 + 3] = 255;
  });

  return { height: 1, rgba, width: lumas.length };
};

/** The three UV corners of a face collapsed onto a horizontal line spanning `u0..u1`. */
const collapsedAlongU = (u0: number, u1: number): number[][] => [
  [u0, 0],
  [u1, 0],
  [(u0 + u1) / 2, 0],
];

describe('smearSpread', () => {
  describe('negative cases', () => {
    it('is zero on a flat-colour line — a wire or a plain roof panel has nothing to smear', () => {
      expect(smearSpread(strip([90, 90, 90, 90]), collapsedAlongU(0, 1))).toBe(0);
    });

    it('is zero when the face samples a single texel, however wide the span in world units', () => {
      expect(smearSpread(strip([200, 40, 200, 40]), collapsedAlongU(0.1, 0.1))).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('rises with the contrast the line actually crosses', () => {
      const gentle = smearSpread(strip([120, 130, 120, 130]), collapsedAlongU(0, 1));
      const harsh = smearSpread(strip([0, 255, 0, 255]), collapsedAlongU(0, 1));

      expect(gentle).toBeGreaterThan(0);
      expect(harsh).toBeGreaterThan(gentle * 5);
    });

    it('wraps past 1, because every tiling world texture is sampled that way', () => {
      const inside = smearSpread(strip([0, 255, 0, 255]), collapsedAlongU(0, 1));
      const wrapped = smearSpread(strip([0, 255, 0, 255]), collapsedAlongU(4, 5));

      expect(wrapped).toBeCloseTo(inside, 6);
    });

    it('reads a line running down V as well as across U', () => {
      const column: Image = {
        height: 4,
        rgba: new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]),
        width: 1,
      };

      expect(
        smearSpread(column, [
          [0, 0],
          [0, 1],
          [0, 0.5],
        ]),
      ).toBeGreaterThan(50);
    });
  });
});
