import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ADHESION_GROUPS, parseSurfaceAdhesion } from './surface.parser';

const datPath = join(process.cwd(), 'fixtures', 'original', 'data', 'surface.dat');
const datExists = existsSync(datPath);

describe('parseSurfaceAdhesion', () => {
  describe('negative cases', () => {
    it('reads nothing out of comments and blank lines (this file comments with ";", not "#")', () => {
      const matrix = parseSurfaceAdhesion(';  Rubber  Hard\n\n   \n');

      expect(matrix.get('road', 'rubber')).toBeNull();
    });

    it('answers null for a group the file does not have', () => {
      const matrix = parseSurfaceAdhesion('Road  4.5');

      expect(matrix.get('road', 'gravel')).toBeNull();
      expect(matrix.get('tarmac', 'rubber')).toBeNull();
    });

    it('ignores a row whose name is not a group, instead of shifting the table', () => {
      const matrix = parseSurfaceAdhesion('WheelBase 9.9\nRubber 6.0');

      expect(matrix.get('rubber', 'rubber')).toBe(6);
    });
  });

  describe('positive cases', () => {
    it('mirrors the stored lower triangle, so a pair reads the same either way round', () => {
      const matrix = parseSurfaceAdhesion('Rubber 6.0\nHard 3.6 2.0\nRoad 4.5 3.0 6.0');

      expect(matrix.get('road', 'rubber')).toBe(4.5);
      expect(matrix.get('rubber', 'road')).toBe(4.5);
      expect(matrix.get('hard', 'road')).toBe(3);
    });

    it.skipIf(!datExists)('reads the real surface.dat — the rubber row every tyre drives on', () => {
      const matrix = parseSurfaceAdhesion(readFileSync(datPath, 'utf8'));
      const tyreOn = (group: string): null | number => matrix.get('rubber', group);

      // THE number this engine carried hardcoded as ROAD_ADHESION = 4.5 since 081/05.
      expect(tyreOn('road')).toBe(4.5);
      expect(tyreOn('hard')).toBe(3.6);
      expect(tyreOn('loose')).toBe(3.2);
      expect(tyreOn('sand')).toBe(3);
      expect(tyreOn('wet')).toBe(2.8);
      expect(tyreOn('rubber')).toBe(6);
      // Nothing a car drives on out-grips tarmac: the off-road change can only ever be a loss.
      const drivable = ['hard', 'loose', 'sand', 'wet'].map((group) => tyreOn(group) ?? 0);
      expect(Math.max(...drivable)).toBeLessThan(tyreOn('road') ?? 0);
    });

    it.skipIf(!datExists)('fills every cell of the matrix (a missing pair would silently read as no grip)', () => {
      const matrix = parseSurfaceAdhesion(readFileSync(datPath, 'utf8'));

      for (const a of ADHESION_GROUPS) {
        for (const b of ADHESION_GROUPS) {
          expect(matrix.get(a, b), `${a} × ${b}`).toBeTypeOf('number');
        }
      }
    });
  });
});
