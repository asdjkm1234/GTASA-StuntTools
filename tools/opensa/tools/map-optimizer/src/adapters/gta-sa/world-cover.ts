import type { Placement, Vec3 } from './boundary';

/**
 * "Is something standing on this face?" — the geometry half of world visibility (plan 025, branch
 * `025-world-visibility`).
 *
 * Five model-local criteria failed to separate a texel-smear DEFECT from an authoring device, and the field
 * said why: `road03sfn`, `backalleys1_sfe` and `garse_85_sfe` all carry large stretched faces that nobody can
 * see, because they are skirts with the NEIGHBOURING BUILDINGS STANDING ON THEM. Visibility is a property of
 * the assembled world, so the judgement has to be made with the placements in hand — which is what plan 019's
 * world pre-pass already walks.
 *
 * **What this is and is not.** A placement is reduced to its world AABB, and a point counts as covered when
 * another model's box encloses the space just above it. That is deliberately crude, and the `reach` is what
 * keeps it honest. A box is also the outer hull, so a hollow archway reads as solid — this OVER-covers, and
 * every threshold below is therefore set to err the other way.
 *
 * **`reach` is measured, not guessed** (2026-08-11). Dumping the 30 faces `road03sfn` still carried at
 * `reach = 2` showed every one of them covered at 5–10 units, not 2: the deck resting over that skirt clears
 * it by more than a metre. At 5 the ranking stops contradicting the field labels (no CLEAN model outranks a
 * BROKEN one); at 10 `road03sfn` leaves the ranking outright, at the cost of hiding more. 5 is the default
 * because the smaller value that satisfies the labels is the one that hides least — the standing bias here.
 * At that setting six of the seven field labels agree with the ranking, and the newly-named broken model
 * (`road_lawn17`) tops the three roads.
 */
export interface CoverQuery {
  /** How many boxes the query holds — 0 means it answers `false` everywhere. */
  readonly boxCount: number;
  /**
   * Is `point` covered from above by a placement of some model OTHER than `ownModel`? A model never occludes
   * itself: a skirt hidden by its own roof plate is one mesh's business, and the defect we hunt lives there.
   */
  covered: (point: Vec3, ownModel: string) => boolean;
}

/** A placement reduced to its world-space box. */
export interface PlacedBox {
  max: Vec3;
  min: Vec3;
  modelName: string;
}

/** Grid pitch of the lookup, world units — a compromise between bucket count and boxes per bucket. */
const CELL = 32;

/**
 * Build the lookup. `reach` is how far ABOVE a point another model's volume still counts as resting on it;
 * beyond it the thing overhead is scenery, not a lid.
 */
export function buildCoverQuery(boxes: readonly PlacedBox[], reach: number): CoverQuery {
  const buckets = new Map<string, number[]>();
  boxes.forEach((box, index) => {
    const x0 = Math.floor(box.min[0] / CELL);
    const x1 = Math.floor(box.max[0] / CELL);
    const y0 = Math.floor(box.min[1] / CELL);
    const y1 = Math.floor(box.max[1] / CELL);
    // A box spanning a huge area would be indexed into thousands of buckets; those are the map-sized shells
    // (water planes, sky domes) and they occlude nothing anyone cares about, so they are simply not indexed.
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_BUCKETS_PER_BOX) {
      return;
    }
    for (let cx = x0; cx <= x1; cx += 1) {
      for (let cy = y0; cy <= y1; cy += 1) {
        const key = `${cx},${cy}`;
        const list = buckets.get(key);
        if (list) list.push(index);
        else buckets.set(key, [index]);
      }
    }
  });

  return {
    boxCount: boxes.length,
    covered: ([x, y, z], ownModel): boolean => {
      for (const index of buckets.get(`${Math.floor(x / CELL)},${Math.floor(y / CELL)}`) ?? []) {
        const box = boxes[index];
        if (box.modelName === ownModel) {
          continue;
        }
        if (x < box.min[0] || x > box.max[0] || y < box.min[1] || y > box.max[1]) {
          continue;
        }
        // The box must START at or below the point's own level plus `reach`, and still extend ABOVE it —
        // i.e. it occupies the space this face looks into. A box entirely below the point is under it.
        if (box.min[2] <= z + reach && box.max[2] > z + EPSILON) {
          return true;
        }
      }

      return false;
    },
  };
}

/** Model-local → world: rotate by the placement quaternion (x, y, z, w), then translate. */
export function toWorld(placement: Placement, x: number, y: number, z: number): Vec3 {
  const [qx, qy, qz, qw] = placement.rotation;
  // v + 2·cross(q.xyz, cross(q.xyz, v) + w·v) — the standard quaternion-vector product.
  const tx = 2 * (qy * z - qz * y);
  const ty = 2 * (qz * x - qx * z);
  const tz = 2 * (qx * y - qy * x);

  return [
    placement.position[0] + x + qw * tx + (qy * tz - qz * ty),
    placement.position[1] + y + qw * ty + (qz * tx - qx * tz),
    placement.position[2] + z + qw * tz + (qx * ty - qy * tx),
  ];
}

/** The world AABB of a model's local positions under one placement. */
export function worldBox(positions: Float32Array, placement: Placement, modelName: string): null | PlacedBox {
  if (positions.length < 3) {
    return null;
  }
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < positions.length; v += 3) {
    const world = toWorld(placement, positions[v], positions[v + 1], positions[v + 2]);
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k], world[k]);
      max[k] = Math.max(max[k], world[k]);
    }
  }

  return { max, min, modelName };
}

/** Height tolerance so a box whose floor sits exactly on the face still reads as covering it. */
const EPSILON = 1e-3;
/** A box wider than this many grid cells is a map-sized shell, not an occluder — see `buildCoverQuery`. */
const MAX_BUCKETS_PER_BOX = 4096;
