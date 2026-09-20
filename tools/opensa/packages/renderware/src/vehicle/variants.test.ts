import { describe, expect, it } from 'vitest';

import type { RWClump, RWFrame, VehicleVariants } from '..';

import { parseName, pickVariants, variantTree } from './variants';

/**
 * The alfamodding cabbie's shape, reduced: classes by city, roof ads gated by class, `int:0` clutter,
 * `:2` picking two groups. Frame indices are the option ids.
 */
function cabbieLike(): RWClump {
  return clump(
    [
      frame('chassis_dummy'), // 0
      frame('f_class:1', 0), // 1
      frame('YCC?c1', 1), // 2
      frame('!characteristics', 2), // 3
      frame('WBC?c3', 1), // 4
      frame('f_extras:2', 0), // 5
      frame('adv_roof:1', 5), // 6
      frame('none[YCC]', 6), // 7
      frame('vegas[WBC]:1', 6), // 8
      frame('adv_roof1', 8), // 9
      frame('adv_roof2', 8), // 10
      frame('int:0', 5), // 11
      frame('bottle', 11), // 12
      frame('bottle_dam', 11), // 13
      frame('chassis', 0), // 14
    ],
    [8, 9, 10, 12, 13, 14],
  );
}

/** Frames only — the tree reads names and parents; `withMesh` marks which carry an atomic. */
function clump(frames: RWFrame[], withMesh: number[] = []): RWClump {
  return { atomics: withMesh.map((index) => ({ frameIndex: index, geometryIndex: 0 })), frames, geometries: [] };
}

