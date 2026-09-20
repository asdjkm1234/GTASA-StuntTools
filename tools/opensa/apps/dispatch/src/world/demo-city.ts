/**
 * The demo world (`?demo=1`): a synthetic block grid loaded straight into the cell store, no pak involved.
 *
 * It exists so the console is pokeable on a machine that has no built game — the whole operator surface, the
 * camera, the beacons, the projected symbology and the click-to-select path all run against it. What it is NOT
 * is a preview of the real thing: these are boxes, not Los Santos, and no placement mapper rides along, so a
 * click on a block resolves to bare ground rather than to a model name. Point `?src=` at a real build for that.
 *
 * The grid is laid over the coordinates the seed board uses, so the units patrol streets rather than a void.
 */
import type { Engine } from '@opensa/engine';

import { syntheticCell, syntheticTextureArray } from '@opensa/engine-lab/synthetic';

/** The render grid's pitch. One value, agreed by the bake, the pack and the engine's streaming. */
const CELL_SIZE = 250;
/** Blocks per cell side. Enough to read as a city from a map camera without flooding a software rasterizer. */
const BLOCKS_PER_SIDE = 6;
/**
 * Which cells to build, in ENGINE cell coords — the synthetic fixture lays its blocks out from `cell × size`
 * in engine space, and engine z is −(GTA y). The range below is chosen so the built area covers the seed
 * landmarks (GTA x 250…3250, y −3500…−500) and the units patrol over blocks instead of over nothing.
 */
const CELL_X = { from: 1, to: 12 } as const;
const CELL_Z = { from: 2, to: 13 } as const;

/**
 * How far from its centre the demo world actually has content, world units — the same question a streamed
 * world answers with its LOD ring, and the number the camera's bounds are derived from (201/7-02). The demo
 * streams nothing, but it still ENDS, and a map camera that frames past the end shows the same emptiness.
 */
export const DEMO_REACH = ((CELL_X.to - CELL_X.from + 1) * CELL_SIZE) / 2;

/**
 * Where the demo world is and how far it goes, GTA — the radar's scale (201/7-04). Derived from the same
 * two cell ranges the blocks are built from, so a change to the fixture moves the dial with it rather than
 * leaving a second number to notice.
 */
export const DEMO_EXTENT = {
  centre: [((CELL_X.from + CELL_X.to + 1) * CELL_SIZE) / 2, -((CELL_Z.from + CELL_Z.to + 1) * CELL_SIZE) / 2] as [
    number,
    number,
  ],
  radius: Math.max(((CELL_X.to - CELL_X.from + 1) * CELL_SIZE) / 2, ((CELL_Z.to - CELL_Z.from + 1) * CELL_SIZE) / 2),
};

/** Build the demo city. Returns how many draws were recorded, for the boot log. */
export function buildDemoCity(engine: Engine): number {
  engine.textures.load(0, syntheticTextureArray());
  let draws = 0;
  for (let cx = CELL_X.from; cx <= CELL_X.to; cx += 1) {
    for (let cz = CELL_Z.from; cz <= CELL_Z.to; cz += 1) {
      draws += engine.cells.load(`${cx},${cz},hd`, syntheticCell(cx, cz, CELL_SIZE, BLOCKS_PER_SIDE)).draws;
    }
  }

  return draws;
}
