import type { RWClump, RWGeometry, RWMaterial, RWTriangle } from '../parsers/binary/types';

/**
 * The pure (three-free) half of `buildClumpParts` (plan 060 Phase 5): everything per-vertex/per-triangle —
 * position/normal sanitizing, normal computation, prelit/sway conversions, per-material index buffers and
 * the bounding sphere — produced as plain typed arrays. It runs in the streaming parse WORKER, off the main
 * thread; `wrapClumpParts` (three side) only wraps these arrays into BufferGeometry. Results are cached by
 * model name so repeat cells reuse them, and the worker primes the cache via {@link primePreparedAtomics}.
 */

/** All prepared render data of one atomic — vertex attributes shared by its {@link PreparedPart}s. */
/**
 * Synthesized night ambient for geometry with NO authored night set (slightly cool, ~SA night level).
 * ONE formula for the whole world: the welded cell path and the per-model rigid path both use it, or a
 * converted prop would disagree with the cell it stands in.
 */
export const NIGHT_AMBIENT: readonly [number, number, number] = [0.3, 0.32, 0.4];

export interface PreparedAtomic {
  /** Prelit colours (vec4 when a floodlight beam lives in the prelit alpha, else vec3), or null. */
  color: null | { array: Float32Array; itemSize: 3 | 4 };
  /** The clump frame this atomic hangs from — anim-hierarchy models place parts via frame transforms. */
  frameIndex: number;
  geometryIndex: number;
  /** SA night (extra) vertex colours as vec3, or null. */
  nightColor: Float32Array | null;
  /** Stored (sanitized) or computed vertex normals. */
  normals: Float32Array;
  parts: PreparedPart[];
  positions: Float32Array;
  /** Bounding sphere over the full position set (all parts share it, like three's computeBoundingSphere). */
  sphere: PreparedSphere;
  /** Per-vertex wind-sway weights from the day-prelit alpha (plan 039), or null when not wind-adapted. */
  sway: null | { minAlpha: number; weights: Float32Array };
  uv: Float32Array | null;
}

/** One renderable single-material slice of an atomic (drives one InstancedMesh). */
export interface PreparedPart {
  /** Triangle index buffer for this material's slice. */
  index: Uint16Array | Uint32Array;
  materialIndex: number;
}

export interface PreparedSphere {
  center: readonly [number, number, number];
  radius: number;
}

/** No legitimate SA model-local vertex sits anywhere near this far from the model origin (largest map plates are
 *  a few hundred units); a coordinate beyond it is corrupt — anti-rip garbage (protected mods park a vertex at
 *  ~5.8e25) or a bad export. */
const MAX_VERTEX_COORD = 1_000_000;

/** Prepared atomics by lowercased model name — primed by the parse worker, filled on demand otherwise. */
const preparedCache = new Map<string, PreparedAtomic[]>();
/** Bounded like the clump cache (plan 073/08 memory) — prepared atomics duplicate the geometry arrays. */
const PREPARED_CACHE_MAX = 512;

/** Group a geometry's triangles into per-material index buffers, skipping empty slices. */
export function groupTrianglesByMaterial(triangles: RWTriangle[], materialCount: number): RWTriangle[][] {
  const groups: RWTriangle[][] = Array.from({ length: Math.max(1, materialCount) }, () => []);
  for (const tri of triangles) {
    const slot = tri.materialIndex < groups.length ? tri.materialIndex : 0;
    groups[slot].push(tri);
  }

  return groups;
}

/** Whether a model's prepared atomics are already cached (adapter skips re-sending it to the worker). */
export function hasPreparedAtomics(modelName: string): boolean {
  return preparedCache.has(modelName.toLowerCase());
}

/**
 * A floodlight/searchlight beam encodes its cone falloff in the prelit ALPHA over a plain `white` texture —
 * those keep the vec4 prelit so the material can blend the cone (everything else drops alpha to vec3).
 */
export function isVertexAlphaBeam(material: RWMaterial, geometry: RWGeometry): boolean {
  if (material.texture?.name.toLowerCase() !== 'white' || !geometry.prelitColors) {
    return false;
  }
  for (let i = 3; i < geometry.prelitColors.length; i += 4) {
    if (geometry.prelitColors[i] < 255) {
      return true;
    }
  }

  return false;
}

