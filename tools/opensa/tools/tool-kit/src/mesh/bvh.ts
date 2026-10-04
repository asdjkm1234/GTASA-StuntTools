/**
 * Triangle BVH for occlusion raycasts (lod-common plan 003, Phase 2), shared `tool-kit` core. Built once per
 * mesh (binned median split over triangle centroids, fully deterministic — no RNG, no time), then queried with
 * an **any-hit** ray test: "is there any triangle between these two points?" — exactly what a visibility cull
 * needs, with early exit on the first hit (a buried sample terminates within its burying geometry immediately).
 */

export interface Bvh {
  /**
   * True when some triangle intersects the segment `origin + t·dir` for `t ∈ (tMin, tMax)`. `dir` need not be
   * normalized — `t` is in units of `dir`'s length (pass the full segment as `dir` with `tMax = 1`).
   */
  anyHit(origin: readonly number[], dir: readonly number[], tMin: number, tMax: number): boolean;
}

/** Flat triangle soup: `positions` (vertexCount × 3) + `indices` (faceCount × 3 vertex triples). */
export interface BvhMesh {
  indices: Uint32Array;
  positions: Float32Array;
}

const LEAF_SIZE = 8;

/** Packed BVH: per-node AABB + either child pair or a leaf triangle range (over a face permutation). */
class Raycaster implements Bvh {
  private nodeCount = 0;
  /** Node layout: minX,minY,minZ,maxX,maxY,maxZ, a, b — a<0 → leaf [start=-a-1, count=b]; else children a,b. */
  private readonly nodes: Float64Array;
  private readonly order: Uint32Array;

  constructor(
    private readonly tris: Float32Array,
    faceCount: number,
  ) {
    this.order = new Uint32Array(faceCount);
    for (let f = 0; f < faceCount; f += 1) {
      this.order[f] = f;
    }
    this.nodes = new Float64Array(Math.max(1, 2 * faceCount) * 8);
    if (faceCount > 0) {
      this.build(0, faceCount);
    }
  }

  anyHit(origin: readonly number[], dir: readonly number[], tMin: number, tMax: number): boolean {
    if (this.nodeCount === 0) {
      return false;
    }
    const [ox, oy, oz] = origin;
    const [dx, dy, dz] = dir;
    const ix = 1 / dx;
    const iy = 1 / dy;
    const iz = 1 / dz;
    const stack: number[] = [0];
    while (stack.length > 0) {
      const n = stack.pop()! * 8;
      const nodes = this.nodes;
      // Slab test against the node AABB (inf-safe for axis-parallel rays).
      let t0 = tMin;
      let t1 = tMax;
      const lx = (nodes[n] - ox) * ix;
      const hx = (nodes[n + 3] - ox) * ix;
      t0 = Math.max(t0, Math.min(lx, hx));
      t1 = Math.min(t1, Math.max(lx, hx));
      const ly = (nodes[n + 1] - oy) * iy;
      const hy = (nodes[n + 4] - oy) * iy;
      t0 = Math.max(t0, Math.min(ly, hy));
      t1 = Math.min(t1, Math.max(ly, hy));
      const lz = (nodes[n + 2] - oz) * iz;
      const hz = (nodes[n + 5] - oz) * iz;
      t0 = Math.max(t0, Math.min(lz, hz));
      t1 = Math.min(t1, Math.max(lz, hz));
      if (t0 > t1) {
        continue;
      }
      const a = nodes[n + 6];
      const b = nodes[n + 7];
      if (a < 0) {
        const start = -a - 1;
        for (let f = start; f < start + b; f += 1) {
          if (this.hitTriangle(this.order[f] * 9, ox, oy, oz, dx, dy, dz, tMin, tMax)) {
            return true;
          }
        }
      } else {
        stack.push(a, b);
      }
    }

    return false;
  }

