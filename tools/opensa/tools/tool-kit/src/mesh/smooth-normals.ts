/**
 * Rebuild per-vertex normals from **smooth groups** (map-optimizer plan 015), decoupled from any mesh type so
 * both map-optimizer (SubMesh) and opensa-lod-generator (merged cell mesh) can drive it. Operates on raw
 * `positions` + flat triangle **index triples** and returns new normals, the remapped indices, and the list of
 * appended (split) vertices — each caller then duplicates *its own* attributes (uv / prelit / colour) for the
 * splits via `splitSources`.
 *
 * Algorithm: (1) weld vertices by position; face normals + areas. (2) flood-fill faces into smooth groups across
 * edges whose dihedral ≤ the crease angle (hard edges / boundaries / double faces bound groups). (3) give each
 * vertex the area-weighted average of **one** group, **splitting** a vertex shared by several groups into one
 * copy per group. Original vertices stay in place (same indices) — only extra group-copies are appended — so a
 * mesh needing no split comes back with identical vertex count + indices (lets a count-aware serializer take its
 * safe attribute-overlay path). See plan 015 for the shatter-bug history this ordering avoids.
 */

type Vec3 = [number, number, number];

const DEFAULTS = { creaseAngleDeg: 45, weldEpsilon: 0.001 };

export interface SmoothNormalsOptions {
  /** Edges sharper than this (degrees) bound smooth groups (faces across them don't average together). */
  creaseAngleDeg?: number;
  /** Position-weld grid (world units) so seam-split vertices share adjacency. */
  weldEpsilon?: number;
}

export interface SmoothNormalsResult {
  /** Remapped triangle vertex indices, flattened (triangleCount × 3), same face order as the input. */
  indices: Uint32Array;
  /** New per-vertex normals, flattened ((originalVertexCount + splitSources.length) × 3). */
  normals: Float32Array;
  /** For each appended vertex (index ≥ originalVertexCount), the original vertex index it copies. */
  splitSources: number[];
}

interface Faces {
  area: Float64Array;
  normal: Float64Array;
}

/**
 * Re-expand a per-vertex attribute for a {@link SmoothNormalsResult}: the original buffer followed by a copy of
 * each split vertex's `size`-tuple (in `splitSources` order). Callers use this to grow positions / UVs / colours
 * to match the rebuilt `normals` + `indices`.
 */
export function appendSplitsF32(source: Float32Array, splitSources: readonly number[], size: number): Float32Array {
  const out = new Float32Array(source.length + splitSources.length * size);
  out.set(source, 0);
  splitSources.forEach((src, k) => {
    for (let i = 0; i < size; i += 1) {
      out[source.length + k * size + i] = source[src * size + i];
    }
  });

  return out;
}

/** {@link appendSplitsF32} for a byte attribute (prelit / night colours). */
export function appendSplitsU8(source: Uint8Array, splitSources: readonly number[], size: number): Uint8Array {
  const out = new Uint8Array(source.length + splitSources.length * size);
  out.set(source, 0);
  splitSources.forEach((src, k) => {
    for (let i = 0; i < size; i += 1) {
      out[source.length + k * size + i] = source[src * size + i];
    }
  });

  return out;
}

/**
 * Recompute normals from smooth groups, splitting at hard edges. `indices` is flat triples into `positions`;
 * returns `null` when there are no triangles.
 */
export function rebuildSmoothNormals(
  positions: Float32Array,
  indices: ArrayLike<number>,
  options: SmoothNormalsOptions = {},
): null | SmoothNormalsResult {
  const triangleCount = Math.floor(indices.length / 3);
  if (triangleCount === 0) {
    return null;
  }
  const cosCrease = Math.cos(((options.creaseAngleDeg ?? DEFAULTS.creaseAngleDeg) * Math.PI) / 180);

  const canonId = weld(positions, options.weldEpsilon ?? DEFAULTS.weldEpsilon);
  const faces = faceData(positions, indices, triangleCount);
  const groupOf = smoothGroups(indices, triangleCount, canonId, faces, cosCrease);
  const groupNormals = accumulateGroupNormals(positions, indices, triangleCount, canonId, groupOf, faces);

  return emitSplitVertices(positions.length / 3, indices, triangleCount, canonId, groupOf, groupNormals);
}

