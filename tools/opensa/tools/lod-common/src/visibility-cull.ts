import { buildBvh } from '@opensa/tool-kit/mesh/bvh';

import type { LodContext, LodModifier } from './hd-to-lod';
import type { MergedGroup, MergedMesh } from './mesh';

import { compactMeshVertices } from './compact';
import { createOpaqueCoverage } from './opaque-coverage';
import { unitsPerPixel } from './view';

/**
 * Sampled visibility cull (plan 003, Phase 2 / Track 2): a face survives iff **some reachable camera sees some
 * sample of it**. Cameras form a deterministic ring at the view's closest LOD distance (azimuths × heights above
 * the mesh's own ground, plus one top-down view); each face is sampled at its centroid (+ area-proportional extra
 * points) and a sample-to-camera **any-hit** ray against the mesh itself (self-occlusion only — neighbour
 * occluders are a later, riskier win) decides the answer. Per-side results drive the output:
 *
 * - seen from **neither** side → dropped (unless `dilate` keeps it as a one-ring safety margin);
 * - seen from the **front** (winding side) only → kept single-sided (`twoSided` 0) — the big index win;
 * - seen from the **back** only, or from **both** → kept two-sided (`twoSided` 1). Back-only faces are NOT
 *   flipped: a "back visible" verdict can be an artifact of rays escaping under non-watertight terrain to a
 *   ring camera below the local ground, and a wrong flip is an invisible face — a hole (the ground-wedge
 *   artifact next to buildings). Two-sided is the safe answer for anything not provably front-visible.
 *
 * Ground-facing faces near terrain die naturally (every camera is above / occluded); bridge and overpass
 * undersides survive because the low ring cameras see them — the difference the pure "normal points down"
 * heuristic can't tell. Deterministic throughout (no RNG). Needs `ctx.view`; without it the mesh is returned
 * unchanged.
 */
export interface VisibilityCullOptions {
  /** Camera ring azimuth count (default 16). */
  azimuthSteps?: number;
  /** Camera heights above the mesh's lowest vertex (default [2, 60, 250, 500] — ground to flight ceiling). */
  cameraHeights?: readonly number[];
  /** Keep invisible faces that share a (position-welded) vertex with a visible face (default true). */
  dilate?: boolean;
  /** Max visibility samples per face — centroid + extras on large faces (default 4). */
  maxSamplesPerFace?: number;
  /**
   * Groups whose texture opaque coverage is below this do NOT occlude visibility rays (default 0.5) — you can
   * see a wall **through** the chain-link fence / ivy in front of it, so treating those quads as solid blocked
   * every front ray and flipped/culled the wall behind (the LA-river sawtooth artifact). Such groups are still
   * *subjects* of the visibility test — they just stop blocking others. Needs `ctx.textures`; without it every
   * group occludes (previous behaviour).
   */
  minOccluderCoverage?: number;
  /**
   * `'cull'` (default) drops faces no camera sees; `'orient'` never drops anything — unseen faces are kept
   * two-sided, seen faces still get oriented + masked. Orient mode makes holes impossible by construction
   * (useful when the LOD is also inspected outside the ≥minDistance contract, e.g. Show-LODs up close) at the
   * cost of keeping the ~5 % invisible faces.
   */
  mode?: 'cull' | 'orient';
}

/** Extra-sample barycentric coordinates (deterministic spread toward each corner). */
const EXTRA_BARY: readonly (readonly [number, number, number])[] = [
  [0.6, 0.2, 0.2],
  [0.2, 0.6, 0.2],
  [0.2, 0.2, 0.6],
];

/** Ray origins are lifted this far off the face so the ray doesn't hit its own triangle. */
const SURFACE_OFFSET = 0.05;

/** Vertex weld tolerance for the dilation adjacency (world units). */
const WELD = 0.01;

