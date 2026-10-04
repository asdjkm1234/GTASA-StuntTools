# opensa-lod-generator

A separate, **custom** (non-lossless) tool that regenerates the map's distant LODs from the HD models. Unlike
`map-optimizer` (which conditions existing assets without changing what's authored), this **bakes new content**:
it cuts the world into square cells and, per cell, merges the HD geometry into one LOD mesh; all cells share
**one** downscaled texture dictionary (`lods.txd`, plan 004; names scoped per source TXD — lod-common plan 004) — the modern open-world LOD scheme (cf. GTA V
SLOD). Geometry goes through the shared
`@opensa/lod-common` **visibility-first chain** (invisible-face culls + budget-checked QEM + coplanar remesh —
every step measured by a render diff; see the Geometry section below). Kept out of `map-optimizer` on purpose:
it's additive and opinionated.

It takes a game-data folder — `gta.dat` + `data/` + `models/` (e.g. `game-src/original/`) — processes it, and
writes its own build.

> **OpenSA only.** This tool targets OpenSA's engine, not the original game. The output is standard RenderWare so
> it loads in stock SA too, but the per-cell budget isn't tuned for SA's streamer (uncapped materials/size crash
> real SA on stream-in — OpenSA has no such limits). See the `opensa-lod-generator-decimation` memory for the real-SA
> findings if that support is ever revisited.

## Usage

```bash
# from the repo root — --game is a path to the game data (e.g. ./game-src/original)
# assemble the world into cells + print a sizing report (Phase 0):
npx tsx opensa-lod-generator/src/cli.ts --game ./game-src/original --cell 256

# bake every cell (merge → simplification chain → smooth normals → per-cell DFF/TXD) and emit a drop-in build under
# --out (models/lods.img + data/lods.ide/.ipl + gta.dat lines):
npx tsx opensa-lod-generator/src/cli.ts --game ./game-src/original --out ./build
```

- `--game <path>` — path to the game data (`gta.dat` + `data/` + `models/`).
- `--cell <size>` — cell size in world units (must match the engine streaming grid; default from `lod.config.ts`).
- `--out <path>` — output directory for the baked drop-in. **Omit it to only print the sizing report** (Phase 0).
- `--strip-lods` — after building, remove the stock `lod*` building LODs from the drop-in (the cell-LODs replace
  that far-LOD layer): drops their IPL instances (text + binary streams, repairing the shared `lod`-index space)
  and deletes their `.dff`/`.txd` from `gta3.img`. The cell-LOD assets (`lods.*`) are left untouched. Use it so the
  stock far-LODs don't double up with the cell-LODs (both are `lod*`-named → both bucket into OpenSA's LOD ring).

```
opensa-lod-generator original:  cellSize=256
  cells      — 520
  instances  — 30981 HD (5958 unique models)
  per cell   — up to 422 instances
```

With `--out` it bakes the cells and emits a drop-in build (one `lods.img` of cell DFFs + per-cell TXDs + a shared
`lods.col` of bounds-only collision so SA can stream them, plus `lods.ide` / `lods.ipl`, registered in `gta.dat`).
Stripping the old `lod*` models is done via `--strip-lods` (**plan 002**, 1d-iii); the cell TXDs are DXT-compressed
(DXT1/DXT5 + mips), keeping `lods.img` to ~196 MB instead of ~458 MB raw.

> **Needs an extended model-ID limit.** Cell-LOD ids start at `max IDE id + 1`, so the full map's cells run past
> the stock **≤ 18630** ceiling. Run the build with **fastman92 Limit Adjuster** ("model special features", IDs
> `0–19999`) or the game faults / crashes registering them.

> **Targets OpenSA, not the original game.** Output is standard RenderWare so it loads in stock SA too, but the
> per-cell budget isn't tuned for SA's streamer — uncapped cell-LODs (hundreds of materials, MB-scale models) crash
> real SA on stream-in (OpenSA has no such limits). The original-game caps were removed; see the
> `opensa-lod-generator-decimation` memory if SA support is revisited.

**Geometry: visibility-first simplification (lod-common plan 003).** Each cell LOD starts as the cell's real HD
geometry merged via the shared `@opensa/lod-common` core, then runs the modifier chain — every step either
removes what provably can't be seen or is self-checked by a render diff:

