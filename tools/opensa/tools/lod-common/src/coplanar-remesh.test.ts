import { describe, expect, it } from 'vitest';

import type { MergedMesh } from './mesh';

import { createCoplanarRemesh } from './coplanar-remesh';

const remesh = createCoplanarRemesh();

/**
 * A flat n×n-quad grid at z=0 with shared indices, affine UV (x/n, y/n) and uniform colour — the ideal remesh
 * candidate (dense interior, single boundary loop).
 */
function grid(n: number, mutate?: (mesh: MergedMesh) => void): MergedMesh {
  const side = n + 1;
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      positions.push(x, y, 0);
      uvs.push(x / n, y / n);
    }
  }
  const indices: number[] = [];
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const v = y * side + x;
      indices.push(v, v + 1, v + side, v + 1, v + side + 1, v + side);
    }
  }
  const mesh: MergedMesh = {
    colors: new Uint8Array(side * side * 4).fill(255),
    groups: [{ indices: Uint32Array.from(indices), texture: 'ground' }],
    normals: new Float32Array(side * side * 3),
    positions: Float32Array.from(positions),
    uvs: Float32Array.from(uvs),
  };
  mutate?.(mesh);

  return mesh;
}

const faceCount = (mesh: MergedMesh): number => mesh.groups.reduce((s, g) => s + g.indices.length / 3, 0);

const totalArea = (mesh: MergedMesh): number => {
  let area = 0;
  const p = mesh.positions;
  for (const group of mesh.groups) {
    for (let i = 0; i < group.indices.length; i += 3) {
      const [a, b, c] = [group.indices[i] * 3, group.indices[i + 1] * 3, group.indices[i + 2] * 3];
      const abx = p[b] - p[a];
      const aby = p[b + 1] - p[a + 1];
      const acx = p[c] - p[a];
      const acy = p[c + 1] - p[a + 1];
      area += Math.abs(abx * acy - aby * acx) / 2;
    }
  }

  return area;
};

describe('createCoplanarRemesh', () => {
  describe('negative cases', () => {
    it('leaves a grid with non-affine UV untouched (per-cluster fallback)', () => {
      const input = grid(4, (mesh) => {
        mesh.uvs[2 * (2 * 5 + 2)] += 0.05; // bend one interior vertex's U off the affine field
      });

      expect(remesh(input, {})).toBe(input);
    });

    it('leaves a grid with a non-affine prelit gradient untouched', () => {
      const input = grid(4, (mesh) => {
        for (let v = 0; v < 25; v += 1) {
          mesh.colors[v * 4] = Math.min(255, (v % 5) * (v % 5) * 10); // quadratic in x
        }
      });

      expect(remesh(input, {})).toBe(input);
    });

    it('leaves a grid with a hole untouched (two boundary loops → v1 fallback)', () => {
      const input = grid(4, (mesh) => {
        const indices = [...mesh.groups[0].indices];
        indices.splice((2 * 4 + 2) * 6, 6); // remove the centre quad's two faces
        mesh.groups[0].indices = Uint32Array.from(indices);
      });

      expect(remesh(input, {})).toBe(input);
    });

    it('leaves a bent grid untouched (raised vertex splits the plane, remainder has a hole)', () => {
      const input = grid(4, (mesh) => {
        mesh.positions[3 * (2 * 5 + 2) + 2] = 1; // raise the centre vertex
      });

      expect(remesh(input, {})).toBe(input);
    });
  });

  describe('positive cases', () => {
    it('re-triangulates a flat grid to boundary-only fans, boundary byte-exact, area preserved', () => {
      const input = grid(4);
      const out = remesh(input, {});

      expect(faceCount(out)).toBe(14); // 16 boundary verts - 2
      expect(out.positions).toHaveLength(16 * 3); // interior vertices compacted away
      expect(totalArea(out)).toBeCloseTo(16, 6); // 4×4 world units, exactly covered
      // Every surviving vertex is an original perimeter vertex, bit-for-bit.
      for (let v = 0; v < out.positions.length; v += 3) {
        const [x, y] = [out.positions[v], out.positions[v + 1]];
        expect(x === 0 || x === 4 || y === 0 || y === 4).toBe(true);
      }
    });

    it('carries night colours through an affine cluster', () => {
      const input = grid(4, (mesh) => {
        mesh.nightColors = new Uint8Array(25 * 4).fill(30);
      });
      const out = remesh(input, {});

      expect(faceCount(out)).toBe(14);
      expect(out.nightColors).toHaveLength(16 * 4);
      expect(out.nightColors?.[0]).toBe(30);
    });

    it('splits clusters by the twoSided flag and remeshes each half with its mask', () => {
      const input = grid(4, (mesh) => {
        // Bottom two quad rows single-sided, top two rows two-sided → two 4×2 rectangles.
        mesh.groups[0].twoSided = Uint8Array.from({ length: 32 }, (_, f) => (f < 16 ? 0 : 1));
      });
      const out = remesh(input, {});

      expect(faceCount(out)).toBe(20); // two rectangles: 12 boundary verts → 10 tris each
      const mask = [...(out.groups[0].twoSided ?? [])];
      expect(mask.filter((flag) => flag === 0)).toHaveLength(10);
      expect(mask.filter((flag) => flag === 1)).toHaveLength(10);
    });
  });
});
