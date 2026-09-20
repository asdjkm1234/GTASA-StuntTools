import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadDistricts, NO_DISTRICTS } from './zones';

const TABLE = {
  districts: [
    { key: 'LOSSANTOS', max: [2997, -768], min: [44.6, -2892.9], name: 'Los Santos' },
    { key: 'GAN', max: [2632.8, -1722.3], min: [2222.6, -1852.9], name: 'Ganton' },
  ],
  gxt: 'text/american.gxt',
};

function serve(body: string, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok, text: () => Promise.resolve(body) })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('loadDistricts', () => {
  describe('negative cases', () => {
    it('answers nothing when the pak declares no districts', async () => {
      expect(await loadDistricts('/pak', undefined)).toBe(NO_DISTRICTS);
    });

    it('answers nothing when the file is not there — a world without names is not an error', async () => {
      serve('', false);

      expect((await loadDistricts('/pak', { count: 2, file: 'districts.json' })).count).toBe(0);
    });

    it('answers nothing on a malformed file rather than throwing into the boot', async () => {
      serve('not json at all');

      expect((await loadDistricts('/pak', { count: 2, file: 'districts.json' })).count).toBe(0);
    });

    it('drops a malformed row instead of letting it throw inside the click handler', async () => {
      serve(
        JSON.stringify({
          districts: [{ key: 'BROKEN', name: 'No corners' }, ...TABLE.districts],
          gxt: null,
        }),
      );
      const lookup = await loadDistricts('/pak', { count: 3, file: 'districts.json' });

      expect(lookup.count).toBe(2);
      expect(() => lookup.nameAt([2495, -1800])).not.toThrow();
      expect(lookup.nameAt([2495, -1800])).toBe('Ganton');
    });

    it('answers null for a point in no district', async () => {
      serve(JSON.stringify(TABLE));
      const lookup = await loadDistricts('/pak', { count: 2, file: 'districts.json' });

      expect(lookup.nameAt([-9000, 9000])).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('names the smallest containing district, not the city around it', async () => {
      serve(JSON.stringify(TABLE));
      const lookup = await loadDistricts('/pak', { count: 2, file: 'districts.json' });

      expect(lookup.count).toBe(2);
      expect(lookup.nameAt([2495, -1800])).toBe('Ganton');
      expect(lookup.nameAt([1480, -1720])).toBe('Los Santos');
    });

    it('answers the BOX of the smallest containing district, which is what a zoom level frames', async () => {
      serve(JSON.stringify(TABLE));
      const lookup = await loadDistricts('/pak', { count: 2, file: 'districts.json' });

      expect(lookup.boxAt([2495, -1800])).toEqual({ max: [2632.8, -1722.3], min: [2222.6, -1852.9] });
      expect(lookup.boxAt([-9000, 9000])).toBeNull();
    });
  });
});

describe('DistrictLookup.search', () => {
  describe('negative cases', () => {
    it('answers nothing for a blank query rather than every place in the world', async () => {
      serve(JSON.stringify(TABLE));
      const lookup = await loadDistricts('/pak', { count: 2, file: 'districts.json' });

      expect(lookup.search('')).toEqual([]);
      expect(lookup.search('   ')).toEqual([]);
    });

    it('answers nothing on a world that ships no districts, instead of stock San Andreas names', () => {
      expect(NO_DISTRICTS.search('ganton')).toEqual([]);
    });

    it('does not invent a hit for a place the world does not have', async () => {
      serve(JSON.stringify(TABLE));
      const lookup = await loadDistricts('/pak', { count: 2, file: 'districts.json' });

      expect(lookup.search('vice city')).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('matches on any part of the name, ignoring case', async () => {
      serve(JSON.stringify(TABLE));
      const lookup = await loadDistricts('/pak', { count: 2, file: 'districts.json' });

      expect(lookup.search('GANT').map((hit) => hit.name)).toEqual(['Ganton']);
      expect(lookup.search('santos').map((hit) => hit.name)).toEqual(['Los Santos']);
    });

    it('ranks a name that STARTS with the query above one that merely contains it', async () => {
      serve(
        JSON.stringify({
          districts: [
            { key: 'A', max: [10, 10], min: [0, 0], name: 'East Beach' },
            { key: 'B', max: [30, 30], min: [20, 20], name: 'Beach Park' },
          ],
        }),
      );
      const lookup = await loadDistricts('/pak', { count: 2, file: 'districts.json' });

      expect(lookup.search('beach').map((hit) => hit.name)).toEqual(['Beach Park', 'East Beach']);
    });

    it('unions the boxes of a place cut into several, so flying to it frames the whole place', async () => {
      serve(
        JSON.stringify({
          districts: [
            { key: 'V1', max: [100, 100], min: [0, 0], name: 'Vinewood' },
            { key: 'V2', max: [300, 50], min: [200, -50], name: 'Vinewood' },
          ],
        }),
      );
      const lookup = await loadDistricts('/pak', { count: 2, file: 'districts.json' });
      const hits = lookup.search('vinewood');

      expect(hits).toHaveLength(1);
      expect(hits[0].min).toEqual([0, -50]);
      expect(hits[0].max).toEqual([300, 100]);
    });

    it("honours the caller's limit, because a list nobody can scan is a list nobody uses", async () => {
      serve(
        JSON.stringify({
          districts: Array.from({ length: 20 }, (_, index) => ({
            key: `K${index}`,
            max: [index + 1, 1],
            min: [index, 0],
            name: `Bay ${index}`,
          })),
        }),
      );
      const lookup = await loadDistricts('/pak', { count: 20, file: 'districts.json' });

      expect(lookup.search('bay')).toHaveLength(8);
      expect(lookup.search('bay', 3)).toHaveLength(3);
    });
  });
});
