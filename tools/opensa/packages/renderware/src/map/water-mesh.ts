/**
 * The FLAT water surface, straight from `water.dat` — the build every host uses when there is no baked
 * `water.bin` to read (the game's fallback since 074/06 row 12, and sa-map-viewer's only water: that app
 * renders a folder of source files, so a bake never exists there).
 *
 * Output is the same layout the baked mesh carries — `[x, y, z, shoreDistance, class]` per vertex in GTA
 * coords — so a host flips the axes once and cannot tell the two sources apart. Without a bake there is no
 * shore field, so every vertex reports {@link WATER_DEEP}: no foam band, no wave damping at the beach.
 */
import type { WaterQuad } from '../parsers/text/water.parser';

import { oceanFrame } from './ocean-frame';

/** Floats per water vertex: x, y, z, shoreDistance, class. */
export const WATER_VERTEX_FLOATS = 5;

/** The shore field every flat vertex gets — "deep", i.e. open sea everywhere (no bake, no beach). */
export const WATER_DEEP = 120;

/** Ocean-frame half extent: far enough that the sea reaches the horizon from any map position. */
const OCEAN_HALF = 6000;

/** Above this height (metres) a polygon is INLAND (pool/reservoir/lake, rendered calm); the ocean is z≈0. */
const SEA_LEVEL_MAX = 1;

/** Tessellate the authored polygons plus the ocean frame into one triangle mesh, in GTA coords. */
export function flatWaterMesh(quads: readonly WaterQuad[]): { indices: Uint32Array; positions: Float32Array } {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const quad of [...quads, ...oceanFrame(quads, OCEAN_HALF, 0)]) {
    const base = positions.length / WATER_VERTEX_FLOATS;
    // Class from height (plan 075): elevated pools/reservoirs are inland and render calm, so their waves
    // cannot spill over the lip.
    const waterClass = (quad.vertices[0]?.[2] ?? 0) > SEA_LEVEL_MAX ? 1 : 0;
    for (const [x, y, z] of quad.vertices) {
      positions.push(x, y, z, WATER_DEEP, waterClass);
    }
    if (quad.vertices.length >= 4) {
      indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    } else if (quad.vertices.length === 3) {
      indices.push(base, base + 1, base + 2);
    }
  }

  return { indices: new Uint32Array(indices), positions: new Float32Array(positions) };
}
