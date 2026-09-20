import { WELD_ROW, WELD_SUNVIS, type WeldBucket, type WeldedCell } from '@opensa/cell-weld/weld';
import { describe, expect, it } from 'vitest';

import { buildOccluderBvh } from './ao';
import { bakeSunVis } from './sunvis';

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

/** A wide plate at height 10 — blocks the whole day arc for anything below it. */
function plate(): WeldBucket {
  const size = 300;
  const vertices = [...row(-size, 10, -size), ...row(size, 10, -size), ...row(size, 10, size), ...row(-size, 10, size)];

  return bucket(vertices, [0, 1, 2, 0, 2, 3]);
}

/** One scratch row: position + normal (default +Y), sunVis slot defaulted open. */
function row(x: number, y: number, z: number, nx = 0, ny = 1, nz = 0): number[] {
  const values = new Array<number>(WELD_ROW).fill(0);
  values[0] = x;
  values[1] = y;
  values[2] = z;
  values[3] = nx;
  values[4] = ny;
  values[5] = nz;
  values[WELD_SUNVIS] = 1;

  return values;
}

describe('bakeSunVis', () => {
  describe('negative cases', () => {
    it('bakes LOD cells but never uses LOD geometry as an occluder', () => {
      // The plate lives in a LOD cell → not an occluder; the probe bakes a near-zero threshold (open sky).
      const lodCell = cell([plate(), bucket(row(0, 0, 0), [])], true);
      bakeSunVis([lodCell], buildOccluderBvh([lodCell]));

      expect(lodCell.hasSunVis).toBe(true); // LOD verts bake too (HD/LOD seam fix)
      expect(lodCell.buckets[1].vertices[WELD_SUNVIS]).toBe(1); // LOD plate is not an occluder
    });

    it('keeps a sun-averted vertex neutral without spending rays', () => {
      // Normal points straight down — the arc never faces it; N·L kills the direct term at runtime anyway.
      const probe = bucket(row(0, 0, 0, 0, -1, 0), []);
      const probeCell = cell([probe]);
      const report = bakeSunVis([probeCell], buildOccluderBvh([probeCell]));

      expect(probe.vertices[WELD_SUNVIS]).toBe(1); // scalar: neutral = fully visible
      expect(report.rays).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('shadows a vertex under a plate and keeps an open vertex lit', () => {
      const covered = bucket(row(0, 0, 0), []);
      const open = bucket(row(2000, 0, 2000), []);
      open.key = '0001|0|0';
      const probeCell = cell([plate(), covered, open]);
      const report = bakeSunVis([probeCell], buildOccluderBvh([probeCell]));

      expect(probeCell.hasSunVis).toBe(true);
      expect(covered.vertices[WELD_SUNVIS]).toBe(0); // scalar: the plate blocks the whole arc
      expect(open.vertices[WELD_SUNVIS]).toBe(1);
      expect(report.vertices).toBeGreaterThan(0);
    });

    it('gives partial visibility at a shadow edge', () => {
      // Plate covers x ≤ 0 only; the arc leans +x, so a vertex just left of the edge sees the LOW sun
      // blocked and the HIGH sun blocked too — but one near the edge catches part of the arc.
      const half = [...row(-600, 10, -300), ...row(0, 10, -300), ...row(0, 10, 300), ...row(-600, 10, 300)];
      const probe = bucket(row(-4, 0, 0), []);
      const probeCell = cell([bucket(half, [0, 1, 2, 0, 2, 3]), probe]);
      bakeSunVis([probeCell], buildOccluderBvh([probeCell]));

      expect(probe.vertices[WELD_SUNVIS]).toBeGreaterThan(0);
      expect(probe.vertices[WELD_SUNVIS]).toBeLessThan(1);
    });

    it('is deterministic (same input ⇒ identical values)', () => {
      const first = bucket(row(3, 0, 3), []);
      const second = bucket(row(3, 0, 3), []);
      const cellA = cell([plate(), first]);
      const cellB = cell([plate(), second]);
      bakeSunVis([cellA], buildOccluderBvh([cellA]));
      bakeSunVis([cellB], buildOccluderBvh([cellB]));

      expect(first.vertices[WELD_SUNVIS]).toBe(second.vertices[WELD_SUNVIS]);
    });
  });
});
