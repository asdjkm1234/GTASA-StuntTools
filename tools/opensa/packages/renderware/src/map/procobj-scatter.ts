import type { Matrix4 } from '@opensa/math';

import { Quaternion, Vector3 } from '@opensa/math';

import type { RegionColliders } from '../collision';
import type { ColFace } from '../parsers/binary/col-types';
import type { ProcObjRule } from '../parsers/text';
import type { ProcObjCategoryName } from './procobj-categories';

import { procObjCategory } from './procobj-categories';

/**
 * Deterministic procobj scatter (plan 042, iteration 3b): turn one cell's collision faces into
 * ground-clutter placements per `procobj.dat`. Pure — same colliders + rules + cell coords give
 * byte-identical output, so streamed cells never "reshuffle" between visits or sessions.
 *
 * Density headroom: vanilla density is 1; the debug slider dials 0–{@link PROC_OBJ_MAX_DENSITY}.
 * We generate `MAX_DENSITY ×` the vanilla count of candidates, give each a `lottery` value
 * uniform in [0, MAX_DENSITY) and sort each batch by it — the renderer then shows exactly the
 * instances with `lottery < density` via a plain instance-count cutoff (no rebuild on the knob).
 *
 * Both of `procobj.dat`'s numeric columns are spent the way the original spends them (recovered
 * 2026-08-09, `docs/gta-sa-original/procedural-objects.md`):
 *
 * - SPACING is a LENGTH in metres, so the count per face is `area / spacing²` — `ProcSurfaceInfo_c`
 *   stores `1/(spacing*spacing)` and multiplies the triangle area by it. The file's own header
 *   comment ("1 object every n square metres") is wrong; reading it as an area over-generates by
 *   4–163× per rule.
 * - MINDIST is a distance to the CAMERA (clamped to 80), an anti-pop-in radius around the player —
 *   never a distance between two objects. It is ignored here: our placements are static per cell and
 *   visibility is the per-category drawDistance.
 *
 * Nothing in the original prevents clumping, and neither does this: the triangle IS the group, and
 * every rule of a surface fires on the same triangle, so mixed clumps are the system working.
 */

/**
 * One model's placements **on one surface**. The pair is the identity, not the model alone: 19 of the 56
 * models `procobj.dat` names appear under several surfaces (`p_rubble` sits on `p_wasteground`, `p_mountain`
 * AND `p_underwaterbarren`), and {@link procObjCategory} reads the surface — so a batch keyed by model alone
 * took the category of whichever surface the collider walk reached first and gave it to every placement,
 * including the ones from the other surfaces. Splitting the key fixes that by construction and is what makes
 * a per-surface density profile expressible at all (lod-procobj plan 010).
 */
export interface ProcObjBatch {
  category: ProcObjCategoryName;
  /** Clutter model name (lowercased) — defs/meshes resolve through the regular IDE catalog. */
  model: string;
  /** Sorted by `lottery` ascending — see the density cutoff note above. */
  placements: ProcObjPlacement[];
  /** The surfinfo surface these placements grew on — the rule's own key, and the secondary density axis. */
  surface: string;
}

export interface ProcObjPlacement {
  /** Align the object to the face normal (from the rule); otherwise it stays world-upright. */
  align: boolean;
  /** Density lottery in [0, {@link PROC_OBJ_MAX_DENSITY}): drawn while `lottery < density`. */
  lottery: number;
  /** Unit face normal (GTA Z-up world space). */
  normal: [number, number, number];
  /** World position (GTA Z-up), z-offset already applied. */
  position: [number, number, number];
  /** Rotation around the up axis, radians. */
  rotation: number;
  /** XY scale. */
  scale: number;
  scaleZ: number;
}

