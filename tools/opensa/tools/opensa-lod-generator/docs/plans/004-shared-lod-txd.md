# 004 — One shared TXD for all cell LODs

**Status: ✅ Implemented (measured below). Revised 2026-07-05 by lod-common plan 004: texture names in the
shared TXD are now SCOPED per source TXD (`<txd>_<name>`) — the original bare-name packing collapsed
same-named different-pixel variants to a random winner.** Replace the 563 per-cell TXDs with **one shared `lods.txd`** holding every unique LOD
texture once. Kills a measured **5.5× texture duplication** in `lods.img` and, more importantly, 5.5× duplicate
decoded/GPU textures at LOD range.

## Measured motivation (2026-07-02, game-src/original)

- 563 cells reference **31,981 texture entries** across their per-cell TXDs, but only **5,805 unique names**
  map-wide → duplication **5.5×** (median 35 textures/cell, max 258).
- At `lodTextureSize` 64 (DXT + mips ≈ ~4 KB each): per-cell payload ≈ **~128 MB** → shared ≈ **~23 MB**.
- Runtime: the engine decodes and uploads each cell TXD's copies separately today — a shared TXD means one
  decoded texture and one GPU texture per name for the whole LOD layer.

## Why a shared TXD and not `txdp` here

The engine supports `txdp` fully (`parseTxdParents` → `MapDefinitions.txdParents` → `asset-cache`
`resolveTxdChain`), but for cells the **degenerate case is strictly simpler**: every cell def can point its IDE
`txd` column at the same `lods` dictionary — no parent chain, no 563 child TXDs, no txdp section. This is
behaviour-preserving because per-cell TXDs are ALREADY name-flattened globally: `createTextureSource` indexes
all source TXDs **by name, first wins**, so two cells naming the same texture already receive identical pixels.
`txdp` stays the right tool for sa-lod-generator (see its plan 006), and returns here only if per-cell
**overrides** ever appear (e.g. baked per-cell atlases — then: shared parent + tiny child per cell).

## Design

- `finalize.ts`: collect the union of every baked cell's texture names (the existing `cellTextures` per cell),
  encode ONE `lods.txd` via `encodeLodTxd(unionNames, source, lodTextureSize)`; stop emitting per-cell TXDs.
- `ideObjsLine`: the `txd` column becomes the shared name (`lods`) instead of the cell model name.
- The engine needs no change: model-key = `model|txd` stays unique per cell model; `getTextures('lods')` is
  cached once and shared.
- `lodTextureSize` stays 64 (this plan changes packaging, not resolution).

## Phases

- **Phase 1 — shared TXD emit + def retarget.** Tests: build writes exactly one TXD; IDE lines reference it;
  union contains each cell texture.
- **Phase 2 — measure + verify.** `lods.img` size before/after; in-game spot-check (textures identical by
  construction — the harness is winding/geometry-level and unaffected).

## Measurements

**After Phase 1 (2026-07-02, game-src/original):** the shared `lods.txd` is **16.0 MB** (5,805 unique
textures @ 64 px DXT + mips) vs a measured-estimate **~88 MB** of per-cell TXD payload (31,981 entries) —
**−82 %** on disk, and one decoded/GPU texture per name instead of ~5.5 copies at LOD range. `finalize` emits
exactly one TXD; every cell IDE def's `txd` column is the shared `lods` (unit-tested). Pixels unchanged by
construction (name-keyed first-wins source, as before).
