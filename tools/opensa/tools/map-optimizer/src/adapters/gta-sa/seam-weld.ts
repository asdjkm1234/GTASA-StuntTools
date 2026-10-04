/**
 * Seam-prelit weld — the pure Phase-1 core (plan 016) + the feather band (plan 019 Phase 3). Given the
 * **uniquely-placed** map models (each with its world placement + per-geometry prelit) it finds **boundary
 * vertices that coincide in world space across two different models** and averages their prelit RGB, so the
 * hard brightness seam on a shared tile edge closes; each model's interior vertices within `featherBand` of a
 * welded vertex then get that correction faded to zero, so the tone step blends out instead of surviving right
 * next to the weld line. Returns per-model overrides keyed by **local position** (not vertex index — the
 * pipeline re-indexes/splits vertices; position is invariant), consumed by `plugins/weld-seam-prelit.ts`.
 *
 * When the prelight pass is on, the adapter feeds prelit with the day-level verdicts already applied
 * (post-level space) — the emitted absolutes must match what `apply-prelit-level` leaves behind, or the band
 * would undo the level shift.
 *
 * Pure + archive-free. Boundary detection, the world transform and the spatial grouping live in `boundary.ts`.
 */

import type { Placement, Vec3, WorldPoint } from './boundary';

import {
  boundaryVertices,
  connectedGroups,
  dot,
  neighbourIndices,
  rotateByConjugate,
  transformToWorld,
  vertexNormals,
} from './boundary';

export type { Placement };
export { transformToWorld };

/** One prelit geometry of a model (a single DFF geometry that carries prelit). */
export interface SeamGeometry {
  /** Vertex positions in model-local space, flattened xyz. */
  positions: Float32Array;
  /** Per-vertex prelit RGBA, flattened (`4 × vertexCount`). */
  prelit: Uint8Array;
  /** Triangles as vertex-index triples into `positions`. */
  triangles: readonly { a: number; b: number; c: number }[];
}

/** A uniquely-placed model: its placement + the prelit geometries to weld. */
export interface SeamModel {
  geometries: readonly SeamGeometry[];
  name: string;
  placement: Placement;
}

export interface SeamWeldOptions {
  /** Feather band width (world units, plan 019 Phase 3): vertices within this distance of a welded seam vertex
   *  get that seam's correction delta with linear falloff, so a tone step between two ground sheets blends out
   *  instead of surviving right next to the 1-vertex weld line. `0` disables. Default 10. */
  featherBand?: number;
  /** Include `lod*` models in the weld (consumed by the adapter's model selection). Default **false** — an HD tile
   *  and its far-LOD are never co-visible (streaming swaps them), so welding that pair is pointless / mildly
   *  harmful (plan 016 real-data finding). */
  includeLods?: boolean;
  /** Max luma spread (0–255) within a seam group; groups above are skipped (a level-normalisation "B" case). */
  maxLumaDelta?: number;
  /** Min cosine between two vertices' world normals to weld them (blocks an overpass edge fusing to the road
   *  below). Default cos 45°. Set ≤ −1 to disable the guard. */
  normalCosThreshold?: number;
  /** World-space coincidence tolerance (units). Vertices within this distance are candidates to weld. */
  weldEpsilon?: number;
}

export interface SeamWeldResult {
  overrides: Map<string, VertexOverride[]>;
  stats: SeamWeldStats;
}

export interface SeamWeldStats {
  /** Interior vertices corrected by the feather band (plan 019 Phase 3). */
  feathered: number;
  /** Distinct models that received at least one override. */
  modelsTouched: number;
  /** Seam groups skipped because their luma spread exceeded `maxLumaDelta`. */
  skippedSpread: number;
  /** Seam groups (≥2 distinct models) that were welded. */
  welded: number;
}

/** A prelit override for one vertex: match by local position, overwrite RGB (alpha stays). */
export interface VertexOverride {
  pos: readonly [number, number, number];
  rgb: readonly [number, number, number];
}

const DEFAULTS = { featherBand: 10, maxLumaDelta: 128, normalCosThreshold: Math.cos(Math.PI / 4), weldEpsilon: 0.05 };

