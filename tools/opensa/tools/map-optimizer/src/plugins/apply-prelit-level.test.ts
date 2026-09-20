import { describe, expect, it } from 'vitest';

import { shiftPrelit, tailGuard } from './apply-prelit-level';

/** RGBA buffer from per-vertex grey lumas (alpha 200 — must never change). */
function prelitOf(lumas: number[]): Uint8Array {
  const out = new Uint8Array(lumas.length * 4);
  lumas.forEach((luma, i) => {
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = luma;
    out[i * 4 + 3] = 200;
  });

  return out;
}

const lumaAt = (prelit: Uint8Array, i: number): number => prelit[i * 4];

describe('shiftPrelit / tailGuard', () => {
  describe('negative cases', () => {
    it('a darkening shift never touches vertices at/above the tail end', () => {
      const prelit = prelitOf([50, 240]);
      shiftPrelit(prelit, { protectFrom: 100, protectTo: 140, shift: -40 });

      expect(lumaAt(prelit, 0)).toBe(10); // full shift below the tail
      expect(lumaAt(prelit, 1)).toBe(240); // lit window stays lit
    });

    it('never changes alpha', () => {
      const prelit = prelitOf([50]);
      shiftPrelit(prelit, { protectFrom: 100, protectTo: 140, shift: 60 });

      expect(prelit[3]).toBe(200);
    });
  });

  describe('positive cases', () => {
    it('lifts every vertex by the full shift (no guard when brightening)', () => {
      const prelit = prelitOf([27, 120, 250]);
      shiftPrelit(prelit, { protectFrom: 100, protectTo: 140, shift: 53 });

      expect(lumaAt(prelit, 0)).toBe(80);
      expect(lumaAt(prelit, 1)).toBe(173);
      expect(lumaAt(prelit, 2)).toBe(255); // clamped
    });

    it('fades a darkening shift linearly across the tail', () => {
      const prelit = prelitOf([120]); // halfway through [100, 140] → half the shift
      shiftPrelit(prelit, { protectFrom: 100, protectTo: 140, shift: -40 });

      expect(lumaAt(prelit, 0)).toBe(100);
    });

    it('tailGuard is 1 below the tail, 0 above, linear between', () => {
      expect(tailGuard(50, 100, 140)).toBe(1);
      expect(tailGuard(140, 100, 140)).toBe(0);
      expect(tailGuard(120, 100, 140)).toBeCloseTo(0.5);
    });
  });
});
