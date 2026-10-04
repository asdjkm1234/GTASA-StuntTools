/**
 * The sea. Los Santos is a coastal city, and a dispatch map without water reads as a hole in the world rather
 * than as a shoreline — an operator has to be able to tell "no data here" from "this is the ocean".
 *
 * The baked `water.bin` rides next to the pak (stride-20 vertices: x, y, z, depth, class). Ripple and foam
 * textures live in `models/particle.txd`, which this app does not ingest; the engine substitutes 1×1 stubs, so
 * the surface reads as the flat timecyc water tint — which is all a map needs it for.
 */
import type { Engine } from '@opensa/engine';

import { pakTraffic } from '@opensa/engine';

/** Floats per baked water vertex: position, shore depth, water class. */
const WATER_STRIDE_FLOATS = 5;

/**
 * Read the baked sea off the network. No engine, on purpose: this runs BESIDE `engine.init` (201/4-03), so
 * the 2.66 MB it costs are spent under the GPU's own wait instead of queued behind it — measured 2026-08-26,
 * where it was the largest single read left on the boot's serial path and the one request of a repeat open
 * the pak's slice cache never answers. `null` when the pak carries no water or the file is not there; the
 * sea is simply absent, and the map still draws.
 */
export async function fetchWater(
  base: string,
  water: undefined | { file: string; indexCount: number; vertexCount: number },
): Promise<null | Uint8Array> {
  if (!water) {
    return null;
  }
  const url = `${base}/${water.file}`;
  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  // The one pak read that does NOT go through the IO worker: `water.bin` rides beside the pak as a loose
  // file, so it is recorded here or it is missing from the bytes column entirely.
  pakTraffic.record(water.file, bytes.byteLength);
  // And because it is loose, the pak's slice cache never sees it, so what a repeat open pays for it was
  // arguable. Resource Timing is not: `transferSize` is 0 when the HTTP cache served it outright, a few
  // hundred bytes for a 304 revalidation, and the full body otherwise. An entry it cannot produce counts as
  // a miss rather than a hit — an unknown transfer must never be reported as a saving.
  if (transferredBytes(url) === 0) {
    pakTraffic.recordCacheHit(bytes.byteLength);
  }

  return bytes;
}

/** Install the baked sea from bytes already read. Returns the triangle count, or 0 when there is none. */
export function installWater(engine: Engine, bytes: null | Uint8Array): number {
  if (!bytes) {
    return 0;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vertexCount = view.getUint32(0, true);
  const indexCount = view.getUint32(4, true);
  const gta = new Float32Array(bytes.buffer, bytes.byteOffset + 8, vertexCount * WATER_STRIDE_FLOATS);
  const indices = new Uint32Array(bytes.buffer.slice(bytes.byteOffset + 8 + vertexCount * 20), 0, indexCount);
  engine.setWater(engineWaterVertices(gta), indices, null, null);

  return indices.length / 3;
}

/** GTA Z-up → engine Y-up; the shore field and the water class ride along untouched. */
function engineWaterVertices(gta: Float32Array): Float32Array {
  const vertices = new Float32Array(gta.length);
  for (let v = 0; v < gta.length; v += WATER_STRIDE_FLOATS) {
    vertices[v] = gta[v];
    vertices[v + 1] = gta[v + 2];
    vertices[v + 2] = -gta[v + 1];
    vertices[v + 3] = gta[v + 3];
    vertices[v + 4] = gta[v + 4];
  }

  return vertices;
}

/**
 * What the network carried for `url`, or `undefined` where Resource Timing cannot say — no `performance`
 * entries (a test host), or a timeline that no longer holds this request. Undefined is NOT zero: an unknown
 * transfer must not be reported as a cache hit.
 */
function transferredBytes(url: string): number | undefined {
  const rows: PerformanceResourceTiming[] = (globalThis.performance?.getEntriesByType?.('resource') ??
    []) as PerformanceResourceTiming[];
  const mine = rows.filter((row) => row.name.endsWith(url));

  return mine.length === 0 ? undefined : mine[mine.length - 1].transferSize;
}
