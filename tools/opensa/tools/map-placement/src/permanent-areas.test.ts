import { describe, expect, it } from 'vitest';

import { AREA_MAX_ROWS, buildPermanentAreas, type PermanentPlacement } from './permanent-areas';

const at = (x: number, y = 0): PermanentPlacement => ({
  id: 800,
  interior: 0,
  model: 'genVEG_bush07',
  position: [x, y, 3.5],
  rotation: [0, 0, 0, 1],
});

const rowsOf = (text: string): string[] => text.split('\r\n').filter((line) => /^\d/.test(line));

describe('buildPermanentAreas', () => {
  describe('negative cases', () => {
    it('emits nothing for no placements — no file, no gta.dat line, no slot', () => {
      expect(buildPermanentAreas([], 'plobj')).toEqual({ datLines: [], files: [], instBearingFiles: 0 });
    });

    it('never emits a row with a lod link — the whole point of the shape', () => {
      const { files } = buildPermanentAreas([at(0), at(1)], 'plobj');

      for (const row of rowsOf(files[0][1])) {
        expect(row.endsWith(', -1')).toBe(true);
      }
    });
  });

  describe('positive cases', () => {
    it('writes one row per placement, in SA inst order, with no stream companion', () => {
      const { datLines, files, instBearingFiles } = buildPermanentAreas([at(12.5)], 'plobj');

      expect(files).toHaveLength(1);
      expect(instBearingFiles).toBe(1);
      expect(datLines).toEqual(['IPL DATA\\MAPS\\plobj0.IPL']);
      expect(files[0][0]).toBe('plobj0.ipl');
      expect(rowsOf(files[0][1])).toEqual(['800, genVEG_bush07, 0, 12.5, 0, 3.5, 0, 0, 0, 1, -1']);
      // No `imgFiles` in the return shape at all — this path ships no binary streams by construction.
      expect(Object.keys(buildPermanentAreas([at(0)], 'plobj')).sort()).toEqual([
        'datLines',
        'files',
        'instBearingFiles',
      ]);
    });

    it('splits into ⌈N/maxRows⌉ areas and counts every one as a slot', () => {
      const placements = Array.from({ length: 2500 }, (_, i) => at(i % 50, Math.floor(i / 50)));
      const { datLines, files, instBearingFiles } = buildPermanentAreas(placements, 'plobj', 1000);

      expect(files).toHaveLength(3);
      expect(instBearingFiles).toBe(3);
      expect(datLines).toHaveLength(3);
      expect(files.reduce((n, [, text]) => n + rowsOf(text).length, 0)).toBe(2500);
      for (const [, text] of files) {
        expect(rowsOf(text).length).toBeLessThanOrEqual(1000);
      }
    });

    it('fits the shipped layer inside the slots that are left: 91 092 objects → 10 areas', () => {
      // The measured layer at density 1. 28 stock inst-bearing IPLs + 1 for the trees overflow leaves 11, so 10
      // is the number this cap has to produce — and it is why the cap sits just under ProperFixes' 9 627 rather
      // than well under it (`AREA_MAX_ROWS`).
      const placements = Array.from({ length: 91_092 }, (_, i) => at(i % 300, Math.floor(i / 300)));

      expect(buildPermanentAreas(placements, 'plobj').instBearingFiles).toBe(10);
      expect(AREA_MAX_ROWS).toBeLessThan(9627); // the largest text IPL the field has been measured running
    });
  });
});
