import { parentPort, workerData } from 'node:worker_threads';

import type { BakedCell, Cell, LodConfig } from '../../core/types';

import { createStageProfiler } from '../../core/profiling';
import { createGtaSaLodAdapter } from './index';
import { openArchivesFromBuffers } from './io';

/**
 * Cell-bake worker thread (the parallel path of `buildOpensaLods`): opens the game archives over the
 * **SharedArrayBuffers** the main thread read once (no per-worker gigabyte copies), builds a normal adapter,
 * and bakes one cell per `bake` message. Mesh buffers are moved back via the transfer list (zero-copy).
 * On `shutdown` it posts its profiler snapshot so the main thread can print one merged stage table.
 */
interface WorkerInit {
  buffers: SharedArrayBuffer[];
  config: LodConfig;
  game: string;
  gameDir: string;
}

type WorkerRequest = { cell: Cell; index: number; type: 'bake' } | { type: 'shutdown' };

const { buffers, config, game, gameDir } = workerData as WorkerInit;
const profiler = createStageProfiler();
const adapter = createGtaSaLodAdapter(game, gameDir, config, {
  archives: openArchivesFromBuffers(buffers),
  profiler,
});
const port = parentPort!;

port.on('message', (request: WorkerRequest) => {
  if (request.type === 'shutdown') {
    port.postMessage({ snapshot: profiler.serialize(), type: 'profile' });
    port.close();

    return;
  }
  const baked = adapter.bakeCell(request.cell);
  port.postMessage({ baked, index: request.index, type: 'baked' }, transferListOf(baked));
});

/** Every distinct ArrayBuffer inside a baked cell — moved to the main thread instead of copied. */
function transferListOf(baked: BakedCell): ArrayBuffer[] {
  const buffersOut = new Set<ArrayBuffer>();
  const add = (view: ArrayBufferView | undefined): void => {
    if (view && view.buffer instanceof ArrayBuffer) {
      buffersOut.add(view.buffer);
    }
  };
  add(baked.mesh.positions);
  add(baked.mesh.normals);
  add(baked.mesh.uvs);
  add(baked.mesh.colors);
  add(baked.mesh.nightColors);
  for (const group of baked.mesh.groups) {
    add(group.indices);
    add(group.twoSided);
  }
  add(baked.effects);

  return [...buffersOut];
}
