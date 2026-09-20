/**
 * A cell's collision, baked (plan 200/3-01).
 *
 * Converts what `buildCellColliders` already produces into the `.oscol` container, so the parse the browser
 * pays 9.6–78.3 ms per cell for happens here instead, once.
 *
 * **The grid is the trap.** Collision streams on the GAME grid (`GAME_CELL_SIZE`, 256) while the pak's render
 * cells are 250 (`CELL_SIZE`) — two different tessellations of the same world. A bake keyed on the render
 * grid lands every collider in the wrong slot, and nothing catches it: the world renders, the player falls
 * through it in some places and stands on nothing in others. So the cell coordinates here are the CALLER's,
 * and the caller is responsible for having asked `buildCellColliders` on the same grid it writes the key
 * with. See `docs/restrictions/architecture.md`.
 */
import type { OscolRegion } from '@opensa/engine-formats';
import type { RegionColliders } from '@opensa/renderware';

import { breakableInstanceKey } from '@opensa/renderware/breakable/key';

/**
 * Every region of one cell. An empty cell is a legitimate result and still gets an entry: "nothing here"
 * and "not baked yet" must not look the same to the runtime.
 *
 * `isBreakable` is REQUIRED rather than optional, and the reason is that its absence would be silent: a
 * region with no instance keys reads as "this model does not shatter", so a caller that forgot to pass the
 * gate would bake a world whose bins and lamp posts simply stop breaking. It must be the SAME gate the
 * runtime applies (a RW Breakable atomic OR an `object.dat` smash effect) — one definition, or the pak and
 * the game disagree about what the player can smash.
 */
export function bakeCellCollision(
  regions: readonly RegionColliders[],
  isBreakable: (modelName: string) => boolean,
): { regions: OscolRegion[] } {
  return { regions: regions.map((region) => bakeRegion(region, isBreakable(region.name))) };
}

/**
 * One region per model, exactly as the runtime's `toModelColliders` builds it — same index order, same
 * per-TRIANGLE surface byte, same conjugated world transforms. The bake may not reinterpret the data; it
 * only moves when it is read.
 *
 * A breakable model additionally gets one instance key per placement, computed the way the render registry
 * and the physics layer both compute it (model name + cm-rounded translation) — the key IS the contract
 * pairing a hit to the prop that disappears.
 */
export function bakeRegion(region: RegionColliders, breakable: boolean): OscolRegion {
  const { col, name, transforms } = region;
  const indices = new Uint32Array(col.faces.length * 3);
  // One surface byte per TRIANGLE, in the same order as the indices — what lets a wheel ask what it is
  // standing on (plan 081/10). Losing it is a DATA regression, not a performance one.
  const materials = new Uint8Array(col.faces.length);
  col.faces.forEach((face, index) => {
    indices[index * 3] = face.a;
    indices[index * 3 + 1] = face.b;
    indices[index * 3 + 2] = face.c;
    materials[index] = face.material;
  });

  return {
    boxes: col.boxes.map((box) => ({
      material: box.surface.material,
      max: [...box.max],
      min: [...box.min],
    })),
    indices,
    ...(breakable
      ? {
          instanceKeys: transforms.map((matrix) =>
            breakableInstanceKey(name, [matrix.elements[12], matrix.elements[13], matrix.elements[14]]),
          ),
        }
      : {}),
    materials,
    name,
    spheres: col.spheres.map((sphere) => ({
      center: [...sphere.center],
      material: sphere.surface.material,
      radius: sphere.radius,
    })),
    // `Matrix4.elements` is column-major, which is what `.oscol` stores and what the physics layer already
    // consumes — copied rather than referenced, since the matrices belong to the builder's scratch.
    transforms: transforms.map((matrix) => Float32Array.from(matrix.elements)),
    vertices: col.vertices,
  };
}

/**
 * The GAME-grid cell rect covering the same world area as a RENDER-grid rect.
 *
 * Both rects are INCLUSIVE cell coordinates, and the two grids do not line up: 250 and 256 share a boundary
 * only every 32 000 units, so a district's collision rect is never simply its render rect. Getting this
 * wrong is the silent failure the restriction describes — colliders land in a neighbouring cell and the
 * player falls through a strip of world that renders perfectly.
 */
export function collisionCellRect(
  renderRect: readonly [number, number, number, number],
  renderCellSize: number,
  gameCellSize: number,
): [number, number, number, number] {
  const [x0, y0, x1, y1] = [
    Math.min(renderRect[0], renderRect[2]),
    Math.min(renderRect[1], renderRect[3]),
    Math.max(renderRect[0], renderRect[2]),
    Math.max(renderRect[1], renderRect[3]),
  ];
  // The render rect's world extent, half-open: cell x1 ends where x1+1 begins.
  const toCell = (worldValue: number): number => Math.floor(worldValue / gameCellSize);

  return [
    toCell(x0 * renderCellSize),
    toCell(y0 * renderCellSize),
    toCell((x1 + 1) * renderCellSize - 1),
    toCell((y1 + 1) * renderCellSize - 1),
  ];
}
