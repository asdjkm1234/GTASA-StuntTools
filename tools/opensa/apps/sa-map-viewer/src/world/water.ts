/**
 * The sea, in the viewer (plan 094 phase 7). A source folder never carries a baked `water.bin`, so this is
 * always the FLAT build from `data/water.dat` — the shared `flatWaterMesh` the game falls back to, which
 * means the two apps draw one sea from one builder.
 *
 * `data/water.dat` is already in the VFS: it rides in with gta.dat and the IDE/IPLs (`ingestWorldFiles`), so
 * installing the sea costs one parse and one upload — no per-cell fetch, nothing streamed.
 *
 * The ripple/foam textures live in `models/particle.txd`, which this app does NOT ingest (it pulls assets per
 * cell, by model name). The engine substitutes 1×1 stubs — a flat normal and no foam — so the surface reads
 * as the timecyc water tint with the wave displacement, which is what an inspector needs it for: knowing
 * where the water IS, and being able to switch it off to look underneath.
 */
import type { Engine } from '@opensa/engine';

import { flatWaterMesh, WATER_VERTEX_FLOATS } from '@opensa/renderware';
import { parseWater } from '@opensa/renderware/parsers/text/water.parser';

import type { LoadedMap } from '../source/map-source';

/** Install the sea. Returns how many triangles it welded (0 when the tree carries no `water.dat`). */
export function installWater(engine: Engine, map: LoadedMap): number {
  const text = map.fs.getText('data/water.dat');
  if (text === null) {
    return 0;
  }
  const { indices, positions } = flatWaterMesh(parseWater(text));
  // GTA Z-up → engine Y-up; the shore field + water class ride along untouched.
  const vertices = new Float32Array(positions.length);
  for (let v = 0; v < positions.length; v += WATER_VERTEX_FLOATS) {
    vertices[v] = positions[v];
    vertices[v + 1] = positions[v + 2];
    vertices[v + 2] = -positions[v + 1];
    vertices[v + 3] = positions[v + 3];
    vertices[v + 4] = positions[v + 4];
  }
  engine.setWater(vertices, indices, null, null);

  return indices.length / 3;
}
