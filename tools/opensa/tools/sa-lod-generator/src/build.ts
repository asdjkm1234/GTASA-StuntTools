/**
 * Programmatic entry for sa-lod-generator (used by the CLI and `perfect-map-builder`). Resolves the map's HD↔LOD
 * links and emits the drop-in build (Phase 1 clones + Phase 2 hole-fill), returning the bake counts. See
 * `docs/plans/004-node-api.md`. `finalize` mirrors the whole game tree to `outDir` (full passthrough).
 */
import { basename } from 'node:path';

import type { BuildStats } from './adapters/gta-sa/finalize';
import type { LodConfig } from './core/types';

import { createSaLodAdapter } from './adapters/gta-sa';
import { config as defaultConfig } from './lod.config';

export interface BuildSaLodsOptions {
  config?: Partial<LodConfig>;
  gameDir: string;
  outDir: string;
}

export function buildSaLods(options: BuildSaLodsOptions): BuildStats {
  const config = { ...defaultConfig, ...options.config };
  const adapter = createSaLodAdapter(basename(options.gameDir), options.gameDir, config);

  return adapter.finalize(options.outDir, adapter.resolvePairs());
}