/** A welded seam vertex of one model, in local space: where its feather band radiates from. */
interface SeamLinePoint {
  /** Welded RGB − the model's own RGB at the seam: the correction the band fades out. */
  delta: Vec3;
  localNormal: Vec3;
  localPos: Vec3;
}

/** One boundary vertex of one placed model, resolved into world space (a weld candidate). */
interface SeamPoint extends WorldPoint {
  localNormal: Vec3;
  localPos: Vec3;
  model: string;
  rgb: Vec3;
}

/**
 * Compute per-model prelit overrides that close cross-model seams. Only boundary vertices participate, only
 * groups spanning ≥2 distinct models are welded, and RGB is the group mean (alpha is never touched — the
 * consumer copies it verbatim).
 */
export function computeSeamOverrides(models: readonly SeamModel[], options: SeamWeldOptions = {}): SeamWeldResult {
  const weldEpsilon = options.weldEpsilon ?? DEFAULTS.weldEpsilon;
  const normalCos = options.normalCosThreshold ?? DEFAULTS.normalCosThreshold;
  const maxLumaDelta = options.maxLumaDelta ?? DEFAULTS.maxLumaDelta;
  const featherBand = options.featherBand ?? DEFAULTS.featherBand;

  const points = collectBoundaryPoints(models);
  const overrides = new Map<string, VertexOverride[]>();
  const lines = new Map<string, SeamLinePoint[]>();
  const stats: SeamWeldStats = { feathered: 0, modelsTouched: 0, skippedSpread: 0, welded: 0 };
  for (const members of connectedGroups(points, weldEpsilon, normalCos)) {
    if (!spansMultipleModels(points, members)) {
      continue; // a single model's own coincident boundary — nothing to reconcile
    }
    if (lumaSpread(points, members) > maxLumaDelta) {
      stats.skippedSpread += 1; // too different to average — a level-normalisation ("B") case
      continue;
    }
    const rgb = meanRgb(points, members);
    for (const index of members) {
      const point = points[index];
      pushOverride(overrides, point.model, { pos: point.localPos, rgb });
      pushLine(lines, point, rgb);
    }
    stats.welded += 1;
  }
  if (featherBand > 0) {
    for (const model of models) {
      const linePoints = lines.get(model.name);
      if (linePoints) {
        stats.feathered += featherModel(model, linePoints, overrides.get(model.name)!, featherBand, normalCos);
      }
    }
  }
  stats.modelsTouched = overrides.size;

  return { overrides, stats };
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/** Every boundary vertex of every model, resolved to world space (position + normal) with its prelit RGB. */
function collectBoundaryPoints(models: readonly SeamModel[]): SeamPoint[] {
  const points: SeamPoint[] = [];
  for (const model of models) {
    for (const geometry of model.geometries) {
      const vertexCount = geometry.positions.length / 3;
      if (geometry.prelit.length !== vertexCount * 4) {
        continue; // prelit count mismatch — can't trust it, skip this geometry
      }
      const normals = vertexNormals(geometry.positions, geometry.triangles);
      for (const v of boundaryVertices(geometry.triangles)) {
        const localPos: Vec3 = [
          geometry.positions[v * 3],
          geometry.positions[v * 3 + 1],
          geometry.positions[v * 3 + 2],
        ];
        const localNormal: Vec3 = [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]];
        points.push({
          localNormal,
          localPos,
          model: model.name,
          rgb: [geometry.prelit[v * 4], geometry.prelit[v * 4 + 1], geometry.prelit[v * 4 + 2]],
          world: transformToWorld(model.placement, localPos),
          worldNormal: rotateByConjugate(model.placement.rotation, localNormal),
        });
      }
    }
  }

  return points;
}

/**
 * Feather one model's seam corrections into its interior (plan 019 Phase 3): every vertex within `band` of a
 * welded seam vertex (and roughly coplanar with it — the normal guard keeps a wall off its ground seam) gets
 * the **nearest** seam vertex's correction delta, faded linearly to zero at the band edge. Emitted as absolute
 * RGB overrides appended to the model's list; seam-line positions themselves are skipped (the line already has
 * its welded value — and the consumer's position map would otherwise let the feather clobber it).
 */
