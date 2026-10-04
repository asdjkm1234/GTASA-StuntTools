# map-optimizer

An offline, **lossless** asset-conditioning tool for the game maps OpenSA loads. It takes a `--game <path>` (a
game-data dir: `gta.dat` + `data/` + `models/`), finds the model DFFs the map actually references, runs them
through a composable, Gulp-style **plugin pipeline**, and writes optimized copies to `--out <path>` — without
touching the originals.

On the bundled `gostown` map it currently shrinks the models **~32%** (≈110 MB → ≈75 MB) by recomputing
normals, welding duplicate vertices, and removing degenerate / duplicate faces — all changes that are provably
**visually identical** (verified by re-parsing every output and checking triangle/material-split consistency).

> Separate sub-project. It reuses the main engine's RenderWare **parsers** read-only (`../src`); all the
> **writing** (the DFF serializer / re-encoder) lives here. The core is game-agnostic — a different game is a
> new adapter.

## Usage

```bash
# from the repo root — --game is a path to the game data, --out where the build is written
npx tsx map-optimizer/src/cli.ts --game ./game-src/gostown --out ./build

# all passes are on by default — opt out per pass:
npx tsx map-optimizer/src/cli.ts --game ./game-src/original --out ./build --no-textures    # skip mip chains (plan 010) AND the DXT block-alignment resize (docs/restrictions/dxt-raster-dimensions.md)
npx tsx map-optimizer/src/cli.ts --game ./game-src/original --out ./build --no-weld-seams  # skip cross-model prelit seam weld (plan 016)
npx tsx map-optimizer/src/cli.ts --game ./game-src/original --out ./build --no-prelit      # skip world-context prelight (plan 019)
npx tsx map-optimizer/src/cli.ts --game ./game-src/original --out ./build --no-add-normals # don't create absent normals

# prelight curation (same JSON entry format for both flags):
#   "name"                                  → forced auto verdict (statistical skip-guards bypassed)
#   {"model": "name", "nightMax": 64, "nightScale": 0.4, "dayShift": -30}
#                                           → explicit corrections, applied verbatim and UNGUARDED
#     nightMax caps every night vertex at the ceiling (dims ONLY the glow, dark walls untouched — what
#     "windows too bright at night" needs); nightScale multiplies the whole set; dayShift adds to day RGB;
#     nightMax wins over nightScale.
# FORCE (default workflow — what perfect-map-builder's broken-prelight.json feeds): the statistical pass runs
# map-wide AND the listed models are additionally forced:
npx tsx map-optimizer/src/cli.ts --game ./game-src/original --out ./build --prelit-force broken-models.json
# ONLY-mode: correct just the listed models, the rest passes byte-identical:
npx tsx map-optimizer/src/cli.ts --game ./game-src/original --out ./build --prelit-only broken-models.json
```

