import type { SmoothNormalsOptions } from '@opensa/tool-kit/mesh/smooth-normals';

import {
  appendSplitsF32,
  appendSplitsU8,
  rebuildSmoothNormals as rebuildCore,
  repairNormalsInPlace,
} from '@opensa/tool-kit/mesh/smooth-normals';
import { validateNormals } from '@opensa/tool-kit/mesh/validate-normals';

import type { MapPlugin } from '../core/asset';
import type { SubMesh } from '../core/ir';

/**
 * Rebuild per-vertex normals from **smooth groups** (plan 015): SA prelit world geometry ships with broken or
 * absent normals, so the engine falls back to a naive whole-mesh average — smearing walls into gradients,
 * cancelling to zero at double faces, and feeding SSAO garbage (dark edges). The smooth-group algorithm lives in
 * `tool-kit` (shared with opensa-lod-generator); this adapter maps a {@link SubMesh} into its raw positions + index
 * triples, then re-expands the result — duplicating UV/prelit/night onto each split vertex so seams survive.
 *
 * **Plan 020: meshes that SHIP normals are sanity-gated instead of blindly rebuilt** — authored normals are the
 * only place an author expressed curvature intent (surfaces smooth across >45° dihedrals). Per-vertex checks
 * (unit-ish length, winding agreement, and plan 024's `badShading` — a normal facing the GROUND markedly more
 * than its most sky-facing incident face, the mirror-side-onto-shared-vertex class winding cannot see;
 * two-sided cancellation without a shading failure = unverifiable → trusted) yield a per-mesh verdict:
 * all pass → **preserved** byte-identical; isolated failures (≤ `repairFraction`) → **point-repaired** (only the
 * failing vertices get their smooth-group normal, no splits); mass failure → full **recompute** as before.
 *
 * Result: flat walls stay flat, hard edges stay sharp, double faces get correct outward normals — no blended
 * gradients, no zero-cancel slivers. Vertex count grows at hard edges (rides the count-changing serializer).
 */

export type { SmoothNormalsOptions };

/** Plugin options: the tool-kit smooth-group knobs + whether to CREATE normals on meshes that ship none. */
export type SmoothNormalsPluginOptions = SmoothNormalsOptions & {
  /** Add normals to meshes that have none. Default **false**: stock SA world geometry is prelit + LIGHT-flagged
   *  WITHOUT normals (777 of 800 sampled geometries) — adding normals flips real SA into its dynamic vertex
   *  lighting path and shades the whole map with giant triangle-interpolated fans. OpenSA builds opt in
   *  (`addNormals` pass) — its renderer wants normals for SSAO (plan 015). */
  addWhereAbsent?: boolean;
  /** Per-model crease-angle override in degrees (plan 023A — organic statues want a higher threshold than
   *  the 45° default; `sphinx01_lvs` was the first demanded entry). Resolved by lowercased model name;
   *  `undefined` keeps `creaseAngleDeg`. */
  creaseFor?: (modelName: string) => number | undefined;
  /** Failing-vertex fraction at or below which an authored mesh is point-repaired instead of fully rebuilt.
   *  Default 0.05. Set to a negative value to force the pre-020 behaviour (always rebuild). */
  repairFraction?: number;
};

/** Aggregate counters for the run summary (plan 020) — the caller owns the object, the plugin fills it. */
export interface SmoothNormalsStats {
  createdMeshes: number;
  preservedMeshes: number;
  recomputedMeshes: number;
  repairedMeshes: number;
  repairedVertices: number;
}

type Rebuilt = Pick<
  SubMesh,
  'extraUvs' | 'nightColors' | 'normals' | 'positions' | 'prelitColors' | 'triangles' | 'uvs'
>;

const DEFAULT_REPAIR_FRACTION = 0.05;

/** One mesh's outcome through the plugin (plan 020 gate). */
type MeshOutcome =
  | { kind: 'created' | 'recomputed'; split: number }
  | { kind: 'preserved' | 'skipped' }
  | { kind: 'repaired'; vertices: number };

