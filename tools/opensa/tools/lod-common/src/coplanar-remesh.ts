import type { LodModifier } from './hd-to-lod';
import type { MergedGroup, MergedMesh } from './mesh';

import { compactMeshVertices } from './compact';

/**
 * Coplanar remesh (plan 003, Phase 3 / Track 3): structural reduction for flat surfaces — where QEM broke, this
 * is provably safe. Within each texture group, faces are clustered by edge adjacency onto a common plane; each
 * cluster's boundary loop is kept **byte-exact** and its interior re-triangulated by ear clipping, deleting every
 * interior vertex. Because the boundary never moves, the silhouette and texture seams cannot change and no crack
 * or hole can open — the invariant the tests assert.
 *
 * A cluster is only rewritten when ALL of these hold (else it is left untouched — fallback is always the
 * original triangles):
 *
 * - every face lies on the seed plane (normal within {@link REMESH_DEFAULTS.maxNormalDeviation}, vertices within
 *   `maxPlaneDistance`) and shares the cluster's `twoSided` flag;
 * - the boundary is a single manifold loop (no holes, no non-manifold edges — v1 scope; multi-loop clusters fall
 *   back);
 * - UV / prelit (/ night) are an **affine** function of the plane coordinates across the whole cluster within
 *   the residual tolerances — dropping interior vertices then provably renders the same gradient (SA's planar
 *   mappings are affine in practice; baked AO that actually varies fails the check and keeps its vertices);
 * - the re-triangulation is strictly smaller than the original.
 *
 * Runs before the normals rebuild (flat cluster → identical plane normal either way). Deterministic; needs no
 * context.
 */
export interface CoplanarRemeshOptions {
  /** Max per-channel prelit/night deviation (0–255) from the affine fit before the cluster is kept as-is. */
  maxColorResidual?: number;
  /** Max normal deviation from the cluster seed, as `1 - dot` (default 1e-4 ≈ 0.8°). */
  maxNormalDeviation?: number;
  /** Max vertex distance (world units) off the seed plane. */
  maxPlaneDistance?: number;
  /** Max UV deviation from the affine fit before the cluster is kept as-is. */
  maxUvResidual?: number;
}

export const REMESH_DEFAULTS = {
  maxColorResidual: 4,
  maxNormalDeviation: 1e-4,
  maxPlaneDistance: 0.005,
  maxUvResidual: 0.002,
} as const;

type Options = Required<CoplanarRemeshOptions>;

interface Plane {
  d: number;
  normal: [number, number, number];
}

export function createCoplanarRemesh(options: CoplanarRemeshOptions = {}): LodModifier {
  const opts = { ...REMESH_DEFAULTS, ...options };

  return (mesh: MergedMesh): MergedMesh => {
    let changed = false;
    const groups: MergedGroup[] = mesh.groups.map((group) => {
      const rebuilt = remeshGroup(mesh, group, opts);
      if (rebuilt) {
        changed = true;
      }

      return rebuilt ?? group;
    });

    return changed ? compactMeshVertices({ ...mesh, groups }) : mesh;
  };
}

/** Undirected edge key. */
const edgeKey = (a: number, b: number): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/**
 * Affine fit `value ≈ cu·u + cv·v + c0` over plane coordinates via 3×3 least squares; returns the max absolute
 * residual, or Infinity when the system is singular.
 */
function affineResidual(uv: readonly (readonly [number, number])[], values: readonly number[]): number {
  const n = uv.length;
  let [suu, suv, svv, su, sv] = [0, 0, 0, 0, 0];
  let [bu, bv, b0] = [0, 0, 0];
  for (let i = 0; i < n; i += 1) {
    const [u, v] = uv[i];
    const value = values[i];
    suu += u * u;
    suv += u * v;
    svv += v * v;
    su += u;
    sv += v;
    bu += u * value;
    bv += v * value;
    b0 += value;
  }
  // Solve [suu suv su; suv svv sv; su sv n] · [cu cv c0] = [bu bv b0] by Cramer's rule.
  const det = suu * (svv * n - sv * sv) - suv * (suv * n - sv * su) + su * (suv * sv - svv * su);
  if (Math.abs(det) < 1e-9) {
    return Infinity;
  }
  const cu = (bu * (svv * n - sv * sv) - suv * (bv * n - sv * b0) + su * (bv * sv - svv * b0)) / det;
  const cv = (suu * (bv * n - sv * b0) - bu * (suv * n - sv * su) + su * (suv * b0 - bv * su)) / det;
  const c0 = (suu * (svv * b0 - bv * sv) - suv * (suv * b0 - bv * su) + bu * (suv * sv - svv * su)) / det;

  let worst = 0;
  for (let i = 0; i < n; i += 1) {
    worst = Math.max(worst, Math.abs(cu * uv[i][0] + cv * uv[i][1] + c0 - values[i]));
  }

  return worst;
}

