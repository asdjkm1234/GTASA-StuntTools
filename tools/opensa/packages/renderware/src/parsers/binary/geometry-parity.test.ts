import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseDff } from './dff';

/**
 * Plan 095 on REAL assets. A DFF stores its triangles twice — the Struct face array (authoring input) and the
 * BinMeshPLG index data (what RenderWare submits) — and the two may disagree. The synthetic cases in
 * `dff.test.ts` prove we prefer the index data; only a real exporter's output proves it MATTERS.
 *
 * Regenerate the fixtures with `npm run test:fixtures` (Rockstar assets, not committed).
 */
const fixtures = {
  /** Stock `bloodrb`: carries the ADC plugin (0x134) — a PS2 strip whose parity bits we do not decode. */
  adc: join(process.cwd(), 'fixtures', 'original', 'dff', 'geometry-parity', 'bloodrb.dff'),
  /** `0. Map Fixes Pack`'s re-export of the beach slab: the two arrays wind it oppositely. */
  modSlab: join(process.cwd(), 'fixtures', 'original', 'mods', 'roads32_law2.dff'),
  /** The same model, stock: the two arrays agree. */
  stockSlab: join(process.cwd(), 'fixtures', 'original', 'dff', 'geometry-parity', 'roads32_law2.dff'),
};
const haveFixtures = Object.values(fixtures).every((path) => existsSync(path));

describe.skipIf(!haveFixtures)('parseDff geometry parity on real assets (095)', () => {
  describe('negative cases', () => {
    it('does not unwind an ADC strip — the PC rule would invent triangles', () => {
      // Stock `bloodrb` is one of two SA models with the plugin. Unwound naively its geometries grow 10–40 %
      // (geom 18: 1050 → 1487 triangles), so the parser must fall back to the face array and keep the counts
      // the file declares. Compared against the Struct's own `numTriangles` — the file is the expectation.
      const buffer = readFileSync(fixtures.adc);
      const clump = parseDff(new Uint8Array(buffer).buffer);

      for (const [index, declared] of declaredTriangleCounts(buffer).entries()) {
        expect(clump.geometries[index].triangles.length).toBe(declared);
      }
    });

    it('leaves the STOCK slab alone — its face array already agrees with the drawn data', () => {
      const geometry = geometryOf(fixtures.stockSlab);

      expect(facingCounts(geometry).up).toBe(65); // the road surface
      expect(facingCounts(geometry).down).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('reads the MOD slab face-UP, the way the game draws it', () => {
      const stock = geometryOf(fixtures.stockSlab);
      const mod = geometryOf(fixtures.modSlab);

      // Same mesh in both trees — the mod copy only adds vertex normals.
      expect(mod.positions.length).toBe(stock.positions.length);
      expect(mod.triangles.length).toBe(stock.triangles.length);
      expect(mod.normals).not.toBeNull();
      expect(stock.normals).toBeNull();
      // The payload: 65 up-facing road triangles, not 65 down-facing ones. Reading the face array instead
      // gives exactly the mirror of this (up 0 / down 65) — a slab that back-face culling deletes.
      expect(facingCounts(mod)).toEqual(facingCounts(stock));
      expect(facingCounts(mod).up).toBe(65);
    });
  });
});

function allChildren(buf: Buffer, start: number, end: number, type: number): { dataStart: number; end: number }[] {
  const out: { dataStart: number; end: number }[] = [];
  let at = start;
  while (at + 12 <= end) {
    const chunkType = buf.readUInt32LE(at);
    const size = buf.readUInt32LE(at + 4);
    if (at + 12 + size > end) break;
    if (chunkType === type) out.push({ dataStart: at + 12, end: at + 12 + size });
    at += 12 + size;
  }

  return out;
}

/** Each geometry's `numTriangles` as its Struct declares it — read straight from the chunk tree. */
function declaredTriangleCounts(buf: Buffer): number[] {
  const clumpEnd = 12 + buf.readUInt32LE(4);
  const list = firstChild(buf, 12, clumpEnd, 0x1a);
  if (!list) return [];

  return allChildren(buf, list.dataStart, list.end, 0x0f).map((geometry) => {
    const struct = firstChild(buf, geometry.dataStart, geometry.end, 0x01);
    if (!struct) throw new Error('geometry without a Struct');

    return buf.readUInt32LE(struct.dataStart + 4);
  });
}

/** How many of a geometry's triangles face up / down, by their winding (GTA z = up). */
function facingCounts(geometry: ReturnType<typeof parseDff>['geometries'][number]): {
  down: number;
  up: number;
} {
  const p = geometry.positions;
  let up = 0;
  let down = 0;
  for (const { a, b, c } of geometry.triangles) {
    const ux = p[b * 3] - p[a * 3];
    const uy = p[b * 3 + 1] - p[a * 3 + 1];
    const uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3];
    const vy = p[c * 3 + 1] - p[a * 3 + 1];
    const vz = p[c * 3 + 2] - p[a * 3 + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    if (nz / length > 0.1) up += 1;
    else if (nz / length < -0.1) down += 1;
  }

  return { down, up };
}

function firstChild(buf: Buffer, start: number, end: number, type: number): null | { dataStart: number; end: number } {
  return allChildren(buf, start, end, type)[0] ?? null;
}

function geometryOf(path: string): ReturnType<typeof parseDff>['geometries'][number] {
  return parseDff(new Uint8Array(readFileSync(path)).buffer).geometries[0];
}