function featherModel(
  model: SeamModel,
  linePoints: readonly SeamLinePoint[],
  overrides: VertexOverride[],
  band: number,
  normalCos: number,
): number {
  const grid = new Map<string, number[]>();
  for (let i = 0; i < linePoints.length; i += 1) {
    const key = linePoints[i].localPos.map((value) => Math.floor(value / band)).join(',');
    let bucket = grid.get(key);
    if (!bucket) {
      bucket = [];
      grid.set(key, bucket);
    }
    bucket.push(i);
  }
  const lineKeys = new Set(linePoints.map((point) => point.localPos.join('|')));

  let feathered = 0;
  for (const geometry of model.geometries) {
    const vertexCount = geometry.positions.length / 3;
    if (geometry.prelit.length !== vertexCount * 4) {
      continue; // same guard as the collection pass
    }
    const normals = vertexNormals(geometry.positions, geometry.triangles);
    for (let v = 0; v < vertexCount; v += 1) {
      const pos: Vec3 = [geometry.positions[v * 3], geometry.positions[v * 3 + 1], geometry.positions[v * 3 + 2]];
      if (lineKeys.has(pos.join('|'))) {
        continue; // the seam line keeps its welded value
      }
      const normal: Vec3 = [normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]];
      const nearest = nearestLinePoint(linePoints, grid, pos, normal, band, normalCos);
      if (!nearest) {
        continue;
      }
      const weight = 1 - Math.hypot(...pos.map((value, axis) => value - nearest.localPos[axis])) / band;
      overrides.push({
        pos,
        rgb: [
          clampByte(geometry.prelit[v * 4] + nearest.delta[0] * weight),
          clampByte(geometry.prelit[v * 4 + 1] + nearest.delta[1] * weight),
          clampByte(geometry.prelit[v * 4 + 2] + nearest.delta[2] * weight),
        ],
      });
      feathered += 1;
    }
  }

  return feathered;
}

function lumaSpread(points: readonly SeamPoint[], members: readonly number[]): number {
  let min = 255;
  let max = 0;
  for (const index of members) {
    const [r, g, b] = points[index].rgb;
    const luma = (r + g + b) / 3;
    min = Math.min(min, luma);
    max = Math.max(max, luma);
  }

  return max - min;
}

function meanRgb(points: readonly SeamPoint[], members: readonly number[]): Vec3 {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const index of members) {
    r += points[index].rgb[0];
    g += points[index].rgb[1];
    b += points[index].rgb[2];
  }
  const n = members.length;

  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

/** The closest seam-line point within `band` whose normal agrees with the vertex, or null. */
function nearestLinePoint(
  linePoints: readonly SeamLinePoint[],
  grid: ReadonlyMap<string, number[]>,
  pos: Vec3,
  normal: Vec3,
  band: number,
  normalCos: number,
): null | SeamLinePoint {
  let best: null | SeamLinePoint = null;
  let bestDistance = band;
  for (const index of neighbourIndices(grid, pos, band)) {
    const point = linePoints[index];
    if (dot(normal, point.localNormal) < normalCos) {
      continue;
    }
    const distance = Math.hypot(pos[0] - point.localPos[0], pos[1] - point.localPos[1], pos[2] - point.localPos[2]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }

  return best;
}

function pushLine(lines: Map<string, SeamLinePoint[]>, point: SeamPoint, welded: Vec3): void {
  const line: SeamLinePoint = {
    delta: [welded[0] - point.rgb[0], welded[1] - point.rgb[1], welded[2] - point.rgb[2]],
    localNormal: point.localNormal,
    localPos: point.localPos,
  };
  const list = lines.get(point.model);
  if (list) {
    list.push(line);
  } else {
    lines.set(point.model, [line]);
  }
}

function pushOverride(overrides: Map<string, VertexOverride[]>, model: string, override: VertexOverride): void {
  const list = overrides.get(model);
  if (list) {
    list.push(override);
  } else {
    overrides.set(model, [override]);
  }
}

function spansMultipleModels(points: readonly SeamPoint[], members: readonly number[]): boolean {
  const first = points[members[0]].model;

  return members.some((index) => points[index].model !== first);
}