/** Run the pure prepare stage over every atomic of a clump. */
export function prepareClumpAtomics(clump: RWClump): PreparedAtomic[] {
  const atomics: PreparedAtomic[] = [];
  for (const atomic of clump.atomics) {
    const rw = clump.geometries[atomic.geometryIndex];
    if (!rw) {
      continue;
    }
    sanitizeVertexPositions(rw.positions);
    // Floodlight beams carry their cone in the prelit ALPHA → keep it (vec4) so the material can blend it.
    const beam = rw.materials.some((m) => isVertexAlphaBeam(m, rw));
    atomics.push({
      color: rw.prelitColors ? prelitColorArray(rw.prelitColors, beam) : null,
      frameIndex: atomic.frameIndex,
      geometryIndex: atomic.geometryIndex,
      nightColor: rw.nightColors ? prelitColorArray(rw.nightColors, false).array : null,
      normals: vertexNormals(rw),
      parts: prepareParts(rw),
      positions: rw.positions,
      sphere: boundingSphereOf(rw.positions),
      sway: rw.prelitColors ? swayWeights(rw.prelitColors) : null,
      uv: rw.uvLayers.length > 0 ? rw.uvLayers[0] : null,
    });
  }

  return atomics;
}

/** Cached {@link prepareClumpAtomics} by model name — the map streaming path's entry point. */
export function preparedAtomicsFor(modelName: string, clump: RWClump): PreparedAtomic[] {
  const key = modelName.toLowerCase();
  let prepared = preparedCache.get(key);
  if (!prepared) {
    prepared = prepareClumpAtomics(clump);
  }
  lruSetPrepared(key, prepared);

  return prepared;
}

/** Seed the cache with worker-prepared atomics (paired with the same worker's parsed clump). */
export function primePreparedAtomics(modelName: string, prepared: PreparedAtomic[]): void {
  lruSetPrepared(modelName.toLowerCase(), prepared);
}

/**
 * Repair zero-length (or NaN/Infinity) vertex normals — both ones left by normal computation and ones
 * **stored in the DFF**. Computed normals cancel to zero when a vertex is shared by triangles with opposite
 * winding (coincident double-sided panels — neon signs — or unclean world meshes like some SA roads); stored
 * normals arrive zeroed from dirty re-exports (gta3-pf.img casroyale02/04 — SA's prelit-only map pipeline never
 * reads them, so the mod shipped garbage; plan 037). A zero normal yields no diffuse term, so the face renders
 * **pure black** under any light. We give each such vertex the geometric face normal of an incident triangle
 * (the flat surface direction; `DoubleSide` materials still flip it per back-face), falling back to +Z up only
 * if every incident triangle is degenerate. Valid normals are left untouched, so smooth shading elsewhere is
 * unchanged, and the repair is idempotent (safe on the cached parse).
 */
export function sanitizeDegenerateNormals(
  normals: Float32Array,
  positions: Float32Array,
  triangles: RWTriangle[],
): void {
  const bad = new Set<number>();
  for (let v = 0; v < normals.length / 3; v += 1) {
    const x = normals[v * 3];
    const y = normals[v * 3 + 1];
    const z = normals[v * 3 + 2];
    const lengthSq = x * x + y * y + z * z;
    if (!Number.isFinite(lengthSq) || lengthSq < 1e-8) {
      bad.add(v); // zero-length or NaN/Infinity — both render black/undefined
    }
  }
  if (bad.size === 0) {
    return;
  }
  for (const tri of triangles) {
    if (!bad.has(tri.a) && !bad.has(tri.b) && !bad.has(tri.c)) {
      continue;
    }
    const face = faceNormal(positions, tri.a, tri.b, tri.c);
    if (!face) {
      continue; // degenerate triangle — try another incident one
    }
    for (const v of [tri.a, tri.b, tri.c]) {
      if (bad.delete(v)) {
        normals[v * 3] = face[0];
        normals[v * 3 + 1] = face[1];
        normals[v * 3 + 2] = face[2];
      }
    }
  }
  for (const v of bad) {
    normals[v * 3] = 0; // only-degenerate-triangle vertices: harmless up normal
    normals[v * 3 + 1] = 0;
    normals[v * 3 + 2] = 1;
  }
}