1. **Screen-size instance cull** — sub-`minLodPixels` objects (bins/poles/wires at ≥ `hdDrawDistance`) are
   dropped whole before the merge.
2. **`dropDegenerateFaces`** — zero-area triangles (measured 0.000 % visual diff).
3. **`dropTransparentGroups`** — texture groups under `minOpaqueCoverage` opaque texels (chain-link/wires).
4. **`createBudgetedDecimate`** — per-cell QEM: aggressive→gentle targets, the first whose own CPU-preview diff
   stays within `decimateBudget` wins; a cell that can't decimate cleanly keeps its triangles. Collapses are
   **UV-drift guarded** (GTA roads map their tiled V as per-segment patchwork; unguarded QEM smeared them into
   lengthwise stripes — plan 003 "Road-stripes bug", fixed + verified in-game 2026-07-07).
5. **`createVisibilityCull`** — raycast against deterministic cameras (ring + a 3×3 top-down grid); faces no
   camera sees are dropped (`hiddenFaces: 'cull' | 'orient' | 'off'`), front-only faces go single-sided, and
   windings are **never flipped** (a wrong flip is a hole). See-through textures don't occlude rays.
6. **`createCoplanarRemesh`** — flat same-texture clusters re-triangulated from their byte-exact boundary.

Normals are re-derived after; tinted materials and the source models' **2dfx corona lights** ride along (the
distant city glows at night). The DFF is emitted two-sided only where faces are genuinely seen from both sides
(per-face masks) and **split across multiple atomics** past the 65 535-vertex limit. Full-map result vs the raw
merge: ~−18 % triangles and ~−37 % encoded indices at ≈ 0.2 % mean pixel diff (see lod-common plan 003's
Measurements). The **harness** (`src/harness.ts --game <path> [--cells 12]`) renders sampled cells against every
stage from independent cameras — tune any knob by number, not by eye.

**What's baked:** exterior building/terrain instances only. **Trees** (the `@opensa/map-placement/vegetation`
roster) are excluded — they get billboard impostors from [`lod-trees-generator`](../lod-trees-generator/), and
decimated alpha foliage looks bad / would duplicate those. **procobj** scatter is never seen here (it lives in
`procobj.dat`, not the IPLs) — its LODs come from [`sa-procobj-placement`](../sa-procobj-placement/).
Interiors are dropped; **IPL `lod`-target instances** are skipped by ground truth (their HD is baked — name
matching missed renamed twins and z-fought); **tobj (timed) instances** are excluded — the engine renders the
real hour-gated instance at LOD range instead (lit windows don't glow at noon). **Script-gated binary IPL
groups** (binary areas with no companion text IPL: `barriers1`/`barriers2` roadblocks, `carter`/`crack`) are
excluded too, except renderware's `OPEN_SCRIPT_IPL` (`truthsfarm`) — the bake must match exactly what the
engine loads via `extraIpl`, or closed props get painted into the far LODs (the bridge-roadblocks-in-`lod_2_1`
bug).

## Layout

```
opensa-lod-generator/
  src/
    cli.ts                 # --game (Phase 0 report) / --out (full bake) / --strip-lods
    lod.config.ts          # cell size (= engine streaming grid) + draw distance + atlas texture size
    core/                  # game-agnostic: Cell/grid types, the LodAdapter contract, summary
    adapters/gta-sa/       # RenderWare adapter — reuses ../src parsers READ-ONLY; bake/writers live here
  docs/plans/              # 001 architecture … 006 cell bake carries effects, 007 the one-model lab's LOD half (model-repack.ts)
# baked drop-in is written wherever --out points (gitignored)
```

## Principles (same discipline as map-optimizer)

- **Never modify `../src`** — read-only reuse of the engine's IDE/IPL/DFF/TXD parsers; all writers live here.
- **Game-agnostic core + a per-game adapter** — a new game is a new adapter, no core change.
- **Engine fit, not engine change** — the engine already renders a per-cell HD/LOD grid, so generated cell-LODs
  drop in via config (cell size match), not code. See plan 002.
