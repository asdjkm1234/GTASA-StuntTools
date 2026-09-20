import { openArchive } from '@opensa/renderware/archive/img-archive';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** An opened IMG archive (engine reader), shared by the IPL scan and the model source. */
export type Archive = ReturnType<typeof openArchive>;

/** Open every `.img` archive under a game's `models/` folder (read-only reuse of the engine reader). */
export function openArchives(modelsDir: string): Archive[] {
  return readdirSync(modelsDir)
    .filter((file) => file.toLowerCase().endsWith('.img'))
    .map((file) => openArchive(new Uint8Array(readFileSync(join(modelsDir, file)))));
}

/** Open archives over shared buffers (the worker-side counterpart of {@link readArchiveBuffers}). */
export function openArchivesFromBuffers(buffers: readonly SharedArrayBuffer[]): Archive[] {
  return buffers.map((shared) => openArchive(new Uint8Array(shared)));
}

/** Read every `.img` into a **SharedArrayBuffer** — one copy of the ~GB archives shared by all bake workers. */
export function readArchiveBuffers(modelsDir: string): SharedArrayBuffer[] {
  return readdirSync(modelsDir)
    .filter((file) => file.toLowerCase().endsWith('.img'))
    .map((file) => {
      const bytes = readFileSync(join(modelsDir, file));
      const shared = new SharedArrayBuffer(bytes.length);
      new Uint8Array(shared).set(bytes);

      return shared;
    });
}
