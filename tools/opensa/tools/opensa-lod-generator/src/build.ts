/**
 * Programmatic entry for opensa-lod-generator (used by the CLI and `perfect-map-builder`). Bakes every grid cell
 * into a decimated LOD and emits the drop-in build, optionally stripping the stock `lod*` layer. See
 * `docs/plans/003-node-api.md`. `finalize` mirrors the whole game tree to `outDir` (full passthrough).
 */
import { availableParallelism } from 'node:os';
import { basename, join } from 'node:path';
import { Worker } from 'node:worker_threads';

import type { BakedCell, Cell, LodConfig } from './core/types';

import { createGtaSaLodAdapter, stripOldLods } from './adapters/gta-sa';
import { readArchiveBuffers } from './adapters/gta-sa/io';
import { createStageProfiler, type ProfileSnapshot, type StageProfiler } from './core/profiling';
import { config as defaultConfig } from './lod.config';

export interface BuildOpensaLodsOptions {
  /** Grid cell size (shortcut for `config.cellSize`) — the GAME-side grid, not the render grid. */
  cellSize?: number;
  /** Overrides on top of the default {@link LodConfig}. */
  config?: Partial<LodConfig>;
  gameDir: string;
  /** lod-target models the strip must KEEP (plan 087 `lod-always.json`): a TC's stub-HD/real-LOD pattern
   *  (gostown `LODEnsemble*` forests) — stripping them deletes the only real geometry; the cell bake
   *  cannot replace it because it bakes the stub HD. Lowercased names. */
  keepLods?: readonly string[];
  outDir: string;
  /** Strip the stock `lod*` building/terrain LODs (the cell-LODs replace them). Default false. */
  stripLods?: boolean;
}

/**
 * What the bake promised about its output (plan 201/1-05): it dropped what covered fewer than
 * `screenPixels` at `hdDrawDistance`, judged on `tools/lod-common`'s view. The pack turns it into the
 * manifest's screen-error fields, so the runtime's HD/LOD rule is this bake's own threshold rather than a
 * radius somebody typed into the engine — and the promise is STATED by the tool that made it, never
 * re-read from a config file by whoever needs it.
 */
export interface OpensaLodPromise {
  hdDrawDistance: number;
  screenPixels: number;
}

export async function buildOpensaLods(options: BuildOpensaLodsOptions): Promise<OpensaLodPromise> {
  const config = { ...defaultConfig, ...options.config, ...(options.cellSize ? { cellSize: options.cellSize } : {}) };
  // Default HALF the cores: the bake saturates memory bandwidth long before core count, and cores−1
  // made the machine unusable (user feedback) for little extra throughput.
  const workers = Math.max(1, config.workers ?? Math.floor(availableParallelism() / 2));
  const profiler = createStageProfiler();
  const adapter = createGtaSaLodAdapter(basename(options.gameDir), options.gameDir, config, { profiler });
  const cells = adapter.resolveCells();
  // The per-cell merge + QEM decimate is CPU-heavy (minutes on a full map) — log progress so it doesn't look hung.
  console.log(`  opensa: baking ${cells.length} cells (${workers} worker(s))…`);
  const baked =
    workers > 1 && cells.length > 1
      ? await bakeInWorkers(cells, options.gameDir, config, workers, profiler)
      : cells.map((cell, i) => {
          const result = adapter.bakeCell(cell);
          logProgress(i + 1, cells.length);

          return result;
        });
  adapter.finalize(options.outDir, baked);
  console.log(profiler.report());
  if (options.stripLods) {
    const exclude = new Set(
      [...(config.excludeItems ?? []), ...(options.keepLods ?? [])].map((name) => name.toLowerCase()),
    );
    const { entries, instances } = stripOldLods(options.outDir, exclude);
    console.log(`  stripped old lod*: ${instances} instances, ${entries} gta3.img entries`);
  }

  return { hdDrawDistance: config.hdDrawDistance, screenPixels: config.minLodPixels };
}

/**
 * The promise this generator's config makes, WITHOUT running the bake — what a resumed pmb run needs, since
 * its `opensa-lod` dir was baked by an earlier run of the same pinned config (a resume refuses when the
 * config, the code or the sources moved).
 */
export function opensaLodPromise(overrides: Partial<LodConfig> = {}): OpensaLodPromise {
  const config = { ...defaultConfig, ...overrides };

  return opensaLodPromise(config);
}

/**
 * Bake the cells on a pool of worker threads. The archives are read ONCE into SharedArrayBuffers (no per-worker
 * gigabyte copies); each worker builds its own adapter over them and bakes one cell per message; mesh buffers
 * come back via the transfer list. Results land at their original index, so the output order (and therefore the
 * emitted build) is identical to the sequential path. Worker profiler snapshots are merged into `profiler`.
 */
function bakeInWorkers(
  cells: readonly Cell[],
  gameDir: string,
  config: LodConfig,
  workers: number,
  profiler: StageProfiler,
): Promise<BakedCell[]> {
  const buffers = readArchiveBuffers(join(gameDir, 'models'));
  const baked: BakedCell[] = new Array<BakedCell>(cells.length);
  let next = 0;
  let done = 0;

  return new Promise((resolvePool, rejectPool) => {
    let settled = false;
    let alive = 0;
    const fail = (error: unknown): void => {
      if (!settled) {
        settled = true;
        rejectPool(error instanceof Error ? error : new Error(String(error)));
      }
    };

    for (let w = 0; w < Math.min(workers, cells.length); w += 1) {
      const worker = new Worker(new URL('./adapters/gta-sa/bake-worker.ts', import.meta.url), {
        execArgv: ['--import', 'tsx'],
        workerData: { buffers, config, game: basename(gameDir), gameDir },
      });
      alive += 1;
      const dispatch = (): void => {
        if (next < cells.length) {
          worker.postMessage({ cell: cells[next], index: next, type: 'bake' });
          next += 1;
        } else {
          worker.postMessage({ type: 'shutdown' });
        }
      };
      worker.on(
        'message',
        (
          message: { baked: BakedCell; index: number; type: 'baked' } | { snapshot: ProfileSnapshot; type: 'profile' },
        ) => {
          if (message.type === 'profile') {
            profiler.merge(message.snapshot);
            void worker.terminate();

            return;
          }
          baked[message.index] = message.baked;
          done += 1;
          logProgress(done, cells.length);
          dispatch();
        },
      );
      worker.on('error', fail);
      worker.on('exit', () => {
        alive -= 1;
        if (alive === 0 && !settled) {
          settled = true;
          if (done === cells.length) {
            resolvePool(baked);
          } else {
            rejectPool(new Error(`workers exited after ${done}/${cells.length} cells`));
          }
        }
      });
      dispatch();
    }
  });
}

function logProgress(done: number, total: number): void {
  if (done % 25 === 0 || done === total) {
    console.log(`  baked ${done}/${total} cells`);
  }
}
