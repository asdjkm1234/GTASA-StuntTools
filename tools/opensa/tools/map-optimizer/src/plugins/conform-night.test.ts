import { describe, expect, it } from 'vitest';

import { capNightSet, scaleNightSet, synthesizeNightSet } from './conform-night';

function rgbaOf(lumas: number[], alpha = 255): Uint8Array {
  const out = new Uint8Array(lumas.length * 4);
  lumas.forEach((luma, i) => {
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = luma;
    out[i * 4 + 3] = alpha;
  });

  return out;
}

const lumaAt = (rgba: Uint8Array, i: number): number => rgba[i * 4];

describe('scaleNightSet / synthesizeNightSet', () => {
  describe('negative cases', () => {
    it('a darkening scale keeps the bright tail glowing (lit windows survive the repair)', () => {
      const night = rgbaOf([64, 240]);
      scaleNightSet(night, { protectFrom: 100, protectTo: 140, scale: 0.375 });

      expect(lumaAt(night, 0)).toBe(24); // wall comes down to the street's night level
      expect(lumaAt(night, 1)).toBe(240); // the window stays lit
    });
  });

  describe('positive cases', () => {
    it('capNightSet dims only vertices above the ceiling, hue preserved (newvic1 window-glow case)', () => {
      const night = new Uint8Array([19, 19, 19, 255, 200, 100, 0, 255]); // dark wall + orange glow (luma 100)
      capNightSet(night, 50);

      expect([...night.subarray(0, 4)]).toEqual([19, 19, 19, 255]); // wall untouched
      expect(night[4]).toBe(100); // 200 × 50/100 — hue ratio kept
      expect(night[5]).toBe(50);
      expect(night[6]).toBe(0);
      expect(night[7]).toBe(255); // alpha untouched
    });

    it('brightening applies the full scale everywhere (no guard)', () => {
      const night = rgbaOf([20, 200]);
      scaleNightSet(night, { protectFrom: 100, protectTo: 140, scale: 1.5 });

      expect(lumaAt(night, 0)).toBe(30);
      expect(lumaAt(night, 1)).toBe(255); // clamped
    });

    it('synthesizes a night set from day prelit at the given ratio, alpha forced opaque', () => {
      const night = synthesizeNightSet(rgbaOf([100, 200], 60), 0.3);

      expect(lumaAt(night, 0)).toBe(30);
      expect(lumaAt(night, 1)).toBe(60);
      expect(night[3]).toBe(255);
      expect(night[7]).toBe(255);
    });
  });
});