export function createVisibilityCull(options: VisibilityCullOptions = {}): LodModifier {
  const azimuthSteps = options.azimuthSteps ?? 16;
  const cameraHeights = options.cameraHeights ?? [2, 60, 250, 500];
  const dilate = options.dilate ?? true;
  const maxSamplesPerFace = options.maxSamplesPerFace ?? 4;
  const minOccluderCoverage = options.minOccluderCoverage ?? 0.5;
  const mode = options.mode ?? 'cull';

  return (mesh: MergedMesh, ctx: LodContext): MergedMesh => {
    if (!ctx.view) {
      return mesh;
    }
    const faceCount = mesh.groups.reduce((sum, group) => sum + group.indices.length / 3, 0);
    if (faceCount === 0) {
      return mesh;
    }

    const flat = flattenFaces(mesh, faceCount);
    const bvh = buildOccluderBvh(mesh, ctx, minOccluderCoverage);
    const cameras = buildCameras(mesh.positions, ctx.view.minDistance, azimuthSteps, cameraHeights);
    // Faces bigger than a handful of pixels at the closest LOD distance get extra samples, so a partially
    // occluded large face isn't killed by an unlucky centroid.
    const extraSampleArea = (4 * unitsPerPixel(ctx.view, ctx.view.minDistance)) ** 2;

    // Per face: bit 1 = front visible, bit 2 = back visible.
    const seen = new Uint8Array(faceCount);
    const p = mesh.positions;
    for (let f = 0; f < faceCount; f += 1) {
      const a = flat.indices[f * 3] * 3;
      const b = flat.indices[f * 3 + 1] * 3;
      const c = flat.indices[f * 3 + 2] * 3;
      const nx = (p[b + 1] - p[a + 1]) * (p[c + 2] - p[a + 2]) - (p[b + 2] - p[a + 2]) * (p[c + 1] - p[a + 1]);
      const ny = (p[b + 2] - p[a + 2]) * (p[c] - p[a]) - (p[b] - p[a]) * (p[c + 2] - p[a + 2]);
      const nz = (p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[b + 1] - p[a + 1]) * (p[c] - p[a]);
      const area2 = Math.hypot(nx, ny, nz);
      if (area2 < 1e-12) {
        continue; // degenerate — the Phase-1 modifier already drops these; stay invisible here
      }
      const inv = 1 / area2;
      const normal: [number, number, number] = [nx * inv, ny * inv, nz * inv];
      const samples = faceSamples(p, flat.indices, f, area2 / 2, extraSampleArea, maxSamplesPerFace);
      for (const side of [1, -1] as const) {
        const bit = side === 1 ? 1 : 2;
        if (sideVisible(bvh, cameras, samples, normal, side)) {
          seen[f] |= bit;
        }
      }
    }

    if (mode === 'orient') {
      // Never drop: an unseen face keeps its winding and renders two-sided (orientation unknown).
      for (let f = 0; f < seen.length; f += 1) {
        if (seen[f] === 0) {
          seen[f] = 3;
        }
      }
    } else if (dilate) {
      dilateOneRing(mesh.positions, flat.indices, seen);
    }

    return compactMeshVertices(rebuildGroups(mesh, flat, seen));
  };
}

/** The deterministic camera set: a ring at `minDistance` from the bbox centre × heights above the mesh's lowest
 *  vertex, plus a 3×3 grid of straight-down cameras across the bbox. */
function buildCameras(
  positions: Float32Array,
  minDistance: number,
  azimuthSteps: number,
  heights: readonly number[],
): number[][] {
  let [minX, minY, minZ] = [Infinity, Infinity, Infinity];
  let [maxX, maxY, maxZ] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]);
    maxX = Math.max(maxX, positions[i]);
    minY = Math.min(minY, positions[i + 1]);
    maxY = Math.max(maxY, positions[i + 1]);
    minZ = Math.min(minZ, positions[i + 2]);
    maxZ = Math.max(maxZ, positions[i + 2]);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const cameras: number[][] = [];
  for (const height of heights) {
    for (let a = 0; a < azimuthSteps; a += 1) {
      const angle = (2 * Math.PI * a) / azimuthSteps;
      cameras.push([cx + minDistance * Math.cos(angle), cy + minDistance * Math.sin(angle), minZ + height]);
    }
  }
  // A 3×3 grid of straight-down cameras (fly / map-viewer views come from anywhere overhead): a single central
  // one misses ground pockets between tall buildings — walls occlude it at grazing angles → wrongly culled floor.
  for (const fy of [0.17, 0.5, 0.83]) {
    for (const fx of [0.17, 0.5, 0.83]) {
      cameras.push([minX + (maxX - minX) * fx, minY + (maxY - minY) * fy, maxZ + minDistance]);
    }
  }

  return cameras;
}

/** The occluder BVH excludes see-through groups (fences/ivy/grates) — see `minOccluderCoverage`. */
function buildOccluderBvh(mesh: MergedMesh, ctx: LodContext, minOccluderCoverage: number): ReturnType<typeof buildBvh> {
  const coverage = createOpaqueCoverage(ctx.textures);
  const solid = mesh.groups.filter((group) => coverage(group.texture) >= minOccluderCoverage);
  const occluderIndices = new Uint32Array(solid.reduce((sum, group) => sum + group.indices.length, 0));
  let at = 0;
  for (const group of solid) {
    occluderIndices.set(group.indices, at);
    at += group.indices.length;
  }

  return buildBvh([{ indices: occluderIndices, positions: mesh.positions }]);
}

/** Keep (mark seen-front) every invisible face sharing a welded vertex with a visible one — a safety margin
 *  against sampling misses. Marked faces keep their winding and are encoded two-sided (orientation unknown). */
