import { describe, expect, it } from 'vitest';

import type { WaterQuad } from '../parsers/text/water.parser';

import { flatWaterMesh, WATER_DEEP, WATER_VERTEX_FLOATS } from './water-mesh';

/** The vertices of the authored quads only — the ocean frame is appended after them. */
function authored(mesh: ReturnType<typeof flatWaterMesh>, count: number): number[][] {
  const rows: number[][] = [];
  for (let v = 0; v < count; v += 1) {
    rows.push([...mesh.positions.slice(v * WATER_VERTEX_FLOATS, (v + 1) * WATER_VERTEX_FLOATS)]);
  }

  return rows;
}

/** A rectangle at one height, in the winding water.dat uses (two rows of two). */
function quad(x0: number, x1: number, y0: number, y1: number, z: number): WaterQuad {
  return {
    vertices: [
      [x0, y0, z],
      [x1, y0, z],
      [x0, y1, z],
      [x1, y1, z],
    ],
  };
}

describe('flatWaterMesh', () => {
  describe('negative cases', () => {
    it('still answers a sea for a map with no water polygons — the ocean frame is the whole plane', () => {
      const mesh = flatWaterMesh([]);
      expect(mesh.indices.length).toBe(6);
      expect(mesh.positions.length).toBe(4 * WATER_VERTEX_FLOATS);
    });

    it('skips a polygon with fewer than three corners instead of emitting a broken triangle', () => {
      const degenerate: WaterQuad = { vertices: [[0, 0, 0]] };
      const mesh = flatWaterMesh([degenerate]);
      // The lone corner still occupies a vertex slot, but NO index may reference it — that is the skip.
      expect([...mesh.indices].includes(0)).toBe(false);
      expect(mesh.indices.length % 3).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('emits two triangles per 4-corner polygon, in GTA coords, with the deep field', () => {
      const mesh = flatWaterMesh([quad(-10, 10, -10, 10, 0)]);
      const rows = authored(mesh, 4);

      expect(rows[0]).toEqual([-10, -10, 0, WATER_DEEP, 0]);
      expect(rows[3]).toEqual([10, 10, 0, WATER_DEEP, 0]);
      expect([...mesh.indices.slice(0, 6)]).toEqual([0, 1, 2, 2, 1, 3]);
    });

    it('emits one triangle for a 3-corner polygon', () => {
      const triangle: WaterQuad = {
        vertices: [
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ],
      };
      expect([...flatWaterMesh([triangle]).indices.slice(0, 3)]).toEqual([0, 1, 2]);
    });

    it('classes an elevated pool as INLAND and the sea as SEA — the runtime keeps a pool calm', () => {
      const sea = authored(flatWaterMesh([quad(-10, 10, -10, 10, 0)]), 1)[0];
      const pool = authored(flatWaterMesh([quad(-10, 10, -10, 10, 40)]), 1)[0];

      expect(sea[4]).toBe(0);
      expect(pool[4]).toBe(1);
    });

    it('frames the authored extent with sea rather than overlapping it', () => {
      const mesh = flatWaterMesh([quad(-100, 100, -100, 100, 0)]);
      const frameRows = authored(mesh, mesh.positions.length / WATER_VERTEX_FLOATS).slice(4);

      expect(frameRows.length).toBeGreaterThan(0);
      // Every frame vertex sits at sea level, and none of them lands inside the authored rectangle.
      for (const row of frameRows) {
        expect(row[2]).toBe(0);
        expect(Math.abs(row[0]) >= 100 || Math.abs(row[1]) >= 100).toBe(true);
      }
    });
  });
});
