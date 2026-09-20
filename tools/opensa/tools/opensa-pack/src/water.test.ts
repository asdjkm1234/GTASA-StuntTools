import { describe, expect, it } from 'vitest';

import { bakeWater } from './water';

/** A 200×200 water square (grid corner order: v0, +X, +Y, +X+Y) with the water.dat 7-float layout. */
const SQUARE = [
  'processed',
  [
    [0, 0, 5],
    [200, 0, 5],
    [0, 200, 5],
    [200, 200, 5],
  ]
    .map(([x, y, z]) => `${x} ${y} ${z} 0 0 0 0`)
    .join('   ') + ' 1',
].join('\n');

/** water.dat text from grid-order quads ([v0, +X, +Y, +X+Y], each vertex [x, y, z]). */
function dat(quads: readonly (readonly (readonly number[])[])[]): string {
  return [
    'processed',
    ...quads.map((corners) => corners.map(([x, y, z]) => `${x} ${y} ${z} 0 0 0 0`).join('   ') + ' 1'),
  ].join('\n');
}

function decode(bin: Uint8Array): { indices: Uint32Array; vertices: Float32Array } {
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const vertexCount = view.getUint32(0, true);
  const indexCount = view.getUint32(4, true);

  return {
    indices: new Uint32Array(bin.buffer, bin.byteOffset + 8 + vertexCount * 20, indexCount),
    // Vertex = [x, y, z, depth, class] (plan 075) — stride 20.
    vertices: new Float32Array(bin.buffer, bin.byteOffset + 8, vertexCount * 5),
  };
}

/** Min baked depth among lake vertices within `radius` of (px, py) at level `z` (skips the ocean frame). */
function depthNear(vertices: Float32Array, px: number, py: number, z: number, radius = 9): number {
  let depth = Number.POSITIVE_INFINITY;
  for (let v = 0; v < vertices.length; v += 5) {
    if (Math.abs(vertices[v + 2] - z) > 0.5) {
      continue;
    }
    if (Math.abs(vertices[v] - px) <= radius && Math.abs(vertices[v + 1] - py) <= radius) {
      depth = Math.min(depth, vertices[v + 3]);
    }
  }

  return depth;
}

/** A flat water square at height `z`, water.dat 7-float layout. */
function square(z: number): string {
  return [
    'processed',
    [
      [0, 0, z],
      [200, 0, z],
      [0, 200, z],
      [200, 200, z],
    ]
      .map(([x, y, level]) => `${x} ${y} ${level} 0 0 0 0`)
      .join('   ') + ' 1',
  ].join('\n');
}

