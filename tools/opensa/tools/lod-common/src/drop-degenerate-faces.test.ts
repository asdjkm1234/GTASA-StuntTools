import { describe, expect, it } from 'vitest';

import type { MergedMesh } from './mesh';

import { dropDegenerateFaces } from './drop-degenerate-faces';

/** A mesh from explicit vertex positions + per-texture index triples (white colours, zero normals/uvs). */
function mesh(positions: number[], groups: { indices: number[]; texture: string }[]): MergedMesh {
  const vertexCount = positions.length / 3;

  return {
    colors: new Uint8Array(vertexCount * 4).fill(255),
    groups: groups.map((group) => ({ indices: Uint32Array.from(group.indices), texture: group.texture })),
    normals: new Float32Array(vertexCount * 3),
    positions: Float32Array.from(positions),
    uvs: new Float32Array(vertexCount * 2),
  };
}

// v0..v2 span a real triangle; v3 duplicates v0 (degenerate partner); v4/v5 are collinear with v0.
const POSITIONS = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 2, 0, 0, 4, 0, 0];

describe('dropDegenerateFaces', () => {
  describe('negative cases', () => {
    it('returns the mesh unchanged when no face is degenerate', () => {
      const input = mesh(POSITIONS, [{ indices: [0, 1, 2], texture: 'a' }]);

      expect(dropDegenerateFaces(input, {})).toBe(input);
    });

    it('does not drop a small-but-real face (tiling tessellation stays)', () => {
      // 0.01 × 0.01 face — tiny on screen but genuinely area-bearing.
      const small = mesh([0, 0, 0, 0.01, 0, 0, 0, 0.01, 0], [{ indices: [0, 1, 2], texture: 'a' }]);

      expect(dropDegenerateFaces(small, {})).toBe(small);
    });
  });

  describe('positive cases', () => {
    it('drops a zero-area (collinear) face and keeps the real one', () => {
      const out = dropDegenerateFaces(mesh(POSITIONS, [{ indices: [0, 1, 2, 0, 4, 5], texture: 'a' }]), {});

      expect([...out.groups[0].indices]).toEqual([0, 1, 2]);
    });

    it('drops a duplicate-vertex face and compacts the orphaned vertices', () => {
      const out = dropDegenerateFaces(
        mesh(POSITIONS, [
          { indices: [0, 1, 2], texture: 'a' },
          { indices: [0, 3, 1], texture: 'b' }, // v3 == v0 → zero area
        ]),
        {},
      );

      expect(out.groups).toHaveLength(1);
      expect(out.positions).toHaveLength(9); // v3..v5 orphans removed
    });
  });
});
