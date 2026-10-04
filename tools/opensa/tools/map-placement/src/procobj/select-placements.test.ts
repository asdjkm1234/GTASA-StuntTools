import type { ProcObjCategoryName } from '@opensa/renderware/map/procobj-categories';
import type { ProcObjBatch, ProcObjPlacement } from '@opensa/renderware/map/procobj-scatter';

import { describe, expect, it } from 'vitest';

import { selectPlacements } from './convert';

/** surfinfo names are DATA, so they are values here rather than literal keys (they are not camelCase). */
const surface = { mountain: 'p_mountain', sand: 'p_sand', woodland: 'p_woodland' } as const;

/**
 * One batch of `count` candidates with lotteries spread evenly over `[0, max)` — the distribution the scatter
 * produces (`random() * maxDensity`), stated exactly so a cutoff's effect is a count and not a probability.
 * At count 30 over [0,3) a cutoff of 1.0 keeps 10, of 2.0 keeps 20: the "d × the authored density" property.
 */
function batch(category: ProcObjCategoryName, model: string, surfaceName: string, count = 30, max = 3): ProcObjBatch {
  return {
    category,
    model,
    placements: Array.from({ length: count }, (_, i) => placement((i * max) / count)),
    surface: surfaceName,
  };
}

/** A batch with exactly these lotteries, all on one spot — the species-floor tests need the cell pinned. */
function batchOfLotteries(
  category: ProcObjCategoryName,
  model: string,
  lotteries: readonly number[],
  position: [number, number, number] = [0, 0, 0],
): ProcObjBatch {
  return {
    category,
    model,
    placements: lotteries.map((lottery) => placement(lottery, position)),
    surface: surface.sand,
  };
}

function placement(lottery: number, position: [number, number, number] = [0, 0, 0]): ProcObjPlacement {
  return { align: false, lottery, normal: [0, 0, 1], position, rotation: 0, scale: 1, scaleZ: 1 };
}

const world = (): ProcObjBatch[] => [
  batch('bushes', 'genveg_bush01', surface.woodland),
  batch('rocks', 'p_rubble', surface.mountain),
  batch('cacti', 'sand_josh1', surface.sand),
];

const countOf = (result: ReturnType<typeof selectPlacements>, category: ProcObjCategoryName): number =>
  result.categories.find((cost) => cost.category === category)?.objects ?? 0;

describe('selectPlacements', () => {
  describe('negative cases', () => {
    it('TRUNCATES a boost against a binding cap from a uniform base — nothing is displaced', () => {
      // The slice keeps the globally LOWEST lotteries, and raising a cutoff only adds placements ABOVE the
      // old one. From a uniform base every other category's kept entries are below that, so the added bushes
      // sort last and are exactly what the cap takes: the boost buys nothing, and costs nobody anything.
      const vanilla = selectPlacements(world(), {}, 30);
      const boosted = selectPlacements(world(), { byCategory: { bushes: 2 } }, 30);

      expect(vanilla.final).toHaveLength(30);
      expect(boosted.final).toHaveLength(30); // the cap, not the density
      expect(countOf(boosted, 'bushes')).toBe(countOf(vanilla, 'bushes'));
      expect(countOf(boosted, 'rocks')).toBe(countOf(vanilla, 'rocks'));
      expect(boosted.dropped).toBe(10); // 40 survivors, 30 shipped — every one of them a boosted bush
    });

    it('DISPLACES only when another category already sits above the boosted one', () => {
      // Rocks at 2.5 keep entries the boost's [1, 2) band undercuts, so here the added bushes really do take
      // rocks' slots. This is the only shape in which decision 8's warning is true.
      const uneven = { byCategory: { bushes: 1, rocks: 2.5 } } as const;
      const before = selectPlacements(world(), uneven, 35);
      const after = selectPlacements(world(), { byCategory: { ...uneven.byCategory, bushes: 2 } }, 35);

      expect(before.final).toHaveLength(35);
      expect(after.final).toHaveLength(35);
      expect(countOf(after, 'bushes')).toBeGreaterThan(countOf(before, 'bushes'));
      expect(countOf(after, 'rocks')).toBeLessThan(countOf(before, 'rocks'));
    });

    it('reports the drop per category, so a capped run cannot read as a free win', () => {
      const boosted = selectPlacements(world(), { byCategory: { bushes: 2 } }, 30);
      const total = boosted.categories.reduce((sum, cost) => sum + cost.dropped, 0);

      expect(total).toBe(boosted.dropped);
      expect(boosted.dropped).toBeGreaterThan(0);
    });

    it('keeps a category out of the build entirely when its cutoff is below every lottery it rolled', () => {
      // The lowest lottery in a 30-candidate batch over [0,3) is 0, so only a cutoff at the very bottom bites.
      const result = selectPlacements(
        [batch('grass', 'veg_procgrasspatch', surface.woodland, 30)],
        { base: 0.05 },
        999,
      );

      expect(result.final).toHaveLength(1); // just the lottery-0 candidate
    });
  });

  describe('positive cases', () => {
    it('is the authored density for an empty profile — a third of the candidates, the regression baseline', () => {
      const result = selectPlacements(world(), {}, 999);

      expect(result.final).toHaveLength(30); // 3 batches × 30 candidates over [0,3), cutoff 1.0
      expect(result.dropped).toBe(0);
      for (const category of ['bushes', 'cacti', 'rocks'] as const) {
        expect(countOf(result, category)).toBe(10);
      }
    });

    it('doubles ONE category and leaves the others untouched, below the cap', () => {
      const vanilla = selectPlacements(world(), {}, 999);
      const boosted = selectPlacements(world(), { byCategory: { bushes: 2 } }, 999);

      expect(countOf(boosted, 'bushes')).toBe(2 * countOf(vanilla, 'bushes'));
      expect(countOf(boosted, 'rocks')).toBe(countOf(vanilla, 'rocks'));
      expect(countOf(boosted, 'cacti')).toBe(countOf(vanilla, 'cacti'));
      expect(boosted.dropped).toBe(0); // below the cap, a boost ADDS
    });

    it('applies a per-surface cutoff to that surface only, with the same model on another surface unchanged', () => {
      const batches = [batch('rocks', 'p_rubble', surface.mountain), batch('rocks', 'p_rubble', surface.woodland)];

      const result = selectPlacements(batches, { bySurface: { rocks: { [surface.mountain]: 2 } } }, 999);

      expect(result.final).toHaveLength(30); // 20 on the mountain + 10 in the woodland
      expect(countOf(result, 'rocks')).toBe(30);
    });

    it('counts every candidate as generated, whatever the cutoff kept', () => {
      const result = selectPlacements(world(), { byCategory: { bushes: 2 } }, 999);

      for (const cost of result.categories) {
        expect(cost.generated).toBe(30);
      }
    });
  });
});

