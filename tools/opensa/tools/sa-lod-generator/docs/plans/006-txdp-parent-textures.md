# 006 — Clone TXDs: 0.25 scale + `txdp` parent dictionary

**Status: ✅ Implemented and STILL IN FORCE — but on 2026-08-16 it spent an afternoon as a suspect.** The
parent was blamed for LODs that render untextured or not at all, replaced by self-contained dictionaries
(`selfContainedTxd`), field-tested, and REVERTED: nothing changed, and self-containment cost 45.9 MiB against
this plan's 10.4 MB. **The chain is neither proven nor disproven on the real target** — which is the gap this
plan left by citing a third-party mod as proof at scale instead of measuring our own install. See
[`docs/open-issues/fixed/sa-lod-visibility-budget.md`](../../../../docs/open-issues/fixed/sa-lod-visibility-budget.md). Two texture cuts for the clone LODs, in order of risk:

1. **`texScale` 0.5 → 0.25** (with a 32 px floor) — the clone textures are only ever seen from ≥ the HD's draw
   distance, where 0.25 still oversamples the screen ~2×.
2. **A `txdp` parent dictionary** — textures byte-identical across clone atlases move into one parent TXD;
   children keep only what's unique to them. SA-native mechanism (IDE `txdp` section), proven at scale by the
   MixMods "SA Optimized Map" mod (1,368 mappings → 32 parents, see `./1`), and already fully supported by the
   OpenSA engine (`resolveTxdChain`).

## Measured motivation (2026-07-02, game-src/original)

- Screen maths: a LOD appears at ≥ ~300 u, where 1 px ≈ 0.32 world units (FOV 60 / 1080p) → ~3 px/m on screen.
  A 256 px facade texture over ~10 m at 0.25 (64 px) still delivers ~6.5 px/m — 2× the screen density at the
  **closest** LOD view.
- 991 clone source atlases hold **15,703 texture entries, 5,082 unique names (3.09×)**; full-res 431 MB total
  vs 122 MB unique. Clone TXD payload: 0.5 ≈ ~108 MB → **0.25 ≈ ~27 MB** → **0.25 + parent ≈ ~8 MB** (−93 %).
- Real-game wins beyond disk: fewer duplicate textures resident in SA's streaming memory — the exact effect the
  MixMods mod targets.

## Design

**Scale (Phase 1):**

- sa config `texScale: 0.25` (halvings 2). `encodeHalvedTxd`'s `halve` gains a **32 px floor**: stop halving
  when `min(width, height)` would drop below 32 — small source textures (64 px) must not become 16 px mush on
  tiled surfaces. Floor constant lives in `lod-common/encode-txd` (shared with any future caller).
- Verification is **in-game A/B** (`--tex-scale` flag): billboards / lit LV windows at night are the risk cases.
  The CPU harness renders mean colours and cannot judge texture resolution.

**Parent (Phase 2) — dedup by name, which IS content-safe here:** _(SUPERSEDED 2026-07-05 by lod-common
plan 004: the "identical pixels per name" premise below was the wrong-variant BUG, not a guarantee. The
partition is now content-aware — a multi-atlas name shares only when every owner resolves to the same pixels;
different variants stay in each child, which resolves first in the txdp chain.)_

- Same-named textures in different SA atlases are not guaranteed identical in the _stock_ files — but the clone
  pipeline's `TextureSource` is **name-keyed, first-TXD-wins**: every clone TXD already receives identical
  pixels for a given name (and always has, since the first salod build). So name-level partitioning cannot
  change any pixel the clones ever showed — a content hash would be redundant. Criterion: a name used by **≥ 2**
  clone atlases moves to the parent `salodpar.txd`; the rest stay in their child (child resolves first in both
  SA and the engine, preserving the override path).
- Children (`salodNNNN.txd`) keep their unique textures; empty children stay as empty TXDs (a child must exist
  for SA to bind).
- `txdp` section (`<child>, salodpar` per clone TXD) goes into sa-lod's own IDE, registered in `gta.dat`
  **before the first IPL line** (the `gta-dat-ide-before-ipl` memory — appending after IDEs crashes stock IPLs).
- Parent size guard: one parent at 0.25 is ~a few MB (fine for SA's streamer); if it ever grows past ~16 MB,
  split by region like the MixMods mod (`LA_gene`-style) — the builder should assert/report the parent size.

## Phases

- **Phase 1 — 0.25 + floor.** Config + `encode-txd` floor + tests (floor respected, mips regenerated);
  measure clone TXD bytes 0.5 vs 0.25.
- **Phase 2 — content-hash parent.** Hash-partition the downscaled textures; emit `salodpar.txd` + slimmed
  children + the `txdp` IDE; tests (identical→parent, name-collision-different-content→child override, empty
  child kept); measure final texture payload + parent size.
- **Phase 3 — in-game verify.** Rebake, check LV night skyline / billboards / the txdp resolution in both the
  real game and OpenSA (engine chain already supports it).

## Measurements

**After Phases 1–2 (2026-07-02, game-src/original, 991 clone atlases):**

| scheme                    | payload                                                               |
| ------------------------- | --------------------------------------------------------------------- |
| OLD — 0.5, per-atlas TXDs | 114.8 MB                                                              |
| NEW — 0.25 + txdp parent  | **10.4 MB** (parent 5.2 MB / 2,475 shared textures + children 5.2 MB) |

**−91 %.** The parent sits comfortably under the ~16 MB region-split guard. `encodeHalvedTxd` floors halving at
32 px (unit-tested), `partitionCloneTextures` is unit-tested (shared ≥ 2 atlases, per-atlas dedup, empty children
kept), `salod-txdp.ide` registers via `patchGtaDat` before the first IPL. Hole-fill atlases added after the
partition stay full standalone TXDs (no txdp line). Phase 3 (in-game verify: LV night skyline, billboards) is on
the user after the next rebake.
