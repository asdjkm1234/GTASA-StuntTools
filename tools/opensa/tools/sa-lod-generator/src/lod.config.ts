import type { LodConfig } from './core/types';

/**
 * Hole-fill models are PER-GAME DATA now (plan 086 phase 5): pmb loads `<in>/lod-holes.json`
 * (stock SA's curated ~30 names live in `mods-src/original/lod-holes.json`) and passes them via
 * `config.holeFillModels`; standalone runs pass `--holes <json>`. The in-code default is empty —
 * a TC game must not inherit SA's list.
 */
const holeFillModels: string[] = [];

/**
 * Default run config. `texScale` 0.25 = quarter each side for the clone LODs (plan 006): the clones render only
 * from ≥ the HD draw distance (~300 u), where 0.25 still oversamples the screen ~2×; `encodeHalvedTxd` floors
 * small sources at 32 px so they don't turn to mush.
 */
export const config: LodConfig = {
  decimateBudget: 0.01,
  holeFillModels,
  holeLodDraw: 1500,
  keepParticles: true,
  minLodPixels: 2,
  selfContainedTxd: false,
  texScale: 0.25,
};
