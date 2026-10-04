import { describe, expect, it } from 'vitest';

import type { ModelRef } from './partition';

import { ideRefs, looseGroup, partitionEntries, placedModels, resolveSource } from './partition';

const ide = new Map<number, ModelRef>([
  [1, { drawDistance: 299, model: 'house', txd: 'htex' }],
  [2, { drawDistance: 299, model: 'shed', txd: 'htex' }], // shares htex with house
  [3, { drawDistance: 299, model: 'tree', txd: 'ttex' }], // dff + txd only in gta_int
  [4, { drawDistance: 299, model: 'ghost', txd: 'gtex' }], // referenced but in neither img
]);

const gta3 = new Set(['house.dff', 'htex.txd', 'la.ipl', 'nodes.dat', 'ped.ifp', 'roads.col', 'shed.dff']);
const gtaInt = new Set(['tree.dff', 'ttex.txd']);

const names = (entries: { name: string }[]): string[] => entries.map((e) => e.name).sort();

describe('resolveSource', () => {
  describe('negative cases', () => {
    it('returns null for a name in neither img', () => {
      expect(resolveSource('ghost.dff', gta3, gtaInt)).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('prefers gta3, falls back to gta_int (override)', () => {
      expect(resolveSource('house.dff', gta3, gtaInt)).toBe('gta3');
      expect(resolveSource('tree.dff', gta3, gtaInt)).toBe('gta_int');
    });
  });
});

describe('placedModels', () => {
  describe('positive cases', () => {
    it('collects the unique referenced model + txd base names', () => {
      const refs = placedModels([1, 2, 3, 1, 1], ide); // id 1 thrice → one
      expect(refs.models.sort()).toEqual(['house', 'shed', 'tree']);
      expect(refs.txds.sort()).toEqual(['htex', 'ttex']); // htex shared, deduped
    });

    it('skips ids without an IDE definition', () => {
      expect(placedModels([999], ide)).toEqual({ models: [], txds: [] });
    });
  });
});

describe('partitionEntries', () => {
  const { models, others, textures } = partitionEntries(placedModels([1, 2, 3, 4], ide), gta3, gtaInt);

  describe('negative cases', () => {
    it('drops dff/txd present in neither img', () => {
      expect(names(models)).not.toContain('ghost.dff');
      expect(names(textures)).not.toContain('gtex.txd');
    });

    it('keeps the three buckets disjoint by extension', () => {
      expect(models.every((e) => /\.(?:dff|col)$/.test(e.name))).toBe(true);
      expect(textures.every((e) => e.name.endsWith('.txd'))).toBe(true);
      expect(others.every((e) => /\.(?:ipl|ifp|dat)$/.test(e.name))).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('puts placement/anim/data world files (ipl/ifp/dat) in others — no col/dff/txd', () => {
      expect(names(others)).toEqual(['la.ipl', 'nodes.dat', 'ped.ifp']);
    });

    it('puts every referenced dff plus every col in models, resolved across both imgs', () => {
      expect(names(models)).toEqual(['house.dff', 'roads.col', 'shed.dff', 'tree.dff']);
      expect(models.find((e) => e.name === 'tree.dff')?.source).toBe('gta_int'); // override
      expect(models.find((e) => e.name === 'house.dff')?.source).toBe('gta3');
      expect(models.find((e) => e.name === 'roads.col')?.source).toBe('gta3');
    });

    it('puts every referenced txd in textures (deduped), resolved across both imgs', () => {
      expect(names(textures)).toEqual(['htex.txd', 'ttex.txd']);
      expect(textures.find((e) => e.name === 'ttex.txd')?.source).toBe('gta_int');
    });

    // A TC keeps its world files in its OWN archive (gostown6.img → the override set) — sweeping only
    // gta3 shipped a world with no collision (plan 086 phase 4 field find).
    it('sweeps col/ipl world files from the override archives too, gta3 winning a collision', () => {
      const tc = partitionEntries(
        placedModels([1], ide),
        new Set(['house.dff', 'la.ipl', 'roads.col']),
        new Set(['gp_stream0.ipl', 'gp_veg.col', 'htex.txd', 'la.ipl', 'roads.col']),
      );
      expect(names(tc.models)).toContain('gp_veg.col');
      expect(tc.models.find((e) => e.name === 'gp_veg.col')?.source).toBe('gta_int');
      expect(names(tc.others)).toEqual(['gp_stream0.ipl', 'la.ipl']);
      expect(tc.others.find((e) => e.name === 'la.ipl')?.source).toBe('gta3'); // not duplicated from the override
      // A col present in BOTH archives: gta3 wins, one entry.
      expect(tc.models.filter((e) => e.name === 'roads.col')).toEqual([{ name: 'roads.col', source: 'gta3' }]);
    });
  });

  /**
   * A converted build (opensa-pack 003): `house` is optimized, `shed` is not. Missing our extensions here
   * would be a silent no-render, not an error — the procobj class of bug.
   */
  describe('a partly converted archive', () => {
    const converted = new Set(['house.osm', 'htex.txd', 'roads.col', 'shed.dff']);
    const partition = partitionEntries(placedModels([1, 2], ide), converted, new Set());

    it('takes the .osm over the .dff — one entry, dictionary included', () => {
      expect(names(partition.models)).toEqual(['house.osm', 'roads.col', 'shed.dff']);
    });

    it('still takes the stock txd for the model that stayed unoptimized', () => {
      // `shed` shares `htex` with `house`; the shared dictionary must survive for shed's sake.
      expect(names(partition.textures)).toEqual(['htex.txd']);
    });

    it('needs no texture entry at all once every model is converted', () => {
      const fully = partitionEntries(placedModels([1], ide), new Set(['house.osm']), new Set());

      expect(names(fully.models)).toEqual(['house.osm']);
      expect(names(fully.textures)).toEqual([]);
    });
  });
});

describe('looseGroup', () => {
  describe('positive cases', () => {
    it('routes data-folder files to data regardless of extension', () => {
      expect(looseGroup('data/gta.dat')).toBe('data');
      expect(looseGroup('data/maps/la.ipl')).toBe('data');
    });

    it('routes our optimized model to the models group, and a loose world .ostex to textures', () => {
      expect(looseGroup('vehicles/admiral.osm')).toBe('models');
      expect(looseGroup('opensa/textures/7.ostex')).toBe('textures');
    });

    it('routes dff to models, txd to textures, and the rest (ifp/gxt) to others', () => {
      expect(looseGroup('player/tommy.dff')).toBe('models');
      expect(looseGroup('vehicles/admiral.txd')).toBe('textures');
      expect(looseGroup('anim/ped.ifp')).toBe('others');
      expect(looseGroup('text/american.gxt')).toBe('others');
    });
  });
});

describe('ideRefs', () => {
  // objs (5 cols) + a tobj (objs cols + timeOn,timeOff). tobj models must be packed too, or every
  // time-of-day overlay (lit windows / neon) is dropped from the build and vanishes in-game.
  const IDE = [
    'objs',
    '100, house, htex, 299, 0',
    'end',
    'tobj',
    '200, lampwin_nt, lamptex, 299, 0, 20, 6',
    'end',
    'anim',
    '300, burger01_LAw, burger01_LAw, BURGER01_LAW, 299, 0',
    'end',
  ].join('\n');

  describe('positive cases', () => {
    it('includes both objs and tobj models (lowercased) keyed by id', () => {
      const refs = ideRefs(IDE);
      expect(refs.get(100)).toEqual({ drawDistance: 299, model: 'house', txd: 'htex' });
      // the tobj model — previously dropped
      expect(refs.get(200)).toEqual({ drawDistance: 299, model: 'lampwin_nt', txd: 'lamptex' });
    });

    it('carries the anim row IFP name so a consumer knows the DFF frames place the atomics', () => {
      const refs = ideRefs(IDE);
      expect(refs.get(300)).toEqual({
        anim: 'burger01_law',
        drawDistance: 299,
        model: 'burger01_law',
        txd: 'burger01_law',
      });
      expect(refs.get(100)?.anim).toBeUndefined();
    });
  });
});
