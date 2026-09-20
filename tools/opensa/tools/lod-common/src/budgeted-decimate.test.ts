import { describe, expect, it } from 'vitest';

import type { MergedMesh } from './mesh';

import { createBudgetedDecimate } from './budgeted-decimate';
import { lodView } from './view';

const ctx = { view: lodView(300) };

/**
 * A dense flat n×n-quad grid at z=0 — decimation-friendly when uniformly lit (any triangulation of a flat,
 * uniformly-lit plane renders identically). `checker: true` paints a per-vertex black/white checkerboard prelit
 * that edge collapses visibly smear — the render self-check must reject that under a strict budget.
 */
function grid(n: number, checker = false): MergedMesh {
  const side = n + 1;
  const positions: number[] = [];
  const colors = new Uint8Array(side * side * 4).fill(255);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      positions.push(x * 4, y * 4, 0);
      if (checker && (x + y) % 2 === 0) {
        const v = (y * side + x) * 4;
        colors[v] = colors[v + 1] = colors[v + 2] = 0;
        colors[v + 3] = 255;
      }
    }
  }
  const indices: number[] = [];
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const v = y * side + x;
      indices.push(v, v + 1, v + side, v + 1, v + side + 1, v + side);
    }
  }

  return {
    colors,
    groups: [{ indices: Uint32Array.from(indices), texture: 'ground' }],
    normals: new Float32Array(side * side * 3),
    positions: Float32Array.from(positions),
    uvs: new Float32Array(side * side * 2),
  };
}

const faceCount = (mesh: MergedMesh): number => mesh.groups.reduce((s, g) => s + g.indices.length / 3, 0);

describe('createBudgetedDecimate', () => {
  describe('negative cases', () => {
    it('returns the mesh unchanged without a view in the context', () => {
      const input = grid(20);

      expect(createBudgetedDecimate()(input, {})).toBe(input);
    });

    it('skips meshes under the minFaces floor', () => {
      const input = grid(4); // 32 faces < 500

      expect(createBudgetedDecimate()(input, ctx)).toBe(input);
    });

    it('keeps the original when no ratio survives a zero budget on visibly patterned geometry', () => {
      // Checkerboard prelit: any collapse smears the pattern → every candidate exceeds a zero budget.
      const input = grid(20, true);

      expect(createBudgetedDecimate({ minFaces: 100, pixelBudget: 0 })(input, ctx)).toBe(input);
    });
  });

  describe('positive cases', () => {
    it('decimates a flat uniform grid within the budget (bounded by the anti-spike edge cap)', () => {
      const input = grid(20); // 800 faces of pure flatness
      const out = createBudgetedDecimate({ minFaces: 100 })(input, ctx);

      expect(faceCount(out)).toBeLessThan(faceCount(input) * 0.8);
    });

    it('is deterministic (same input → same output)', () => {
      const a = createBudgetedDecimate({ minFaces: 100 })(grid(12), ctx);
      const b = createBudgetedDecimate({ minFaces: 100 })(grid(12), ctx);

      expect([...a.positions]).toEqual([...b.positions]);
      expect([...a.groups[0].indices]).toEqual([...b.groups[0].indices]);
    });
  });
});