/**
 * Extract the cluster's boundary as one directed loop of vertex indices (edges used exactly once, chained tail
 * to head). Returns null on holes (extra loops), non-manifold edges, or broken chains — the caller falls back.
 */
function boundaryLoop(faces: readonly number[], indices: Uint32Array): null | number[] {
  const use = new Map<string, number>();
  for (const f of faces) {
    for (let c = 0; c < 3; c += 1) {
      const key = edgeKey(indices[f * 3 + c], indices[f * 3 + ((c + 1) % 3)]);
      use.set(key, (use.get(key) ?? 0) + 1);
    }
  }
  if ([...use.values()].some((count) => count > 2)) {
    return null; // non-manifold
  }
  const next = new Map<number, number>();
  let start = -1;
  let boundaryEdges = 0;
  for (const f of faces) {
    for (let c = 0; c < 3; c += 1) {
      const a = indices[f * 3 + c];
      const b = indices[f * 3 + ((c + 1) % 3)];
      if (use.get(edgeKey(a, b)) === 1) {
        if (next.has(a)) {
          return null; // two boundary edges leave one vertex — pinched loop
        }
        next.set(a, b);
        boundaryEdges += 1;
        start = a;
      }
    }
  }
  if (start < 0) {
    return null;
  }
  const loop: number[] = [start];
  let at = next.get(start);
  while (at !== undefined && at !== start && loop.length <= boundaryEdges) {
    loop.push(at);
    at = next.get(at);
  }
  // One closed loop must consume every boundary edge; anything else (holes, gaps) falls back.

  return at === start && loop.length === boundaryEdges ? loop : null;
}

/** Ear-clip a CCW simple polygon (2D); returns triangle index triples into the loop, or null if stuck. */
function earClip(points: readonly (readonly [number, number])[]): null | number[] {
  const remaining = points.map((_, i) => i);
  const out: number[] = [];
  const cross = (o: number, a: number, b: number): number =>
    (points[a][0] - points[o][0]) * (points[b][1] - points[o][1]) -
    (points[a][1] - points[o][1]) * (points[b][0] - points[o][0]);
  const inside = (p: number, a: number, b: number, c: number): boolean =>
    cross(a, b, p) > 0 && cross(b, c, p) > 0 && cross(c, a, p) > 0;

  while (remaining.length > 3) {
    let clipped = false;
    for (let i = 0; i < remaining.length; i += 1) {
      const prev = remaining[(i + remaining.length - 1) % remaining.length];
      const cur = remaining[i];
      const nxt = remaining[(i + 1) % remaining.length];
      if (cross(prev, cur, nxt) <= 1e-12) {
        continue; // reflex or collinear — not an ear
      }
      let blocked = false;
      for (const other of remaining) {
        if (other !== prev && other !== cur && other !== nxt && inside(other, prev, cur, nxt)) {
          blocked = true;
          break;
        }
      }
      if (!blocked) {
        out.push(prev, cur, nxt);
        remaining.splice(i, 1);
        clipped = true;
        break;
      }
    }
    if (!clipped) {
      return null; // degenerate polygon — fall back
    }
  }
  const [a, b, c] = remaining;
  if (cross(a, b, c) > 1e-12) {
    out.push(a, b, c);
  }

  return out;
}

/** The plane of face `f` (unit normal + offset), or null when degenerate. */
function facePlane(p: Float32Array, indices: Uint32Array, f: number): null | Plane {
  const a = indices[f * 3] * 3;
  const b = indices[f * 3 + 1] * 3;
  const c = indices[f * 3 + 2] * 3;
  const nx = (p[b + 1] - p[a + 1]) * (p[c + 2] - p[a + 2]) - (p[b + 2] - p[a + 2]) * (p[c + 1] - p[a + 1]);
  const ny = (p[b + 2] - p[a + 2]) * (p[c] - p[a]) - (p[b] - p[a]) * (p[c + 2] - p[a + 2]);
  const nz = (p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[b + 1] - p[a + 1]) * (p[c] - p[a]);
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-12) {
    return null;
  }
  const normal: [number, number, number] = [nx / len, ny / len, nz / len];

  return { d: normal[0] * p[a] + normal[1] * p[a + 1] + normal[2] * p[a + 2], normal };
}

