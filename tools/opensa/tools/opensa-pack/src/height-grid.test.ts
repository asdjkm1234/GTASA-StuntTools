import { describe, expect, it } from 'vitest';

import { WaterHeightGrid } from './height-grid';

describe('WaterHeightGrid', () => {
  describe('negative cases', () => {
    it('rejects triangles entirely above the sea band', () => {
      const grid = new WaterHeightGrid();
      grid.addTriangle(0, 0, 10, 40, 0, 12, 0, 40, 11);
      expect(grid.size).toBe(0);
      expect(grid.heightAt(10, 10)).toBeNull();
    });

    it('returns null where nothing rasterized', () => {
      const grid = new WaterHeightGrid();
      grid.addTriangle(0, 0, -5, 40, 0, -5, 0, 40, -5);
      expect(grid.heightAt(500, 500)).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('rasterizes a flat sea-band triangle and keeps the max height per cell', () => {
      const grid = new WaterHeightGrid();
      grid.addTriangle(0, 0, -5, 40, 0, -5, 0, 40, -5);
      grid.addTriangle(0, 0, -2, 40, 0, -2, 0, 40, -2); // higher ground wins
      expect(grid.heightAt(6, 6)).toBeCloseTo(-2, 5);
    });

    it('clips the above-band part of a straddling beach triangle per cell', () => {
      // The SA beach-slope case: one huge triangle from −10 (seabed) up to +15 (berm) — the underwater
      // part must rasterize, the above-band part must not.
      const grid = new WaterHeightGrid();
      grid.addTriangle(0, 0, -10, 200, 0, -10, 0, 200, 15);
      const deep = grid.heightAt(50, 6);
      const high = grid.heightAt(6, 190);
      expect(deep).not.toBeNull();
      expect(deep as number).toBeLessThan(0);
      expect(high).toBeNull(); // interpolated z there is ~+13 — above the sea band
    });

    it('interpolates the slope height barycentrically', () => {
      const grid = new WaterHeightGrid();
      grid.addTriangle(0, 0, -8, 64, 0, 0, 0, 64, -8);
      const mid = grid.heightAt(30, 2);
      expect(mid).not.toBeNull();
      expect(mid as number).toBeGreaterThan(-8);
      expect(mid as number).toBeLessThan(0);
    });
  });
});
