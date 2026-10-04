/**
 * Flat triangle BVH for the bake raycasts (plan 074/07): median-split over AABBs, iterative traversal,
 * OCCLUSION queries only (any hit within maxDistance — no nearest-hit bookkeeping). Deterministic; no deps.
 */

export interface Bvh {
  /** Node AABBs: [minx,miny,minz,maxx,maxy,maxz] × nodeCount. */
  bounds: Float32Array;
  /** Per node: left child index (or −triStart−1 when leaf), right child index (or triCount for leaves). */
  nodes: Int32Array;
  /** Triangle vertex positions, 9 floats per triangle (leaf order). */
  triangles: Float32Array;
}

const LEAF_SIZE = 8;

/** Build from a flat triangle soup (9 floats per triangle: ax ay az bx by bz cx cy cz). */
export function buildBvh(triangles: Float32Array): Bvh {
  const triCount = triangles.length / 9;
  const centroids = new Float32Array(triCount * 3);
  const indices = new Uint32Array(triCount);
  for (let tri = 0; tri < triCount; tri += 1) {
    indices[tri] = tri;
    for (let axis = 0; axis < 3; axis += 1) {
      centroids[tri * 3 + axis] =
        (triangles[tri * 9 + axis] + triangles[tri * 9 + 3 + axis] + triangles[tri * 9 + 6 + axis]) / 3;
    }
  }

  const maxNodes = Math.max(1, 2 * Math.ceil(triCount / LEAF_SIZE) * 2);
  const bounds = new Float32Array(maxNodes * 6);
  const nodes = new Int32Array(maxNodes * 2);
  const ordered = new Float32Array(triangles.length);
  let nodeCount = 0;
  let orderedCount = 0;

  const build = (start: number, end: number): number => {
    const node = nodeCount;
    nodeCount += 1;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let at = start; at < end; at += 1) {
      const tri = indices[at] * 9;
      for (let corner = 0; corner < 3; corner += 1) {
        const x = triangles[tri + corner * 3];
        const y = triangles[tri + corner * 3 + 1];
        const z = triangles[tri + corner * 3 + 2];
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        minZ = Math.min(minZ, z);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
        maxZ = Math.max(maxZ, z);
      }
    }
    bounds.set([minX, minY, minZ, maxX, maxY, maxZ], node * 6);

    if (end - start <= LEAF_SIZE) {
      const triStart = orderedCount / 9;
      for (let at = start; at < end; at += 1) {
        ordered.set(triangles.subarray(indices[at] * 9, indices[at] * 9 + 9), orderedCount);
        orderedCount += 9;
      }
      nodes[node * 2] = -triStart - 1;
      nodes[node * 2 + 1] = end - start;

      return node;
    }

    // Median split along the widest centroid axis.
    const extentX = maxX - minX;
    const extentY = maxY - minY;
    const extentZ = maxZ - minZ;
    const axis = extentX >= extentY && extentX >= extentZ ? 0 : extentY >= extentZ ? 1 : 2;
    const slice = Array.from(indices.subarray(start, end));
    slice.sort((a, b) => centroids[a * 3 + axis] - centroids[b * 3 + axis]);
    indices.set(slice, start);
    const mid = (start + end) >> 1;
    const left = build(start, mid);
    const right = build(mid, end);
    nodes[node * 2] = left;
    nodes[node * 2 + 1] = right;

    return node;
  };
  if (triCount > 0) {
    build(0, triCount);
  }

  return {
    bounds: bounds.subarray(0, nodeCount * 6),
    nodes: nodes.subarray(0, nodeCount * 2),
    triangles: ordered.subarray(0, orderedCount),
  };
}

const stack = new Int32Array(128);

