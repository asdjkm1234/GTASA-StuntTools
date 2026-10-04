import type { WeldedCell } from '@opensa/cell-weld/weld';

import { WELD_AO, WELD_ROW, WELD_SUNSOFT, WELD_SUNVIS } from '@opensa/cell-weld/weld';
/**
 * Bake worker pool (074/14 A2): the 074/07 bakes are ~90 % of convert wall-time and perfectly per-cell
 * parallel. The district BVH is copied ONCE into SharedArrayBuffers; each worker bakes whole cells (flat
 * vertex arrays in, flat results out — see bake-flat.ts, whose parity test pins pooled ≡ serial). Cells are
 * extracted LAZILY (only while a worker is free) so at most `workers` flat arrays are in flight.
 */
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import type { BakeAoReport } from './ao';
import type { Bvh } from './bvh';
import type { BakeSunVisReport } from './sunvis';

import { type FlatBakeResult } from './bake-flat';
import { SUNSOFT_FILL } from './sunvis';

export interface PooledBakeOptions {
  ao: boolean;
  sunVis: boolean;
  /** Worker count; callers default it to `defaultBakeWorkers()`. */
  workers: number;
}

/** Run both bakes over all cells on the pool. Mutates scratch rows exactly like the serial bakes. */
export async function bakeCellsPooled(
  cells: WeldedCell[],
  bvh: Bvh,
  options: PooledBakeOptions,
): Promise<{ ao: BakeAoReport | null; sunVis: BakeSunVisReport | null }> {
  const aoReport: BakeAoReport = { rays: 0, triangles: bvh.triangles.length / 9, uniqueVertices: 0, vertices: 0 };
  const sunReport: BakeSunVisReport = { rays: 0, uniqueVertices: 0, vertices: 0 };

  // Big cells first — the tail of a convert should not wait on one 600 k-vert downtown cell.
  const order = [...cells].sort((a, b) => cellRows(b) - cellRows(a));

  const workerData = {
    bounds: toShared(bvh.bounds),
    nodes: toShared(bvh.nodes),
    triangleFloats: bvh.triangles.length,
    triangles: toShared(bvh.triangles),
  };
  const workerPath = fileURLToPath(new URL('./bake-worker.ts', import.meta.url));
  const workerCount = Math.max(1, Math.min(options.workers, order.length));
  const workers = Array.from({ length: workerCount }, () => new Worker(workerPath, { workerData }));

  let nextCell = 0;
  try {
    await Promise.all(
      workers.map(async (worker) => {
        for (;;) {
          const cell = order[nextCell];
          nextCell += 1;
          if (!cell) {
            return;
          }
          const data = extractRows(cell);
          const result = await bakeOn(worker, { ao: options.ao, data, lod: cell.lod, sunVis: options.sunVis });
          writeBack(cell, result);
          aoReport.vertices += result.ao ? result.ao.length : 0;
          aoReport.uniqueVertices += result.aoUnique;
          aoReport.rays += result.aoRays;
          sunReport.vertices += result.sunVis ? result.sunVis.length : 0;
          sunReport.uniqueVertices += result.sunVisUnique;
          sunReport.rays += result.sunVisRays;
        }
      }),
    );
  } finally {
    await Promise.all(workers.map((worker) => worker.terminate()));
  }

  return { ao: options.ao ? aoReport : null, sunVis: options.sunVis ? sunReport : null };
}

/** A QUARTER of the machine's cores (user decision 2026-07-13): converts run on the dev machine alongside
 *  the browser/lab, and even half the cores makes it struggle (thermals). `--bake-workers N` overrides. */
export function defaultBakeWorkers(): number {
  return Math.max(1, Math.floor(availableParallelism() / 4));
}

function bakeOn(
  worker: Worker,
  task: { ao: boolean; data: Float64Array; lod: boolean; sunVis: boolean },
): Promise<FlatBakeResult> {
  return new Promise((resolve, reject) => {
    const onMessage = (result: FlatBakeResult & { id: number }): void => {
      cleanup();
      resolve(result);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    // A native crash or OS OOM-kill of the worker thread emits NO 'error' event, only 'exit'. Without this
    // the in-flight promise never settles and `Promise.all` hangs the whole pack forever (the district BVH is
    // ~700 MB on full LS — an OOM-kill is a real outcome). This handler is armed only while a task is in
    // flight, so the clean `terminate()` in the finally never reaches it.
    const onExit = (code: number): void => {
      cleanup();
      reject(new Error(`bake worker exited (code ${code}) before returning a result — likely OOM-killed`));
    };
    const cleanup = (): void => {
      worker.off('message', onMessage);
      worker.off('error', onError);
      worker.off('exit', onExit);
    };
    worker.on('message', onMessage);
    worker.on('error', onError);
    worker.on('exit', onExit);
    worker.postMessage({ id: 0, ...task }, [task.data.buffer as ArrayBuffer]);
  });
}

function cellRows(cell: WeldedCell): number {
  let rows = 0;
  for (const bucket of cell.buckets) {
    rows += bucket.vertices.length / WELD_ROW;
  }

  return rows;
}

/** Flat `[x,y,z,nx,ny,nz] × N` WORLD-space float64 array in the serial bakes' row order (f64 transport —
 *  scratch rows are plain numbers; an f32 hop would break bit-parity with the serial path). */
function extractRows(cell: WeldedCell): Float64Array {
  const data = new Float64Array(cellRows(cell) * 6);
  let at = 0;
  for (const bucket of cell.buckets) {
    const rows = bucket.vertices;
    for (let row = 0; row < rows.length; row += WELD_ROW) {
      data[at] = rows[row] + cell.origin[0];
      data[at + 1] = rows[row + 1] + cell.origin[1];
      data[at + 2] = rows[row + 2] + cell.origin[2];
      data[at + 3] = rows[row + 3];
      data[at + 4] = rows[row + 4];
      data[at + 5] = rows[row + 5];
      at += 6;
    }
  }

  return data;
}

function toShared(view: Float32Array | Int32Array): SharedArrayBuffer {
  const shared = new SharedArrayBuffer(view.byteLength);
  if (view instanceof Float32Array) {
    new Float32Array(shared).set(view);
  } else {
    new Int32Array(shared).set(view);
  }

  return shared;
}

function writeBack(cell: WeldedCell, result: FlatBakeResult): void {
  let vertex = 0;
  for (const bucket of cell.buckets) {
    const rows = bucket.vertices;
    for (let row = 0; row < rows.length; row += WELD_ROW) {
      if (result.ao) {
        rows[row + WELD_AO] = result.ao[vertex];
      }
      if (result.sunVis) {
        rows[row + WELD_SUNVIS] = result.sunVis[vertex];
        rows[row + WELD_SUNSOFT] = SUNSOFT_FILL;
      }
      vertex += 1;
    }
  }
  if (result.ao) {
    cell.hasAo = true;
  }
  if (result.sunVis) {
    cell.hasSunVis = true;
  }
}
