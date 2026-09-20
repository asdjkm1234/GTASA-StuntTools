/**
 * The sea, from `data/water.dat` (adapted from sa-map-viewer phase 7). `data/water.dat` is already in the VFS
 * (it rides in with gta.dat and the IDE/IPLs), so installing the sea costs one parse and one upload.
 */
import type { Engine } from '@opensa/engine';

import { flatWaterMesh, WATER_VERTEX_FLOATS } from '@opensa/renderware/map/water-mesh';
import { parseWater } from '@opensa/renderware/parsers/text/water.parser';

import type { LoadedMap } from './map-source';

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
