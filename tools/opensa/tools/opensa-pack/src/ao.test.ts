import { WELD_AO, WELD_ROW, type WeldBucket, type WeldedCell } from '@opensa/cell-weld/weld';
import { describe, expect, it } from 'vitest';

import { bakeAo } from './ao';

function bucket(vertices: number[], indices: number[], pipelineClass = 0): WeldBucket {
  return {
    indices,
    key: `0000|${pipelineClass}|0`,
    max: [0, 0, 0],
    min: [0, 0, 0],
    pipelineClass,
    side: 0,
    textureArrayRef: 0,
    timed: null,
    uvAnim: null,
    vertices,
  };
}

function cell(buckets: WeldBucket[], lod = false): WeldedCell {
  return {
    breakables: [],
    buckets,
    hasAo: false,
    hasNight: false,
    hasSunVis: false,
    hasSway: false,
    lights: [],
    lod,
    origin: [0, 0, 0],
    particles: [],
    placements: [],
    stats: {
      animatedObjects: 0,
      animatedStatic: 0,
      breakables: 0,
      groups: 0,
      indices: 0,
      particles: 0,
      placements: 0,
      roadsignQuads: 0,
      roadsigns: 0,
      skippedTimed: 0,
      timedObjects: 0,
      uvAnimObjects: 0,
      vertices: 0,
    },
  };
}

/** A big plate at height 10 covering [-30, 30]² — the occluder above the probes. */
function plate(): WeldBucket {
  const size = 30;
  const vertices = [...row(-size, 10, -size), ...row(size, 10, -size), ...row(size, 10, size), ...row(-size, 10, size)];

  return bucket(vertices, [0, 1, 2, 0, 2, 3]);
}

/** One scratch row: position + up normal, everything else zero, ao slot defaulted open. */
function row(x: number, y: number, z: number): number[] {
  const values = new Array<number>(WELD_ROW).fill(0);
  values[0] = x;
  values[1] = y;
  values[2] = z;
  values[4] = 1; // normal = +Y
  values[WELD_AO] = 1;

  return values;
}

describe('bakeAo', () => {
  describe('negative cases', () => {
    it('bakes LOD cells but never uses LOD geometry as an occluder', () => {
      // The plate lives in a LOD cell → it is NOT in the occluder set; the probe stays fully open.
      const lodCell = cell([plate(), bucket(row(0, 0, 0), [])], true);
      bakeAo([lodCell]);

      expect(lodCell.hasAo).toBe(true); // LOD verts bake too (HD/LOD seam fix)
      expect(lodCell.buckets[1].vertices[WELD_AO]).toBe(1);
    });

    it('ignores blend and beam groups as occluders', () => {
      const glassPlate = plate();
      glassPlate.pipelineClass = 2;
      const probe = bucket(row(0, 0, 0), []);
      const probeCell = cell([glassPlate, probe]);
      bakeAo([probeCell]);

      expect(probe.vertices[WELD_AO]).toBe(1); // glass above must not darken the sky
    });
  });

  describe('positive cases', () => {
    it('darkens a vertex under a plate and keeps an open vertex bright', () => {
      const covered = bucket(row(0, 0, 0), []);
      const open = bucket(row(200, 0, 200), []);
      open.key = '0001|0|0';
      const probeCell = cell([plate(), covered, open]);
      const report = bakeAo([probeCell]);

      expect(probeCell.hasAo).toBe(true);
      expect(covered.vertices[WELD_AO]).toBeLessThan(0.5);
      expect(open.vertices[WELD_AO]).toBe(1);
      expect(report.vertices).toBeGreaterThan(0);
      expect(report.uniqueVertices).toBeLessThanOrEqual(report.vertices);
    });

    it('dedupes identical (position, normal) pairs across buckets', () => {
      const a = bucket(row(0, 0, 0), []);
      const b = bucket(row(0, 0, 0), []);
      b.key = '0001|0|0';
      const report = bakeAo([cell([plate(), a, b])]);

      expect(a.vertices[WELD_AO]).toBe(b.vertices[WELD_AO]);
      expect(report.uniqueVertices).toBeLessThan(report.vertices);
    });

    it('is deterministic (same input ⇒ identical values)', () => {
      const first = bucket(row(3, 0, 3), []);
      const second = bucket(row(3, 0, 3), []);
      bakeAo([cell([plate(), first])]);
      bakeAo([cell([plate(), second])]);

      expect(first.vertices[WELD_AO]).toBe(second.vertices[WELD_AO]);
    });
  });
});
