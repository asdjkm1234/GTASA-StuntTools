import { describe, expect, it, vi } from 'vitest';

import type { MergedMesh } from './mesh';

import { applyModifiers, hdToLod, type LodModifier } from './hd-to-lod';

/** A minimal MergedMesh stub — the core/modifiers here don't inspect its contents. */
function mesh(tag: string): MergedMesh {
  return {
    colors: Uint8Array.of(),
    groups: [{ indices: Uint32Array.of(), texture: tag }],
    normals: Float32Array.of(),
    positions: Float32Array.of(),
    uvs: Float32Array.of(),
  };
}

describe('applyModifiers', () => {
  describe('negative cases', () => {
    it('returns the mesh unchanged when the chain is empty', () => {
      const input = mesh('a');

      expect(applyModifiers(input, [])).toBe(input);
    });
  });

  describe('positive cases', () => {
    it('applies modifiers left to right', () => {
      const order: string[] = [];
      const tag =
        (name: string): LodModifier =>
        (m) => {
          order.push(name);

          return m;
        };
      applyModifiers(mesh('a'), [tag('first'), tag('second')]);

      expect(order).toEqual(['first', 'second']);
    });

    it('passes the context to every modifier (empty object by default)', () => {
      const seen: unknown[] = [];
      const spy: LodModifier = (m, ctx) => {
        seen.push(ctx);

        return m;
      };
      const view = { fovYDeg: 60, minDistance: 300, viewportHeight: 1080 };
      applyModifiers(mesh('a'), [spy]);
      applyModifiers(mesh('a'), [spy], { view });

      expect(seen).toEqual([{}, { view }]);
    });
  });
});

describe('hdToLod', () => {
  describe('positive cases', () => {
    it('verbatim fast-path: single HD + no modifiers → copies the HD bytes (no mesh build/encode)', () => {
      const hdDff = new Uint8Array([1, 2, 3, 4]); // no 2dfx → stripParticleEffects is identity
      const build = vi.fn(() => mesh('x'));
      const encode = vi.fn(() => new Uint8Array([9]));

      const out = hdToLod({ encode, hdDff, mesh: build });

      expect(out).toBe(hdDff); // same bytes back (strip is a no-op here)
      expect(build).not.toHaveBeenCalled();
      expect(encode).not.toHaveBeenCalled();
    });

    it('mesh path when modifiers are present (even with a single HD)', () => {
      const doubled = mesh('modified');
      const encode = vi.fn((m: MergedMesh) => new Uint8Array([m.groups.length]));

      const out = hdToLod({ encode, hdDff: new Uint8Array([1]), mesh: () => mesh('src') }, [(): MergedMesh => doubled]);

      expect(encode).toHaveBeenCalledWith(doubled); // built mesh ran through the modifier, then encoded
      expect([...out]).toEqual([1]);
    });

    it('mesh path when there is no single HD DFF (a merge)', () => {
      const built = mesh('cell');
      const encode = vi.fn(() => new Uint8Array([7]));

      const out = hdToLod({ encode, mesh: () => built });

      expect(encode).toHaveBeenCalledWith(built);
      expect([...out]).toEqual([7]);
    });
  });
});
