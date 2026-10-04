import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseZones, zoneAt } from './zon.parser';

// The real map.zon boxes (name, type, x1,y1,z1, x2,y2,z2, level, label).
const MAP_ZON = `zone
Vegas, 3, 685.0, 476.093, -500.0, 3000.0, 3000.0, 500.0, 3, UNUSED
SF01, 3, -3000.0, -742.306, -500.0, -1270.53, 1530.24, 500.0, 2, UNUSED
LA01, 3, 480.0, -3000.0, -500.0, 3000.0, -850.0, 500.0, 1, UNUSED
end`;

const ZON_PATH = join(process.cwd(), 'fixtures', 'original', 'data', 'info.zon');

describe('zoneAt', () => {
  describe('negative cases', () => {
    it('answers null for a point in no box at all', () => {
      expect(zoneAt(parseZones(MAP_ZON), -9000, -9000)).toBeNull();
    });

    it('answers null over an empty table', () => {
      expect(zoneAt([], 0, 0)).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('takes the SMALLEST containing box, not the first in file order', () => {
      // A district nested inside a county inside an island, declared largest-first the way `info.zon` is.
      const nested = parseZones(
        [
          'zone',
          'ISLAND, 3, -3000, -3000, -500, 3000, 3000, 500, 1, ISLAND',
          'COUNTY, 3, 0, -2000, -500, 3000, 0, 500, 1, COUNTY',
          'GANTON, 3, 2200, -1900, -500, 2800, -1500, 500, 1, GANTON',
          'end',
        ].join('\n'),
      );

      expect(zoneAt(nested, 2495, -1687)?.name).toBe('GANTON');
      expect(zoneAt(nested, 1000, -1000)?.name).toBe('COUNTY');
      expect(zoneAt(nested, -2000, 2000)?.name).toBe('ISLAND');
    });

    it('includes a point exactly on a box edge', () => {
      const zones = parseZones('zone\nA, 3, 0, 0, -500, 10, 10, 500, 1, A\nend');

      expect(zoneAt(zones, 0, 10)?.name).toBe('A');
    });
  });
});

describe('parseZones', () => {
  describe('negative cases', () => {
    it('returns no zones for empty / section-only text', () => {
      expect(parseZones('zone\nend\n')).toEqual([]);
    });

    it('skips malformed lines (too few fields, non-numeric bounds, non-numeric level)', () => {
      expect(parseZones('zone\nBad, 3, 1, 2\nNope, 3, a, b, 0, c, d, 0, 1, X\nend')).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('parses each box with its level and normalised min/max', () => {
      const zones = parseZones(MAP_ZON);
      expect(zones.map((z) => z.level)).toEqual([3, 2, 1]);
      const sf = zones.find((z) => z.name === 'SF01');
      expect(sf?.min).toEqual([-3000, -742.306]);
      expect(sf?.max).toEqual([-1270.53, 1530.24]);
    });
  });

  describe.skipIf(!existsSync(ZON_PATH))('real info.zon', () => {
    it('names the DISTRICT a point is in, not the county or the island around it', () => {
      const zones = parseZones(readFileSync(ZON_PATH, 'latin1'));
      // Grove Street, Ganton — a point real `info.zon` covers with several nested boxes. The assertion is
      // the RULE rather than a name: of everything containing the point, the answer is the smallest.
      const [x, y] = [2495, -1687];
      const containing = zones.filter(
        (zone) => x >= zone.min[0] && x <= zone.max[0] && y >= zone.min[1] && y <= zone.max[1],
      );
      expect(containing.length).toBeGreaterThan(1);
      const smallest = Math.min(...containing.map((zone) => (zone.max[0] - zone.min[0]) * (zone.max[1] - zone.min[1])));
      const hit = zoneAt(zones, x, y);
      expect(hit).not.toBeNull();
      expect((hit!.max[0] - hit!.min[0]) * (hit!.max[1] - hit!.min[1])).toBe(smallest);
    });
  });

  describe.skipIf(!existsSync(ZON_PATH))('real info.zon parsing', () => {
    it('parses every named district zone (Bone County desert + a normal box)', () => {
      const zones = parseZones(readFileSync(ZON_PATH, 'latin1'));
      expect(zones.length).toBeGreaterThan(300);
      const bone = zones.find((z) => z.name === 'BONE'); // the Bone County desert county box
      expect(bone?.min).toEqual([-480.539, 596.349]);
      expect(bone?.max).toEqual([869.461, 2993.87]);
    });
  });
});
