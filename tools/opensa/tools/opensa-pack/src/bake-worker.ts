/**
 * Bake worker (074/14 A2): one `worker_threads` worker of the bake pool. The occluder BVH arrives ONCE as
 * SharedArrayBuffer-backed views (700 MB on full LS — never copied per worker); each message is one cell's
 * flat vertex array (transferred), answered with the flat bake results (transferred back).
 */
import { parentPort, workerData } from 'node:worker_threads';

import type { Bvh } from './bvh';

import { bakeFlat, type FlatBakeRequest } from './bake-flat';

export interface BakeWorkerTask extends FlatBakeRequest {
  id: number;
}

interface BakeWorkerData {
  bounds: SharedArrayBuffer;
  nodes: SharedArrayBuffer;
  triangleFloats: number;
  triangles: SharedArrayBuffer;
}

const shared = workerData as BakeWorkerData;
const bvh: Bvh = {
  bounds: new Float32Array(shared.bounds),
  nodes: new Int32Array(shared.nodes),
  // The occluder soup is a subarray of its build scratch — the SAB carries the exact float count.
  triangles: new Float32Array(shared.triangles, 0, shared.triangleFloats),
};

parentPort?.on('message', (task: BakeWorkerTask) => {
  const result = bakeFlat(bvh, task);
  const transfers: ArrayBuffer[] = [];
  if (result.ao) {
    transfers.push(result.ao.buffer as ArrayBuffer);
  }
  if (result.sunVis) {
    transfers.push(result.sunVis.buffer as ArrayBuffer);
  }
  parentPort?.postMessage({ id: task.id, ...result }, transfers);
});
