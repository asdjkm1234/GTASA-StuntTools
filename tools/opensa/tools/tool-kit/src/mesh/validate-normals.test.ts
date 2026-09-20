import { describe, expect, it } from 'vitest';

import { validateNormals } from './validate-normals';

// A flat quad in the XY plane, winding → +Z.
const QUAD_POSITIONS = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
const QUAD_INDICES = [0, 1, 2, 0, 2, 3];

function upNormals(count: number): Float32Array {
  const normals = new Float32Array(count * 3);
  for (let v = 0; v < count; v += 1) {
    normals[v * 3 + 2] = 1;
  }

  return normals;
}

describe('validateNormals', () => {
  describe('negative cases', () => {
    it('fails zeroed normals as bad unit length', () => {
      const { failing, stats } = validateNormals(QUAD_POSITIONS, QUAD_INDICES, new Float32Array(12));
      expect(failing).toEqual([0, 1, 2, 3]);
      expect(stats.badUnit).toBe(4);
    });

    it('fails NaN normals as bad unit length', () => {
      const normals = upNormals(4);
      normals[0] = Number.NaN;
      const { failing, stats } = validateNormals(QUAD_POSITIONS, QUAD_INDICES, normals);
      expect(failing).toEqual([0]);
      expect(stats.badUnit).toBe(1);
    });

    it('fails a normal pointing against its faces (winding disagreement)', () => {
      const normals = upNormals(4);
      normals[2] = -1; // vertex 0 flipped to −Z against +Z faces
      const { failing, stats } = validateNormals(QUAD_POSITIONS, QUAD_INDICES, normals);
      expect(failing).toEqual([0]);
      expect(stats.badWinding).toBe(1);
    });

    it('fails a mirror-side normal shared with a top face as badShading (the roads17 class, 024)', () => {
      // The quad doubled two-sided on SHARED vertices: winding evidence cancels (the 020 gate trusted
      // this), but a DOWN normal still darkens the visible top face it participates in.
      const indices = [...QUAD_INDICES, 0, 2, 1, 0, 3, 2];
      const normals = upNormals(4);
      normals[2] = -1;
      normals[0] = 0; // vertex 0 → straight down
      const { failing, stats } = validateNormals(QUAD_POSITIONS, indices, normals);
      expect(failing).toEqual([0]);
      expect(stats.badShading).toBe(1);
      expect(stats.badWinding).toBe(0); // cancelled evidence — winding could not see it
    });

    it('fails a sideways normal on a flat top face (orthogonal dot passes winding, shading catches it)', () => {
      const normals = upNormals(4);
      normals[0] = 1;
      normals[2] = 0; // vertex 0 → horizontal +X on a +Z quad
      const { failing, stats } = validateNormals(QUAD_POSITIONS, QUAD_INDICES, normals);
      expect(failing).toEqual([0]);
      expect(stats.badShading).toBe(1);
    });

    it('respects a custom shadeDz (Infinity disables the shading check)', () => {
      const normals = upNormals(4);
      normals[0] = 1;
      normals[2] = 0;
      const { failing, stats } = validateNormals(QUAD_POSITIONS, QUAD_INDICES, normals, {
        shadeDz: Number.POSITIVE_INFINITY,
      });
      expect(failing).toEqual([]);
      expect(stats.badShading).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('passes clean unit normals that agree with winding', () => {
      const { failing, stats } = validateNormals(QUAD_POSITIONS, QUAD_INDICES, upNormals(4));
      expect(failing).toEqual([]);
      expect(stats).toEqual({ badShading: 0, badUnit: 0, badWinding: 0, unverifiable: 0, vertexCount: 4 });
    });

    it('passes an UP normal on a VERTICAL face (the grass-card trick — brightening is legal, 024)', () => {
      // A quad standing in the XZ plane (face normal −Y) with straight-up normals: the field-validated
      // standard01_lawn case — the asymmetric test must not flag sky-rotated normals.
      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]);
      const { failing, stats } = validateNormals(positions, QUAD_INDICES, upNormals(4));
      expect(failing).toEqual([]);
      expect(stats.badShading).toBe(0);
    });

    it('passes a mirror-side DOWN normal on a vertex used only by the bottom side', () => {
      // A bottom-facing quad (winding → −Z) with down normals — its own side, correct shading.
      const normals = new Float32Array(12);
      for (let v = 0; v < 4; v += 1) normals[v * 3 + 2] = -1;
      const { failing, stats } = validateNormals(QUAD_POSITIONS, [0, 2, 1, 0, 3, 2], normals);
      expect(failing).toEqual([]);
      expect(stats.badShading).toBe(0);
    });

    it('keeps a two-sided (cancelling) vertex as unverifiable instead of failing it', () => {
      // The same triangle wound both ways — face evidence cancels to zero for every vertex.
      const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
      const { failing, stats } = validateNormals(positions, [0, 1, 2, 0, 2, 1], upNormals(3));
      expect(failing).toEqual([]);
      expect(stats.unverifiable).toBe(3);
    });

    it('keeps a faceless vertex as unverifiable', () => {
      const { failing, stats } = validateNormals(QUAD_POSITIONS, [0, 1, 2], upNormals(4));
      expect(failing).toEqual([]);
      expect(stats.unverifiable).toBe(1); // vertex 3 has no incident face
    });
  });
});