/**
 * Point-repair (plan 020): overwrite ONLY the `failing` vertices' normals with their smooth-group normal,
 * keeping every other vertex byte-identical and NEVER splitting (the failing vertex gets the group of its
 * first incident face — deterministic, face order is stable). Returns the number of vertices repaired
 * (a failing vertex with no non-degenerate incident face keeps its value and is not counted).
 */
export function repairNormalsInPlace(
  positions: Float32Array,
  indices: ArrayLike<number>,
  normals: Float32Array,
  failing: readonly number[],
  options: SmoothNormalsOptions = {},
): number {
  const triangleCount = Math.floor(indices.length / 3);
  if (triangleCount === 0 || failing.length === 0) {
    return 0;
  }
  const cosCrease = Math.cos(((options.creaseAngleDeg ?? DEFAULTS.creaseAngleDeg) * Math.PI) / 180);
  const canonId = weld(positions, options.weldEpsilon ?? DEFAULTS.weldEpsilon);
  const faces = faceData(positions, indices, triangleCount);
  const groupOf = smoothGroups(indices, triangleCount, canonId, faces, cosCrease);
  const groupNormals = accumulateGroupNormals(positions, indices, triangleCount, canonId, groupOf, faces);

  // First non-degenerate incident face per FAILING vertex only (one pass, no full adjacency).
  const wanted = new Set(failing);
  const faceFor = new Map<number, number>();
  for (let f = 0; f < triangleCount && faceFor.size < wanted.size; f += 1) {
    if (faces.area[f] < 1e-9) {
      continue;
    }
    for (let c = 0; c < 3; c += 1) {
      const v = indices[f * 3 + c];
      if (wanted.has(v) && !faceFor.has(v)) {
        faceFor.set(v, f);
      }
    }
  }

  let repaired = 0;
  for (const v of failing) {
    const face = faceFor.get(v);
    if (face === undefined) {
      continue; // only-degenerate faces — no evidence to repair with
    }
    const sum = groupNormals.get(`${canonId[v]}|${groupOf[face]}`);
    if (!sum) {
      continue;
    }
    const [nx, ny, nz] = normalize(sum);
    normals[v * 3] = nx;
    normals[v * 3 + 1] = ny;
    normals[v * 3 + 2] = nz;
    repaired += 1;
  }

  return repaired;
}

/**
 * Corner-angle × area weighted normal per `(welded vertex, group)`, keyed `${canonVertex}|${group}`
 * (plan 021): area alone lets long thin triangles dominate — a 100 m road strip outvotes every local face at
 * a junction corner and tilts the vertex normal along the strip. The corner angle cancels a sliver's huge
 * area (its angle at the junction is tiny) while leaving equilateral fans unchanged.
 */
function accumulateGroupNormals(
  positions: Float32Array,
  indices: ArrayLike<number>,
  triangleCount: number,
  canonId: Int32Array,
  groupOf: Int32Array,
  faces: Faces,
): Map<string, Vec3> {
  const accum = new Map<string, Vec3>();
  for (let f = 0; f < triangleCount; f += 1) {
    const group = groupOf[f];
    for (let c = 0; c < 3; c += 1) {
      const vertex = indices[f * 3 + c];
      const weight = faces.area[f] * cornerAngle(positions, indices, f, c);
      const key = `${canonId[vertex]}|${group}`;
      const sum = accum.get(key) ?? [0, 0, 0];
      sum[0] += faces.normal[f * 3] * weight;
      sum[1] += faces.normal[f * 3 + 1] * weight;
      sum[2] += faces.normal[f * 3 + 2] * weight;
      accum.set(key, sum);
    }
  }

  return accum;
}