export function createSmoothNormals(
  options: SmoothNormalsPluginOptions = {},
  stats: SmoothNormalsStats = emptySmoothNormalsStats(),
): MapPlugin {
  return {
    name: 'smooth-normals',
    transform(asset, context): void {
      const tally = { created: 0, preserved: 0, recomputed: 0, repairedMeshes: 0, repairedVerts: 0, split: 0 };
      const crease = options.creaseFor?.(asset.name.toLowerCase());
      const meshOptions = crease === undefined ? options : { ...options, creaseAngleDeg: crease };
      for (const mesh of asset.ir.meshes) {
        const outcome = mesh.normals ? gateAuthoredMesh(mesh, meshOptions) : createWhereAbsent(mesh, meshOptions);
        if (outcome.kind === 'created' || outcome.kind === 'recomputed') {
          tally[outcome.kind === 'created' ? 'created' : 'recomputed'] += 1;
          tally.split += outcome.split;
        } else if (outcome.kind === 'repaired') {
          tally.repairedMeshes += 1;
          tally.repairedVerts += outcome.vertices;
        } else if (outcome.kind === 'preserved') {
          tally.preserved += 1;
        }
      }
      stats.createdMeshes += tally.created;
      stats.preservedMeshes += tally.preserved;
      stats.recomputedMeshes += tally.recomputed;
      stats.repairedMeshes += tally.repairedMeshes;
      stats.repairedVertices += tally.repairedVerts;
      if (tally.created + tally.repairedMeshes + tally.recomputed > 0) {
        asset.dirty = true;
        context.log(
          asset,
          'smooth-normals',
          `created ${tally.created}, preserved ${tally.preserved}, repaired ${tally.repairedVerts} vert(s) in ` +
            `${tally.repairedMeshes} mesh(es), recomputed ${tally.recomputed}, +${tally.split} split verts`,
        );
      }
    },
  };
}

export function emptySmoothNormalsStats(): SmoothNormalsStats {
  return { createdMeshes: 0, preservedMeshes: 0, recomputedMeshes: 0, repairedMeshes: 0, repairedVertices: 0 };
}

/**
 * Recompute one mesh's normals via the shared smooth-group core, re-expanding split vertices with this mesh's
 * attributes (UV / prelit / night). `null` if it has no triangles.
 */
export function rebuildSmoothNormals(mesh: SubMesh, options: SmoothNormalsOptions = {}): null | Rebuilt {
  if (mesh.triangles.length === 0) {
    return null;
  }
  const result = rebuildCore(mesh.positions, triangleIndices(mesh), options);
  if (!result) {
    return null;
  }
  const { splitSources } = result;

  return {
    extraUvs: mesh.extraUvs?.map((layer) => appendSplitsF32(layer, splitSources, 2)),
    nightColors: mesh.nightColors ? appendSplitsU8(mesh.nightColors, splitSources, 4) : null,
    normals: result.normals,
    positions: appendSplitsF32(mesh.positions, splitSources, 3),
    prelitColors: mesh.prelitColors ? appendSplitsU8(mesh.prelitColors, splitSources, 4) : null,
    triangles: mesh.triangles.map((triangle, f) => ({
      a: result.indices[f * 3],
      b: result.indices[f * 3 + 1],
      c: result.indices[f * 3 + 2],
      material: triangle.material,
    })),
    uvs: mesh.uvs ? appendSplitsF32(mesh.uvs, splitSources, 2) : null,
  };
}

/** Meshes that ship NO normals: create them only when the pass opts in (see addWhereAbsent). */
function createWhereAbsent(mesh: SubMesh, options: SmoothNormalsPluginOptions): MeshOutcome {
  if (!options.addWhereAbsent || mesh.triangles.length === 0) {
    return { kind: 'skipped' }; // real SA must not gain normals
  }
  const before = mesh.positions.length / 3;
  const rebuilt = rebuildSmoothNormals(mesh, options);
  if (!rebuilt) {
    return { kind: 'skipped' };
  }
  Object.assign(mesh, rebuilt);

  return { kind: 'created', split: rebuilt.positions.length / 3 - before };
}

/** Authored normals: sanity-gate (plan 020) — preserve / point-repair / full recompute. */
function gateAuthoredMesh(mesh: SubMesh, options: SmoothNormalsPluginOptions): MeshOutcome {
  if (mesh.triangles.length === 0 || !mesh.normals) {
    return { kind: 'preserved' };
  }
  const repairFraction = options.repairFraction ?? DEFAULT_REPAIR_FRACTION;
  const { failing, stats: verdict } = validateNormals(mesh.positions, triangleIndices(mesh), mesh.normals);
  if (failing.length === 0) {
    return { kind: 'preserved' };
  }
  if (repairFraction >= 0 && failing.length <= verdict.vertexCount * repairFraction) {
    const vertices = repairNormalsInPlace(mesh.positions, triangleIndices(mesh), mesh.normals, failing, options);

    // No repairable vertex (degenerate-only evidence) → keep as authored.
    return vertices > 0 ? { kind: 'repaired', vertices } : { kind: 'preserved' };
  }
  const before = mesh.positions.length / 3;
  const rebuilt = rebuildSmoothNormals(mesh, options);
  if (!rebuilt) {
    return { kind: 'preserved' };
  }
  Object.assign(mesh, rebuilt);

  return { kind: 'recomputed', split: rebuilt.positions.length / 3 - before };
}

function triangleIndices(mesh: SubMesh): Uint32Array {
  const indices = new Uint32Array(mesh.triangles.length * 3);
  mesh.triangles.forEach((triangle, f) => {
    indices[f * 3] = triangle.a;
    indices[f * 3 + 1] = triangle.b;
    indices[f * 3 + 2] = triangle.c;
  });

  return indices;
}
