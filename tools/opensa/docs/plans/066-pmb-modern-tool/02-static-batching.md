# 066·02 — Static batching (draw-call reduction)

[← chain](readme.md) · prev: [01 format](01-native-cell-format.md) · next: [03 shadows](03-baked-sun-occlusion-shadows.md)

The biggest single frame-time lever in the chain. We are draw-call-bound — [072 measurements](../072-quality-tiers-default-flip/readme.md)
show `ls-noon` at **14 454 draws** and the night scenes (`lv-night`, `ls-rain-night`) CPU-bound (frame ms ≫ GPU ms). The
static world emits roughly one small draw per object/cell, exactly as DFF did. Merging that geometry at **build time** —
which only a format we own can do cheaply — collapses thousands of tiny draws into dozens per cell.

## Context

- Runtime merging is late and expensive (we'd re-do it every stream-in). Offline, we already have the welded, compacted
  per-cell mesh (map-optimizer) and — once [01](01-native-cell-format.md) lands — a KTX2 **atlas** per cell. A shared
  atlas is the enabler: objects that shared a texture dictionary can now share one material → one draw.
- Trade-off to respect: bigger merged chunks = coarser frustum cull → more triangles drawn and more overdraw. GPU has
  headroom on the CPU-bound scenes, but blind whole-cell merges would regress the GPU-bound `ls-noon`. Chunk size is the
  knob.

## Decisions

1. **Merge by material within a cell**, not across the whole map. Group the cell's geometry by (atlas page, blend mode,
   flags) and concatenate into one buffer per group → one draw per group instead of per object. Opaque and alpha-blended
   stay separate (blend order). Two-sided / `0x200000` geometry batches separately (preserve the culling flag).
2. **Sub-cell chunking for cull balance.** Split a merged group into a few spatial sub-chunks (e.g. quadrants) so frustum
   cull still discards off-screen halves. Chunk granularity is a pmb parameter, tuned on `ls-noon` (GPU-bound) vs
   `lv-night` (CPU-bound) so neither regresses.
3. **Keep per-object identity where it matters.** Objects that must toggle/animate independently (TOBJ time-objects,
   breakables, anything the streaming/LOD system swaps per-object) are excluded from the merge and stay individual.
   The batcher takes an explicit "mergeable" predicate.
4. **Batched geometry lives in the 01 format** as a group table in the header (material index, index range, sub-chunk
   bounds). The runtime draws groups; a non-batched (older) native cell or a DFF cell is unaffected.
5. **Interaction with LOD & shadows**: batching applies per LOD level independently (HD cell and LOD cell each merged
   on their own). Baked static shadows ([03](03-baked-sun-occlusion-shadows.md)) ride the same merged vertex buffers —
   the sunVis channel is per vertex, so merging does not disturb it.

## Tasks

- [~] Batcher in pmb: group welded cell geometry by (atlas page, blend, flags); concatenate buffers; emit a group table
      into the 01 header. Deterministic ordering.
- [~] Sub-cell chunking with a configurable granularity; per-chunk bounds for frustum cull.
- [~] Mergeable predicate: exclude TOBJ / breakable / per-object-swapped instances (reuse IDE flags, plan 039).
- [~] Runtime: draw groups/sub-chunks from the header; frustum-cull per sub-chunk; graceful for non-batched cells.
- [~] Draw-count + triangle-count report per cell (before/after) in the pmb budget output.
- [~] Bench the granularity knob on `ls-noon` (must-not-regress GPU) and `lv-night`/`ls-rain-night` (target win).

## Verification

- Draws/cell drop from ~hundreds to dozens on a dense cell; frame ms on the CPU-bound night scenes improves; `ls-noon`
  GPU ms does **not** regress (overdraw check via the sub-chunk knob).
- Visual: merged cell is pixel-identical to the un-merged cell (same atlas, same winding, two-sided preserved).
- TOBJ and breakables still toggle/animate independently (not swallowed by a merge).

## Measurements

_(record after implementation)_

- draws/cell + tris/cell before → after (per bench scene); frame ms + GPU ms delta; best chunk granularity: …