  /** Build a node over `order[start, start+count)`; returns the node index. */
  private build(start: number, count: number): number {
    const node = this.nodeCount;
    this.nodeCount += 1;
    const n = node * 8;
    // AABB over the range.
    let [minX, minY, minZ] = [Infinity, Infinity, Infinity];
    let [maxX, maxY, maxZ] = [-Infinity, -Infinity, -Infinity];
    for (let f = start; f < start + count; f += 1) {
      const t = this.order[f] * 9;
      for (let c = 0; c < 9; c += 3) {
        minX = Math.min(minX, this.tris[t + c]);
        maxX = Math.max(maxX, this.tris[t + c]);
        minY = Math.min(minY, this.tris[t + c + 1]);
        maxY = Math.max(maxY, this.tris[t + c + 1]);
        minZ = Math.min(minZ, this.tris[t + c + 2]);
        maxZ = Math.max(maxZ, this.tris[t + c + 2]);
      }
    }
    this.nodes[n] = minX;
    this.nodes[n + 1] = minY;
    this.nodes[n + 2] = minZ;
    this.nodes[n + 3] = maxX;
    this.nodes[n + 4] = maxY;
    this.nodes[n + 5] = maxZ;

    if (count <= LEAF_SIZE) {
      this.nodes[n + 6] = -start - 1;
      this.nodes[n + 7] = count;

      return node;
    }

    // Median split along the widest axis of the centroid extent.
    const axis = widestAxis(this.tris, this.order, start, count);
    const slice = Array.from(this.order.subarray(start, start + count));
    slice.sort((fa, fb) => centroid(this.tris, fa, axis) - centroid(this.tris, fb, axis));
    this.order.set(slice, start);
    const half = count >> 1;
    const left = this.build(start, half);
    const right = this.build(start + half, count - half);
    this.nodes[n + 6] = left;
    this.nodes[n + 7] = right;

    return node;
  }

  /** Möller–Trumbore, double-sided, `t ∈ (tMin, tMax)`. */
  private hitTriangle(
    t: number,
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    tMin: number,
    tMax: number,
  ): boolean {
    const p = this.tris;
    const e1x = p[t + 3] - p[t];
    const e1y = p[t + 4] - p[t + 1];
    const e1z = p[t + 5] - p[t + 2];
    const e2x = p[t + 6] - p[t];
    const e2y = p[t + 7] - p[t + 1];
    const e2z = p[t + 8] - p[t + 2];
    const px = dy * e2z - dz * e2y;
    const py = dz * e2x - dx * e2z;
    const pz = dx * e2y - dy * e2x;
    const det = e1x * px + e1y * py + e1z * pz;
    if (Math.abs(det) < 1e-12) {
      return false;
    }
    const inv = 1 / det;
    const sx = ox - p[t];
    const sy = oy - p[t + 1];
    const sz = oz - p[t + 2];
    const u = (sx * px + sy * py + sz * pz) * inv;
    if (u < 0 || u > 1) {
      return false;
    }
    const qx = sy * e1z - sz * e1y;
    const qy = sz * e1x - sx * e1z;
    const qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv;
    if (v < 0 || u + v > 1) {
      return false;
    }
    const hit = (e2x * qx + e2y * qy + e2z * qz) * inv;

    return hit > tMin && hit < tMax;
  }
}

/** Build a BVH over the mesh (plus optional extra occluder meshes, concatenated). */
export function buildBvh(meshes: readonly BvhMesh[]): Bvh {
  // Concatenate all meshes into one triangle soup (vertex positions per corner — no shared indexing needed).
  let faceCount = 0;
  for (const mesh of meshes) {
    faceCount += mesh.indices.length / 3;
  }
  const tris = new Float32Array(faceCount * 9);
  let at = 0;
  for (const mesh of meshes) {
    for (const index of mesh.indices) {
      const v = index * 3;
      tris[at] = mesh.positions[v];
      tris[at + 1] = mesh.positions[v + 1];
      tris[at + 2] = mesh.positions[v + 2];
      at += 3;
    }
  }

  return new Raycaster(tris, faceCount);
}

function centroid(tris: Float32Array, face: number, axis: number): number {
  const t = face * 9;

  return tris[t + axis] + tris[t + 3 + axis] + tris[t + 6 + axis];
}

function widestAxis(tris: Float32Array, order: Uint32Array, start: number, count: number): number {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let f = start; f < start + count; f += 1) {
    for (let axis = 0; axis < 3; axis += 1) {
      const c = centroid(tris, order[f], axis);
      min[axis] = Math.min(min[axis], c);
      max[axis] = Math.max(max[axis], c);
    }
  }
  const spans = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];

  return spans.indexOf(Math.max(...spans));
}