/** True when ANY triangle blocks the ray within `maxDistance`. */
export function occluded(
  bvh: Bvh,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDistance: number,
): boolean {
  if (bvh.triangles.length === 0) {
    return false;
  }
  const invX = 1 / dx;
  const invY = 1 / dy;
  const invZ = 1 / dz;
  let top = 0;
  stack[top] = 0;
  top += 1;
  while (top > 0) {
    top -= 1;
    const node = stack[top];
    if (!rayHitsAabb(bvh.bounds, node, ox, oy, oz, invX, invY, invZ, maxDistance)) {
      continue;
    }
    const left = bvh.nodes[node * 2];
    if (left < 0) {
      const triStart = -left - 1;
      const count = bvh.nodes[node * 2 + 1];
      for (let tri = triStart; tri < triStart + count; tri += 1) {
        if (rayHitsTriangle(bvh.triangles, tri, ox, oy, oz, dx, dy, dz, maxDistance)) {
          return true;
        }
      }
    } else {
      stack[top] = left;
      top += 1;
      stack[top] = bvh.nodes[node * 2 + 1];
      top += 1;
    }
  }

  return false;
}

function rayHitsAabb(
  bounds: Float32Array,
  node: number,
  ox: number,
  oy: number,
  oz: number,
  invX: number,
  invY: number,
  invZ: number,
  maxDistance: number,
): boolean {
  const at = node * 6;
  let t0 = 0;
  let t1 = maxDistance;
  // A ray component of exactly 0 makes inv = ±Infinity, and `(bound - o) * inv` is then `0 * Infinity = NaN`
  // for a slab plane that coincides with the origin. JS Math.min/max PROPAGATE NaN (unlike the C fmin/fmax
  // idiom this shape relies on), so the whole test would collapse to `NaN <= NaN → false` and the subtree be
  // silently skipped — the occluder reads as unshadowed. The noon sun sample hits this exactly (sunvis dir.x
  // = 0 at elevation 1). So each parallel axis is its own slab: the ray only intersects if the origin lies
  // within the box on that axis; otherwise it misses entirely.
  if (Number.isFinite(invX)) {
    const tx0 = (bounds[at] - ox) * invX;
    const tx1 = (bounds[at + 3] - ox) * invX;
    t0 = Math.max(t0, Math.min(tx0, tx1));
    t1 = Math.min(t1, Math.max(tx0, tx1));
  } else if (ox < bounds[at] || ox > bounds[at + 3]) {
    return false;
  }
  if (Number.isFinite(invY)) {
    const ty0 = (bounds[at + 1] - oy) * invY;
    const ty1 = (bounds[at + 4] - oy) * invY;
    t0 = Math.max(t0, Math.min(ty0, ty1));
    t1 = Math.min(t1, Math.max(ty0, ty1));
  } else if (oy < bounds[at + 1] || oy > bounds[at + 4]) {
    return false;
  }
  if (Number.isFinite(invZ)) {
    const tz0 = (bounds[at + 2] - oz) * invZ;
    const tz1 = (bounds[at + 5] - oz) * invZ;
    t0 = Math.max(t0, Math.min(tz0, tz1));
    t1 = Math.min(t1, Math.max(tz0, tz1));
  } else if (oz < bounds[at + 2] || oz > bounds[at + 5]) {
    return false;
  }

  return t0 <= t1;
}

/** Möller–Trumbore, any-hit within maxDistance (epsilon offsets are the CALLER's job). */
function rayHitsTriangle(
  triangles: Float32Array,
  tri: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  maxDistance: number,
): boolean {
  const at = tri * 9;
  const e1x = triangles[at + 3] - triangles[at];
  const e1y = triangles[at + 4] - triangles[at + 1];
  const e1z = triangles[at + 5] - triangles[at + 2];
  const e2x = triangles[at + 6] - triangles[at];
  const e2y = triangles[at + 7] - triangles[at + 1];
  const e2z = triangles[at + 8] - triangles[at + 2];
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-9) {
    return false;
  }
  const invDet = 1 / det;
  const tx = ox - triangles[at];
  const ty = oy - triangles[at + 1];
  const tz = oz - triangles[at + 2];
  const u = (tx * px + ty * py + tz * pz) * invDet;
  if (u < 0 || u > 1) {
    return false;
  }
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * invDet;
  if (v < 0 || u + v > 1) {
    return false;
  }
  const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;

  return t > 1e-4 && t < maxDistance;
}