/**
 * Default candidate headroom: how many times the AUTHORED density the scatter generates, and therefore the
 * highest cutoff a caller can ask for. Also the runtime debug slider's range (0–3).
 *
 * The lottery is uniform in `[0, maxDensity)` and the candidate count scales with the same number, so a
 * cutoff of `d` keeps `d/maxDensity` of `vanilla × maxDensity` — **`d` times the authored density, whatever
 * the headroom is**. Raising it therefore does not change what a cutoff MEANS; it only makes cutoffs above 3
 * reachable, at a linear cost in candidates (and in scatter time).
 *
 * **It does change the SCATTER, from the second face onward.** Each face consumes draws in proportion to its
 * candidate COUNT, so raising the headroom shifts where every later face starts in the seeded sequence: the
 * first face's placements survive unchanged and nothing after them does. Every species moves, not only the one
 * whose cutoff wanted the headroom, so two builds with different headroom compare only statistically.
 */
export const PROC_OBJ_MAX_DENSITY = 3;

/**
 * `|normal.z|` below which a collision face counts as STEEP. 0.85 is ~32° off horizontal, and it is where the
 * map's own faces separate rather than a round number: measured 2026-08-11 over every rule-bearing face
 * (`scripts/debug/procobj-biome-vs-surface.ts`), `p_mountain` is **48.8 %** steep at this threshold while
 * every other surface is under 20 % and the flat ones read 0.0 %.
 */
export const PROC_OBJ_STEEP_THRESHOLD = 0.85;

/**
 * Where inside a collision triangle a placement lands. **Both are the same three lines** — the whole
 * difference is one `sqrt`, which is why the original's routine is reproducible here exactly rather than
 * approximately.
 *
 * - `area` (ours, the default): `o1 = sqrt(rand())`, so points are uniform over the triangle's AREA.
 * - `corner` (**the original's, recovered** — `gta-sa-original/procedural-objects.md`): `o1 = rand()`,
 *   `o2 = o1 × rand()`, `pos = V1 + (V2−V1)·o1 + (V3−V2)·o2`. Expand that and the barycentric weights are
 *   `1−o1`, `o1(1−s)`, `o1·s` — ours exactly, minus the warp. Sampling `o1` uniformly puts equal numbers of
 *   points on cross-sections whose length grows with `o1`, so density falls as `1/o1` and the scatter
 *   **pulls toward V1**: mean weight 0.5 on the first vertex against 1/3 for an area-uniform draw.
 *
 * The bias is a property of the MESH, not of the landscape — V1 is whichever vertex the COL happens to list
 * first, so the clumps land on arbitrary tessellation corners. That is the argument for `area` being the
 * default; the knob exists because it is a LOOK the authored world was tuned in front of, and a look is not
 * settled by an argument.
 */
export type ProcObjSampler = 'area' | 'corner';

/**
 * Slope-aware candidate density (plan 011, the one task that survived its 2026-08-11 re-scope): scale how many
 * candidates a face generates by whether it is STEEP, per category.
 *
 * **Why it lives in the scatter rather than in a density cutoff.** Slope is a property of the FACE; both
 * selection paths (`selectPlacements` on `sa`, `procObjCellBudget` on `opensa`) resolve a cutoff per BATCH,
 * and a batch pools the faces of one model×surface with every normal they happen to have. So a cutoff cannot
 * express it, and generation can — which is also why **both targets get this from one place**: they call this
 * same function.
 *
 * **It is the only terrain signal that is NOT already in the surface.** The same measurement that closed the
 * rest of plan 011 (12 of 14 rule-bearing surfaces sit ≥ 90 % inside one region, carrying that region's
 * species) found `p_mountain` split 48.8/51.2 steep/flat while carrying all six `p_rubble*` rock species —
 * one surface, two kinds of ground, and nothing else in the pipeline can tell them apart.
 *
 * **It moves the scatter from that face on**, like {@link PROC_OBJ_MAX_DENSITY} does: the candidate count is
 * what the seeded sequence is consumed in proportion to. Two builds with different slope settings compare
 * statistically, never placement by placement.
 */
export interface ProcObjSlopeConfig {
  /** Multiplier on a FLAT face's candidate count, per category. Absent (or absent key) = 1, unchanged. */
  flat?: Partial<Record<ProcObjCategoryName, number>>;
  /** Multiplier on a STEEP face's candidate count, per category. Absent (or absent key) = 1, unchanged. */
  steep?: Partial<Record<ProcObjCategoryName, number>>;
  /** `|normal.z|` under which a face is steep. Default {@link PROC_OBJ_STEEP_THRESHOLD}. */
  threshold?: number;
}

