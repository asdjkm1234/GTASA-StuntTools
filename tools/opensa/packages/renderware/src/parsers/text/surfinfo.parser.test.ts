import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseSurfaceInfo, parseSurfaceNames } from './surfinfo.parser';

const datPath = join(process.cwd(), 'fixtures', 'original', 'data', 'surfinfo.dat');
const datExists = existsSync(datPath);
const real = (): ReturnType<typeof parseSurfaceInfo> => parseSurfaceInfo(readFileSync(datPath, 'utf8'));
const named = (name: string): ReturnType<typeof parseSurfaceInfo>[number] => {
  const found = real().find((surface) => surface.name === name);
  if (!found) {
    throw new Error(`no surface "${name}" in the real table`);
  }

  return found;
};

describe('parseSurfaceNames', () => {
  describe('negative cases', () => {
    it('drops comment (#) and blank lines', () => {
      expect(parseSurfaceNames('# header\n\n   \n')).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('reads the leading name token of each row, lowercased', () => {
      expect(parseSurfaceNames('DEFAULT   ROAD 1.0\nTARMAC_FUCKED  ROAD 1.0')).toEqual(['default', 'tarmac_fucked']);
    });

    it.skipIf(!datExists)('parses the real surfinfo.dat (row index = COL material id)', () => {
      const names = parseSurfaceNames(readFileSync(datPath, 'utf8'));
      expect(names).toHaveLength(179); // SA's fixed surface table
      expect(names[0]).toBe('default');
      expect(names[1]).toBe('tarmac');
      // The P_* procedural-object surfaces (procobj.dat rules key off these by material id).
      expect(names[74]).toBe('p_sand');
      expect(names.filter((n) => n.startsWith('p_')).length).toBeGreaterThan(0);
    });
  });
});

describe('parseSurfaceInfo', () => {
  describe('negative cases', () => {
    it('keeps a malformed row rather than dropping it — row index IS the COL material id', () => {
      const table = parseSurfaceInfo('DEFAULT\nTARMAC ROAD 1.0');

      expect(table).toHaveLength(2);
      expect(table[0].name).toBe('default');
      expect(table[0].adhesionGroup).toBe('road'); // the default, not a shifted neighbour's value
      expect(table[1].name).toBe('tarmac');
    });

    it('reads a missing grip column as 1.0, never as no grip at all', () => {
      expect(parseSurfaceInfo('DEFAULT')[0].tyreGrip).toBe(1);
    });

    it.skipIf(!datExists)('finds no surface that out-grips its group (the override column is unused)', () => {
      // Measured 2026-07-27: TYRE_GRIP is 1.0 on all 179 rows, so nothing may be designed around it. If a
      // future data set does set it, this test is the alarm that the assumption changed.
      expect(real().every((surface) => surface.tyreGrip === 1)).toBe(true);
    });
  });

  describe('positive cases', () => {
    it.skipIf(!datExists)('reads the physics columns of the surface a car normally drives on', () => {
      const tarmac = named('tarmac');

      expect(tarmac.adhesionGroup).toBe('road');
      expect(tarmac.tyreGrip).toBe(1);
      expect(tarmac.wetGrip).toBe(-0.25);
      expect(tarmac.skidmark).toBe('default');
      expect(tarmac.skateable).toBe(true);
      expect(tarmac.wheelSpray).toBe(true); // a wet road throws spray
      expect(tarmac.wheelGrass).toBe(false);
    });

    it.skipIf(!datExists)('reads the wheel-effect flags off the surfaces that have them', () => {
      expect(named('grass_short_lush').adhesionGroup).toBe('loose');
      expect(named('grass_short_lush').wheelGrass).toBe(true);
      expect(named('grass_short_lush').skidmark).toBe('muddy');
      expect(named('sand_beach').sand).toBe(true);
      expect(named('sand_beach').wheelSand).toBe(true);
      expect(named('water_shallow').adhesionGroup).toBe('wet');
      expect(named('water_shallow').water).toBe(true);
      expect(named('water_shallow').shallowWater).toBe(true);
    });

    it.skipIf(!datExists)('agrees with the name-only reader, row for row', () => {
      const names = parseSurfaceNames(readFileSync(datPath, 'utf8'));

      expect(real().map((surface) => surface.name)).toEqual(names);
    });

    it.skipIf(!datExists)('sorts the fleet of surfaces into the six adhesion groups, none unknown', () => {
      const groups = new Map<string, number>();
      for (const surface of real()) {
        groups.set(surface.adhesionGroup, (groups.get(surface.adhesionGroup) ?? 0) + 1);
      }

      // The 2026-07-27 census — it is what 081/10's grip mapping is sized against.
      expect(groups.get('road')).toBe(73);
      expect(groups.get('loose')).toBe(60);
      expect(groups.get('hard')).toBe(29);
      expect(groups.get('sand')).toBe(12);
      expect(groups.get('rubber')).toBe(3);
      expect(groups.get('wet')).toBe(2);
      expect([...groups.keys()].sort()).toEqual(['hard', 'loose', 'road', 'rubber', 'sand', 'wet']);
    });
  });
});
