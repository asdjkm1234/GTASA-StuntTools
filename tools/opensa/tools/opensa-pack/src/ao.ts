import { WELD_AO, WELD_ROW, type WeldedCell } from '@opensa/cell-weld/weld';

/**
 * Baked AO/skyVis (plan 074/07): between weld and assemble, hemisphere-raycast every HD vertex against a
 * district BVH and write the visibility fraction into the scratch rows (→ the `.oscell` aoSkyVis byte).
 *
 * Decisions (v1):
 * - Occluders = opaque + cutout groups of HD cells only (blend glass and beam cones must not darken the sky).
 * - Only HD vertices are baked; LOD keeps the fully-open default — LOD verts sit NEAR but not ON the HD
 *   surfaces, so baking them against the HD BVH self-occludes noisily, and LOD is viewed from ≥380 units.
 * - Fixed cosine-weighted sample fan (golden-ratio spiral) — deterministic, no RNG.
 * - Vertices are deduped by quantized world position+normal: welding duplicates verts per instance/part, the
 *   rays are the cost, and identical (pos, normal) pairs get identical answers by construction.
 */
import { buildBvh, type Bvh, occluded } from './bvh';

export interface BakeAoOptions {
  /** Prebuilt district BVH (shared with the sun-vis bake); built from `cells` when absent. */
  bvh?: Bvh;
  /** Ray length: geometry farther than this never darkens a vertex. */
  maxDistance?: number;
  /** Hemisphere rays per unique vertex. */
  samples?: number;
}

export interface BakeAoReport {
  rays: number;
  triangles: number;
  uniqueVertices: number;
  vertices: number;
}

export const RAY_OFFSET = 0.08; // push origins off the surface — neighbouring coplanar tris otherwise self-hit
export const LOD_RAY_OFFSET = 1.0; // LOD verts sit near-but-not-on the HD surfaces — push well clear of them
/** LOD AO floor — same self-shadow noise cap as the sun-vis bake (field). */
export const LOD_AO_FLOOR = 0.5;
export const AO_SAMPLES = 12;
export const AO_MAX_DISTANCE = 60;

/** Mutates the HD cells' scratch rows in place; returns the bake counters for the report. */
export function bakeAo(cells: WeldedCell[], options: BakeAoOptions = {}): BakeAoReport {
  const samples = options.samples ?? AO_SAMPLES;
  const maxDistance = options.maxDistance ?? AO_MAX_DISTANCE;
  const bvh = options.bvh ?? buildOccluderBvh(cells);
  const fan = sampleFan(samples);
  const report: BakeAoReport = { rays: 0, triangles: bvh.triangles.length / 9, uniqueVertices: 0, vertices: 0 };

  for (const cell of cells) {
    // Dedup cache is PER CELL: V8 Maps cap at ~16.7 M entries (a full-city bake overflows a global one),
    // and cross-cell duplicates were negligible anyway (GTA verts are heavily split).
    const cache = new Map<string, number>();
    // LOD cells bake TOO (field fix: unbaked LOD = visible HD/LOD seams); bigger push-off — LOD verts sit
    // near-but-not-on the HD occluder surfaces.
    const offset = cell.lod ? LOD_RAY_OFFSET : RAY_OFFSET;
    for (const bucket of cell.buckets) {
      const rows = bucket.vertices;
      for (let row = 0; row < rows.length; row += WELD_ROW) {
        const wx = rows[row] + cell.origin[0];
        const wy = rows[row + 1] + cell.origin[1];
        const wz = rows[row + 2] + cell.origin[2];
        const key = quantKey(wx, wy, wz, rows[row + 3], rows[row + 4], rows[row + 5]);
        let ao = cache.get(key);
        if (ao === undefined) {
          ao = skyVisibility(bvh, wx, wy, wz, rows[row + 3], rows[row + 4], rows[row + 5], fan, maxDistance, offset);
          cache.set(key, ao);
          report.uniqueVertices += 1;
          report.rays += samples;
        }
        rows[row + WELD_AO] = cell.lod ? Math.max(ao, LOD_AO_FLOOR) : ao;
        report.vertices += 1;
      }
    }
    cell.hasAo = true;
  }

  return report;
}

/** District occluder BVH — HD opaque/cutout triangles only; shared by the AO and sun-vis bakes. */
export function buildOccluderBvh(cells: WeldedCell[]): Bvh {
  return buildBvh(collectOccluders(cells));
}

/** Quantized (world position, normal) dedup key — identical pairs get identical bake answers. */
export function quantKey(x: number, y: number, z: number, nx: number, ny: number, nz: number): string {
  return `${Math.round(x * 50)},${Math.round(y * 50)},${Math.round(z * 50)},${Math.round(nx * 30)},${Math.round(ny * 30)},${Math.round(nz * 30)}`;
}

/** Deterministic cosine-weighted hemisphere fan (tangent space, +Z = normal), 3 floats per sample. */
export function sampleFan(samples: number): Float32Array {
  const fan = new Float32Array(samples * 3);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  for (let sample = 0; sample < samples; sample += 1) {
    const u = (sample + 0.5) / samples;
    const cosTheta = Math.sqrt(1 - u); // cosine-weighted: pdf ∝ cosθ
    const sinTheta = Math.sqrt(u);
    const phi = sample * goldenAngle;
    fan[sample * 3] = Math.cos(phi) * sinTheta;
    fan[sample * 3 + 1] = Math.sin(phi) * sinTheta;
    fan[sample * 3 + 2] = cosTheta;
  }

  return fan;
}

