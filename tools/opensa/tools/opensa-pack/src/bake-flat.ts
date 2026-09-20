/**
 * Flat per-vertex bake (074/14 A2) — the worker pool's unit of work. Operates on a flat
 * `[x, y, z, nx, ny, nz] × N` WORLD-space float64 array using the exact kernels, dedup keys and LOD floors of the
 * serial bakes in ao.ts / sunvis.ts, in the same row order — pooled results are BYTE-IDENTICAL to serial
 * ones by construction (the parity unit test holds the two paths together).
 */
import type { Bvh } from './bvh';

import {
  AO_MAX_DISTANCE,
  AO_SAMPLES,
  LOD_AO_FLOOR,
  LOD_RAY_OFFSET,
  quantKey,
  RAY_OFFSET,
  sampleFan,
  skyVisibility,
} from './ao';
import { arcVisibility, buildArc, LOD_VIS_FLOOR, SUNVIS_DISC_JITTER, SUNVIS_MAX_DISTANCE } from './sunvis';

export interface FlatBakeRequest {
  ao: boolean;
  /** `[x, y, z, nx, ny, nz]` per vertex, WORLD space, serial row order. */
  data: Float64Array;
  lod: boolean;
  sunVis: boolean;
}

export interface FlatBakeResult {
  /** Per-vertex AO/skyVis (LOD floor applied) — null when not requested. */
  ao: Float64Array | null;
  aoRays: number;
  aoUnique: number;
  /** Per-vertex arc sun visibility (LOD floor applied) — null when not requested. */
  sunVis: Float64Array | null;
  sunVisRays: number;
  sunVisUnique: number;
}

const fan = sampleFan(AO_SAMPLES);
const arc = buildArc(SUNVIS_DISC_JITTER);

export function bakeFlat(bvh: Bvh, request: FlatBakeRequest): FlatBakeResult {
  const count = request.data.length / 6;
  const offset = request.lod ? LOD_RAY_OFFSET : RAY_OFFSET;
  const result: FlatBakeResult = {
    ao: request.ao ? new Float64Array(count) : null,
    aoRays: 0,
    aoUnique: 0,
    sunVis: request.sunVis ? new Float64Array(count) : null,
    sunVisRays: 0,
    sunVisUnique: 0,
  };
  // Per-cell dedup caches, same as the serial bakes (the V8 Map size cap lesson — one cell per call).
  const aoCache = new Map<string, number>();
  const sunCache = new Map<string, number>();

  for (let vertex = 0; vertex < count; vertex += 1) {
    const at = vertex * 6;
    const [wx, wy, wz, nx, ny, nz] = request.data.subarray(at, at + 6);
    const key = quantKey(wx, wy, wz, nx, ny, nz);
    if (result.ao) {
      let ao = aoCache.get(key);
      if (ao === undefined) {
        ao = skyVisibility(bvh, wx, wy, wz, nx, ny, nz, fan, AO_MAX_DISTANCE, offset);
        aoCache.set(key, ao);
        result.aoUnique += 1;
        result.aoRays += AO_SAMPLES;
      }
      result.ao[vertex] = request.lod ? Math.max(ao, LOD_AO_FLOOR) : ao;
    }
    if (result.sunVis) {
      let visibility = sunCache.get(key);
      if (visibility === undefined) {
        const scan = arcVisibility(bvh, wx, wy, wz, nx, ny, nz, arc, SUNVIS_MAX_DISTANCE, offset);
        visibility = scan.visibility;
        sunCache.set(key, visibility);
        result.sunVisUnique += 1;
        result.sunVisRays += scan.rays;
      }
      result.sunVis[vertex] = request.lod ? Math.max(visibility, LOD_VIS_FLOOR) : visibility;
    }
  }

  return result;
}
