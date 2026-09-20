# sa-lod-generator

Regenerates **GTA-SA's per-object LODs as HD-quality clones** for the **real game** (contrast with
`opensa-lod-generator`, which bakes _cell_ LODs for OpenSA). Every LOD becomes a copy of its HD model with a
half-res texture, so far-view geometry matches the HD — no pop, no holes. With `decimateBudget` set (default
0.01), each clone additionally tries budget-checked QEM: within the pixel budget it's re-encoded lighter (night
prelit, material tints and 2dfx coronas carried over; particles stripped); over budget it stays a **verbatim
byte-copy**. A drop-in `--out` build: it edits `models/gta3.img` + the map data in place, never touching the id
space of existing LODs.

See [`docs/plans/`](./docs/plans) for the design: [001](./docs/plans/001-architecture.md) (architecture +
measured feasibility), [002](./docs/plans/002-clone-lods.md) (Phase 1 clone), [003](./docs/plans/003-fill-missing-lods.md)
(Phase 2 hole-fill), [009](./docs/plans/009-multi-atomic-clone-merge.md) (multi-atomic HDs are merged, never byte-copied).

## Usage

```sh
# Report only (no build) — LOD counts + stock-vs-clone triangle budget:
tsx tools/sa-lod-generator/src/cli.ts --game ./game-src/original

# Drop-in build:
NODE_OPTIONS=--max-old-space-size=8192 \
tsx tools/sa-lod-generator/src/cli.ts --game ./game-src/original --out ./build/salod [--tex-scale 0.25]
```

`--game` is a game-data dir (`data/` + `models/` with `gta3.img`). Without `--out` it prints the sizing report.
Needs ~8 GB heap (`NODE_OPTIONS`) for the texture indexing.

## What it does

The LODs it touches are found from the IPL `lod` **index** (ground truth), not the `lod`-name prefix (unreliable —
see the `lod-detection-name-vs-target` memory). The text↔binary `lod`-index coupling is handled per area.

**Phase 1 — clone existing LODs** (plan 002, decimation per lod-common plan 003 Phase 5):

- Replace each **per-object** LOD's `.dff` with its HD's bytes — **budget-decimated** when the clone's own
  render diff stays within `decimateBudget` (re-encoded with night prelit + tints + transplanted 2dfx coronas),
  else **verbatim** (a known-good SA byte-copy — sidesteps every DFF format gotcha and keeps plugins like
  breakable). **Exception: a multi-atomic HD (an `anim` clump — rotating signs, derricks, the Burger Shot) is
  always MERGED into one atomic** (frame transforms baked, budget or not — `mergedLods` in the stats): a LOD row
  is an `objs` atomic model and SA keeps exactly one atomic of a clump it reads, at the origin
  (`docs/gta-sa-original/atomic-model-one-atomic.md`; plan 009). Textures: `texScale` (default 0.25, 32 px floor) DXT TXDs, **`txdp`-partitioned** (plan 006) —
  textures used by ≥ 2 source atlases live once in the shared `salodpar.txd` parent, children keep only their
  unique ones (`salod-txdp.ide` registers the links before the first IPL); retarget the LOD's IDE `txd`.
  Same-named textures with DIFFERENT pixels stay per-child, each resolved from its own atlas (lod-common plan 004).
  Every clone texture is a **power of two** per side (`resampleToPow2` after the halving): a mod's 250×250 source
  halved to 62×62 DXT1 made the real game refuse the whole dictionary and every LOD on it
  (`docs/restrictions/dxt-raster-dimensions.md`, 2026-08-17).
- Retarget each cloned LOD **instance's** transform to its HD instance's — the stock LOD geometry was baked in a
  different local frame, so an HD clone under the stock rotation would skew (see `lod-clone-needs-hd-instance-transform`).
- **Skipped** (kept stock): shared multi-HD LODs, dual-role LODs (also placed standalone — cloning corrupts them),
  vegetation (`SA_TREE_MODELS` — trees get impostors from `lod-trees-generator`), sibling generators' finished
  LODs, sub-pixel models (`minLodPixels`), and **timed-mismatch links** (a `tobj` HD whose stock LOD is an
  untimed neutral stand-in — cloning would glow round the clock, e.g. the Luxor lights at noon).

**Phase 2 — fill missing LODs** (plan 003): for the curated `holeFillModels` (HD pieces with **no** LOD that hole
the far view), generate a new far-LOD — new id + IDE def (`data/maps/salod-holes.ide`) + a leaf LOD instance
appended at the HD's transform with the HD's `lod` pointed at it (text row or binary stream record).

## Config (`src/lod.config.ts`)

| key              | meaning                                                                                                                                                                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `texScale`       | LOD texture downscale (default `0.25` = ¼ each side, floored at 32 px — plan 006).                                                                                                                                                                                                |
| `decimateBudget` | Budget-checked QEM for the clones (mean pixel-diff fraction per model, default `0.01`); `0` = pure verbatim clones.                                                                                                                                                               |
| `minLodPixels`   | Skip cloning LODs whose HD is under this many pixels at its draw distance (default `2`).                                                                                                                                                                                          |
| `holeFillModels` | **Curated** HD models with no LOD to give a generated far-LOD. Auto-detection over-generates ~1000× (a hole depends on ground coverage, not shape), so this is opt-in — extend it as holes are spotted in the viewer. Entries that already have a LOD are skipped with a warning. |
| `holeLodDraw`    | Draw distance for the generated hole-fill LODs (default 1500).                                                                                                                                                                                                                    |

## Prerequisites

- **fastman92 Limit Adjuster** — Phase 1 raises the LOD-layer stream/TXD memory (~+200 MB); Phase 2 needs raised
  **model-id** limits too (new ids are `> 18630`, SA's ceiling is already full).
- The OpenSA map viewer classifies HD/LOD by the IPL `lod` index (`IplInstance.isLod`), so name-mismatched clones
  (`nw_lodbit_18`, …) show correctly under "Show LODs".