/**
 * Refuse a slope config the scatter cannot serve. **NaN is the dangerous one**: it passes every comparison,
 * after which `expected` is NaN, `count` is 0 and the layer is silently empty — the same trap
 * `validateDensityProfile` exists for. A factor of exactly 0 is legal and means "none of this category here".
 */
export function validateSlopeConfig(config: ProcObjSlopeConfig): void {
  const threshold = config.threshold ?? PROC_OBJ_STEEP_THRESHOLD;
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
    throw new Error(`procobj slope threshold must be in (0, 1] — it is |normal.z|: got ${threshold}.`);
  }
  for (const [where, factors] of [
    ['steep', config.steep],
    ['flat', config.flat],
  ] as const) {
    for (const [category, factor] of Object.entries(factors ?? {})) {
      if (!Number.isFinite(factor) || factor < 0) {
        throw new Error(`procobj slope ${where}.${category} must be a finite number >= 0: got ${factor}.`);
      }
    }
  }
}

/** The candidate-count multiplier this face earns for this category — 1 whenever nothing is configured. */
function slopeFactor(config: ProcObjSlopeConfig, category: ProcObjCategoryName, normalZ: number): number {
  const steep = Math.abs(normalZ) < (config.threshold ?? PROC_OBJ_STEEP_THRESHOLD);

  return (steep ? config.steep?.[category] : config.flat?.[category]) ?? 1;
}

const DEG_TO_RAD = Math.PI / 180;

export interface ProcObjCellBudgetOptions {
  /** Effective density per category (0 = disabled). Default: vanilla density 1. */
  densityOf?: (category: ProcObjCategoryName) => number;
  /** The cell's `procObjLimit`. Default: unlimited. */
  limit?: number;
  /**
   * Species floor N (plan 012): every MODEL with an eligible placement in the cell keeps at least
   * `min(N, its eligible count)` of them. **0 (default) is OFF** and returns the plain cap's counts.
   */
  speciesFloor?: number;
}

/** The scatter's optional knobs. An options bag rather than more positionals — `slope` was the seventh. */
export interface ProcObjScatterOptions {
  /** Where inside a triangle a placement lands. Default `area` (ours); `corner` is the original's. */
  sampler?: ProcObjSampler;
  /** Slope-aware candidate density — see {@link ProcObjSlopeConfig}. */
  slope?: ProcObjSlopeConfig;
}

/** Reused triangle temporaries (one allocation per cell, not per face). */
interface TriangleScratch {
  a: Vector3;
  ab: Vector3;
  ac: Vector3;
  b: Vector3;
  c: Vector3;
  normal: Vector3;
}

/** Index `procobj.dat` rules by their (lowercased) surface name — the scatter's lookup shape. */
export function groupRulesBySurface(rules: readonly ProcObjRule[]): Map<string, ProcObjRule[]> {
  const bySurface = new Map<string, ProcObjRule[]>();
  for (const rule of rules) {
    const list = bySurface.get(rule.surface);
    if (list) {
      list.push(rule);
    } else {
      bySurface.set(rule.surface, [rule]);
    }
  }

  return bySurface;
}

/**
 * How many of each batch's placements this cell draws (and therefore collides) — parallel to `batches`,
 * and the ONE place the per-cell budget is decided. Placements are lottery-sorted, so a count is a prefix.
 *
 * Without a floor this is exactly `lottery < min(densityOf(category), procObjLotteryCap(batches, limit))`,
 * the density knob capped by the cell budget, lowest lotteries winning.
 *
 * **The floor exists because that cut can zero a whole species** (plan 012): it pools every candidate and
 * keeps the lowest, so what decides whether a species dies is how many species compete in the cell — 8
 * underwater rules share a 150 budget comfortably, 26 desert ones do not, and a desert cell measured 18 of
 * 26 species placed. Above the floor the lottery order still rules, so the skew a good scatter has is kept;
 * only the zero case is outlawed. **The rescue is PAID FOR** at the top of the lottery order — the
 * placements the cap would have cut next are the ones it now cuts — so the cell budget is conserved and
 * `limit` stays a real number.
 *
 * **The floor's unit is the MODEL, not the batch.** 19 of the 56 models `procobj.dat` names scatter on
 * several surfaces and are therefore several batches ({@link ProcObjBatch}) — but a bush still on screen
 * from the neighbouring surface has not gone missing, so flooring per batch would reserve twice for one
 * visible species. The model's floor is filled from its own lowest lotteries, whichever surface they grew on.
 */