/** The triangle's interior angle (radians) at corner `c` — the two edges leaving that corner. */
function cornerAngle(positions: Float32Array, indices: ArrayLike<number>, face: number, c: number): number {
  const at = vertexAt(positions, indices[face * 3 + c]);
  const next = sub(vertexAt(positions, indices[face * 3 + ((c + 1) % 3)]), at);
  const prev = sub(vertexAt(positions, indices[face * 3 + ((c + 2) % 3)]), at);
  const lengths = Math.hypot(next[0], next[1], next[2]) * Math.hypot(prev[0], prev[1], prev[2]);
  if (lengths < 1e-12) {
    return 0;
  }
  const cos = (next[0] * prev[0] + next[1] * prev[1] + next[2] * prev[2]) / lengths;

  return Math.acos(Math.max(-1, Math.min(1, cos)));
}

function crossProduct(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Canon-vertex edge key → incident face list. */
function edgeIncidence(indices: ArrayLike<number>, triangleCount: number, canonId: Int32Array): Map<string, number[]> {
  const edges = new Map<string, number[]>();
  for (let f = 0; f < triangleCount; f += 1) {
    const corners = [canonId[indices[f * 3]], canonId[indices[f * 3 + 1]], canonId[indices[f * 3 + 2]]];
    for (let i = 0; i < 3; i += 1) {
      const u = corners[i];
      const v = corners[(i + 1) % 3];
      const key = u < v ? `${u},${v}` : `${v},${u}`;
      const list = edges.get(key);
      if (list) {
        list.push(f);
      } else {
        edges.set(key, [f]);
      }
    }
  }

  return edges;
}

/** Re-emit indices, keeping original vertices in place and appending one copy per extra smooth group. */
function emitSplitVertices(
  vertexCount: number,
  indices: ArrayLike<number>,
  triangleCount: number,
  canonId: Int32Array,
  groupOf: Int32Array,
  groupNormals: Map<string, Vec3>,
): SmoothNormalsResult {
  const normals = new Array<number>(vertexCount * 3).fill(0);
  const splitSources: number[] = [];
  const primaryGroup = new Int32Array(vertexCount).fill(-1);
  const appended = new Map<string, number>(); // `${originalVertex}|${group}` → appended index

  const normalFor = (original: number, group: number): Vec3 =>
    normalize(groupNormals.get(`${canonId[original]}|${group}`) ?? [0, 0, 1]);

  const resolve = (original: number, group: number): number => {
    if (primaryGroup[original] === -1) {
      primaryGroup[original] = group; // this group owns the original slot
      const [nx, ny, nz] = normalFor(original, group);
      normals[original * 3] = nx;
      normals[original * 3 + 1] = ny;
      normals[original * 3 + 2] = nz;

      return original;
    }
    if (primaryGroup[original] === group) {
      return original;
    }
    const key = `${original}|${group}`;
    const cached = appended.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const index = vertexCount + splitSources.length;
    appended.set(key, index);
    splitSources.push(original);
    normals.push(...normalFor(original, group));

    return index;
  };

  const out = new Uint32Array(triangleCount * 3);
  for (let f = 0; f < triangleCount; f += 1) {
    out[f * 3] = resolve(indices[f * 3], groupOf[f]);
    out[f * 3 + 1] = resolve(indices[f * 3 + 1], groupOf[f]);
    out[f * 3 + 2] = resolve(indices[f * 3 + 2], groupOf[f]);
  }

  return { indices: out, normals: Float32Array.from(normals), splitSources };
}

function faceData(positions: Float32Array, indices: ArrayLike<number>, triangleCount: number): Faces {
  const normal = new Float64Array(triangleCount * 3);
  const area = new Float64Array(triangleCount);
  for (let f = 0; f < triangleCount; f += 1) {
    const a = vertexAt(positions, indices[f * 3]);
    const cross = crossProduct(
      sub(vertexAt(positions, indices[f * 3 + 1]), a),
      sub(vertexAt(positions, indices[f * 3 + 2]), a),
    );
    const length = Math.hypot(cross[0], cross[1], cross[2]);
    area[f] = length / 2;
    if (length > 1e-9) {
      normal[f * 3] = cross[0] / length;
      normal[f * 3 + 1] = cross[1] / length;
      normal[f * 3 + 2] = cross[2] / length;
    }
  }

  return { area, normal };
}

/** A 4-incident edge whose faces form two reversed-winding twin pairs (the doubled-surface interior). */
function isTwinQuad(incident: readonly number[], twin: Int32Array): boolean {
  return incident.every((face) => twin[face] !== -1 && incident.includes(twin[face]));
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]);

  return length < 1e-9 ? [0, 0, 1] : [v[0] / length, v[1] / length, v[2] / length];
}

