import type { RWTriangle } from '../parsers/binary/types';

interface Cluster {
  max: [number, number, number];
  min: [number, number, number];
  triangles: RWTriangle[];
}

/** Each live row's nearest partner among the rows AFTER it — the naive scan's `i < j` half of the matrix. */
interface Nearest {
  /** Gap to `of[row]`; `Infinity` once the row has no later partner left. */
  gap: Float64Array;
  /** The nearest later row, `-1` when none is left. */
  of: Int32Array;
}

/**
 * Split one material group's triangles into spatially COMPACT clusters — the unit the translucent sort can
 * order honestly. The sort keys a submesh by the eye's distance to its AABB; a group that is one material but
 * several separate pieces (the gostown comet's `dials`: the gauge cluster on the dash AND the two speakers on
 * the rear shelf, one submesh spanning 1.9 m) has no single key: from a front-side angle the box's nearest
 * point is the dash, so the whole submesh sorted NEARER than the rear quarter glass and the speakers drew
 * crisp over it (field, 2026-08-17 — the 2026-08-04 AABB fix could not reach this case). Each cluster
 * becomes its own submesh with its own bounds.
 *
 * Connected components by shared vertex POSITION (a UV seam splits indices, not geometry), then components
 * whose boxes lie within `gap` of each other are merged, and the nearest pairs keep merging until at most
 * `maxClusters` remain — a bound on the draw calls one group can cost. A single connected piece (a
 * windscreen) comes back as it was.
 */
export function clusterTriangles(
  triangles: readonly RWTriangle[],
  positions: Float32Array,
  gap = 0.2,
  maxClusters = 8,
): RWTriangle[][] {
  const parent = new Map<string, string>();
  const keyOf = (corner: number): string =>
    `${positions[corner * 3].toFixed(4)},${positions[corner * 3 + 1].toFixed(4)},${positions[corner * 3 + 2].toFixed(4)}`;
  const find = (key: string): string => {
    let root = key;
    while (parent.get(root) !== root) {
      root = parent.get(root) ?? root;
    }
    parent.set(key, root);

    return root;
  };
  const union = (a: string, b: string): void => {
    parent.set(find(a), find(b));
  };
  for (const tri of triangles) {
    for (const corner of [tri.a, tri.b, tri.c]) {
      const key = keyOf(corner);
      if (!parent.has(key)) {
        parent.set(key, key);
      }
    }
    union(keyOf(tri.a), keyOf(tri.b));
    union(keyOf(tri.b), keyOf(tri.c));
  }

  const byRoot = new Map<string, Cluster>();
  for (const tri of triangles) {
    const root = find(keyOf(tri.a));
    let cluster = byRoot.get(root);
    if (!cluster) {
      cluster = { max: [-Infinity, -Infinity, -Infinity], min: [Infinity, Infinity, Infinity], triangles: [] };
      byRoot.set(root, cluster);
    }
    cluster.triangles.push(tri);
    for (const corner of [tri.a, tri.b, tri.c]) {
      for (let axis = 0; axis < 3; axis += 1) {
        cluster.min[axis] = Math.min(cluster.min[axis], positions[corner * 3 + axis]);
        cluster.max[axis] = Math.max(cluster.max[axis], positions[corner * 3 + axis]);
      }
    }
  }

  return agglomerate([...byRoot.values()], gap, maxClusters).map((cluster) => cluster.triangles);
}

/**
 * Merge the closest pair first, while it is within `gap` — then, past the cap, regardless.
 *
 * Re-scanning every pair per merge is O(n^3), and one material group really does reach 1 440 components
 * (the Pacific Park ferris ring is 1 440 separate bulbs over 50 400 triangles) — 3.6 s for that one model.
 * A merge changes ONE box, and growing a box can only bring it NEARER to the others, so every row keeps its
 * own nearest partner and only that column is repaired. Same merge order, same clusters, O(n^2).
 */
function agglomerate(clusters: Cluster[], gap: number, maxClusters: number): Cluster[] {
  const alive = new Uint8Array(clusters.length).fill(1);
  const nearest: Nearest = {
    gap: new Float64Array(clusters.length).fill(Infinity),
    of: new Int32Array(clusters.length).fill(-1),
  };
  let live = clusters.length;

  for (let row = 0; row < clusters.length; row += 1) {
    scanRow(clusters, alive, nearest, row);
  }

  while (live >= 2) {
    const [into, from, distance] = closestPair(alive, nearest);
    if (into < 0 || (distance > gap && live <= maxClusters)) {
      break;
    }
    merge(clusters[into], clusters[from]);
    alive[from] = 0;
    live -= 1;
    repair(clusters, alive, nearest, into, from);
  }

  return clusters.filter((_, index) => alive[index] === 1);
}

function boxGap(a: Cluster, b: Cluster): number {
  let sq = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const d = Math.max(a.min[axis] - b.max[axis], b.min[axis] - a.max[axis], 0);
    sq += d * d;
  }

  return Math.sqrt(sq);
}

/** The closest live pair, ties falling to the lowest row then its lowest partner — the naive scan's order. */
function closestPair(alive: Uint8Array, nearest: Nearest): [number, number, number] {
  let into = -1;
  let from = -1;
  let best = Infinity;
  for (let row = 0; row < alive.length; row += 1) {
    if (alive[row] === 1 && nearest.of[row] >= 0 && nearest.gap[row] < best) {
      best = nearest.gap[row];
      into = row;
      from = nearest.of[row];
    }
  }

  return [into, from, best];
}

function merge(into: Cluster, from: Cluster): void {
  into.triangles.push(...from.triangles);
  for (let axis = 0; axis < 3; axis += 1) {
    into.min[axis] = Math.min(into.min[axis], from.min[axis]);
    into.max[axis] = Math.max(into.max[axis], from.max[axis]);
  }
}

/**
 * Repair the cache after `from` was folded into `into`. Only rows BELOW `into` own the pair to it, so only
 * they can see the grown box; rows that pointed at the retired `from` have lost their partner outright.
 */
function repair(clusters: readonly Cluster[], alive: Uint8Array, nearest: Nearest, into: number, from: number): void {
  scanRow(clusters, alive, nearest, into);
  for (let row = 0; row < into; row += 1) {
    if (alive[row] === 0) {
      continue;
    }
    if (nearest.of[row] === from) {
      scanRow(clusters, alive, nearest, row);
      continue;
    }
    const candidate = boxGap(clusters[row], clusters[into]);
    if (candidate < nearest.gap[row] || (candidate === nearest.gap[row] && into < nearest.of[row])) {
      nearest.gap[row] = candidate;
      nearest.of[row] = into;
    }
  }
  for (let row = into + 1; row < from; row += 1) {
    if (alive[row] === 1 && nearest.of[row] === from) {
      scanRow(clusters, alive, nearest, row);
    }
  }
}

/** Re-read one row's nearest partner from scratch. */
function scanRow(clusters: readonly Cluster[], alive: Uint8Array, nearest: Nearest, row: number): void {
  let bestRow = -1;
  let bestGap = Infinity;
  for (let other = row + 1; other < clusters.length; other += 1) {
    if (alive[other] === 1) {
      const candidate = boxGap(clusters[row], clusters[other]);
      if (candidate < bestGap) {
        bestGap = candidate;
        bestRow = other;
      }
    }
  }
  nearest.of[row] = bestRow;
  nearest.gap[row] = bestGap;
}