export function procObjCellBudget(batches: readonly ProcObjBatch[], options: ProcObjCellBudgetOptions = {}): number[] {
  const densityOf = options.densityOf ?? ((): number => 1);
  const cap = procObjLotteryCap(batches, options.limit);
  const densities = batches.map((batch) => densityOf(batch.category));
  const keep = batches.map((batch, at) => countBelow(batch.placements, Math.min(densities[at], cap)));
  const floor = options.speciesFloor ?? 0;
  if (floor <= 0 || cap === Number.POSITIVE_INFINITY) {
    return keep; // no floor asked for, or the budget is not binding — nothing can have been zeroed
  }

  const eligible = batches.map((batch, at) => countBelow(batch.placements, densities[at]));
  const reserved = reserveFloor(batches, eligible, floor);
  let owed = 0;
  for (let at = 0; at < keep.length; at += 1) {
    if (keep[at] < reserved[at]) {
      owed += reserved[at] - keep[at];
      keep[at] = reserved[at];
    }
  }
  if (owed === 0) {
    return keep;
  }
  // Everything above its own floor, highest lottery first: the next placements the cap was going to cut.
  const spare: { at: number; lottery: number }[] = [];
  for (let at = 0; at < keep.length; at += 1) {
    for (let i = reserved[at]; i < keep[at]; i += 1) {
      spare.push({ at, lottery: batches[at].placements[i].lottery });
    }
  }
  spare.sort((left, right) => right.lottery - left.lottery);
  for (let i = 0; i < owed && i < spare.length; i += 1) {
    keep[spare[i].at] -= 1; // a batch's entries arrive highest-index-first, so this drops its top placements
  }

  return keep;
}

/**
 * The cell's `procObjLimit` as a lottery threshold: the lottery value below which exactly
 * `limit` placements fall, across ALL of the cell's batches (lowest lotteries win — the
 * most-vanilla subset). `Infinity` when under the limit or unlimited. Both the render meshes
 * and the clutter colliders cut by `lottery < min(density, cap)`, so what isn't rendered is
 * never collided.
 */
export function procObjLotteryCap(batches: readonly ProcObjBatch[], limit?: number): number {
  if (limit === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  const lotteries: number[] = [];
  for (const batch of batches) {
    for (const placement of batch.placements) {
      lotteries.push(placement.lottery);
    }
  }
  if (lotteries.length <= limit) {
    return Number.POSITIVE_INFINITY;
  }
  lotteries.sort((a, b) => a - b);

  return lotteries[limit]; // first excluded value — `< cap` keeps exactly `limit` placements
}

/**
 * Scatter one cell's clutter. `surfaceNames` is the surfinfo table (index = COL material id);
 * faces whose surface has no rules are skipped. Walk order (colliders → transforms → faces →
 * rules) is deterministic, and the RNG is seeded by the cell coords alone.
 */
export function scatterProcObjects(
  colliders: readonly RegionColliders[],
  rulesBySurface: ReadonlyMap<string, readonly ProcObjRule[]>,
  surfaceNames: readonly string[],
  cx: number,
  cy: number,
  maxDensity: number = PROC_OBJ_MAX_DENSITY,
  options: ProcObjScatterOptions = {},
): ProcObjBatch[] {
  const random = mulberry32(cellSeed(cx, cy));
  const batches = new Map<string, ProcObjBatch>();
  const scratch: TriangleScratch = {
    a: new Vector3(),
    ab: new Vector3(),
    ac: new Vector3(),
    b: new Vector3(),
    c: new Vector3(),
    normal: new Vector3(),
  };

  for (const collider of colliders) {
    const { faces, vertices } = collider.col;
    for (const transform of collider.transforms) {
      for (const face of faces) {
        scatterTriangle(
          batches,
          random,
          rulesBySurface,
          surfaceNames,
          face,
          vertices,
          transform,
          scratch,
          maxDensity,
          options,
        );
      }
    }
  }

  const result = [...batches.values()];
  for (const batch of result) {
    batch.placements.sort((left, right) => left.lottery - right.lottery);
  }

  return result;
}

/** Stable per-cell seed (coords hashed with two large primes, like the world-grid keys). */
function cellSeed(cx: number, cy: number): number {
  return (Math.imul(cx, 73856093) ^ Math.imul(cy, 19349663)) >>> 0;
}

/** How many of a lottery-sorted placement list fall below `cutoff` — the drawn set is that prefix. */
function countBelow(placements: readonly ProcObjPlacement[], cutoff: number): number {
  let low = 0;
  let high = placements.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (placements[mid].lottery < cutoff) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }

  return low;
}