/**
 * Union faces across smooth edges (dihedral ≤ crease); returns each face's group root.
 *
 * Two-sided geometry (plan 022): SA's doubled world (mirrored coplanar face pairs) makes every interior edge
 * 4-incident, which the manifold-only rule treated as a hard boundary — the whole doubled region fragmented
 * into per-face groups (flat shading on curved shells; 72 513 such faces map-wide). A 4-incident edge whose
 * faces form two reversed-winding TWIN pairs is now smoothed by testing every cross pair with the SAME
 * dihedral test — no side bookkeeping needed, because a twin's normal is negated: the wrong-side pairs and
 * the twin pairs fail the crease test arithmetically, and only the two same-side pairs can union.
 */
function smoothGroups(
  indices: ArrayLike<number>,
  triangleCount: number,
  canonId: Int32Array,
  faces: Faces,
  cosCrease: number,
): Int32Array {
  const { find, parent } = unionFind(triangleCount);
  const twin = twinFaces(indices, triangleCount, canonId);
  const edges = edgeIncidence(indices, triangleCount, canonId);

  const unionIfSmooth = (a: number, b: number): void => {
    if (faces.area[a] < 1e-9 || faces.area[b] < 1e-9) {
      return;
    }
    const dot =
      faces.normal[a * 3] * faces.normal[b * 3] +
      faces.normal[a * 3 + 1] * faces.normal[b * 3 + 1] +
      faces.normal[a * 3 + 2] * faces.normal[b * 3 + 2];
    if (dot >= cosCrease) {
      parent[find(a)] = find(b); // smooth edge — same group
    }
  };

  for (const incident of edges.values()) {
    if (incident.length === 2) {
      unionIfSmooth(incident[0], incident[1]); // twins never pass (dot −1), so an open sheet's sides stay apart
    } else if (incident.length === 4 && isTwinQuad(incident, twin)) {
      for (let i = 0; i < 4; i += 1) {
        for (let j = i + 1; j < 4; j += 1) {
          unionIfSmooth(incident[i], incident[j]);
        }
      }
    }
    // Anything else (3-incident T-junctions, 5+, un-twinned 4s) stays a hard group boundary.
  }

  const group = new Int32Array(triangleCount);
  for (let i = 0; i < group.length; i += 1) {
    group[i] = find(i);
  }

  return group;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** Canonical DIRECTED triple key: rotate the smallest canon id first, keep the winding. */
function tripleKey(a: number, b: number, c: number): string {
  if (a <= b && a <= c) {
    return `${a},${b},${c}`;
  }
  if (b <= a && b <= c) {
    return `${b},${c},${a}`;
  }

  return `${c},${a},${b}`;
}

/** Pair each face with its coincident reversed-winding twin (−1 = none); greedy, deterministic by order. */
function twinFaces(indices: ArrayLike<number>, triangleCount: number, canonId: Int32Array): Int32Array {
  const byKey = new Map<string, number[]>();
  for (let f = 0; f < triangleCount; f += 1) {
    const key = tripleKey(canonId[indices[f * 3]], canonId[indices[f * 3 + 1]], canonId[indices[f * 3 + 2]]);
    const list = byKey.get(key);
    if (list) {
      list.push(f);
    } else {
      byKey.set(key, [f]);
    }
  }
  const twin = new Int32Array(triangleCount).fill(-1);
  for (let f = 0; f < triangleCount; f += 1) {
    if (twin[f] !== -1) {
      continue;
    }
    const reversed = tripleKey(canonId[indices[f * 3]], canonId[indices[f * 3 + 2]], canonId[indices[f * 3 + 1]]);
    for (const candidate of byKey.get(reversed) ?? []) {
      if (candidate !== f && twin[candidate] === -1) {
        twin[f] = candidate;
        twin[candidate] = f;
        break;
      }
    }
  }

  return twin;
}

/** Path-halving union–find over `size` elements. */
function unionFind(size: number): { find: (i: number) => number; parent: Int32Array } {
  const parent = new Int32Array(size);
  for (let i = 0; i < size; i += 1) {
    parent[i] = i;
  }
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }

    return i;
  };

  return { find, parent };
}

