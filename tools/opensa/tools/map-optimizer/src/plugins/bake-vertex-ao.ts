import { buildBvh } from '@opensa/tool-kit/mesh/bvh';

import type { MapPlugin } from '../core/asset';
import type { SubMesh } from '../core/ir';

/**
 * Vertex-AO rebake for **flat-prelit** models (plan 019 Phase 4). A `flat` verdict means the export carries no
 * baked shading at all (day-luma spread ≈ 0) — `apply-prelit-level` puts the fill at the neighbourhood level,
 * and this plugin then replaces the flatness with real shading: per-vertex hemisphere occlusion against the
 * model's own geometry (tool-kit BVH, deterministic golden-spiral ray set — no RNG), normalized so the
 * **median stays at the levelled value** (occluded corners go darker, open faces slightly brighter; the
 * neighbourhood conformance is preserved). The same factor is applied to an existing night set, and a
 * synthesized one (`conform-night`, ordered later) derives from the shaded day — so the AO survives into night.
 *
 * Ordered after `apply-prelit-level` and before `weld-seam-prelit` (the seam line/band keeps its final word at
 * shared borders) — see `run.ts`. Vertex normals must already be rebuilt (`smooth-normals` runs in the base
 * pipeline).
 */
export interface BakeVertexAoOptions {
  /** Occluders beyond this distance (world units) don't darken a vertex. Default 25. */
  maxDistance?: number;
  /** Hemisphere rays per vertex (deterministic spiral). Default 32. */
  rayCount?: number;
  /** How dark a fully-occluded vertex gets before normalization (0..1). Default 0.6. */
  strength?: number;
}

const DEFAULTS: Required<BakeVertexAoOptions> = { maxDistance: 25, rayCount: 32, strength: 0.6 };

export function createBakeVertexAo(flatModels: ReadonlySet<string>, options: BakeVertexAoOptions = {}): MapPlugin {
  const opts = { ...DEFAULTS, ...options };

  return {
    accepts: (asset): boolean => flatModels.has(asset.name),
    name: 'bake-vertex-ao',
    transform(asset, context): void {
      const meshes = asset.ir.meshes.filter((mesh) => mesh.prelitColors);
      if (meshes.length === 0) {
        return;
      }
      const bvh = buildBvh(
        asset.ir.meshes.map((mesh) => ({ indices: triangleIndices(mesh), positions: mesh.positions })),
      );
      const factors = meshes.map((mesh) => occlusionFactors(mesh, bvh, opts));
      const median = medianOf(factors);
      if (median <= 0) {
        return; // no vertex had a usable normal — nothing to shade
      }

      let shaded = 0;
      meshes.forEach((mesh, index) => {
        const factor = factors[index];
        for (let v = 0; v < factor.length; v += 1) {
          if (factor[v] < 0) {
            continue; // no normal — leave the levelled fill
          }
          const scale = factor[v] / median;
          scaleRgb(mesh.prelitColors!, v, scale);
          if (mesh.nightColors) {
            scaleRgb(mesh.nightColors, v, scale);
          }
          shaded += 1;
        }
      });
      if (shaded > 0) {
        asset.dirty = true;
        context.log(asset, 'bake-vertex-ao', `baked hemisphere AO on ${shaded} vertex(es)`);
      }
    },
  };
}

/** Deterministic golden-spiral unit directions over the +Z hemisphere (tangent-space z = up). */
function hemisphereRays(count: number): readonly [number, number, number][] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const rays: [number, number, number][] = [];
  for (let i = 0; i < count; i += 1) {
    const z = (i + 0.5) / count;
    const radius = Math.sqrt(1 - z * z);
    const angle = i * golden;
    rays.push([Math.cos(angle) * radius, Math.sin(angle) * radius, z]);
  }

  return rays;
}

function medianOf(factors: readonly Float32Array[]): number {
  const values: number[] = [];
  for (const factor of factors) {
    for (const value of factor) {
      if (value >= 0) {
        values.push(value);
      }
    }
  }
  if (values.length === 0) {
    return 0;
  }
  values.sort((a, b) => a - b);

  return values[values.length >> 1];
}

/** Per-vertex ambient factor `1 − strength·occlusion` for one mesh; `−1` marks vertices without a normal. */
function occlusionFactors(
  mesh: SubMesh,
  bvh: ReturnType<typeof buildBvh>,
  opts: Required<BakeVertexAoOptions>,
): Float32Array {
  const vertexCount = mesh.positions.length / 3;
  const factors = new Float32Array(vertexCount).fill(-1);
  const normals = mesh.normals;
  if (!normals || normals.length !== vertexCount * 3) {
    return factors;
  }
  const rays = hemisphereRays(opts.rayCount);
  for (let v = 0; v < vertexCount; v += 1) {
    const nx = normals[v * 3];
    const ny = normals[v * 3 + 1];
    const nz = normals[v * 3 + 2];
    if (nx * nx + ny * ny + nz * nz < 0.5) {
      continue; // degenerate normal
    }
    const [tx, ty, tz, bx, by, bz] = tangentBasis(nx, ny, nz);
    const origin = [
      mesh.positions[v * 3] + nx * 0.05,
      mesh.positions[v * 3 + 1] + ny * 0.05,
      mesh.positions[v * 3 + 2] + nz * 0.05,
    ];
    let occluded = 0;
    for (const [rx, ry, rz] of rays) {
      const dir = [tx * rx + bx * ry + nx * rz, ty * rx + by * ry + ny * rz, tz * rx + bz * ry + nz * rz];
      if (bvh.anyHit(origin, dir, 1e-4, opts.maxDistance)) {
        occluded += 1;
      }
    }
    factors[v] = 1 - opts.strength * (occluded / rays.length);
  }

  return factors;
}

function scaleRgb(rgba: Uint8Array, vertex: number, scale: number): void {
  for (let channel = 0; channel < 3; channel += 1) {
    const at = vertex * 4 + channel;
    rgba[at] = Math.max(0, Math.min(255, Math.round(rgba[at] * scale)));
  }
}

/** An orthonormal tangent + bitangent for the given (unit) normal. */
function tangentBasis(nx: number, ny: number, nz: number): [number, number, number, number, number, number] {
  // Pick the world axis least aligned with the normal, then Gram-Schmidt.
  const [ax, ay, az] = Math.abs(nx) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  let tx = ax - nx * (ax * nx + ay * ny + az * nz);
  let ty = ay - ny * (ax * nx + ay * ny + az * nz);
  let tz = az - nz * (ax * nx + ay * ny + az * nz);
  const length = Math.hypot(tx, ty, tz);
  tx /= length;
  ty /= length;
  tz /= length;

  return [tx, ty, tz, ny * tz - nz * ty, nz * tx - nx * tz, nx * ty - ny * tx];
}

function triangleIndices(mesh: SubMesh): Uint32Array {
  const indices = new Uint32Array(mesh.triangles.length * 3);
  mesh.triangles.forEach((triangle, i) => {
    indices[i * 3] = triangle.a;
    indices[i * 3 + 1] = triangle.b;
    indices[i * 3 + 2] = triangle.c;
  });

  return indices;
}
