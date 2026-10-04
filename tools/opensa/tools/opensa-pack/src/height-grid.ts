/**
 * Sea-level height grid (074/06 row 12 v3): during the chunked weld, triangles near sea level rasterize
 * their heights into a coarse GTA-space grid; the water bake then computes TRUE DEPTH (water z − ground z)
 * per vertex — the visual waterline is where depth crosses zero, NOT the water-quad edge (which hides
 * under the beach; the field-round-3 foam lesson). Capped at z ≤ +4: only waterline-adjacent ground
 * matters (foam/surf live in the 0–3 m depth band); elevated reservoirs fall back to the shore heuristic.
 */

const CELL = 4;
/** Only geometry with all corners at or below this GTA z participates (sea-adjacent band). */
const Z_CAP = 4;

export class WaterHeightGrid {
  get size(): number {
    return this.cells.size;
  }

  private readonly cells = new Map<number, number>();

  /** Rasterize one triangle (GTA coords) into the grid (max ground height per cell). */
  addTriangle(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
  ): void {
    // SA beach slopes are HUGE low-poly triangles (−10 under water up to +15 on the berm): accept when
    // ANY corner dips into the sea band and clip per-CELL on the interpolated height instead.
    if (Math.min(az, bz, cz) > Z_CAP) {
      return;
    }
    const minX = Math.floor(Math.min(ax, bx, cx) / CELL);
    const maxX = Math.floor(Math.max(ax, bx, cx) / CELL);
    const minY = Math.floor(Math.min(ay, by, cy) / CELL);
    const maxY = Math.floor(Math.max(ay, by, cy) / CELL);
    const d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (d === 0) {
      return;
    }
    for (let gx = minX; gx <= maxX; gx += 1) {
      for (let gy = minY; gy <= maxY; gy += 1) {
        const px = (gx + 0.5) * CELL;
        const py = (gy + 0.5) * CELL;
        const w0 = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / d;
        const w1 = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / d;
        const w2 = 1 - w0 - w1;
        // Slack lets edge cells catch the triangle (the centre may sit just outside a sliver).
        if (w0 < -0.15 || w1 < -0.15 || w2 < -0.15) {
          continue;
        }
        const z = az * w0 + bz * w1 + cz * w2;
        if (z > Z_CAP) {
          continue; // the above-sea part of a straddling triangle
        }
        const key = gx * 8192 + gy + 33554432;
        const current = this.cells.get(key);
        if (current === undefined || z > current) {
          this.cells.set(key, z);
        }
      }
    }
  }

  /** The grid as `[key, height]` pairs — the checkpoint form (opensa-pack resume). */
  entries(): [number, number][] {
    return [...this.cells];
  }

  /** Topmost sea-band ground height at (x, y), or null when nothing rasterized there. */
  heightAt(x: number, y: number): null | number {
    const key = Math.floor(x / CELL) * 8192 + Math.floor(y / CELL) + 33554432;

    return this.cells.get(key) ?? null;
  }

  /** Replace the grid with a checkpointed one. */
  restore(entries: readonly (readonly [number, number])[]): void {
    this.cells.clear();
    for (const [key, height] of entries) {
      this.cells.set(key, height);
    }
  }
}