/** Union ε-close vertices across neighbouring grid cells (each cell PAIR visited once — positive offsets). */
function unionNearMisses(
  positions: Float32Array,
  epsilon: number,
  cells: ReadonlyMap<string, number[]>,
  parent: Int32Array,
  find: (i: number) => number,
): void {
  const epsilonSq = epsilon * epsilon;
  for (const [key, list] of cells) {
    const [gx, gy, gz] = key.split(',').map(Number);
    for (const [dx, dy, dz] of NEIGHBOUR_OFFSETS) {
      const other = cells.get(`${gx + dx},${gy + dy},${gz + dz}`);
      if (!other) {
        continue;
      }
      for (const a of list) {
        for (const b of other) {
          const ddx = positions[a * 3] - positions[b * 3];
          const ddy = positions[a * 3 + 1] - positions[b * 3 + 1];
          const ddz = positions[a * 3 + 2] - positions[b * 3 + 2];
          if (ddx * ddx + ddy * ddy + ddz * ddz < epsilonSq) {
            parent[find(a)] = find(b);
          }
        }
      }
    }
  }
}

/** Half the 26-neighbourhood: lexicographically positive offsets, so each cell pair is checked once. */
const NEIGHBOUR_OFFSETS: readonly (readonly [number, number, number])[] = ((): [number, number, number][] => {
  const offsets: [number, number, number][] = [];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        if (dx > 0 || (dx === 0 && dy > 0) || (dx === 0 && dy === 0 && dz > 0)) {
          offsets.push([dx, dy, dz]);
        }
      }
    }
  }

  return offsets;
})();

function vertexAt(positions: Float32Array, i: number): Vec3 {
  return [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
}

/**
 * Position-weld by grid quantization PLUS a neighbour-cell union (plan 023B): `round(pos/ε)` alone splits two
 * ε-close vertices that straddle a grid-cell boundary — a phantom hard edge mid-surface (measured: 5 327
 * such vertices in 478 vanilla models). Pass 2 unions ε-close vertices across the 26 adjacent cells.
 */
function weld(positions: Float32Array, epsilon: number): Int32Array {
  // Pass 1: exact-cell weld — each vertex joins its quantized cell's first member.
  const cells = new Map<string, number[]>();
  const count = positions.length / 3;
  const { find, parent } = unionFind(count);
  for (let i = 0; i < count; i += 1) {
    const key = `${Math.round(positions[i * 3] / epsilon)},${Math.round(positions[i * 3 + 1] / epsilon)},${Math.round(positions[i * 3 + 2] / epsilon)}`;
    const list = cells.get(key);
    if (list) {
      parent[i] = find(list[0]);
      list.push(i);
    } else {
      cells.set(key, [i]);
    }
  }

  // Pass 2: union ε-close vertices across neighbouring cells (the boundary-straddle fix).
  unionNearMisses(positions, epsilon, cells, parent, find);

  // Compact to dense ids so downstream keys stay small.
  const canonId = new Int32Array(count);
  const dense = new Map<number, number>();
  for (let i = 0; i < count; i += 1) {
    const root = find(i);
    let id = dense.get(root);
    if (id === undefined) {
      id = dense.size;
      dense.set(root, id);
    }
    canonId[i] = id;
  }

  return canonId;
}
