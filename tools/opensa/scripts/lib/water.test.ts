import type { WaterQuad } from '@opensa/renderware/parsers/text/water.parser';

import { describe, expect, it } from 'vitest';

import { waterField } from './water';

/** A vanilla-shaped quad: corners in GRID order (bl, br, tl, tr), which is how `water.dat` stores them. */
const gridQuad = (x0: number, y0: number, x1: number, y1: number, z = 0): WaterQuad => ({
  vertices: [
    [x0, y0, z],
    [x1, y0, z],
    [x0, y1, z],
    [x1, y1, z],
  ],
});

describe('waterField', () => {
  describe('negative cases', () => {
    it('answers null where the map has no water polygon', () => {
      const field = waterField([gridQuad(0, 0, 100, 100)]);

      expect(field.heightAt(500, 500)).toBeNull();
      expect(field.heightAt(-1, 50)).toBeNull();
    });

    it('answers null for an empty file rather than pretending the map is dry land at sea level', () => {
      expect(waterField([]).heightAt(0, 0)).toBeNull();
    });

    it('takes a sloping quad by its LOWEST corner, so a partly-dry face is never called submerged', () => {
      const sloped: WaterQuad = {
        vertices: [
          [0, 0, 0],
          [100, 0, 8],
          [0, 100, 0],
          [100, 100, 8],
        ],
      };

      expect(waterField([sloped]).heightAt(90, 50)).toBe(0);
    });
  });

  describe('positive cases', () => {
    /**
     * The regression that pays for this file: `water.dat` stores corners in GRID order, so walking them as a
     * perimeter traces a bowtie and a loop-based point-in-polygon test hits NOTHING — 307 real polygons and
     * `heightAt` answered null over the entire map.
     */
    it('finds a point inside a GRID-ordered quad, not just a perimeter-ordered one', () => {
      const field = waterField([gridQuad(-1584, -1826, -1360, -1642)]);

      expect(field.heightAt(-1500, -1700)).toBe(0);
      expect(field.heightAt(-1584, -1826)).toBe(0); // corner
      expect(field.heightAt(-1472, -1734)).toBe(0); // centre
    });

    it('reads a quad in perimeter order too — the test must not encode one ordering', () => {
      const perimeter: WaterQuad = {
        vertices: [
          [0, 0, 0],
          [100, 0, 0],
          [100, 100, 0],
          [0, 100, 0],
        ],
      };

      expect(waterField([perimeter]).heightAt(50, 50)).toBe(0);
    });

    it('handles a three-corner polygon', () => {
      const triangle: WaterQuad = {
        vertices: [
          [0, 0, 0],
          [100, 0, 0],
          [0, 100, 0],
        ],
      };

      expect(waterField([triangle]).heightAt(10, 10)).toBe(0);
      expect(waterField([triangle]).heightAt(90, 90)).toBeNull();
    });

    it('spans quads far larger than the lookup grid pitch', () => {
      const field = waterField([gridQuad(-3000, 354, -2832, 2942)]);

      expect(field.heightAt(-2900, 2000)).toBe(0);
    });

    it('takes the HIGHEST surface where polygons overlap — the shallower one is what hides a face', () => {
      const field = waterField([gridQuad(0, 0, 100, 100, -5), gridQuad(0, 0, 100, 100, 3)]);

      expect(field.heightAt(50, 50)).toBe(3);
    });
  });
});
