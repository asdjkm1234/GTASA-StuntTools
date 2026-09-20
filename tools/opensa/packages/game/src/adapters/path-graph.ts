/**
 * The road graph straight from the game fs (096/01): `data/Paths/NODES0..63.DAT` → a traversable
 * {@link RouteGraph}. Lives in `adapters/` because it imports renderware — the graph and route code itself
 * stays pure (the layer boundary the lint config enforces).
 */
import type { AssetFileSystem } from '@opensa/renderware';

import { vehiclePathNodes } from '@opensa/renderware';

import type { RouteGraph } from '../paths/route-graph';

import { buildRouteGraph } from '../paths/route-graph';

/** How many area files SA ships. */
const AREA_COUNT = 64;

/** The whole vehicle path network as one graph, or null when the game ships none. */
export function loadRouteGraph(fs: AssetFileSystem): null | RouteGraph {
  const areas = pathAreaFiles(fs);
  if (areas.size === 0) {
    return null;
  }

  return buildRouteGraph(vehiclePathNodes(areas));
}

/**
 * Read every present area file. Both spellings are tried: a pmb build writes lowercase `data/paths/nodes0.dat`,
 * a stock tree ships `data/Paths/NODES0.DAT`. An empty map means the game shipped no path graph.
 */
export function pathAreaFiles(fs: AssetFileSystem): Map<number, ArrayBuffer> {
  const areas = new Map<number, ArrayBuffer>();
  for (let area = 0; area < AREA_COUNT; area += 1) {
    const bytes = fs.get(`data/paths/nodes${area}.dat`) ?? fs.get(`data/Paths/NODES${area}.DAT`);
    if (bytes) {
      areas.set(area, bytes);
    }
  }

  return areas;
}
