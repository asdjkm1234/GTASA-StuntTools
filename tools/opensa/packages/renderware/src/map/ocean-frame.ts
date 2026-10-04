import type { WaterQuad } from '../parsers/text/water.parser';

/**
 * The SEA frame around the authored water quads — pure `WaterQuad` math, extracted from the three-era
 * `build-water` in plan 074/13 phase 5c because `opensa-pack` depends on it and the builder does not.
 */

/**
 * Open-ocean "frame" quads: a `[-half, half]` sea-level plane with a rectangular
 * hole cut to the bounding box of `quads` (the real water.dat extent). Lets the
 * actual water polygons cover the map (so tunnels under land aren't flooded) while
 * the frame still fills out to the horizon. Returns up to 4 border quads (any
 * degenerate strip — where the data already reaches `half` — is skipped).
 */
export function oceanFrame(quads: readonly WaterQuad[], half: number, level: number): WaterQuad[] {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const quad of quads) {
    for (const [x, y] of quad.vertices) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) {
    return [strip(-half, half, -half, half, level)]; // no data → solid plane
  }

  const frame: WaterQuad[] = [];
  pushStrip(frame, -half, minX, -half, half, level); // left (full height)
  pushStrip(frame, maxX, half, -half, half, level); // right (full height)
  pushStrip(frame, minX, maxX, -half, minY, level); // bottom (between the side strips)
  pushStrip(frame, minX, maxX, maxY, half, level); // top

  return frame;
}

function pushStrip(out: WaterQuad[], x0: number, x1: number, y0: number, y1: number, level: number): void {
  if (x1 > x0 && y1 > y0) {
    out.push(strip(x0, x1, y0, y1, level));
  }
}

/** A sea-level quad with grid-ordered corners (v0, +X, +Y, +X+Y). */
function strip(x0: number, x1: number, y0: number, y1: number, level: number): WaterQuad {
  return {
    vertices: [
      [x0, y0, level],
      [x1, y0, level],
      [x0, y1, level],
      [x1, y1, level],
    ],
  };
}
