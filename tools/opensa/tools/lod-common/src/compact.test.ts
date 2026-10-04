import { describe, expect, it } from 'vitest';

import type { MergedMesh } from './mesh';

import { compactMeshVertices } from './compact';

/** Three vertices per unit step on X; groups pick which of them triangles reference. */
function mesh(vertexCount: number, groups: { indices: number[]; texture: string }[], night = false): MergedMesh {
  return {
    colors: Uint8Array.from({ length: vertexCount * 4 }, (_, i) => i),
    groups: groups.map((group) => ({ indices: Uint32Array.from(group.indices), texture: group.texture })),
    normals: Float32Array.from({ length: vertexCount * 3 }, (_, i) => i),
    positions: Float32Array.from({ length: vertexCount * 3 }, (_, i) => i),
    uvs: Float32Array.from({ length: vertexCount * 2 }, (_, i) => i),
    ...(night ? { nightColors: Uint8Array.from({ length: vertexCount * 4 }, (_, i) => 100 + i) } : {}),
  };
}

describe('compactMeshVertices', () => {
  describe('negative cases', () => {
    it('returns the mesh unchanged when every vertex is referenced', () => {
      const input = mesh(3, [{ indices: [0, 1, 2], texture: 'a' }]);

      expect(compactMeshVertices(input)).toBe(input);
    });
  });

  describe('positive cases', () => {
    it('drops orphan vertices and remaps indices', () => {
      const out = compactMeshVertices(mesh(6, [{ indices: [3, 4, 5], texture: 'a' }]));

      expect(out.positions).toHaveLength(9);
      expect([...out.groups[0].indices]).toEqual([0, 1, 2]);
      expect([...out.positions]).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17]);
      expect([...out.uvs]).toEqual([6, 7, 8, 9, 10, 11]);
      expect([...out.colors]).toEqual([12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
    });

    it('carries the night set through the remap when present', () => {
      const out = compactMeshVertices(mesh(4, [{ indices: [1, 2, 3], texture: 'a' }], true));

      expect([...(out.nightColors ?? [])]).toEqual([104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115]);
    });

    it('keeps a vertex shared by two groups exactly once', () => {
      const out = compactMeshVertices(
        mesh(5, [
          { indices: [0, 1, 2], texture: 'a' },
          { indices: [2, 3, 0], texture: 'b' },
        ]),
      );

      expect(out.positions).toHaveLength(12);
      expect([...out.groups[1].indices]).toEqual([2, 3, 0]);
    });
  });
});