describe('bakeWater', () => {
  describe('negative cases', () => {
    it('returns only the ocean frame for empty water data', () => {
      const { bin, manifest } = bakeWater('processed\n');
      expect(manifest.vertexCount).toBeGreaterThan(0); // the solid ocean plane
      expect(decode(bin).indices.length).toBe(manifest.indexCount);
    });

    it('does not treat a T-junction seam between same-level quads as a shoreline (087 row C stripes)', () => {
      // One 200-wide quad meets TWO 100-wide neighbours along y=100: endpoint keys never pair, so all
      // three seam edges are boundary CANDIDATES — but water covers both sides, so none is a shore.
      const lake = dat([
        [
          [0, 0, 5],
          [200, 0, 5],
          [0, 100, 5],
          [200, 100, 5],
        ],
        [
          [0, 100, 5],
          [100, 100, 5],
          [0, 200, 5],
          [100, 200, 5],
        ],
        [
          [100, 100, 5],
          [200, 100, 5],
          [100, 200, 5],
          [200, 200, 5],
        ],
      ]);
      const { vertices } = decode(bakeWater(lake).bin);

      // Mid-lake ON the seam: the nearest TRUE shore is ~96 u away → deep, not a 0-depth stripe.
      expect(depthNear(vertices, 96, 100, 5)).toBeGreaterThan(5);
      // The real outer shoreline still reads as depth ≈ 0.
      expect(depthNear(vertices, 96, 0, 5)).toBeLessThan(0.5);
    });
  });

  describe('positive cases', () => {
    it('tessellates a quad and bakes the pseudo-depth field without height data', () => {
      const { bin, manifest } = bakeWater(SQUARE);
      const { indices, vertices } = decode(bin);
      expect(manifest.indexCount).toBe(indices.length);
      // 200/16 → 13 cells per side → 14×14 verts for the square alone (plus the ocean frame's).
      expect(manifest.vertexCount).toBeGreaterThan(14 * 14);
      // Pseudo-depth = shore distance × 0.15: ~15 m mid-square, ~0 at the corner shoreline.
      let centreDepth = 0;
      let cornerDepth = Number.POSITIVE_INFINITY;
      for (let v = 0; v < vertices.length; v += 5) {
        const [x, y, , depth] = [vertices[v], vertices[v + 1], vertices[v + 2], vertices[v + 3]];
        if (Math.abs(x - 96) < 9 && Math.abs(y - 96) < 9) {
          centreDepth = Math.max(centreDepth, depth);
        }
        if (Math.abs(x) < 1 && Math.abs(y) < 1) {
          cornerDepth = Math.min(cornerDepth, depth);
        }
      }
      expect(centreDepth).toBeGreaterThan(10);
      expect(cornerDepth).toBeLessThan(0.5);
      // Water level carried through the tessellation.
      expect(vertices[2]).toBe(5);
      // All indices in range.
      for (const index of indices) {
        expect(index).toBeLessThan(manifest.vertexCount);
      }
    });

    it('bakes TRUE depth where the height grid has data', () => {
      // Ground rises linearly from −10 at x=0 to +5 at x=200: the waterline (z=5) sits at x=200.
      const { bin } = bakeWater(SQUARE, (x) => -10 + (x / 200) * 15);
      const { vertices } = decode(bin);
      let atStart = 0;
      let atEnd = Number.POSITIVE_INFINITY;
      for (let v = 0; v < vertices.length; v += 5) {
        const [x, y, , depth] = [vertices[v], vertices[v + 1], vertices[v + 2], vertices[v + 3]];
        if (y < 0 || y > 200 || x < -1 || x > 201) {
          continue; // ocean frame (constant deep)
        }
        if (x > 2 && x < 20) {
          atStart = Math.max(atStart, depth);
        }
        if (x > 199) {
          atEnd = Math.min(atEnd, depth);
        }
      }
      // Deep end (x≈2–20): water z 5 − ground ≈ −10 → ~14–15 m (the x=0 column belongs to the ocean frame).
      expect(atStart).toBeGreaterThan(13);
      expect(atStart).toBeLessThan(16);
      expect(atEnd).toBeLessThan(0.5); // the visual waterline
    });

    it('keeps a reservoir lip above lower water as a REAL shoreline (the level gate)', () => {
      // The upper lake's south edge T-joins two lower-river quads 40 m BELOW: water covers both sides
      // in XY, but not at the same level — the lip must stay a waterline (depth → 0 there).
      const damLip = dat([
        [
          [0, 100, 50],
          [200, 100, 50],
          [0, 300, 50],
          [200, 300, 50],
        ],
        [
          [0, 0, 10],
          [100, 0, 10],
          [0, 100, 10],
          [100, 100, 10],
        ],
        [
          [100, 0, 10],
          [200, 0, 10],
          [100, 100, 10],
          [200, 100, 10],
        ],
      ]);
      const { vertices } = decode(bakeWater(damLip).bin);

      expect(depthNear(vertices, 96, 100, 50)).toBeLessThan(0.5);
    });

    it('classifies water above sea level as INLAND (class 1) and sea-level water as SEA (class 0)', () => {
      // A z=0 square + the always-sea ocean frame → every vertex is SEA.
      const seaVerts = decode(bakeWater(square(0)).bin).vertices;
      const seaClasses = new Set<number>();
      for (let v = 0; v < seaVerts.length; v += 5) {
        seaClasses.add(seaVerts[v + 4]);
      }
      expect([...seaClasses]).toEqual([0]);

      // A z=5 square → its own vertices are INLAND; the surrounding ocean frame stays SEA.
      const verts = decode(bakeWater(square(5)).bin).vertices;
      let sawElevated = false;
      let elevatedAllInland = true;
      let frameAllSea = true;
      for (let v = 0; v < verts.length; v += 5) {
        const [z, cls] = [verts[v + 2], verts[v + 4]];
        if (z > 1) {
          sawElevated = true;
          elevatedAllInland &&= cls === 1;
        } else {
          frameAllSea &&= cls === 0;
        }
      }
      expect(sawElevated).toBe(true);
      expect(elevatedAllInland).toBe(true);
      expect(frameAllSea).toBe(true);
    });
  });
});