export function skyVisibility(
  bvh: ReturnType<typeof buildBvh>,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  fan: Float32Array,
  maxDistance: number,
  rayOffset: number,
): number {
  const nLen = Math.hypot(nx, ny, nz) || 1;
  const zx = nx / nLen;
  const zy = ny / nLen;
  const zz = nz / nLen;
  // Tangent frame: pick the world axis least aligned with the normal.
  const ax = Math.abs(zx) < 0.9 ? 1 : 0;
  const ay = Math.abs(zx) < 0.9 ? 0 : 1;
  // t = (ax, ay, 0) × z
  let tx = ay * zz;
  let ty = -ax * zz;
  let tz = ax * zy - ay * zx;
  const tLen = Math.hypot(tx, ty, tz) || 1;
  tx /= tLen;
  ty /= tLen;
  tz /= tLen;
  const bx = zy * tz - zz * ty;
  const by = zz * tx - zx * tz;
  const bz = zx * ty - zy * tx;
  const ox = x + zx * rayOffset;
  const oy = y + zy * rayOffset;
  const oz = z + zz * rayOffset;

  const samples = fan.length / 3;
  let visible = 0;
  for (let sample = 0; sample < samples; sample += 1) {
    const sx = fan[sample * 3];
    const sy = fan[sample * 3 + 1];
    const sz = fan[sample * 3 + 2];
    const dx = tx * sx + bx * sy + zx * sz;
    const dy = ty * sx + by * sy + zy * sz;
    const dz = tz * sx + bz * sy + zz * sz;
    if (!occluded(bvh, ox, oy, oz, dx, dy, dz, maxDistance)) {
      visible += 1;
    }
  }

  // Floor at 1/255: encoded byte 0 is the UNBAKED sentinel in the WGSL consumer — a fully-occluded vertex
  // (e.g. a road under a bridge, all rays blocked) must not collide with it and render fully open.
  return Math.max(visible / samples, 1 / 255);
}

/** Append one bucket's world-space triangles at `at`, skipping slivers; returns the new write offset. */
function appendBucketOccluders(
  triangles: Float32Array,
  at: number,
  bucket: WeldedCell['buckets'][number],
  origin: readonly [number, number, number],
): number {
  for (let tri = 0; tri + 2 < bucket.indices.length; tri += 3) {
    const buffer = at;
    for (let corner = 0; corner < 3; corner += 1) {
      const row = bucket.indices[tri + corner] * WELD_ROW;
      triangles[at] = bucket.vertices[row] + origin[0];
      triangles[at + 1] = bucket.vertices[row + 1] + origin[1];
      triangles[at + 2] = bucket.vertices[row + 2] + origin[2];
      at += 3;
    }
    if (isSliver(triangles, buffer)) {
      at = buffer; // drop it — rewind
    }
  }

  return at;
}

/** HD opaque/cutout triangles in ENGINE WORLD space, 9 floats each. THIN triangles (power lines, cables,
 *  railing bars — area ≪ longestEdge²) are EXCLUDED: a per-vertex bake inflates a 5 cm wire into a
 *  zigzag shadow blotch across whole ground polys (field report), and such slivers barely occlude anyway. */
function collectOccluders(cells: WeldedCell[]): Float32Array {
  let indexCount = 0;
  for (const cell of cells) {
    if (cell.lod) {
      continue;
    }
    for (const bucket of cell.buckets) {
      // Timed buckets are sometimes-absent AND often coplanar overlays (night windows) — never occluders.
      if (bucket.pipelineClass <= 1 && !bucket.timed) {
        indexCount += bucket.indices.length;
      }
    }
  }
  const triangles = new Float32Array(indexCount * 3);
  let at = 0;
  for (const cell of cells) {
    if (cell.lod) {
      continue;
    }
    for (const bucket of cell.buckets) {
      if (bucket.pipelineClass > 1 || bucket.timed) {
        continue;
      }
      at = appendBucketOccluders(triangles, at, bucket, cell.origin);
    }
  }

  return triangles.subarray(0, at);
}

/** Sliver test: area < 1 % of longestEdge² — wires/cables/railing bars, not walls or foliage cards. */
function isSliver(triangles: Float32Array, at: number): boolean {
  const ux = triangles[at + 3] - triangles[at];
  const uy = triangles[at + 4] - triangles[at + 1];
  const uz = triangles[at + 5] - triangles[at + 2];
  const vx = triangles[at + 6] - triangles[at];
  const vy = triangles[at + 7] - triangles[at + 1];
  const vz = triangles[at + 8] - triangles[at + 2];
  const wx = triangles[at + 6] - triangles[at + 3];
  const wy = triangles[at + 7] - triangles[at + 4];
  const wz = triangles[at + 8] - triangles[at + 5];
  const area = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  const longest = Math.max(ux * ux + uy * uy + uz * uz, vx * vx + vy * vy + vz * vz, wx * wx + wy * wy + wz * wz);

  return area < longest * 0.01;
}