/** Grow edge-adjacent, same-plane, same-`twoSided` clusters over the group's faces. */
function growClusters(
  mesh: MergedMesh,
  group: MergedGroup,
  opts: Options,
): { faces: number[]; plane: Plane; twoSided: number }[] {
  const faceCount = group.indices.length / 3;
  const byEdge = new Map<string, number[]>();
  for (let f = 0; f < faceCount; f += 1) {
    for (let c = 0; c < 3; c += 1) {
      const key = edgeKey(group.indices[f * 3 + c], group.indices[f * 3 + ((c + 1) % 3)]);
      let faces = byEdge.get(key);
      if (!faces) {
        faces = [];
        byEdge.set(key, faces);
      }
      faces.push(f);
    }
  }

  const assigned = new Int32Array(faceCount).fill(-1);
  const clusters: { faces: number[]; plane: Plane; twoSided: number }[] = [];
  for (let seed = 0; seed < faceCount; seed += 1) {
    if (assigned[seed] !== -1) {
      continue;
    }
    const plane = facePlane(mesh.positions, group.indices, seed);
    if (!plane) {
      continue;
    }
    const twoSided = group.twoSided?.[seed] ?? -1;
    assigned[seed] = clusters.length;
    clusters.push({
      faces: growFrom(seed, clusters.length, { assigned, byEdge, group, mesh, opts, plane, twoSided }),
      plane,
      twoSided,
    });
  }

  return clusters;
}

/** Flood-fill one cluster from `seed` across shared edges, restricted to the seed plane + `twoSided` flag. */
function growFrom(
  seed: number,
  cluster: number,
  env: {
    assigned: Int32Array;
    byEdge: Map<string, number[]>;
    group: MergedGroup;
    mesh: MergedMesh;
    opts: Options;
    plane: Plane;
    twoSided: number;
  },
): number[] {
  const { assigned, byEdge, group, mesh, opts, plane, twoSided } = env;
  const faces = [seed];
  const queue = [seed];
  while (queue.length > 0) {
    const f = queue.pop()!;
    for (let c = 0; c < 3; c += 1) {
      const key = edgeKey(group.indices[f * 3 + c], group.indices[f * 3 + ((c + 1) % 3)]);
      for (const neighbour of byEdge.get(key) ?? []) {
        const compatible = assigned[neighbour] === -1 && (group.twoSided?.[neighbour] ?? -1) === twoSided;
        if (compatible && onPlane(mesh.positions, group.indices, neighbour, plane, opts)) {
          assigned[neighbour] = cluster;
          faces.push(neighbour);
          queue.push(neighbour);
        }
      }
    }
  }

  return faces;
}

/** Whether face `f` lies on `plane` (normal aligned, every vertex within distance). */
function onPlane(p: Float32Array, indices: Uint32Array, f: number, plane: Plane, opts: Options): boolean {
  const own = facePlane(p, indices, f);
  if (!own) {
    return false;
  }
  const dot = own.normal[0] * plane.normal[0] + own.normal[1] * plane.normal[1] + own.normal[2] * plane.normal[2];
  if (1 - dot > opts.maxNormalDeviation) {
    return false;
  }
  for (let c = 0; c < 3; c += 1) {
    const v = indices[f * 3 + c] * 3;
    const dist = plane.normal[0] * p[v] + plane.normal[1] * p[v + 1] + plane.normal[2] * p[v + 2] - plane.d;
    if (Math.abs(dist) > opts.maxPlaneDistance) {
      return false;
    }
  }

  return true;
}

/** Plane basis (e1, e2) with e1 × e2 = normal, so CCW in (u, v) reproduces the cluster's winding. */
function planeBasis(normal: readonly [number, number, number]): [number[], number[]] {
  const [nx, ny, nz] = normal;
  const pick = Math.abs(nx) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const e1 = [ny * pick[2] - nz * pick[1], nz * pick[0] - nx * pick[2], nx * pick[1] - ny * pick[0]];
  const len = Math.hypot(e1[0], e1[1], e1[2]);
  e1[0] /= len;
  e1[1] /= len;
  e1[2] /= len;
  // e2 = normal × e1 ⇒ e1 × e2 = normal (right-handed), so CCW in (u, v) matches the cluster winding.
  const e2 = [
    normal[1] * e1[2] - normal[2] * e1[1],
    normal[2] * e1[0] - normal[0] * e1[2],
    normal[0] * e1[1] - normal[1] * e1[0],
  ];

  return [e1, e2];
}

