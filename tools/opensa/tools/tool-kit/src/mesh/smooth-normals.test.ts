import { describe, expect, it } from 'vitest';

import { rebuildSmoothNormals } from './smooth-normals';

describe('rebuildSmoothNormals', () => {
  describe('negative cases', () => {
    it('returns null with no triangles', () => {
      expect(rebuildSmoothNormals(new Float32Array(9), new Uint32Array(0))).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('leaves a flat quad un-split with one consistent normal', () => {
      // Two coplanar triangles in the XY plane (winding → +Z).
      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
      const result = rebuildSmoothNormals(positions, [0, 1, 2, 0, 2, 3])!;
      expect(result.splitSources).toEqual([]); // one smooth group → no split
      expect([...result.indices]).toEqual([0, 1, 2, 0, 2, 3]); // indices unchanged
      expect([...result.normals.slice(0, 3)]).toEqual([0, 0, 1]);
    });

    it('splits the shared edge of a 90° crease (sharper than 45°)', () => {
      // Two triangles sharing edge A–B: one flat (XY), one vertical — dihedral 90° > crease.
      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
      const result = rebuildSmoothNormals(positions, [0, 1, 2, 0, 1, 3])!;
      expect(result.splitSources).toEqual([0, 1]); // A and B each split into a second copy
      expect(result.normals).toHaveLength((4 + 2) * 3); // 4 originals + 2 appended
    });

    it('weights by corner angle so a huge sliver does not dominate a junction vertex (plan 021)', () => {
      // Faces share edge (0,1): a unit triangle tilted 30° (normal (0,−0.5,0.866)) and a 200 u road-strip
      // sliver in the XY plane (normal +Z, area 2 — 4× the unit face) whose corner angle at vertex 0 is
      // only ~0.02 rad. Area-only weighting lands near +Z (nz ≈ 0.99); angle×area keeps the tilt.
      const positions = new Float32Array([
        0,
        0,
        0, // 0 — the junction
        1,
        0,
        0, // 1
        0.5,
        Math.cos(Math.PI / 6),
        Math.sin(Math.PI / 6), // 2 — tilts triangle (0,1,2) by 30°
        200,
        -4,
        0, // 3 — sliver far end
      ]);
      const result = rebuildSmoothNormals(positions, [0, 1, 2, 0, 3, 1], { creaseAngleDeg: 60 })!;
      expect(result.splitSources).toEqual([]); // 30° dihedral < 60° crease — one smooth group
      const ny = result.normals[1];
      const nz = result.normals[2];
      expect(nz).toBeLessThan(0.93); // area-only would give ≈ 0.99
      expect(ny).toBeLessThan(-0.3); // the tilted face's −Y lean survives
    });

    it('welds ε-close vertices straddling a grid-cell boundary (plan 023B)', () => {
      // Two coplanar triangles whose "shared" edge is duplicated with a 0.0000002 x-offset chosen so the
      // two copies quantize into DIFFERENT ε-cells (0.0004999 → cell 0, 0.0005001 → cell 1). Grid-only
      // welding loses the adjacency (two boundary-edged groups); the neighbour union restores ONE group.
      const xA = 0.0004999;
      const xB = 0.0005001;
      const positions = new Float32Array([
        xA,
        0,
        0, // 0 — edge copy A
        xA,
        1,
        0, // 1
        -1,
        0.5,
        0.2, // 2 — left face, slightly tilted
        xB,
        0,
        0, // 3 — edge copy B (same points within ε)
        xB,
        1,
        0, // 4
        1,
        0.5,
        0.2, // 5 — right face, tilted the other way
      ]);
      const result = rebuildSmoothNormals(positions, [0, 1, 2, 3, 5, 4])!;
      expect(result.splitSources).toEqual([]); // one smooth group across the seam
      // The two copies of the seam vertex must carry the SAME averaged normal (not their own face normals).
      expect(result.normals[0 * 3 + 2]).toBeCloseTo(result.normals[3 * 3 + 2], 6);
      expect(result.normals[0 * 3]).toBeCloseTo(result.normals[3 * 3], 6);
    });

    it('smooths a DOUBLED curved surface per side (plan 022 twin quads)', () => {
      // A gently-bent quad strip (two faces, dihedral ≈ 17° < 45°) plus its mirrored back side. The interior
      // edge (1,2) is 4-incident (two twin pairs) — pre-022 that was a hard boundary and every face went its
      // own group. Now each SIDE smooths: both front faces must share their emitted vertices on edge (1,2)
      // (averaged normal, +Z-ish), both back faces share theirs (−Z-ish).
      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0.3]);
      const front: [number, number, number][] = [
        [0, 1, 2],
        [1, 3, 2],
      ];
      const back: [number, number, number][] = [
        [0, 2, 1],
        [1, 2, 3],
      ];
      const flat = [...front, ...back].flat();
      const result = rebuildSmoothNormals(positions, flat)!;
      // Front faces are one group: their shared-edge corners resolve to the SAME emitted vertices.
      expect(result.indices[0 * 3 + 1]).toBe(result.indices[1 * 3 + 0]); // vertex 1 shared by both fronts
      expect(result.indices[0 * 3 + 2]).toBe(result.indices[1 * 3 + 2]); // vertex 2 shared by both fronts
      // Back faces are one group too, but a DIFFERENT copy of vertex 1/2 than the front's.
      expect(result.indices[2 * 3 + 2]).toBe(result.indices[3 * 3 + 0]); // vertex 1 shared by both backs
      expect(result.indices[2 * 3 + 2]).not.toBe(result.indices[0 * 3 + 1]);
      // Opposite orientations: the front copy of vertex 1 points +Z-ish, the back copy −Z-ish, mirrored.
      const frontV1 = result.indices[0 * 3 + 1];
      const backV1 = result.indices[2 * 3 + 2];
      expect(result.normals[frontV1 * 3 + 2]).toBeGreaterThan(0.9);
      expect(result.normals[backV1 * 3 + 2]).toBeCloseTo(-result.normals[frontV1 * 3 + 2], 6);
    });

    it('keeps a T-junction edge hard (3 incidents, no twins)', () => {
      // Two coplanar faces sharing edge (0,1) PLUS a third vertical face on the same edge — 3-incident,
      // not a twin structure → no smoothing across it: the two coplanar faces stay separate groups.
      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0.5, 1, 0, 0.5, -1, 0, 0.5, 0, 1]);
      const result = rebuildSmoothNormals(positions, [0, 1, 2, 0, 4, 1, 1, 0, 3])!;
      // If the junction had smoothed, faces 0 and 2 (coplanar, opposite winding around the edge) would share
      // emitted vertices; assert they DON'T (each keeps its own copy of vertex 0).
      expect(result.indices[0 * 3 + 0]).not.toBe(result.indices[2 * 3 + 1]);
    });
  });
});
