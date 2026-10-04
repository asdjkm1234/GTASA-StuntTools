/**
 * A baked cell's collision, turned into the shapes the physics layer already consumes (plan 200/3-01).
 *
 * This is the whole of the runtime read: `.oscol` was written by the converter from the SAME
 * `RegionColliders` this path used to build by parsing COL in the browser, so the conversion here is a
 * re-wrapping of flat arrays — no archive, no chunk header, no string. What it replaces is measured at
 * 9.6–78.3 ms per cell on the main thread (plan 091), paid ~95 times on a cold district entry.
 *
 * The surface bytes are carried straight through. A baked collider that loses them is a DATA regression
 * however fast it loads: `materials` is what lets a wheel ask whether it is on tarmac, grass or sand
 * (plan 081/10), and absent materials mean "unknown surface" — never surface 0.
 *
 * **Breakability is the writer's decision, not this reader's** (`.oscol` v2): a region's instance keys are
 * present exactly when the model shatters. Asking the archive here instead would parse a DFF per model on
 * the very path the bake exists to keep out of the archive — and on a streamed run that was the LAST reason
 * the collision path opened one.
 */
import type { Oscol, OscolRegion } from '@opensa/engine-formats';

import { decodeOscol } from '@opensa/engine-formats';
import { Matrix4 } from '@opensa/math';

import type { ModelColliders } from '../interfaces/collider.interface';

/**
 * What the adapter needs of the pak's baked-collision reader — declared structurally so the game layer
 * keeps no dependency on the engine's streaming internals (the host wires the engine's `PakCollisionSource`
 * in, and a test wires a stub).
 */
/** Decode failures already reported — see {@link readBakedCell}. */
const warnedReasons = new Set<string>();

export interface BakedCollisionSource {
  /** The GAME grid the bake is keyed on. It is NOT the pak's render grid, and a consumer streaming on a
   *  different one would be handed a neighbouring cell's colliders — so the consumer checks it. */
  readonly cellSize: number;
  /** Whether the pak carries a bake for this cell — asked first so a cell with none never costs an await. */
  has(cx: number, cy: number): boolean;
  read(cx: number, cy: number): Promise<null | Uint8Array>;
}

/** One decoded cell as the physics layer's per-model colliders, in the order the bake wrote them. */
export function bakedModelColliders(cell: Oscol): ModelColliders[] {
  return cell.regions.map(toModelColliders);
}

/**
 * A cell's pak bytes as colliders, or **null when this reader cannot read that container** — a pak baked by
 * an older `.oscol` writer, or a corrupt entry. Null means "use the COL path", which is the same answer as
 * "no bake for this cell", so a stale pak degrades to slower rather than to a world with holes in it.
 *
 * It says so once per distinct reason, not once per cell: a district entry decodes ~95 cells and would
 * otherwise print the same line ninety-five times.
 */
export function readBakedCell(bytes: Uint8Array): ModelColliders[] | null {
  try {
    return bakedModelColliders(decodeOscol(bytes));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (!warnedReasons.has(reason)) {
      warnedReasons.add(reason);
      // eslint-disable-next-line no-console -- a pak the runtime silently ignores is the failure mode this project keeps paying for
      console.warn(`[collision] the pak's baked collision is unreadable (${reason}) — parsing COL instead`);
    }

    return null;
  }
}

function toModelColliders(region: OscolRegion): ModelColliders {
  return {
    ...(region.instanceKeys !== undefined ? { instanceKeys: region.instanceKeys } : {}),
    name: region.name,
    shape: {
      boxes: region.boxes.map((box) => ({
        ...(box.material !== undefined ? { material: box.material } : {}),
        max: [...box.max],
        min: [...box.min],
      })),
      indices: region.indices,
      ...(region.materials !== undefined ? { materials: region.materials } : {}),
      spheres: region.spheres.map((sphere) => ({
        center: [...sphere.center],
        ...(sphere.material !== undefined ? { material: sphere.material } : {}),
        radius: sphere.radius,
      })),
      vertices: region.vertices,
    },
    // `.oscol` stores column-major, which is exactly `Matrix4.elements` — the transforms are read, not
    // rebuilt, so a placement cannot drift between the bake and the world it was baked from.
    transforms: region.transforms.map((matrix) => new Matrix4().fromArray(matrix)),
  };
}
