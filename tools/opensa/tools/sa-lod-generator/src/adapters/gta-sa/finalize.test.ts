import { describe, expect, it } from 'vitest';

import { partitionCloneTextures } from './finalize';

describe('partitionCloneTextures', () => {
  describe('negative cases', () => {
    it('keeps a texture used by a single atlas in that atlas (nothing shared)', () => {
      const { perAtlas, shared } = partitionCloneTextures(
        new Map([
          ['a', ['wall_a']],
          ['b', ['wall_b']],
        ]),
      );

      expect(shared).toEqual([]);
      expect(perAtlas.get('a')).toEqual(['wall_a']);
      expect(perAtlas.get('b')).toEqual(['wall_b']);
    });

    it('does not double-count a name repeated within ONE atlas', () => {
      const { shared } = partitionCloneTextures(new Map([['a', ['dup', 'dup']]]));

      expect(shared).toEqual([]); // repeated in one atlas ≠ shared across atlases
    });
  });

  describe('positive cases', () => {
    it('keeps a multi-atlas name in EACH child when its pixels differ per atlas (plan 004)', () => {
      // `leaves` lives in both atlases but with different content keys — variants must not merge.
      const { perAtlas, shared } = partitionCloneTextures(
        new Map([
          ['badlands', ['leaves']],
          ['bush', ['leaves']],
        ]),
        (atlas, name) => `${atlas}:${name}`, // every atlas = its own variant
      );

      expect(shared).toEqual([]);
      expect(perAtlas.get('bush')).toEqual(['leaves']);
      expect(perAtlas.get('badlands')).toEqual(['leaves']); // both children carry their own variant
    });

    it('still shares a multi-atlas name when every owner resolves to the SAME pixels', () => {
      const { perAtlas, shared } = partitionCloneTextures(
        new Map([
          ['a', ['concrete']],
          ['b', ['concrete']],
        ]),
        () => 'same-key',
      );

      expect(shared).toEqual(['concrete']);
      expect(perAtlas.get('a')).toEqual([]);
    });

    it('moves textures used by ≥ 2 atlases into the shared parent and dedupes children', () => {
      const { perAtlas, shared } = partitionCloneTextures(
        new Map([
          ['a', ['concrete', 'wall_a', 'wall_a']],
          ['b', ['concrete', 'wall_b']],
          ['c', ['concrete', 'wall_b']],
        ]),
      );

      expect(shared).toEqual(['concrete', 'wall_b']); // wall_b shared by b + c
      expect(perAtlas.get('a')).toEqual(['wall_a']);
      expect(perAtlas.get('b')).toEqual([]); // fully covered by the parent — empty child stays valid
      expect(perAtlas.get('c')).toEqual([]);
    });
  });
});