/** Deterministic 32-bit PRNG (mulberry32) — tiny, seedable, plenty for decoration. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Per batch, how many of its placements the species floor protects: for every MODEL, its `floor` lowest
 * lotteries among the eligible ones, spread over whatever batches (surfaces) hold them. Reserved for every
 * model, not only the ones under pressure — the reservation is also what stops the payment pass below from
 * cutting a model to zero on its way to funding another.
 */
function reserveFloor(batches: readonly ProcObjBatch[], eligible: readonly number[], floor: number): number[] {
  const reserved = batches.map((): number => 0);
  const byModel = new Map<string, number[]>();
  for (let at = 0; at < batches.length; at += 1) {
    const group = byModel.get(batches[at].model);
    if (group) {
      group.push(at);
    } else {
      byModel.set(batches[at].model, [at]);
    }
  }
  for (const group of byModel.values()) {
    const need = Math.min(
      floor,
      group.reduce((sum, at) => sum + eligible[at], 0),
    );
    // Take them one at a time from whichever of the model's batches offers the lowest lottery next.
    for (let taken = 0; taken < need; taken += 1) {
      let best = -1;
      let bestLottery = Number.POSITIVE_INFINITY;
      for (const at of group) {
        if (reserved[at] >= eligible[at]) {
          continue;
        }
        const lottery = batches[at].placements[reserved[at]].lottery;
        if (lottery < bestLottery) {
          best = at;
          bestLottery = lottery;
        }
      }
      reserved[best] += 1;
    }
  }

  return reserved;
}

function scatterFace(
  batches: Map<string, ProcObjBatch>,
  random: () => number,
  rule: ProcObjRule,
  surface: string,
  a: Vector3,
  b: Vector3,
  c: Vector3,
  normal: Vector3,
  area: number,
  maxDensity: number,
  options: ProcObjScatterOptions,
): void {
  const { sampler = 'area', slope } = options;
  // The category is only needed when a slope config exists, and this runs per face PER RULE over the whole
  // map — so resolving it unconditionally would be a map-wide cost for a feature nobody switched on.
  const category = slope ? procObjCategory(rule.model, surface) : undefined;
  const slopeScale = slope && category ? slopeFactor(slope, category, normal.z) : 1;
  // maxDensity × the vanilla expectation — one object per `spacing × spacing` m², as the original
  // spends the column. The fractional part rolls one extra candidate so small faces still average
  // out to the authored spacing (SA's `for (density; density > 0; density -= 1)` does the same).
  const expected = (area / (rule.spacing * rule.spacing)) * maxDensity * slopeScale;
  const count = Math.floor(expected) + (random() < expected % 1 ? 1 : 0);
  if (count === 0) {
    return;
  }
  // Keyed by model AND surface — see {@link ProcObjBatch}. The RNG is untouched by the split (it is consumed
  // in the same order whatever bucket a placement lands in), so the scatter itself is bit-identical.
  const key = `${rule.model} ${surface}`;
  let batch = batches.get(key);
  if (!batch) {
    batch = { category: category ?? procObjCategory(rule.model, surface), model: rule.model, placements: [], surface };
    batches.set(key, batch);
  }
  for (let i = 0; i < count; i += 1) {
    // Where in the triangle it lands — see {@link ProcObjSampler}. The `sqrt` IS the whole difference from
    // the original's routine: without it the same three weights pull toward the first vertex.
    const roll = random();
    const r = sampler === 'corner' ? roll : Math.sqrt(roll);
    const s = random();
    const wa = 1 - r;
    const wb = r * (1 - s);
    const wc = r * s;
    batch.placements.push({
      align: rule.align,
      lottery: random() * maxDensity,
      normal: [normal.x, normal.y, normal.z],
      position: [
        a.x * wa + b.x * wb + c.x * wc,
        a.y * wa + b.y * wb + c.y * wc,
        a.z * wa + b.z * wb + c.z * wc + rule.zOffsetMin + random() * (rule.zOffsetMax - rule.zOffsetMin),
      ],
      rotation: (rule.minRotation + random() * (rule.maxRotation - rule.minRotation)) * DEG_TO_RAD,
      scale: rule.minScale + random() * (rule.maxScale - rule.minScale),
      scaleZ: rule.minScaleZ + random() * (rule.maxScaleZ - rule.minScaleZ),
    });
  }
}

