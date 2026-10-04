import { describe, expect, it } from 'vitest';

import { mergeGtaDat } from './gta-dat-merge';

describe('mergeGtaDat', () => {
  describe('negative cases', () => {
    it('returns the base unchanged with no refs', () => {
      const base = 'IDE data/maps/stock.ide\nIPL data/maps/stock.ipl\n';

      expect(mergeGtaDat(base, { ide: [], ipl: [] })).toBe(base);
    });

    it('skips a ref already listed (case/slash-insensitive) so it never double-places', () => {
      const base = 'IPL data/maps/stock.ipl\n';

      expect(mergeGtaDat(base, { ide: [], ipl: ['DATA\\MAPS\\stock.ipl'] })).toBe(base);
    });
  });

  describe('positive cases', () => {
    it('appends the new IDE/IPL lines (verbatim) after the stock ones', () => {
      const out = mergeGtaDat('IDE data/maps/stock.ide\n', {
        ide: ['data/maps/lodtrees.ide', 'data/maps/lodtrees_hd.ide'],
        ipl: ['data/maps/lod_procobj.ipl'],
      });

      expect(out).toBe(
        'IDE data/maps/stock.ide\nIDE data/maps/lodtrees.ide\nIDE data/maps/lodtrees_hd.ide\nIPL data/maps/lod_procobj.ipl\n',
      );
    });

    it('splices the IDE refs BEFORE the first IPL line — a placement may not precede its definition', () => {
      // The defect this closes: the IPL slot fold moves a mod's inst rows into a stock host chosen by capacity,
      // so a mod IDE appended at the end is read after the row that needs it
      // (docs/open-issues/mod-inst-rows-folded-before-their-ide.md).
      const base = 'IDE data/maps/stock.ide\nIPL data/maps/las.ipl\nIPL data/maps/lae.ipl\n';

      const out = mergeGtaDat(base, { ide: ['data/maps/relit.ide'], ipl: ['data/maps/mod.ipl'] });

      expect(out.split('\n')).toEqual([
        'IDE data/maps/stock.ide',
        'IDE data/maps/relit.ide', // after every stock IDE, so which definition wins a shared id is unchanged
        'IPL data/maps/las.ipl',
        'IPL data/maps/lae.ipl',
        'IPL data/maps/mod.ipl',
        '',
      ]);
    });

    it('keeps the IDE refs in their own order when several are spliced', () => {
      const out = mergeGtaDat('IPL data/maps/las.ipl\n', { ide: ['a.ide', 'b.ide'], ipl: [] });

      expect(out).toBe('IDE a.ide\nIDE b.ide\nIPL data/maps/las.ipl\n');
    });

    it('dedups a ref repeated across loader files', () => {
      const out = mergeGtaDat('', { ide: ['x.ide', 'X.IDE'], ipl: [] });

      expect(out).toBe('IDE x.ide\n');
    });
  });
});
