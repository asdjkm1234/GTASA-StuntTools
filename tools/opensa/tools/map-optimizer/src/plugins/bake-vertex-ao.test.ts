import { describe, expect, it } from 'vitest';

import type { Asset, PipelineContext } from '../core/asset';
import type { SubMesh } from '../core/ir';

import { createBakeVertexAo } from './bake-vertex-ao';

const context: PipelineContext = { game: 'test', log: () => undefined };

function asset(name: string, meshes: SubMesh[]): Asset {
  return { dirty: false, ir: { meshes }, log: [], meta: {}, name, source: new Uint8Array() };
}

/** Floor 0..10 × 0..10 at z 0, with a large roof slab 2 u above covering the floor's y ≤ 5 half and beyond. */
function coveredFloor(night?: number): SubMesh[] {
  const floor = quad(
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    0,
    128,
    night,
  );
  const roof = quad(
    [
      [-10, -10],
      [20, -10],
      [20, 5],
      [-10, 5],
    ],
    2,
    128,
    night,
  );

  return [floor, roof];
}

/** A +Z-facing quad at height `z` with a flat grey prelit (and optional flat night set). */
function quad(corners: [number, number][], z: number, luma: number, night?: number): SubMesh {
  const positions = new Float32Array(corners.flatMap(([x, y]) => [x, y, z]));
  const normals = new Float32Array(corners.flatMap(() => [0, 0, 1]));
  const rgba = (value: number): Uint8Array => {
    const out = new Uint8Array(corners.length * 4);
    for (let i = 0; i < corners.length; i += 1) {
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = value;
      out[i * 4 + 3] = 255;
    }

    return out;
  };

  return {
    materialCount: 1,
    name: 'm',
    nightColors: night === undefined ? null : rgba(night),
    normals,
    positions,
    prelitColors: rgba(luma),
    triangles: [
      { a: 0, b: 1, c: 2, material: 0 },
      { a: 0, b: 2, c: 3, material: 0 },
    ],
    uvs: null,
  };
}

const lumaAt = (mesh: SubMesh, v: number): number => mesh.prelitColors![v * 4];

describe('createBakeVertexAo', () => {
  describe('negative cases', () => {
    it('does not accept a model that is not flagged flat', () => {
      expect(createBakeVertexAo(new Set(['other'])).accepts?.(asset('m', []))).toBe(false);
    });

    it('leaves a mesh without normals at the levelled fill', () => {
      const meshes = coveredFloor();
      meshes.forEach((mesh) => (mesh.normals = null));
      const target = asset('m', meshes);
      void createBakeVertexAo(new Set(['m'])).transform(target, context);

      expect(target.dirty).toBe(false);
      expect(lumaAt(target.ir.meshes[0], 0)).toBe(128);
    });

    it('does nothing when no mesh carries prelit', () => {
      const meshes = coveredFloor();
      meshes.forEach((mesh) => (mesh.prelitColors = null));
      const target = asset('m', meshes);
      void createBakeVertexAo(new Set(['m'])).transform(target, context);

      expect(target.dirty).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('darkens vertices under the roof and keeps open vertices near the levelled median', () => {
      const target = asset('m', coveredFloor());
      void createBakeVertexAo(new Set(['m'])).transform(target, context);
      const floor = target.ir.meshes[0];

      const covered = lumaAt(floor, 0); // (0,0,0) — under the roof
      const open = lumaAt(floor, 2); // (10,10,0) — sky above
      expect(target.dirty).toBe(true);
      expect(covered).toBeLessThan(open - 10);
      expect(open).toBeGreaterThanOrEqual(120); // median normalization keeps the level
      expect(open).toBeLessThanOrEqual(136);
    });

    it('applies the same shading factor to an existing night set', () => {
      const target = asset('m', coveredFloor(100));
      void createBakeVertexAo(new Set(['m'])).transform(target, context);
      const floor = target.ir.meshes[0];

      const dayRatio = lumaAt(floor, 0) / lumaAt(floor, 2);
      const nightRatio = floor.nightColors![0] / floor.nightColors![2 * 4];
      expect(nightRatio).toBeCloseTo(dayRatio, 1);
      expect(floor.nightColors![0]).toBeLessThan(100);
    });

    it('is deterministic', () => {
      const a = asset('m', coveredFloor());
      const b = asset('m', coveredFloor());
      void createBakeVertexAo(new Set(['m'])).transform(a, context);
      void createBakeVertexAo(new Set(['m'])).transform(b, context);

      expect(a.ir.meshes[0].prelitColors).toEqual(b.ir.meshes[0].prelitColors);
    });
  });
});