/**
 * Repair corrupt vertex positions in place — NaN/Infinity or absurd magnitudes. Anti-rip-protected vehicle mods
 * (and some dirty exports) ship a garbage vertex (e.g. the funky comet's `top_on` roof part carries one at
 * ~5.8e25); left as-is it stretches every triangle that uses it across the whole world (giant spikes) and blows
 * up the bounding sphere (breaking frustum culling). Each bad vertex is collapsed onto the centroid of the
 * geometry's **valid** vertices (origin if there are none), so its triangles become zero-area slivers inside the
 * model — invisible — and the bounds stay sane. Valid vertices are untouched; idempotent, so it's safe on the
 * cached parse (mirrors {@link sanitizeDegenerateNormals}).
 */
export function sanitizeVertexPositions(positions: Float32Array): void {
  const bad: number[] = [];
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  let good = 0;
  for (let v = 0; v < positions.length / 3; v += 1) {
    const x = positions[v * 3];
    const y = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];
    if (
      Math.abs(x) > MAX_VERTEX_COORD ||
      Math.abs(y) > MAX_VERTEX_COORD ||
      Math.abs(z) > MAX_VERTEX_COORD ||
      !Number.isFinite(x + y + z)
    ) {
      bad.push(v);
    } else {
      sumX += x;
      sumY += y;
      sumZ += z;
      good += 1;
    }
  }
  if (bad.length === 0) {
    return;
  }
  const cx = good > 0 ? sumX / good : 0;
  const cy = good > 0 ? sumY / good : 0;
  const cz = good > 0 ? sumZ / good : 0;
  for (const v of bad) {
    positions[v * 3] = cx;
    positions[v * 3 + 1] = cy;
    positions[v * 3 + 2] = cz;
  }
}

/** Bounding sphere over all positions — three's algorithm (box centre, max-distance radius) without three. */
function boundingSphereOf(positions: Float32Array): PreparedSphere {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxX = Math.max(maxX, positions[i]);
    maxY = Math.max(maxY, positions[i + 1]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }
  if (positions.length === 0) {
    return { center: [0, 0, 0], radius: 0 };
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cz = (minZ + maxZ) / 2;
  let maxDistSq = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const dx = positions[i] - cx;
    const dy = positions[i + 1] - cy;
    const dz = positions[i + 2] - cz;
    maxDistSq = Math.max(maxDistSq, dx * dx + dy * dy + dz * dz);
  }

  return { center: [cx, cy, cz], radius: Math.sqrt(maxDistSq) };
}

/** Area-weighted vertex normals from triangle geometry — three's computeVertexNormals without three. */
function computeVertexNormals(positions: Float32Array, triangles: RWTriangle[]): Float32Array {
  const normals = new Float32Array(positions.length);
  for (const tri of triangles) {
    const a = tri.a * 3;
    const b = tri.b * 3;
    const c = tri.c * 3;
    const cbx = positions[c] - positions[b];
    const cby = positions[c + 1] - positions[b + 1];
    const cbz = positions[c + 2] - positions[b + 2];
    const abx = positions[a] - positions[b];
    const aby = positions[a + 1] - positions[b + 1];
    const abz = positions[a + 2] - positions[b + 2];
    // cb × ab — un-normalised, so larger faces weigh more (same as three).
    const nx = cby * abz - cbz * aby;
    const ny = cbz * abx - cbx * abz;
    const nz = cbx * aby - cby * abx;
    for (const v of [a, b, c]) {
      normals[v] += nx;
      normals[v + 1] += ny;
      normals[v + 2] += nz;
    }
  }
  for (let v = 0; v < normals.length; v += 3) {
    const length = Math.hypot(normals[v], normals[v + 1], normals[v + 2]);
    if (length > 0) {
      normals[v] /= length;
      normals[v + 1] /= length;
      normals[v + 2] /= length;
    }
  }

  return normals;
}

