import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { allocateLodIds, buildLodIde, lodAlias, lodVegetationFlags, patchGtaDat, setIdeDrawDistance } from './ide';

describe('allocateLodIds', () => {
  describe('negative cases', () => {
    it('returns an empty map for no models', () => {
      expect(allocateLodIds([], new Set()).size).toBe(0);
    });

    it('throws when the id window cannot fit every model rather than spilling past the ceiling', () => {
      const used = new Set<number>();
      for (let id = 4000; id <= 19000; id += 1) {
        if (id !== 19000) {
          used.add(id); // leave a single free id, ask for two
        }
      }

      expect(() => allocateLodIds(['a', 'b'], used)).toThrow(/free object ids/);
    });
  });

  describe('positive cases', () => {
    it('assigns the lowest free ids, deduped and sorted', () => {
      // 4000 is taken → the first two free ids are 4001, 4002
      const ids = allocateLodIds(['lodb', 'loda', 'loda'], new Set([4000]));

      expect([...ids]).toEqual([
        ['loda', 4001],
        ['lodb', 4002],
      ]);
    });

    it('fills non-contiguous free ids (a lone gap is usable — ids need not be consecutive)', () => {
      const ids = allocateLodIds(['a', 'b'], new Set([4000, 4001, 4002, 4004]));

      // 4000..4002 taken, 4003 free, 4004 taken, 4005 free → 4003, 4005
      expect([...ids.values()]).toEqual([4003, 4005]);
    });
  });
});

describe('lodAlias', () => {
  describe('negative cases', () => {
    it('aliases a name that would overflow the IMG entry limit to a synthetic id', () => {
      expect(lodAlias('lodgenveg_tallgrass01', 7)).toBe('lodt7');
    });
  });

  describe('positive cases', () => {
    it('keeps a name that fits the entry limit', () => {
      expect(lodAlias('lodash1_hi', 5)).toBe('lodash1_hi');
    });

    it('uses the given prefix for an overflowing name', () => {
      expect(lodAlias('lodgenveg_tallgrass01', 3, 'lpo')).toBe('lpo3');
    });
  });
});

describe('buildLodIde', () => {
  describe('negative cases', () => {
    it('falls back to the default flags for a model the per-model map does not name', () => {
      const text = buildLodIde(
        new Map([
          ['loda', 4000],
          ['lodb', 4001],
        ]),
        'lodtrees',
        1500,
        new Map([['loda', 2105476]]),
      );

      expect(text).toContain('4000, loda, lodtrees, 1500, 2105476');
      expect(text).toContain('4001, lodb, lodtrees, 1500, 2097284');
    });
  });

  describe('positive cases', () => {
    it('emits an objs section ordered by id, at the given txd + draw distance, with CRLF', () => {
      const text = buildLodIde(
        new Map([
          ['loda', 6526],
          ['lodb', 6527],
        ]),
        'lodtrees',
        1500,
      );

      expect(text).toContain('objs\r\n');
      expect(text).toContain('6526, loda, lodtrees, 1500, 2097284');
      expect(text.indexOf('6526')).toBeLessThan(text.indexOf('6527'));
      expect(text.trimEnd().endsWith('end')).toBe(true);
    });

    it('uses the given txd name and flags override', () => {
      const text = buildLodIde(new Map([['a', 4000]]), 'lod_procobj', 300, 2130048);

      expect(text).toContain('4000, a, lod_procobj, 300, 2130048');
    });
  });
});

describe('lodVegetationFlags', () => {
  describe('negative cases', () => {
    it('adds nothing when the source row carries no vegetation bit', () => {
      expect(lodVegetationFlags(0)).toBe(2097284);
      expect(lodVegetationFlags(0x200048)).toBe(2097284); // double-sided + additive + draw-last
    });
  });

  describe('positive cases', () => {
    it('carries IS_TREE and IS_PALM over from the row being replaced', () => {
      expect(lodVegetationFlags(0x202084)).toBe(2105476); // | IS_TREE
      expect(lodVegetationFlags(0x204084)).toBe(2113668); // | IS_PALM
      expect(lodVegetationFlags(0x206084)).toBe(2121860); // both, as a `tobj` palm row may carry
    });
  });
});