function dilateOneRing(positions: Float32Array, indices: Uint32Array, seen: Uint8Array): void {
  const key = (v: number): string =>
    `${Math.round(positions[v * 3] / WELD)},${Math.round(positions[v * 3 + 1] / WELD)},${Math.round(positions[v * 3 + 2] / WELD)}`;
  const visibleVerts = new Set<string>();
  for (let f = 0; f < seen.length; f += 1) {
    if (seen[f] !== 0) {
      for (let c = 0; c < 3; c += 1) {
        visibleVerts.add(key(indices[f * 3 + c]));
      }
    }
  }
  for (let f = 0; f < seen.length; f += 1) {
    if (seen[f] === 0) {
      for (let c = 0; c < 3; c += 1) {
        if (visibleVerts.has(key(indices[f * 3 + c]))) {
          seen[f] = 3; // orientation unknown → both sides, encoder doubles it
          break;
        }
      }
    }
  }
}

/** Centroid + up to `max - 1` extra points on faces larger than `extraArea`. */
function faceSamples(
  positions: Float32Array,
  indices: Uint32Array,
  face: number,
  area: number,
  extraArea: number,
  max: number,
): number[][] {
  const a = indices[face * 3] * 3;
  const b = indices[face * 3 + 1] * 3;
  const c = indices[face * 3 + 2] * 3;
  const at = (wa: number, wb: number, wc: number): number[] => [
    wa * positions[a] + wb * positions[b] + wc * positions[c],
    wa * positions[a + 1] + wb * positions[b + 1] + wc * positions[c + 1],
    wa * positions[a + 2] + wb * positions[b + 2] + wc * positions[c + 2],
  ];
  const samples = [at(1 / 3, 1 / 3, 1 / 3)];
  if (area > extraArea) {
    for (const [wa, wb, wc] of EXTRA_BARY.slice(0, Math.max(0, max - 1))) {
      samples.push(at(wa, wb, wc));
    }
  }

  return samples;
}

/** Flatten the per-texture groups into one face stream, remembering each face's group. */
function flattenFaces(mesh: MergedMesh, faceCount: number): { faceGroup: Int32Array; indices: Uint32Array } {
  const indices = new Uint32Array(faceCount * 3);
  const faceGroup = new Int32Array(faceCount);
  let f = 0;
  mesh.groups.forEach((group, g) => {
    for (let i = 0; i < group.indices.length; i += 3, f += 1) {
      indices[f * 3] = group.indices[i];
      indices[f * 3 + 1] = group.indices[i + 1];
      indices[f * 3 + 2] = group.indices[i + 2];
      faceGroup[f] = g;
    }
  });

  return { faceGroup, indices };
}

/** Rebuild the per-texture groups from the visibility verdicts: drop unseen, keep front-only faces single-sided,
 *  and keep back-only / both-sides faces two-sided. **Never flip a winding** — a "back visible" verdict can be an
 *  artifact of rays escaping under non-watertight terrain to a ring camera below the local ground, and a wrong
 *  flip is an invisible face, i.e. a hole (the ground-wedge artifact beside buildings). */
function rebuildGroups(
  mesh: MergedMesh,
  flat: { faceGroup: Int32Array; indices: Uint32Array },
  seen: Uint8Array,
): MergedMesh {
  const buckets = mesh.groups.map(() => ({ indices: [] as number[], mask: [] as number[] }));
  for (let f = 0; f < seen.length; f += 1) {
    const verdict = seen[f];
    if (verdict === 0) {
      continue;
    }
    const bucket = buckets[flat.faceGroup[f]];
    bucket.indices.push(flat.indices[f * 3], flat.indices[f * 3 + 1], flat.indices[f * 3 + 2]);
    bucket.mask.push(verdict === 1 ? 0 : 1);
  }

  const groups: MergedGroup[] = [];
  buckets.forEach((bucket, g) => {
    if (bucket.indices.length > 0) {
      groups.push({
        indices: Uint32Array.from(bucket.indices),
        texture: mesh.groups[g].texture,
        twoSided: Uint8Array.from(bucket.mask),
        ...(mesh.groups[g].color ? { color: mesh.groups[g].color } : {}),
      });
    }
  });

  return { ...mesh, groups };
}

/** True when any camera on this side of the face sees any sample (any-hit ray, early exit on first success). */
function sideVisible(
  bvh: ReturnType<typeof buildBvh>,
  cameras: readonly number[][],
  samples: readonly number[][],
  normal: readonly [number, number, number],
  side: -1 | 1,
): boolean {
  const [nx, ny, nz] = [normal[0] * side, normal[1] * side, normal[2] * side];
  for (const sample of samples) {
    const origin = [sample[0] + nx * SURFACE_OFFSET, sample[1] + ny * SURFACE_OFFSET, sample[2] + nz * SURFACE_OFFSET];
    for (const camera of cameras) {
      const dx = camera[0] - origin[0];
      const dy = camera[1] - origin[1];
      const dz = camera[2] - origin[2];
      if (dx * nx + dy * ny + dz * nz <= 0) {
        continue; // camera behind this side of the face plane
      }
      if (!bvh.anyHit(origin, [dx, dy, dz], 1e-4, 1)) {
        return true;
      }
    }
  }

  return false;
}
