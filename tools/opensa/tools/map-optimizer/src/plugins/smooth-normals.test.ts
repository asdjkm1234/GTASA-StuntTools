import { describe, expect, it } from 'vitest';

import type { Asset, PipelineContext } from '../core/asset';
import type { SubMesh } from '../core/ir';

import { createSmoothNormals, emptySmoothNormalsStats, rebuildSmoothNormals } from './smooth-normals';

const context: PipelineContext = { game: 'test', log: (asset, plugin, message) => asset.log.push({ message, plugin }) };

function assetOf(sub: SubMesh): Asset {
  return { dirty: false, ir: { meshes: [sub] }, log: [], name: 'a', source: new Uint8Array() } as unknown as Asset;
}

/** A flat quad (XY plane, +Z winding) with authored normals — the preserve/repair fixture. */
function authoredQuad(): SubMesh {
  const sub = mesh(
    [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
    [
      [0, 1, 2],
      [0, 2, 3],
    ],
  );
  const normals = new Float32Array(12);
  for (let v = 0; v < 4; v += 1) {
    normals[v * 3 + 2] = 1;
  }
  sub.normals = normals;

  return sub;
}

function mesh(positions: number[], triangles: [number, number, number][]): SubMesh {
  return {
    materialCount: 1,
    name: 'm',
    nightColors: null,
    normals: null,
    positions: new Float32Array(positions),
    prelitColors: null,
    triangles: triangles.map(([a, b, c]) => ({ a, b, c, material: 0 })),
    uvs: null,
  };
}

function normalAt(normals: Float32Array | null, v: number): [number, number, number] {
  return [normals![v * 3], normals![v * 3 + 1], normals![v * 3 + 2]];
}

describe('rebuildSmoothNormals', () => {
  describe('negative cases', () => {
    it('returns null for an empty mesh', () => {
      expect(rebuildSmoothNormals(mesh([], []))).toBeNull();
    });

    it('does not split a flat quad — one smooth group, one normal per vertex', () => {
      const flat = mesh(
        [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
        [
          [0, 1, 2],
          [0, 2, 3],
        ],
      );
      const out = rebuildSmoothNormals(flat)!;
      expect(out.positions.length / 3).toBe(4); // no split
      for (let v = 0; v < 4; v += 1) {
        expect(normalAt(out.normals, v)).toEqual([0, 0, 1]);
      }
    });
  });

  describe('positive cases', () => {
    it('splits a shared 90° corner so each wall keeps its own flat normal', () => {
      // Vertices 0,1 are shared by both faces; the hinge edge (0,1) is 90° → two groups → 0,1 split.
      const hinge = mesh(
        [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
        [
          [0, 1, 2],
          [0, 1, 3],
        ],
      );
      const out = rebuildSmoothNormals(hinge)!;
      expect(out.positions.length / 3).toBe(6); // 4 → 6 (0 and 1 each duplicated)
      expect(normalAt(out.normals, out.triangles[0].a)).toEqual([0, 0, 1]); // +Z wall
      expect(normalAt(out.normals, out.triangles[1].a)).toEqual([0, -1, 0]); // -Y wall
    });

    it('handles a double face: opposite-wound coincident triangles get opposite normals', () => {
      const doubleFace = mesh(
        [0, 0, 0, 1, 0, 0, 0, 1, 0],
        [
          [0, 1, 2],
          [0, 2, 1],
        ],
      );
      const out = rebuildSmoothNormals(doubleFace)!;
      expect(out.positions.length / 3).toBe(6); // every vertex split between the two sides
      expect(normalAt(out.normals, out.triangles[0].a)).toEqual([0, 0, 1]);
      expect(normalAt(out.normals, out.triangles[1].a)).toEqual([0, 0, -1]);
    });
  });
});

describe('createSmoothNormals authored gate (plan 020)', () => {
  describe('negative cases', () => {
    it('fully recomputes a mesh whose authored normals are mass garbage (zeroed block)', () => {
      const sub = authoredQuad();
      sub.normals = new Float32Array(12); // all four vertices fail the unit check → > repairFraction
      const stats = emptySmoothNormalsStats();
      const asset = assetOf(sub);
      void createSmoothNormals({}, stats).transform(asset, context);
      expect(stats.recomputedMeshes).toBe(1);
      expect(asset.dirty).toBe(true);
      expect(normalAt(sub.normals, 0)).toEqual([0, 0, 1]); // rebuilt from geometry
    });

    it('does not create normals on a normal-less mesh without addWhereAbsent', () => {
      const sub = mesh([0, 0, 0, 1, 0, 0, 1, 1, 0], [[0, 1, 2]]);
      const stats = emptySmoothNormalsStats();
      const asset = assetOf(sub);
      void createSmoothNormals({}, stats).transform(asset, context);
      expect(sub.normals).toBeNull();
      expect(asset.dirty).toBe(false);
      expect(stats).toEqual(emptySmoothNormalsStats());
    });
  });

  describe('positive cases', () => {
    it('preserves clean authored normals byte-identical and stays non-dirty', () => {
      const sub = authoredQuad();
      const before = Float32Array.from(sub.normals!);
      const stats = emptySmoothNormalsStats();
      const asset = assetOf(sub);
      void createSmoothNormals({}, stats).transform(asset, context);
      expect(stats.preservedMeshes).toBe(1);
      expect(asset.dirty).toBe(false);
      expect([...sub.normals!]).toEqual([...before]);
      expect(sub.positions.length / 3).toBe(4); // no splits
    });

    it('point-repairs an isolated broken vertex, leaving the rest untouched', () => {
      const sub = authoredQuad();
      // 16-vertex grid version so 1 broken vertex is ≤ 5 %... a quad is 4 verts, so raise the fraction instead.
      sub.normals![2] = -1; // vertex 0 flipped against the +Z winding
      const stats = emptySmoothNormalsStats();
      const asset = assetOf(sub);
      void createSmoothNormals({ repairFraction: 0.25 }, stats).transform(asset, context);
      expect(stats.repairedMeshes).toBe(1);
      expect(stats.repairedVertices).toBe(1);
      expect(asset.dirty).toBe(true);
      expect(normalAt(sub.normals, 0)).toEqual([0, 0, 1]); // repaired to the group normal
      expect(normalAt(sub.normals, 1)).toEqual([0, 0, 1]); // untouched
      expect(sub.positions.length / 3).toBe(4); // repair never splits
    });

    it('creates normals where absent with addWhereAbsent', () => {
      const sub = mesh([0, 0, 0, 1, 0, 0, 1, 1, 0], [[0, 1, 2]]);
      const stats = emptySmoothNormalsStats();
      const asset = assetOf(sub);
      void createSmoothNormals({ addWhereAbsent: true }, stats).transform(asset, context);
      expect(stats.createdMeshes).toBe(1);
      expect(normalAt(sub.normals, 0)).toEqual([0, 0, 1]);
      expect(asset.dirty).toBe(true);
    });
  });
});
