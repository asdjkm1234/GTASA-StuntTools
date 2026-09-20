import { oceanFrame } from '@opensa/renderware/map/ocean-frame';
import { parseWater, type WaterQuad } from '@opensa/renderware/parsers/text/water.parser';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * "Is this point under the sea?" over a game dir's `data/water.dat` (plan 025 world-visibility).
 *
 * The defect scans judge a face by its geometry, and geometry cannot say whether anyone can SEE it — the
 * field labelled three models clean because their stretched faces are skirts with buildings standing on
 * them, and `sbseabed3_las20` is the same question asked of water: its whole surface sits 4–51 units under
 * the sea. This answers the water half.
 *
 * `water.dat` is a flat list of convex polygons (3 or 4 corners) in GTA Z-up world space, so the lookup is a
 * uniform grid over their bounding boxes plus a convexity test. **Deliberately conservative**: a polygon's
 * LOWEST corner is taken as the surface height, so a sloping quad never reports a face as submerged when part
 * of it may be dry. Marking something hidden that is actually visible is the expensive mistake here.
 */
export interface WaterField {
  /** Sea surface height at this world XY, or `null` where the map has no water polygon. */
  heightAt: (x: number, y: number) => null | number;
  /** How many polygons the file carried — 0 means the lookup answers `null` everywhere. */
  readonly quadCount: number;
}

/** Grid pitch for the polygon lookup, world units. SA's water quads are far larger than this. */
const CELL = 128;
/** Open-ocean half-extent and level — the same pair `flatWaterMesh` builds its frame with. */
const OCEAN_HALF = 6000;
const SEA_LEVEL = 0;

/** Read `<gameDir>/data/water.dat`; a missing file yields a field that answers `null` everywhere. */
export function loadWaterField(gameDir: string): WaterField {
  const path = join(gameDir, 'data', 'water.dat');
  if (!existsSync(path)) {
    return { heightAt: () => null, quadCount: 0 };
  }

  const quads = parseWater(readFileSync(path, 'utf8'));

  // The open ocean beyond the authored polygons, exactly as `flatWaterMesh` adds it — otherwise a face past
  // the data's own bounding box reads as dry when the game draws sea over it. Interior gaps stay dry on
  // purpose: that is how `water.dat` keeps tunnels under land from flooding.
  return waterField([...quads, ...oceanFrame(quads, OCEAN_HALF, SEA_LEVEL)]);
}

/** The lookup over already-parsed polygons — the unit-testable half. */
export function waterField(quads: readonly WaterQuad[]): WaterField {
  const buckets = new Map<string, number[]>();
  quads.forEach((quad, index) => {
    const xs = quad.vertices.map((v) => v[0]);
    const ys = quad.vertices.map((v) => v[1]);
    const x0 = Math.floor(Math.min(...xs) / CELL);
    const x1 = Math.floor(Math.max(...xs) / CELL);
    const y0 = Math.floor(Math.min(...ys) / CELL);
    const y1 = Math.floor(Math.max(...ys) / CELL);
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cy = y0; cy <= y1; cy += 1) {
        const key = `${cx},${cy}`;
        const list = buckets.get(key);
        if (list) list.push(index);
        else buckets.set(key, [index]);
      }
    }
  });

  return {
    heightAt: (x, y): null | number => {
      const candidates = buckets.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`);
      if (!candidates) {
        return null;
      }
      let best: null | number = null;
      for (const index of candidates) {
        const quad = quads[index];
        if (!contains(quad, x, y)) {
          continue;
        }
        // Lowest corner, and the HIGHEST such surface when polygons overlap — both choices err toward
        // calling a face dry.
        const low = Math.min(...quad.vertices.map((v) => v[2]));
        if (best === null || low > best) {
          best = low;
        }
      }

      return best;
    },
    quadCount: quads.length,
  };
}

/**
 * **`water.dat` stores a quad's corners in GRID order, not around its perimeter** — the first line of the
 * vanilla file is (−1584,−1826), (−1360,−1826), (−1584,−1642), (−1360,−1642), i.e. bottom-left,
 * bottom-right, top-left, top-right. Walking those as a loop traces a self-intersecting bowtie, so a
 * perimeter-based point-in-polygon test never reports a hit ANYWHERE, which is exactly what the first
 * version of this file did: 307 polygons loaded and `heightAt` answered `null` over the whole map.
 *
 * The triangulation below is the engine's own (`flatWaterMesh`: `0,1,2` + `2,1,3`), so this lookup and what
 * the game draws cannot disagree about where the sea is.
 */
function contains(quad: WaterQuad, x: number, y: number): boolean {
  const v = quad.vertices;
  if (v.length >= 4) {
    return inTriangle(v[0], v[1], v[2], x, y) || inTriangle(v[2], v[1], v[3], x, y);
  }

  return v.length === 3 && inTriangle(v[0], v[1], v[2], x, y);
}

/** Point-in-triangle by consistent cross-product sign; the tolerance keeps a shared edge inside BOTH sides. */
function inTriangle(a: readonly number[], b: readonly number[], c: readonly number[], x: number, y: number): boolean {
  let positive = false;
  let negative = false;
  for (const [p, q] of [
    [a, b],
    [b, c],
    [c, a],
  ]) {
    const cross = (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
    if (cross > 1e-6) positive = true;
    if (cross < -1e-6) negative = true;
    if (positive && negative) return false;
  }

  return true;
}
