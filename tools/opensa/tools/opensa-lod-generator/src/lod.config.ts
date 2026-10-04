import type { LodConfig } from './core/types';

/**
 * Default run config. `cellSize` MUST equal the engine's streaming grid (opensa-pack `CELL_SIZE`, 250) —
 * plan 002's original invariant ("one baked LOD = one engine cell"; the 256 of the three era WAS that
 * era's streaming grid). Both sides bucket by `floor(pivot / cellSize)`, so equal sizes put an object's
 * HD and LOD in the SAME slot and the HD↔LOD swap is atomic by construction. A mismatched bake splits
 * them across slots — field-proven on gostown (plan 087, 2026-07-23): the paradise-bridge main span had
 * HD in slot 5,−7 and LOD in 5,−6, so at spawn NEITHER level loaded; a water-shore hole at (1514,−1498)
 * showed the same split on plain terrain. NOT the game grid: collision streaming / procobj scatter keep
 * their own `GAME_CELL_SIZE` (256).
 */
export const config: LodConfig = {
  cellSize: 250,
  decimateBudget: 0.01,
  // Engine streaming HD ring (apps/web canvas-host Config.streaming.hdDrawDistance) — the closest a LOD is seen.
  hdDrawDistance: 300,
  hiddenFaces: 'cull',
  lodDrawDistance: 1500,
  lodTextureSize: 64,
  mergeCoplanar: true,
  minLodPixels: 2,
  // 0.05, not 0.15: the Phase-4 harness measured 0.15 deleting whole visible objects (8.6% pixel diff — e.g. a
  // lone fence instance vanishing entirely); at 0.05 the cull is visually free (0.07%) and still kills wire mesh.
  minOpaqueCoverage: 0.05,
};
