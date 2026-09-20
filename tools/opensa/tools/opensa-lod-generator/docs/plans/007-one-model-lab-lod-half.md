# 007 — One-model swap for the OpenSA target: the lab pak gets its LOD half

_(Was `docs/plans/103-opensa-one-model-lab/` until 2026-08-17 — moved beside the tool whose bake it reuses;
the central folder is engine plans only. The instrument itself is `scripts/debug/model-repack.ts`, which began
as map-optimizer plan 024 phase 0.)_

**Status: ✅ Phase 1 DONE 2026-08-17.** `scripts/debug/model-repack.ts` — the OpenSA-target counterpart of
the `sa`-target instruments (`model-lab.ts` / `model-optimize.ts` / `img-patch.ts`, session 17) — now
re-bakes the rect's CELL LODs from the swapped HD and takes a mod's loose `--dff/--txd`. One model, HD and far
view both, in a servable lab copy of the built game, in seconds. Phase 2 (patching the SHIPPING pak in place)
is researched and deferred: [`docs/in-reserve/ospak-in-place-cell-patch.md`](../../../../docs/in-reserve/ospak-in-place-cell-patch.md).

Restrictions checked 2026-08-17: `restrictions/architecture.md` (one build, the grid every tool agrees on —
`lodConfig.cellSize === CELL_SIZE` is asserted), `restrictions/build-vs-runtime.md` (the look is baked; and,
promoted today, **never re-pack a pack output**), `restrictions/gpu-and-shaders.md` (a grown texture array
kills the bundles recorded against it — the lab is a separate pak, nothing is grown in a live session).

## Why (his ask, session 18 close)

For the `sa` target a changed model is swapped in place in seconds; for OpenSA the same change cost a ~10 min
pipeline (`--exclude sa`), because the static world is welded into `pak/world.ospak` cells and the far view is
`opensa-lod-generator`'s per-CELL bake — a per-object clone does not exist. He named the two differences: the
LOD is regenerated for the model's AREA, and the result has to go through `opensa-pack`.

## What the research settled (2026-08-17, `world.ospak` read end to end)

- **`world.ospak` IS per-cell replaceable**: a JSON manifest + one blob of 4096-aligned, individually
  wire-compressed entries keyed `"cx,cy,hd"` / `"cx,cy,lod"` / `"array-N"`; the runtime reads ranges only,
  `validateOspakManifest` checks alignment and bounds only — an `img-patch`-style append + repoint would
  validate.
- **But a subset weld cannot reproduce the shipping pak's texture plan.** `TexturePlanner` assigns
  `(arrayRef, layer)` eagerly in first-use order over the WHOLE map and persists nothing (`manifest.textures`
  is per-array meta, `report.json` counts); a one-cell weld yields different refs and layers, so a patched cell
  would bind the wrong layers of every array. Patching in place needs a new artifact (a `name/contentHash →
  (arrayRef, layer)` sidecar written by the full pack) — that is Phase 2's price and the in-reserve card.
- The lab-pak model (`model-repack.ts`, plan 024 phase 0) sidesteps it: a fresh small pak with its own
  dictionary, served as `?src=build/<game>/opensa-lab`. It lacked the LOD half — its `"cx,cy,lod"` cells were
  the BUILT `lod_<cx>_<cy>` models, cut from the old HD.
- `opensa-lod-generator` has no per-cell path (`writeBuild` wipes + mirrors the tree, ONE shared `lods.txd`),
  but its adapter takes `deps.archives` and `bakeCell(cell)` is per cell — enough for a lab.
- The BUILT archives cannot feed either half: the pack replaced every converted `.dff` with an `.osm`
  (that is also WHY re-packing an output silently yields a quarter of the world). Sources come from
  `game-src/<game>/models/*.img` (ALL of them — a TC ships its world in `gostown6.img`, and the script read
  `gta3.img` alone before today) overridden by mods, or from the loose files.
- `.work-opensa` does not survive a default run, so the pack INPUT is gone after a build; the lab rebuilds what
  it needs from sources.

## Phase 1 — shipped

`model-repack.ts <model> [--dff f.dff [--txd f.txd]] [--no-lod] …`:

1. resolve + optimize as before (targets with the experimental flags, neighbours the build defaults; a loose
   `--dff/--txd` replaces the single target's source, the txd written under the TARGET's txd name);
2. **`bakeRectLods`**: `createGtaSaLodAdapter(game, inputDir, {…lodConfig, excludeItems: [...lodConfig, every
   built lod_* name]}, { archives: [overlayArchive, sourceIndex] })` — the overlay first (`createModelSource`
   is first-wins), the built `lod_*` cells excluded or they merge in as HD twice; `resolveCells()` filtered to
   the rect; `bakeCell` each; `encodeLodDff` (double-sided, effects) as `lod_<cx>_<cy>.dff` + ONE
   `lods.txd` scoped to the rect's cells (`encodeLodTxd`, scoped registry, `lodTextureSize`, linear) into the
   overlay, where they shadow the built entries by basename;
3. `convertDistrict` over the rect (unchanged) → `build/<game>/opensa-lab`.

Measured on `build/gostown/opensa` (the only OpenSA tree on disk today — `build/original/opensa` was wiped at
session 18's close and only `sa` rebuilt), `gp_dt_01`, rect `3,-4` (1 cell, 9 models): **1.9 s wall
total, LOD rebake 1.0–1.2 s**, lab pak 1.5 MB / 2 entries (`3,-4,hd` 33 425 B, `3,-4,lod` 24 383 B — the
shipping tree's `3,-4,lod` is 24 992 B, so the lab LOD is the same class of mesh). Proof the LOD is cut from
the swap: `--raw` vs the optimized run gave a different `gp_dt_01.dff` AND a different `lod_3_-4.dff`
(md5 `4a0b16c8…` → `cbcb4ac5…`). Benchmark: `docs/benchmarks/tools/2026-08-17-model-repack-lod-half.md`.
**`original`, measured 2026-08-17 on the rebuilt `build/original/opensa`** (the run that also fixed the pack's
per-file archive rewrite — 2804 s total, `opensa` stage 2532 s, 1124 cell entries, pak 1.21 GB):
`burger01_law` → rect `3,-7` (1 cell, **88 models**, 104 tiny instances culled): **17.4 s wall, LOD rebake
12.1 s**, lab pak 6.3 MB / 2 entries, peak RSS 3.6 GB. 11 of the 88 have no source by design (generated
tree/palm LODs — the lab's known caveat). Field verdict: pending his look at `?src=/build/original/opensa-lab`.

## Caveats that stand (documented in the script header)

The lab LOD is baked without the pipeline's `excludeItems` (generated tree/procobj LODs), world-context
prelight passes are not replayed, `.osm` props inside the rect reference the MAIN pak's dictionary. All are
fine for an A/B eyeball of one model; none is fine for shipping — the lab never touches `build/<game>/opensa/pak`.

## Phase 2 — deferred (in reserve)

In-place surgery on the shipping pak: persist the texture plan at pack time, then append + repoint the
touched cells (and grown arrays) in `world.ospak`. Trigger and its check in code are on the card.
