import { describe, expect, it } from 'vitest';

import { simplify, type SimplifyMesh } from './simplify';

/** An N×N quad grid in the XY plane (2N² triangles), with UVs = the XY position. */
function grid(n: number): SimplifyMesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let y = 0; y <= n; y += 1) {
    for (let x = 0; x <= n; x += 1) {
      positions.push(x, y, 0);
      uvs.push(x, y);
    }
  }
  const faces: number[] = [];
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const v00 = y * (n + 1) + x;
      const v10 = v00 + 1;
      const v01 = v00 + (n + 1);
      const v11 = v01 + 1;
      faces.push(v00, v10, v11, v00, v11, v01);
    }
  }

  return {
    attributes: [{ data: Float64Array.from(uvs), size: 2 }],
    faceGroup: new Int32Array(faces.length / 3),
    faces: Int32Array.from(faces),
    positions: Float64Array.from(positions),
  };
}

/**
 * A 1×8 quad strip along X whose U mapping is PATCHWORK — gradient 0.1/unit up to x=4, then 1.0/unit (continuous
 * at the junction, like GTA roads resetting their tiled V every few segments). Any collapse merging the two
 * mappings produces faces whose interpolated UVs disagree with the ground truth.
 */
function patchworkStrip(): SimplifyMesh {
  const positions: number[] = [];
  const uvs: number[] = [];
  for (let y = 0; y <= 1; y += 1) {
    for (let x = 0; x <= 8; x += 1) {
      positions.push(x, y, 0);
      uvs.push(patchworkU(x), y);
    }
  }
  const faces: number[] = [];
  for (let x = 0; x < 8; x += 1) {
    faces.push(x, x + 1, 9 + x + 1, x, 9 + x + 1, 9 + x);
  }

  return {
    attributes: [{ data: Float64Array.from(uvs), size: 2 }],
    faceGroup: new Int32Array(16),
    faces: Int32Array.from(faces),
    positions: Float64Array.from(positions),
  };
}

/** The strip's ground-truth U at position x. */
function patchworkU(x: number): number {
  return x <= 4 ? 0.1 * x : 0.4 + (x - 4);
}

/** Worst face-level UV error: each face's affine map sampled at its centroid vs the strip's ground truth. */
function worstFaceDrift(result: {
  attributes: { data: Float64Array }[];
  faces: Int32Array;
  positions: Float64Array;
}): number {
  const uv = result.attributes[0].data;
  const p = result.positions;
  let worst = 0;
  for (let f = 0; f < result.faces.length / 3; f += 1) {
    const [a, b, c] = [result.faces[f * 3], result.faces[f * 3 + 1], result.faces[f * 3 + 2]];
    const centroidX = (p[a * 3] + p[b * 3] + p[c * 3]) / 3;
    const mappedU = (uv[a * 2] + uv[b * 2] + uv[c * 2]) / 3;
    worst = Math.max(worst, Math.abs(mappedU - patchworkU(centroidX)));
  }

  return worst;
}

describe('simplify', () => {
  describe('negative cases', () => {
    it('returns an empty mesh unchanged', () => {
      const result = simplify(
        { faceGroup: new Int32Array(0), faces: new Int32Array(0), positions: new Float64Array(0) },
        10,
      );
      expect(result.faces).toHaveLength(0);
    });

    it('without maxUvDrift, collapsing a patchwork-mapped strip smears its texture mapping (the road-stripes bug)', () => {
      // Documents the failure the guard exists for: unguarded QEM merges the two mappings and the surviving
      // faces' UVs disagree with the ground truth by over a full tile — roads render as lengthwise stripes.
      const result = simplify(patchworkStrip(), 2);
      expect(worstFaceDrift(result)).toBeGreaterThan(0.5);
    });
  });

  describe('positive cases', () => {
    it('reduces a flat grid toward the budget while staying within the original bounds', () => {
      const result = simplify(grid(8), 20); // 128 → ≤ ~20 triangles
      const faceCount = result.faces.length / 3;
      expect(faceCount).toBeLessThan(128);
      expect(faceCount).toBeGreaterThan(0);

      for (let i = 0; i < result.positions.length; i += 3) {
        expect(Number.isFinite(result.positions[i])).toBe(true);
        expect(result.positions[i]).toBeGreaterThanOrEqual(-0.01); // boundary pinned → inside [0,8]
        expect(result.positions[i]).toBeLessThanOrEqual(8.01);
      }
      expect(result.attributes[0].size).toBe(2);
      expect(result.attributes[0].data.length).toBe((result.positions.length / 3) * 2);
    });

    it('keeps every face index in range after compaction', () => {
      const result = simplify(grid(6), 15);
      const vertexCount = result.positions.length / 3;
      expect([...result.faces].every((v) => v >= 0 && v < vertexCount)).toBe(true);
    });

    it('caps edge growth on a flat surface when maxEdgeFactor is set', () => {
      const inputMaxEdge = Math.SQRT2; // unit grid → longest input edge is the quad diagonal
      const uncapped = maxEdge(simplify(grid(8), 8));
      const capped = maxEdge(simplify(grid(8), 8, { maxEdgeFactor: 1.5 }));
      expect(uncapped).toBeGreaterThan(inputMaxEdge * 1.5); // unbounded QEM slivers the flat grid into long edges
      expect(capped).toBeLessThanOrEqual(inputMaxEdge * 1.5 + 1e-9);
    });

    it('with maxUvDrift, every surviving face stays true to the patchwork mapping', () => {
      const result = simplify(patchworkStrip(), 2, { maxUvDrift: 0.1 });
      expect(worstFaceDrift(result)).toBeLessThanOrEqual(0.1 + 1e-9);
    });

    it('maxUvDrift does not block decimation of a uniformly affine-mapped surface', () => {
      // grid() maps UV = position — one global affine map, so every collapse is UV-exact and the guard is free.
      const guarded = simplify(grid(8), 20, { maxUvDrift: 0.1 });
      expect(guarded.faces.length / 3).toBeLessThanOrEqual(simplify(grid(8), 20).faces.length / 3 + 2);
      expect(guarded.faces.length / 3).toBeLessThan(128);
    });

    it('keeps a flat group alive with minFacesPerGroup that would otherwise collapse to nothing', () => {
      const mesh = grid(8);
      mesh.faceGroup = mesh.faceGroup.map((_, f) => (f < 6 ? 1 : 0)); // a small 6-face group within the flat grid
      const groupFaces = (r: { faceGroup: Int32Array }): number => [...r.faceGroup].filter((g) => g === 1).length;

      expect(groupFaces(simplify(mesh, 4))).toBeLessThan(2); // unbounded → the flat group is collapsed away
      expect(groupFaces(simplify(mesh, 4, { minFacesPerGroup: 2 }))).toBeGreaterThanOrEqual(2);
    });
  });
});

/** Longest edge over all faces of a simplify result. */
function maxEdge(result: { faces: Int32Array; positions: Float64Array }): number {
  const p = result.positions;
  const len = (a: number, b: number): number =>
    Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
  let m = 0;
  for (let f = 0; f < result.faces.length; f += 3) {
    const [a, b, c] = [result.faces[f], result.faces[f + 1], result.faces[f + 2]];
    m = Math.max(m, len(a, b), len(b, c), len(c, a));
  }

  return m;
}