/** A species whose every candidate lost the lottery — three rolls above the cutoff, which happens ~30 % of the
 *  time for a rule that fires three times on a patch. It is the only way a species empties on this path. */
const zeroed = (position: [number, number, number] = [0, 0, 0]): ProcObjBatch =>
  batchOfLotteries('cacti', 'sjmcacti2', [1.4, 2.1, 2.7], position);

describe('selectPlacements — the species-roster floor', () => {
  describe('negative cases', () => {
    it('changes nothing with the floor off (regression against the unfloored build)', () => {
      const batches = [...world(), zeroed()];

      expect(selectPlacements(batches, {}, 999, 0).final).toHaveLength(30);
      expect(selectPlacements(batches, {}, 999, 0).floored).toBe(0);
    });

    it('does not floor a species the cutoff already kept', () => {
      const batches = [batchOfLotteries('cacti', 'sjmcacti2', [0.2, 0.4, 2.7])];

      const result = selectPlacements(batches, {}, 999, 1);

      expect(result.floored).toBe(0);
      expect(result.final).toHaveLength(2); // the two below the cutoff, and nothing promoted
    });

    it('never promotes more than the species has candidates', () => {
      const batches = [batchOfLotteries('cacti', 'sjmcacti2', [2.9])];

      const result = selectPlacements(batches, {}, 999, 3);

      expect(result.floored).toBe(1);
    });
  });

  describe('positive cases', () => {
    it('gives a species the lottery emptied one object back', () => {
      const result = selectPlacements([...world(), zeroed()], {}, 999, 1);

      expect(result.floored).toBe(1);
      expect(result.final).toHaveLength(31);
      expect(result.final.filter((entry) => entry.model === 'sjmcacti2')).toHaveLength(1);
    });

    it('promotes the species’ own LOWEST rejected lottery — the most vanilla of them', () => {
      const result = selectPlacements([zeroed()], {}, 999, 1);

      expect(result.final[0].placement.lottery).toBe(1.4);
    });

    it('guarantees the roster PER CELL, not once for the whole map', () => {
      const far: [number, number, number] = [2000, -600, 0]; // eight cells east, one south
      const result = selectPlacements([zeroed(), zeroed(far)], {}, 999, 1);

      expect(result.floored).toBe(2);
      expect(result.final.map((entry) => entry.placement.position[0]).sort()).toEqual([0, 2000]);
    });

    it('keeps the guarantee ahead of the lottery order when the cap binds', () => {
      // Budget 5, and the woodland bushes alone would fill it with lotteries below every reject.
      const result = selectPlacements([batch('bushes', 'genveg_bush01', surface.woodland), zeroed()], {}, 5, 1);

      expect(result.final).toHaveLength(5);
      expect(result.final.filter((entry) => entry.model === 'sjmcacti2')).toHaveLength(1);
      expect(result.dropped).toBe(6); // 10 bushes + 1 floored cactus, minus the 5 that fit
    });
  });
});