/** Normalised geometric normal of a triangle from its vertex positions, or null when degenerate (zero area). */
function faceNormal(p: Float32Array, a: number, b: number, c: number): [number, number, number] | null {
  const ux = p[b * 3] - p[a * 3];
  const uy = p[b * 3 + 1] - p[a * 3 + 1];
  const uz = p[b * 3 + 2] - p[a * 3 + 2];
  const vx = p[c * 3] - p[a * 3];
  const vy = p[c * 3 + 1] - p[a * 3 + 1];
  const vz = p[c * 3 + 2] - p[a * 3 + 2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-6) {
    return null;
  }

  return [nx / len, ny / len, nz / len];
}

/** LRU touch (see asset-cache): re-insert on hit, evict the oldest past the cap. */
function lruSetPrepared(key: string, value: PreparedAtomic[]): void {
  preparedCache.delete(key);
  preparedCache.set(key, value);
  while (preparedCache.size > PREPARED_CACHE_MAX) {
    const oldest = preparedCache.keys().next().value as string;
    preparedCache.delete(oldest);
  }
}

/** Prelit RGBA bytes → float colours; `withAlpha` keeps vec4 (floodlight beams), default drops to vec3. */
function prelitColorArray(prelit: Uint8Array, withAlpha: boolean): { array: Float32Array; itemSize: 3 | 4 } {
  if (withAlpha) {
    const rgba = new Float32Array(prelit.length);
    for (let i = 0; i < prelit.length; i += 1) {
      rgba[i] = prelit[i] / 255;
    }

    return { array: rgba, itemSize: 4 };
  }
  const colors = new Float32Array((prelit.length / 4) * 3);
  for (let i = 0, j = 0; i < prelit.length; i += 4, j += 3) {
    colors[j] = prelit[i] / 255;
    colors[j + 1] = prelit[i + 1] / 255;
    colors[j + 2] = prelit[i + 2] / 255;
  }

  return { array: colors, itemSize: 3 };
}

/** Per-material index buffers (16-bit when the vertex count allows), skipping empty material slices. */
function prepareParts(rw: RWGeometry): PreparedPart[] {
  const vertexCount = rw.positions.length / 3;
  const parts: PreparedPart[] = [];
  groupTrianglesByMaterial(rw.triangles, rw.materials.length).forEach((tris, materialIndex) => {
    if (tris.length === 0) {
      return;
    }
    // uint16 holds indices 0..65535, so a mesh of up to 65536 vertices (max index 65535) still fits; only
    // > 65536 vertices need uint32 (matches `indicesFor` in build-vehicle-model.ts). Hi-poly mod meshes.
    const index = vertexCount > 65536 ? new Uint32Array(tris.length * 3) : new Uint16Array(tris.length * 3);
    tris.forEach((tri, at) => {
      index[at * 3] = tri.a;
      index[at * 3 + 1] = tri.b;
      index[at * 3 + 2] = tri.c;
    });
    parts.push({ index, materialIndex });
  });

  return parts;
}

/**
 * Per-vertex sway weights from the day-prelit ALPHA channel, or null when every alpha is 255 (the
 * model is not wind-adapted). Weight = (255 − a) / 255: alpha 255 → 0 (rigid trunk), lower alpha →
 * more sway (cedar canopies ship 0xAA ≈ 0.33, dead trees 0xDC ≈ 0.14). `minAlpha` lets the caller
 * reject fade-style alpha gradients (skirts go near 0) as sway candidates.
 */
function swayWeights(prelit: Uint8Array): null | { minAlpha: number; weights: Float32Array } {
  let minAlpha = 255;
  for (let i = 3; i < prelit.length; i += 4) {
    if (prelit[i] < minAlpha) {
      minAlpha = prelit[i];
    }
  }
  if (minAlpha === 255) {
    return null;
  }
  const weights = new Float32Array(prelit.length / 4);
  for (let i = 3, j = 0; i < prelit.length; i += 4, j += 1) {
    weights[j] = (255 - prelit[i]) / 255;
  }

  return { minAlpha, weights };
}

/** Stored normals (sanitized in place) or freshly computed ones. */
function vertexNormals(rw: RWGeometry): Float32Array {
  // Stored normals can be exporter garbage (PF re-exports ship all-zero blocks — black faces);
  // repair is in-place and idempotent, so mutating the cached parse is safe. See plan 037.
  const normals = rw.normals ?? computeVertexNormals(rw.positions, rw.triangles);
  sanitizeDegenerateNormals(normals, rw.positions, rw.triangles);

  return normals;
}
