# Dedupe the clone-LOD textures into a `txdp` parent again

**Status: KEPT — the give-up was reverted the same day, 2026-08-16.** For a few hours the clone dictionaries
were made self-contained (every `salodNNNN` carrying every texture, no `salodpar` at all) on the theory that
the game does not resolve the `txdp` chain. **The field said it changed nothing**, and it cost 45.9 MiB
against the partition's 10.4 MB, so the partition
([plan 006](../../../tools/sa-lod-generator/docs/plans/006-txdp-parent-textures.md)) stands and
`selfContainedTxd` is an opt-in flag.

**What that leaves unresolved, honestly:** the parent is neither proven to work nor proven broken. It is not
the defect being chased — that is all the field established.

**Impact: archive bytes only — nothing per frame.** Plan 006's own measurement of the same map:

| clone TXD payload | size |
| --- | --- |
| 0.5 scale, per-atlas dictionaries (before 006) | 114.8 MB |
| 0.25 + `txdp` parent (006, retired) | **10.4 MB** — parent 5.2 MB / 2 475 shared textures + children 5.2 MB |
| 0.25, self-contained (today) | **45.9 MiB** across 1 020 dictionaries — measured on the 2026-08-16 build; `gta3.img` 1 602 MiB |

**Effort to pull it back: low in code, and that is not the problem.** The partition still exists behind
`selfContainedTxd: false` (`partitionCloneTextures`, unit-tested). What it costs is the thing the field
measured.

## What the day measured about it

**1 966 of 4 050 clone LODs (49 %) depend on the parent** — so if the chain ever were broken, half the clone
LODs would be affected. It is not: removing the parent entirely changed nothing in the field, in either
direction. That number is worth keeping, because it also says what the parent is worth: half the clone LODs
would otherwise carry duplicated copies of the shared textures.

## What would justify revisiting it

A field-proven statement about the chain in EITHER direction — one model, one parent-only texture,
photographed rendering correctly (or not) on the real target. The MixMods "SA Optimized Map" pack plan 006
cited as proof at scale was never verified on OUR install, and that gap is what let a whole afternoon be
spent here. Detail: [`docs/open-issues/fixed/sa-lod-visibility-budget.md`](../../open-issues/fixed/sa-lod-visibility-budget.md).