describe('patchGtaDat', () => {
  describe('negative cases', () => {
    it('prepends the IDE line when the dat has none', () => {
      const out = patchGtaDat('IMG models\\gta3.img\r\n', 'DATA\\MAPS\\lodtrees.IDE');

      expect(out.split('\r\n')[0]).toBe('IDE DATA\\MAPS\\lodtrees.IDE');
    });
  });

  describe('positive cases', () => {
    it('inserts before the first IPL line', () => {
      const dat = 'IDE a.ide\r\nIDE b.ide\r\nIPL x.ipl\r\n';
      const out = patchGtaDat(dat, 'DATA\\MAPS\\lodtrees.IDE').split('\r\n');

      expect(out).toEqual(['IDE a.ide', 'IDE b.ide', 'IDE DATA\\MAPS\\lodtrees.IDE', 'IPL x.ipl', '']);
    });

    it('inserts before the IPLs even when a later IDE sits past them (mod-appended)', () => {
      const dat = 'IDE stock.ide\r\nIPL stock.ipl\r\nIDE mod.ide\r\nIPL mod.ipl\r\n';
      const out = patchGtaDat(dat, 'DATA\\MAPS\\lodtrees.IDE').split('\r\n');

      // Must land before `stock.ipl` (which may reference the new ids), NOT after the trailing `mod.ide`.
      expect(out).toEqual([
        'IDE stock.ide',
        'IDE DATA\\MAPS\\lodtrees.IDE',
        'IPL stock.ipl',
        'IDE mod.ide',
        'IPL mod.ipl',
        '',
      ]);
    });
  });
});

describe('setIdeDrawDistance', () => {
  /** The real stock file the baked layer's range comes from — 107 models, every one declared at 59. */
  const STOCK = 'game-src/original/data/maps/generic/procobj.ide';

  describe('negative cases', () => {
    it('reports a model it will not guess at instead of leaving the range silently unchanged', () => {
      const text = 'objs\n800, genVEG_bush07, gta_proc_bush, 4, 59, 8324\nend\n'; // mesh-count variant
      const result = setIdeDrawDistance(text, new Set(['genveg_bush07']), 299);

      expect(result.changed).toEqual([]);
      expect(result.skipped).toEqual(['genveg_bush07']);
      expect(result.text).toBe(text);
    });

    it('leaves rows in other sections alone', () => {
      const text = 'tobj\n800, genVEG_bush07, gta_proc_bush, 59, 8324, 5, 20\nend\n';

      expect(setIdeDrawDistance(text, new Set(['genveg_bush07']), 299).text).toBe(text);
    });
  });

  describe('positive cases', () => {
    it('raises only the named models, keeping every other row byte-identical', () => {
      const text = 'objs\n800, a, txd, 59, 8324\n801, b, txd, 59, 8324\nend\n';
      const result = setIdeDrawDistance(text, new Set(['a']), 299);

      expect(result.changed).toEqual(['a']);
      expect(result.text).toBe('objs\n800, a, txd, 299, 8324\n801, b, txd, 59, 8324\nend\n');
    });

    it('raises the whole stock procobj.ide from 59 to 299 — the ProperFixes mechanism', () => {
      const text = readFileSync(STOCK, 'utf8');
      const models = new Set([...text.matchAll(/^\s*\d+,([^,]*),/gm)].map((match) => match[1].trim().toLowerCase()));
      const result = setIdeDrawDistance(text, models, 299);

      expect(result.skipped).toEqual([]);
      expect(result.changed).toHaveLength(107); // every objs row in the stock file
      expect(result.text).not.toMatch(/,\s*59,/); // no 59 left as a draw distance
      expect(result.text.split(/\r?\n/)).toHaveLength(text.split(/\r?\n/).length); // no row added or lost
    });

    it('preserves CRLF, comments and blank lines', () => {
      const text = '# header\r\n\r\nobjs\r\n800, a, txd, 59, 8324 # trailing\r\nend\r\n';
      const result = setIdeDrawDistance(text, new Set(['a']), 299);

      expect(result.text).toContain('# header\r\n\r\nobjs\r\n');
      expect(result.text).toContain('800, a, txd, 299, 8324');
    });
  });
});
