import { Matrix4 } from '@opensa/math';

import type { CollisionIndex, RegionColliders } from '../collision';
import type { ProcObjBatch } from './procobj-scatter';

import { getCollision } from '../collision';
import { placementMatrix } from './procobj-scatter';

export interface ProcObjColliderOptions {
  /** How many of each batch's placements the cell budget draws ({@link procObjCellBudget}), parallel to
   *  `batches` — collision exists for exactly the rendered set, never beyond it. Default: all of them. */
  keep?: readonly number[];
}

/**
 * Collision for scattered clutter (plan 042): vanilla-faithful rule — a clutter model collides
 * iff it ships a COL (rocks `p_rubble*col`, cacti, trees do; grass/flower patches don't, so
 * they stay walk-through). The collidable set IS the rendered set, and it is not decided here:
 * {@link procObjCellBudget} resolves the density knob, the `procObjLimit` cap and the species floor
 * into one count per batch, and both the render path and this one spend that same count — so nothing
 * invisible can ever collide. The caller invalidates its collider cache and re-streams physics when
 * the knobs change. Transforms reuse the render `placementMatrix`, scale included (vanilla leaves
 * collision unscaled — a dat-format limitation, not a feature; matching the visual pose is strictly
 * better).
 */
export function procObjColliders(
  index: CollisionIndex,
  batches: readonly ProcObjBatch[],
  options: ProcObjColliderOptions = {},
): RegionColliders[] {
  const { keep } = options;

  const colliders: RegionColliders[] = [];
  for (let at = 0; at < batches.length; at += 1) {
    const batch = batches[at];
    const col = getCollision(index, batch.model);
    if (!col) {
      continue;
    }
    const count = keep ? (keep[at] ?? 0) : batch.placements.length;
    const transforms: Matrix4[] = [];
    for (let i = 0; i < count; i += 1) {
      transforms.push(placementMatrix(batch.placements[i], new Matrix4()));
    }
    if (transforms.length > 0) {
      colliders.push({ col, name: batch.model, transforms });
    }
  }

  return colliders;
}
