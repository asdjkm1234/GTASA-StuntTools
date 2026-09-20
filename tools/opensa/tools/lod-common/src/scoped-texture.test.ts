import { describe, expect, it } from 'vitest';

import type { SourceTexture, TextureSource } from './texture-source';

import { registerScopedName, type ScopedRegistry, scopedSource, scopedTextureName } from './scoped-texture';

/** A base source with per-TXD variants of `leaves` and a global-only `bark`. */
function base(): TextureSource {
  return {
    get: (name) => (name === 'bark' ? solid(1) : null),
    getFrom: (txd, name) => (name === 'leaves' ? solid(txd === 'badlands' ? 200 : 50) : null),
  };
}

function solid(r: number): SourceTexture {
  return { hasAlpha: false, height: 1, rgba: Uint8Array.from([r, 0, 0, 255]), width: 1 };
}

describe('scopedTextureName', () => {
  describe('negative cases', () => {
    it('never exceeds the 31-char RW name budget', () => {
      const name = scopedTextureName('a_really_long_txd_dictionary_name', 'an_equally_long_texture_name');
      expect(name.length).toBeLessThanOrEqual(31);
    });

    it('keeps truncated long pairs distinct (hash of the FULL pair)', () => {
      // Same 23-char prefix, different tails — byte-truncation alone would collide.
      const a = scopedTextureName('gta_tree_dictionary_one', 'newtreeleaves128_variant_a');
      const b = scopedTextureName('gta_tree_dictionary_one', 'newtreeleaves128_variant_b');
      expect(a).not.toBe(b);
    });
  });

  describe('positive cases', () => {
    it('is deterministic and readable when the pair fits', () => {
      expect(scopedTextureName('badlands', 'leaves')).toBe('badlands_leaves');
      expect(scopedTextureName('BADLANDS', 'Leaves')).toBe('badlands_leaves'); // case-insensitive like RW
    });
  });
});

describe('scopedSource', () => {
  describe('positive cases', () => {
    it('resolves a registered scoped name through the pair TXD and passes raw names through', () => {
      const registry: ScopedRegistry = new Map();
      const scopedBadlands = registerScopedName(registry, 'badlands', 'leaves');
      const scopedOther = registerScopedName(registry, 'first', 'leaves');
      const view = scopedSource(base(), registry);

      expect(view.get(scopedBadlands)?.rgba[0]).toBe(200); // badlands' variant
      expect(view.get(scopedOther)?.rgba[0]).toBe(50); // the other TXD's variant coexists
      expect(view.get('bark')?.rgba[0]).toBe(1); // unregistered name → base passthrough
    });
  });
});