/** Rebuild one cluster: boundary loop → affine-attribute validation → ear clip. Null = keep the original. */
function remeshCluster(
  mesh: MergedMesh,
  group: MergedGroup,
  cluster: { faces: number[]; plane: Plane },
  opts: Options,
): null | number[] {
  const loop = boundaryLoop(cluster.faces, group.indices);
  if (!loop || loop.length < 3) {
    return null;
  }
  const newFaces = loop.length - 2;
  if (newFaces >= cluster.faces.length) {
    return null; // no win — the "dense interior" was already minimal
  }

  // Validate that UV / prelit (/ night) are affine over the plane across ALL cluster vertices — deleting the
  // interior then changes nothing visually. Any failing channel keeps the cluster as-is.
  const [e1, e2] = planeBasis(cluster.plane.normal);
  const vertexSet = new Set<number>();
  for (const f of cluster.faces) {
    vertexSet.add(group.indices[f * 3]);
    vertexSet.add(group.indices[f * 3 + 1]);
    vertexSet.add(group.indices[f * 3 + 2]);
  }
  const verts = [...vertexSet];
  const planeUv = verts.map((v): readonly [number, number] => {
    const p = mesh.positions;

    return [
      e1[0] * p[v * 3] + e1[1] * p[v * 3 + 1] + e1[2] * p[v * 3 + 2],
      e2[0] * p[v * 3] + e2[1] * p[v * 3 + 1] + e2[2] * p[v * 3 + 2],
    ];
  });
  const channels: { tolerance: number; values: number[] }[] = [
    { tolerance: opts.maxUvResidual, values: verts.map((v) => mesh.uvs[v * 2]) },
    { tolerance: opts.maxUvResidual, values: verts.map((v) => mesh.uvs[v * 2 + 1]) },
  ];
  for (let channel = 0; channel < 4; channel += 1) {
    channels.push({ tolerance: opts.maxColorResidual, values: verts.map((v) => mesh.colors[v * 4 + channel]) });
    if (mesh.nightColors) {
      channels.push({
        tolerance: opts.maxColorResidual,
        values: verts.map((v) => mesh.nightColors![v * 4 + channel]),
      });
    }
  }
  for (const { tolerance, values } of channels) {
    if (affineResidual(planeUv, values) > tolerance) {
      return null;
    }
  }

  // Ear-clip the boundary in plane coordinates (winding already CCW w.r.t. the plane normal by construction).
  const byVertex = new Map(verts.map((v, i) => [v, i]));
  const polygon = loop.map((v) => planeUv[byVertex.get(v)!]);
  const tris = earClip(polygon);
  if (!tris) {
    return null;
  }
  const out: number[] = [];
  for (const cornerIndex of tris) {
    out.push(loop[cornerIndex]);
  }

  return out;
}

/** Re-triangulate every profitable cluster of the group; null when nothing changed. */
function remeshGroup(mesh: MergedMesh, group: MergedGroup, opts: Options): MergedGroup | null {
  const clusters = growClusters(mesh, group, opts);
  if (clusters.every((cluster) => cluster.faces.length < 4)) {
    return null;
  }

  const indices: number[] = [];
  const mask: number[] = [];
  const hasMask = group.twoSided !== undefined;
  let changed = false;
  const keep = (faces: readonly number[]): void => {
    for (const f of faces) {
      indices.push(group.indices[f * 3], group.indices[f * 3 + 1], group.indices[f * 3 + 2]);
      if (hasMask) {
        mask.push(group.twoSided![f]);
      }
    }
  };

  for (const cluster of clusters) {
    const rebuilt = cluster.faces.length >= 4 ? remeshCluster(mesh, group, cluster, opts) : null;
    if (rebuilt) {
      changed = true;
      indices.push(...rebuilt);
      if (hasMask) {
        for (let f = 0; f < rebuilt.length / 3; f += 1) {
          mask.push(cluster.twoSided);
        }
      }
    } else {
      keep(cluster.faces);
    }
  }
  if (!changed) {
    return null;
  }

  return {
    indices: Uint32Array.from(indices),
    texture: group.texture,
    ...(group.color ? { color: group.color } : {}),
    ...(hasMask ? { twoSided: Uint8Array.from(mask) } : {}),
  };
}