- `--game <path>` — game data (models `*.img` + `data/` IDE/IPL to resolve the map's models).
- `--out <path>` — where the **complete, drop-in build** is written (gitignored; the source is never modified) —
  the whole game-data tree mirrored, with each `models/*.img` **rebuilt**: optimized entries swapped in,
  everything else (vehicles, peds, interiors, data, …) preserved. Point the game at it and it runs. A
  **`report.json`** is written alongside.
- Passes (`textures` / `weld-seams` / `prelit` / `add-normals`) are **on by default**. `--weld-seams` (plan 016 + 019 Phase 3) averages prelit RGB at world-coincident boundary vertices of
  **uniquely-placed** models to close tile seams, then **feathers** each side's correction into a ~10 u band so
  the tone step blends out; `prelit` (plan 019) conforms day/night vertex-colour outliers to their world
  neighbourhood. (The former `--stitch-gaps`/plan 017 and `--refine`/plan 014 passes are **retired** — see
  their plans for the in-game findings.)
- Prints a summary: models processed/changed, vertices & faces removed, size reduction, and any per-asset
  failures (isolated — one bad model never aborts the run).

```
map-optimizer gostown:
  models   — 836 processed, 813 changed
  vertices — 1283675 removed
  faces    — 1144 removed
  size     — 109892 KB → 74958 KB (31.8% smaller)
  failures — 7
```

## Review workflow (plan 019)

The prelight pass is **semi-automatic**: generate a review page, curate, feed the lists back. The default
workflow is the **force list** (`--prelit-force <file.json>`; perfect-map-builder's `broken-prelight.json`):
the statistical pass corrects the whole map and the listed, human-confirmed models are additionally forced —
their statistical skip-guards are bypassed (the listing is the evidence) while the within-model protections
(tail guard, darken-only night, synth cap) still hold. For the tightest control there is **only-mode**
(`--prelit-only <file.json>`): just the listed models are corrected, every other model passes through
byte-identical (`only` wins when both are given).

```bash
# 1. HTML review report — day/night before→after thumbnails per verdict (in-memory apply; no run needed)
npx tsx tools/map-optimizer/src/review-cli.ts --game ./game-src/original --report review.html --limit 200

# 2. Tick "exclude" on over-corrected models in the page, save the JSON it produces to exclude.json, iterate:
npx tsx tools/map-optimizer/src/review-cli.ts --game ./game-src/original --report review.html --exclude exclude.json
#    (the run consumes it via the Node API: runOptimizer({ ..., prelitOptions: { exclude } }))

# 3. Interactive side-by-side compare of one model from two game trees
#    (BEFORE = stock .dff/.txd, AFTER = the pmb build's .osm — the canonical build):
npx tsx tools/map-optimizer/src/compare-serve.ts --before ./game-src/original --after ./build/original/opensa
#    then `npm run dev` and open viewer.html?tab=compare (day + night-colours view, synced orbit)
```

## Analysis

Read-only measurement tools (no output build), used to decide whether a transform is worth building:

```bash
# curvature scan — how much of a region is flat / gently-curved / crease (fed the retired plan 014)
npx tsx map-optimizer/src/analyze-curvature.ts --game ./game-src/original --center 2100,1490,15 --radius 200
```

## Pipeline

Edit `src/optimizer.config.ts` (the "gulpfile") to choose/reorder stages. The default pipeline, in order:

1. **weld-vertices** — merge vertices identical in _all_ attributes (position/normal/UV/prelit/night).
2. **remove-degenerate-triangles** — drop zero-area faces (coincident/collinear/equal-index).
3. **dedupe-faces** — remove exact duplicate triangles (keeps two-sided/reversed-winding faces and decals).
4. **prune-vertices** — drop vertices no triangle references.
5. **smooth-normals** — rebuild normals from **smooth groups**, splitting at hard edges (plan 015): flat walls
   get flat normals, sharp edges stay sharp, double faces get correct outward normals. By default it only
   REBUILDS meshes that already ship normals; the `addNormals` pass (on by default — graphics mods and OpenSA
   SSAO want normals) also creates them where absent, at ~+40% vertices map-wide from the hard-edge splits.
   `--no-add-normals` if the vanilla renderer's vertex lighting looks off on stock prelit world geometry.

On top of that base, `run.ts` appends the **world-context prelight** pass (plan 019, on by default): one
adapter pre-pass fingerprints every placed model's prelit/night and judges it against its **neighbourhood**,
then two thin appliers execute the verdicts:

6. **apply-prelit-level** — additive day-luma shift pulling outlier medians to the hood median; darkening
   shifts fade to zero across the model's own bright tail (lit windows/signs survive).
7. **bake-vertex-ao** — models flagged `flat` (no baked shading at all) get real shading: per-vertex
   hemisphere occlusion against the model's own geometry (tool-kit BVH, deterministic ray set), normalized so
   the median stays at the levelled value.
8. **conform-night** — darken a night set that glows above the local night/day ratio (only with corroborating
   day evidence — glow props like street lamps are design; tail-guarded so lit windows survive), or synthesize
   a missing one at the local ratio (capped).

(The former global-heuristic `condition-prelit` / `synthesize-night` / `recompute-normals` plugins were removed
— see plans 012/013/002 for why.)

Every stage is a small, independently-tested pure transform wrapped in a `MapPlugin`.

## How it works

```
--game <path>  --out <path>
  resolve   reuse the build partition: open models/*.img + parse data/ IDE+IPL → the map's model DFFs
  read      DFF bytes → RWClump (../src parser) → neutral MeshIR
  pipeline  MeshIR ──▶ plugin1 ▶ … ▶ pluginN   (per model, concurrency-limited, errors isolated)
  write     MeshIR → DFF bytes (in-house serializer)   → --out  + report.json
```

- **Faithful chunk codec** (`src/adapters/gta-sa/codec/chunk.ts`): `writeRw(readRw(bytes))` is byte-exact, so
  an unchanged model round-trips identically.
- **Re-encoder** (`geometry-struct.ts` + `geometry-rebuild.ts`): rewrites a Geometry's Struct (and, on a
  vertex/triangle count change, regenerates **BinMeshPLG**, remaps **night colours**, recomputes the
  **bounding sphere**). It **refuses** (per-asset) what the neutral IR can't safely remap — skinned, multi-UV,
  or multi-morph geometry — so those models are skipped, not corrupted.

## Layout

```
map-optimizer/
  src/
    cli.ts                 # --game entry
    optimizer.config.ts    # the default pipeline
    core/                  # game-agnostic: ir, asset, adapter iface, pipeline, report
    adapters/gta-sa/       # RenderWare adapter: resolve / read / codec (the DFF writer)
    plugins/               # weld, degenerate, dedupe, prune, smooth-normals, prelit appliers (+ shared vertex-compaction)
    review/                # prelit review report: verdict thumbnails (CPU raster) + self-contained HTML
    review-cli.ts          # --game → review.html (plan 019 Phase 2)
    compare-serve.ts       # serves models from two game trees for viewer.html?tab=compare (BEFORE via /dff+/txd, AFTER via /osm)
  docs/plans/              # numbered design plans (001 base … 008 report)
  out/                     # generated output (gitignored)
```

## Extending

- **A new transform:** add a `plugins/<name>.ts` exporting a `create…(): MapPlugin` (and ideally a pure
  function + unit test), then list it in `optimizer.config.ts`.
- **Another game:** implement `core/adapter.ts`'s `GameAdapter` under `src/adapters/<game>/` (resolve / read /
  write for that game's format). The core and plugins don't change.

## Status & safety

Everything implemented is **provably lossless** (no appearance change), validated by parser round-trip +
triangle/material-split integrity over the full gostown map (0 serializer failures). The remaining backlog
items **change appearance** and need **in-game visual validation** before shipping:

- coplanar / decal-aware face dedupe (a blanket version would delete intentional decals);
- hole-fill / remesh;
- auto-wind weight authoring.

See [`docs/plans/`](./docs/plans/) for the full design history.