/** Scatter one collision face: resolve its surface rules, build the world triangle + upward
 *  normal, and roll the placements for every matching rule. */
function scatterTriangle(
  batches: Map<string, ProcObjBatch>,
  random: () => number,
  rulesBySurface: ReadonlyMap<string, readonly ProcObjRule[]>,
  surfaceNames: readonly string[],
  face: ColFace,
  vertices: Float32Array,
  transform: Matrix4,
  scratch: TriangleScratch,
  maxDensity: number,
  options: ProcObjScatterOptions,
): void {
  const surface: string | undefined = surfaceNames[face.material];
  if (surface === undefined) {
    return;
  }
  const rules = rulesBySurface.get(surface);
  if (!rules || rules.length === 0) {
    return;
  }
  const { a, ab, ac, b, c, normal } = scratch;
  a.fromArray(vertices, face.a * 3).applyMatrix4(transform);
  b.fromArray(vertices, face.b * 3).applyMatrix4(transform);
  c.fromArray(vertices, face.c * 3).applyMatrix4(transform);
  normal.copy(ab.subVectors(b, a)).cross(ac.subVectors(c, a));
  const area = normal.length() / 2;
  if (area < 1e-6) {
    return;
  }
  normal.normalize();
  // COL winding is not consistent for ground faces — clutter must grow OUT of the surface,
  // so a downward normal (align rules would plant bushes upside-down, buried) is flipped up.
  if (normal.z < 0) {
    normal.negate();
  }
  for (const rule of rules) {
    scatterFace(batches, random, rule, surface, a, b, c, normal, area, maxDensity, options);
  }
}

// placementMatrix scratch (single-threaded module state, like the three.js math conventions).
const PLACEMENT_UP = new Vector3(0, 0, 1);
const placementPosition = new Vector3();
const placementQuaternion = new Quaternion();
const placementSpin = new Quaternion();
const placementNormal = new Vector3();
const placementScale = new Vector3();

/** Compose one placement transform: tilt to the face normal (align rules), spin around local up.
 *  Shared by the render meshes and the clutter colliders (procobj-colliders) — same world pose. */
export function placementMatrix(placement: ProcObjPlacement, matrix: Matrix4): Matrix4 {
  placementPosition.set(placement.position[0], placement.position[1], placement.position[2]);
  placementSpin.setFromAxisAngle(PLACEMENT_UP, placement.rotation);
  if (placement.align) {
    placementNormal.set(placement.normal[0], placement.normal[1], placement.normal[2]);
    // spin in model space, then tilt
    placementQuaternion.setFromUnitVectors(PLACEMENT_UP, placementNormal).multiply(placementSpin);
  } else {
    placementQuaternion.copy(placementSpin);
  }
  placementScale.set(placement.scale, placement.scale, placement.scaleZ);

  return matrix.compose(placementPosition, placementQuaternion, placementScale);
}