function frame(name: string, parentIndex = -1): RWFrame {
  return { name, parentIndex, position: [0, 0, 0], rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
}

/** A `random` that replays a fixed tape — every call takes the next value (wraps). */
function tape(...values: number[]): () => number {
  let at = 0;

  return () => values[at++ % values.length];
}

describe('parseName', () => {
  describe('negative cases', () => {
    it('a bare name has no decorations: one child, no tags, no condition', () => {
      expect(parseName('bags')).toEqual({ name: 'bags', select: [1, 1] });
    });

    it('an empty tag bracket asks for nothing', () => {
      expect(parseName('adv[]')).toEqual({ name: 'adv', select: [1, 1] });
    });
  });

  describe('positive cases', () => {
    it('reads the VehFuncs count suffixes: `:N`, `:0`, `:0+`, `:N+`, `+`', () => {
      expect(parseName('f_extras:10').select).toEqual([10, 10]);
      expect(parseName('int:0').select).toEqual([0, 1]);
      expect(parseName('trunkbay:0+').select).toEqual([0, -1]);
      expect(parseName('stuff:2+').select).toEqual([2, -1]);
      expect(parseName('all+').select).toEqual([1, -1]);
    });

    it('reads class tags and conditions off the name in field order', () => {
      expect(parseName('vegas[wbc]:1')).toEqual({ name: 'vegas', requires: ['wbc'], select: [1, 1] });
      expect(parseName('bumper[sc,35th]')).toEqual({ name: 'bumper', requires: ['sc', '35th'], select: [1, 1] });
      expect(parseName('rural?c0?c4')).toEqual({ condition: 'c0?c4', name: 'rural', select: [1, 1] });
      expect(parseName('roof?rain')).toEqual({ condition: 'rain', name: 'roof', select: [1, 1] });
    });
  });
});

describe('variantTree', () => {
  describe('negative cases', () => {
    it('a model with no container has no tree and tags no frame', () => {
      const tree = variantTree(clump([frame('chassis_dummy'), frame('chassis', 0)], [1]));

      expect(tree.variants).toBeNull();
      expect(tree.optionOfFrame.size).toBe(0);
    });

    it('a container inside the excluded set (the wheel) is not a variant container', () => {
      const tree = variantTree(
        clump([frame('f_wheel_1111'), frame('f_extras:1', 0), frame('rim', 1)], [2]),
        new Set([0, 1, 2]),
      );

      expect(tree.variants).toBeNull();
    });

    it('`_dam` / `_vlo` frames are never options — they ride their `_ok` sibling', () => {
      const tree = variantTree(cabbieLike());
      const int = tree.variants!.extras[0].children[1];

      expect(int.name).toBe('int');
      expect(int.children.map((child) => child.name)).toEqual(['bottle']);
      expect(tree.optionOfFrame.get(13)).toBe('12'); // bottle_dam belongs to bottle's option
    });
  });

  describe('positive cases', () => {
    it('reads classes with their conditions and skips `!characteristics`', () => {
      const tree = variantTree(cabbieLike());

      expect(tree.variants!.classes).toHaveLength(1);
      expect(tree.variants!.classes[0].children.map((child) => [child.name, child.condition])).toEqual([
        ['ycc', 'c1'],
        ['wbc', 'c3'],
      ]);
      expect(tree.variants!.classes[0].children[0].children).toHaveLength(0);
    });

    it('reads the extras tree with counts and tags, ids = frame indices, meshes tagged by nearest option', () => {
      const tree = variantTree(cabbieLike());
      const [extras] = tree.variants!.extras;

      expect(extras.select).toEqual([2, 2]);
      expect(extras.children.map((child) => child.name)).toEqual(['adv_roof', 'int']);
      const advRoof = extras.children[0];
      expect(advRoof.children.map((child) => [child.name, child.requires])).toEqual([
        ['none', ['ycc']],
        ['vegas', ['wbc']],
      ]);
      expect(advRoof.children[1].children.map((child) => child.id)).toEqual(['9', '10']);
      // The mesh ON an option frame and the meshes below it are that option's; the chassis is nobody's.
      expect(tree.optionOfFrame.get(8)).toBe('8');
      expect(tree.optionOfFrame.get(9)).toBe('9');
      expect(tree.optionOfFrame.get(14)).toBeUndefined();
    });
  });
});

describe('pickVariants', () => {
  const variants = (): VehicleVariants => variantTree(cabbieLike()).variants!;

  describe('negative cases', () => {
    it('an option whose class tag was not chosen is never picked', () => {
      // Class walk: `f_class:1` picks index 0 → ycc. `adv_roof:1`'s eligible children are then only
      // `none[ycc]`; `vegas[wbc]` and its two ads are never reachable.
      const chosen = pickVariants(variants(), tape(0));

      expect(chosen.has('8')).toBe(false);
      expect(chosen.has('9')).toBe(false);
      expect(chosen.has('7')).toBe(true); // `none` — a meshless option that shows nothing
    });

    it('`:0` may pick nothing', () => {
      // tape(0) → count = 0 + floor(0 × 2) = 0 for `int:0`.
      const chosen = pickVariants(variants(), tape(0));

      expect(chosen.has('12')).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('picks a class-gated option when its class was chosen, then ONE of its children', () => {
      // Class pick → wbc (0.9 × 2 children = index 1). `f_extras:2` selects both groups (count fixed at 2;
      // which-order draws consume the tape). `adv_roof:1` → vegas is the only eligible → chosen, then one of
      // adv_roof1/adv_roof2.
      const chosen = pickVariants(variants(), tape(0.9));

      expect(chosen.has('8')).toBe(true);
      expect([chosen.has('9'), chosen.has('10')].filter(Boolean)).toHaveLength(1);
    });

    it('never picks more than the eligible children, whatever the count says', () => {
      const chosen = pickVariants(
        {
          classes: [],
          extras: [
            {
              children: [{ children: [], id: 'a', name: 'a', select: [1, 1] }],
              id: 'r',
              name: 'f_extras',
              select: [10, 10],
            },
          ],
        },
        tape(0.5),
      );

      expect([...chosen]).toEqual(['a']);
    });

    it('is a spawn decision: different draws give different sets over the same tree', () => {
      const seen = new Set<string>();
      for (let spawn = 0; spawn < 40; spawn += 1) {
        seen.add([...pickVariants(variants())].sort().join(','));
      }

      expect(seen.size).toBeGreaterThan(1);
    });
  });
});
