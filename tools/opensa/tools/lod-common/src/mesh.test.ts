import { describe, expect, it } from 'vitest';

import type { MergedMesh } from './mesh';

import { concatMeshes } from './mesh';

/** A minimal one-triangle mesh at `base` with a single group named `texture`. */
function tri(texture: string, base: number, night?: boolean): MergedMesh {
  return {
    colors: new Uint8Array([10, 10, 10, 255, 20, 20, 20, 255, 30, 30, 30, 255]),
    groups: [{ indices: Uint32Array.of(0, 1, 2), texture }],
    ...(night ? { nightColors: new Uint8Array([1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255]) } : {}),
    normals: new Float32Array(9),
    positions: new Float32Array([base, 0, 0, base + 1, 0, 0, base, 1, 0]),
    uvs: new Float32Array(6),
  };
}

describe('concatMeshes', () => {
  describe('negative cases', () => {
    it('emits no night set when neither side carries one', () => {
      expect(concatMeshes(tri('a', 0), tri('b', 5)).nightColors).toBeUndefined();
    });
  });

  describe('positive cases', () => {
    it('appends vertices and rebases the second mesh’s group indices', () => {
      const out = concatMeshes(tri('a', 0), tri('b', 5));

      expect(out.positions.length).toBe(18);
      expect(out.groups.map((g) => g.texture)).toEqual(['a', 'b']);
      expect([...out.groups[0].indices]).toEqual([0, 1, 2]);
      expect([...out.groups[1].indices]).toEqual([3, 4, 5]);
      expect(out.positions[9]).toBe(5); // b's first vertex follows a's three
    });

    it('falls back to a side’s DAY colours when only the other side has a night set', () => {
      const out = concatMeshes(tri('a', 0, true), tri('b', 5));

      expect(out.nightColors).toBeDefined();
      expect([...out.nightColors!.subarray(0, 4)]).toEqual([1, 1, 1, 255]); // a's real night
      expect([...out.nightColors!.subarray(12, 16)]).toEqual([10, 10, 10, 255]); // b's day stand-in
    });
  });
});
