import type { WeldedCell } from '@opensa/cell-weld/weld';

import { WELD_AO, WELD_ROW, WELD_SUNVIS } from '@opensa/cell-weld/weld';
import { describe, expect, it } from 'vitest';

import { bakeAo, buildOccluderBvh } from './ao';
import { bakeFlat } from './bake-flat';
import { bakeSunVis } from './sunvis';

function bakedColumn(cell: WeldedCell, column: number): number[] {
  const out: number[] = [];
  for (const bucket of cell.buckets) {
    for (let row = 0; row < bucket.vertices.length; row += WELD_ROW) {
      out.push(bucket.vertices[row + column]);
    }
  }

  return out;
}

function extract(cell: WeldedCell): Float64Array {
  const rows: number[] = [];
  for (const bucket of cell.buckets) {
    for (let row = 0; row < bucket.vertices.length; row += WELD_ROW) {
      rows.push(
        bucket.vertices[row] + cell.origin[0],
        bucket.vertices[row + 1] + cell.origin[1],
        bucket.vertices[row + 2] + cell.origin[2],
        bucket.vertices[row + 3],
        bucket.vertices[row + 4],
        bucket.vertices[row + 5],
      );
    }
  }

  return new Float64Array(rows);
}

/** A ground-plane bucket under a wall slab: some verts shadowed, some open — non-trivial bake output. */
function testCell(lod = false): WeldedCell {
  const vertices: number[] = [];
  for (let x = 0; x < 6; x += 1) {
    for (let z = 0; z < 6; z += 1) {
      const row = new Array<number>(WELD_ROW).fill(0);
      row[0] = x * 4;
      row[1] = 0;
      row[2] = z * 4;
      row[4] = 1; // +Y normal
      vertices.push(...row);
    }
  }
  // A wall along x = 8: two triangles, 12 units tall — occludes low-angle arc rays for nearby verts.
  const wall = [8, 0, -20, 8, 0, 40, 8, 12, -20, 8, 12, -20, 8, 0, 40, 8, 12, 40];
  const wallRows: number[] = [];
  for (let corner = 0; corner < 6; corner += 1) {
    const row = new Array<number>(WELD_ROW).fill(0);
    row[0] = wall[corner * 3];
    row[1] = wall[corner * 3 + 1];
    row[2] = wall[corner * 3 + 2];
    row[3] = -1; // -X normal
    wallRows.push(...row);
  }

  return {
    breakables: [],
    buckets: [
      {
        indices: [0, 1, 2, 3, 4, 5],
        key: 'wall',
        max: [8, 12, 40],
        min: [8, 0, -20],
        pipelineClass: 0,
        side: 0,
        textureArrayRef: 0,
        timed: null,
        uvAnim: null,
        vertices: wallRows,
      },
      {
        indices: [],
        key: 'ground',
        max: [20, 0, 20],
        min: [0, 0, 0],
        pipelineClass: 0,
        side: 0,
        textureArrayRef: 0,
        timed: null,
        uvAnim: null,
        vertices,
      },
    ],
    hasAo: false,
    hasNight: false,
    hasSunVis: false,
    hasSway: false,
    lights: [],
    lod,
    origin: [1000, 0, -500],
    particles: [],
    placements: [],
    stats: {
      animatedObjects: 0,
      animatedStatic: 0,
      breakables: 0,
      groups: 2,
      indices: 6,
      particles: 0,
      placements: 0,
      roadsignQuads: 0,
      roadsigns: 0,
      skippedTimed: 0,
      timedObjects: 0,
      uvAnimObjects: 0,
      vertices: 42,
    },
  };
}

describe('bakeFlat (worker-pool unit) vs serial bakes', () => {
  describe('negative cases', () => {
    it('returns no channels when neither bake is requested', () => {
      const cell = testCell();
      const bvh = buildOccluderBvh([cell]);

      const result = bakeFlat(bvh, { ao: false, data: extract(cell), lod: false, sunVis: false });

      expect(result.ao).toBeNull();
      expect(result.sunVis).toBeNull();
      expect(result.aoRays).toBe(0);
      expect(result.sunVisRays).toBe(0);
    });
  });

  describe('positive cases', () => {
    for (const lod of [false, true]) {
      it(`matches the serial bakes exactly (${lod ? 'LOD floors applied' : 'HD'})`, () => {
        const serial = testCell(lod);
        const pooled = testCell(lod);
        // The occluder BVH always comes from the HD view of the district.
        const bvh = buildOccluderBvh([testCell(false)]);

        const aoReport = bakeAo([serial], { bvh });
        const sunReport = bakeSunVis([serial], bvh);
        const flat = bakeFlat(bvh, { ao: true, data: extract(pooled), lod, sunVis: true });

        expect([...(flat.ao ?? [])]).toEqual(bakedColumn(serial, WELD_AO));
        expect([...(flat.sunVis ?? [])]).toEqual(bakedColumn(serial, WELD_SUNVIS));
        expect(flat.aoUnique).toBe(aoReport.uniqueVertices);
        expect(flat.aoRays).toBe(aoReport.rays);
        expect(flat.sunVisUnique).toBe(sunReport.uniqueVertices);
        expect(flat.sunVisRays).toBe(sunReport.rays);
      });
    }
  });
});
