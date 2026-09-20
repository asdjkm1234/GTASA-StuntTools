# 074·12 — Stochastic texturing (de-tiling, the skygfx way, offline-selected)

> **STATUS: UNSTABLE — built, data-ready, DEFAULT OFF (user verdict 2026-07-12).** Ships dormant
> (`Environment.stochastic = 0`, `?stoch=1` re-enables). Needs finishing before default-on: the
> histogram-preserving upgrade, a grazing-angle field test, and a per-texture list QA pass.
> What that finishing would be, with what session 17 learned from the reference install: [ideas/stochastic-texturing-v2](../../ideas/stochastic-texturing-v2/readme.md).

[← chain](readme.md) · relates: [02 formats](02-native-formats.md) · [03 converter](../../../tools/opensa-pack/docs/plans/000-converter-tool.md) ·
[06 effects](06-world-effects-parity.md)

Revives the parked [improvements/stochastic-texturing](../../improvements/stochastic-texturing.md) research:
large tiled surfaces (ground, grass, sand, roads) show macro-repetition; stochastic tiling-and-blending hides
it. The old investigation parked on two blockers — **both die in the own-engine architecture**. Reference
implementation researched 2026-07-12: the JuniorDjjr skygfx fork
(<https://github.com/JuniorDjjr/skygfx>), which ships this exact feature for SA on PC.

## What skygfx actually does (research findings)

- **Shader** (`shaders/include/StochasticSamplerPS.hlsl`): the classic Deliot–Heitz _tiling and blending_
  WITHOUT histogram preservation — UVs skewed into a triangular grid (`[[1,0],[-0.577,1.155]] × UV × 3.464`),
  each of the 3 surrounding grid vertices hashes (`hash2D2D`: sin/dot magic-number hash) to a random UV
  offset, 3 texture taps blended by the barycentric weights. Explicit `ddx/ddy` gradients passed to every
  tap so the discontinuous per-triangle UV offsets don't break mip selection (grid-seam artifacts).
- **Selection** (`src/texdb.cpp`): a curated per-texture database `models/texdb.txt` — lines tag texture
  NAMES with `stochastic=1` (plus detail/alpha attributes; _siblings/affiliates_ inherit the flag). At draw
  time (`src/buildingPipe.cpp`) the pixel shader is swapped per texture (`simpleStochasticPS`,
  `xboxBuildingStochasticPS`) when `texinfo->stochastic && config->stochastic`.
- **Knobs**: global ini toggle `stochasticTexturing`, debug-menu bool, a ×1.2 UV scale fudge in the simple
  pixel shader.

The load-bearing lesson: **selection is editorial, not inferred.** skygfx never solved the "which textures
tile" problem with a signal — it ships a curated list keyed by texture name. That is exactly the answer the
old research refused to commit to at runtime, and exactly what our offline converter is built for.

## Why the two old blockers die here

| Old blocker (WebGL/three prod)                                                                                                                   | Own engine + own format                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No clean selection signal** — UV-span gating applies to ~everything (heavy tiling is the SA norm); per-material shader swaps fight the batcher | Selection moves OFFLINE where it belongs: the planner resolves every texture **by name** — a curated list (texdb-style, start from the community's tagged ground/grass/sand/road sets) marks layers at convert time. The tool can additionally PROPOSE candidates by content analysis (autocorrelation periodicity × observed UV span × mostly-horizontal usage) — affordable offline, impossible per frame |
| **Histogram-preserving conflicts with DXT** (needs decode + Gaussianize + LUT)                                                                   | v1 doesn't need it (skygfx ships the plain 3-tap on DXT and reads fine at gameplay distance). If contrast wash shows, the converter ALREADY owns full texel processing (decode → process → re-encode + offline mips) — Gaussianized layers + an inverse-LUT texture are a tool stage, not an engine hack                                                                                                    |

And the batching problem inverts: skygfx swaps pixel shaders per texture; we CAN'T (one merged group mixes
many layers) — but we don't need to. The flag rides the DATA per vertex, and one world shader branches on it.

## Design (v1)

- **Format**: no bump. The layer u16 of `layerChannels` carries indexes ≤ 255 — the TOP BIT (bit 15) becomes
  `LAYER_STOCHASTIC` (engine masks the index with `& 0xff`). Set by the welder from the planner's resolution.
- **Converter**: `data/stochastic.txt` (name list, texdb-inspired: bare texture names + `#` comments) or a
  `--stochastic <file>` override; planner marks `ResolvedTexture.stochastic`; report counts flagged layers.
  Later (pmb integration): the auto-candidate analyzer emits a REVIEW list, humans promote entries.
- **WGSL**: port `tex2DStochastic` — same skew/hash/3-tap math; **`textureSampleGrad`** with `dpdx/dpdy` of
  the ORIGINAL UV (mandatory twice over: grid-seam mips + WGSL forbids implicit-grad `textureSample` in the
  non-uniform branch). Branch on the per-vertex flag (flat varying); non-flagged pixels keep the single tap.
- **Mips**: fully covered by the grad path — `textureSampleGrad` with the ORIGINAL UV's derivatives gives
  correct mip selection per tap (the hash offsets are discontinuous at grid seams; implicit gradients there
  pick garbage mips — the exact artifact skygfx's explicit `ddx/ddy` exists for). Our offline `.ostex` mip
  chains need NO change for v1 (offsets live in wrap-sampled UV space; deep mips converging toward the
  texture mean is the method's normal far-field behaviour). The histogram-preserving upgrade, if taken,
  must Gaussianize EVERY mip level (per-mip transform in the converter), not just level 0.
- **Fog/lighting unchanged** — this replaces only the texel fetch.
- **Knobs**: `?stoch=0` lab A/B toggle (env flag in `params2` spare... none left — grow the UBO or pack into
  windStrength sign? decide at build time; a compile-time constant + reconvert-free toggle is acceptable v1).
- **Cost gate**: 3 taps only on flagged layers (ground/grass/sand/road — a minority of pixels but often
  screen-dominant). Bench ritual before/after on `drive`; budget ≤ +0.5 ms GPU p95 at 2× retina.

## Tasks

- [x] WGSL port of the sampler (skew + hash2D2D + 3-tap `textureSampleGrad`) behind the per-vertex flag +
      golden snapshot + guardrail pass.
- [x] Planner/welder: name-list → `ResolvedTexture.stochastic` → layer bit 15; engine masks the index.
- [x] Seed `data/stochastic.txt` for the LS rect — 28 names (grass/dirt/gravel/pavement/tarmac); ROADS
      WITH LANE MARKINGS excluded on purpose (offsets scramble painted lines).
- [ ] Field A/B + bench row; acceptance = macro-repetition visibly gone on ground planes at the aerial
      camera, no seam/mip artifacts up close, gate ≤ +0.5 ms GPU p95.
- [ ] (later) Histogram-preserving upgrade if contrast wash is objectionable: Gaussianize + inverse LUT as a
      converter stage (the format already buckets arbitrary layer payloads).
- [x] (v0 shipped 2026-07-12) Auto-candidate analyzer: `stochastic-candidates.ts` ranks a rect's textures
      by COVERED TRIANGLE AREA and prints the top entries not yet listed — the curation loop is run/eyeball/
      promote/reconvert (found the LS beach `sandnew_law` + the big lawns on first run). Periodicity × slope
      refinement stays a later pmb upgrade.
- [x] skygfx interop: the list loader also parses the mod's own `texdb.txt` format (`"name" … stochastic=1`).
      The mod's FULL database (user-supplied, 307 tagged names — metals/wood/plaster beyond ground) now lives
      at `data/skygfx-texdb.txt` and is merged with our curated list BY DEFAULT
      (`--stochastic <file>[,<file>…]` overrides). LS flagged verts: 23 k → 172.8 k with the merge.

## Measurement ledger

| Date       | What                              | Numbers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-07-12 | v1 implemented                    | 23,045 flagged verts in the LS rect (ground planes: few verts, many pixels); toggle rides `moonDir.w` (spare slot), lab `?stoch=0`; sample-then-override keeps the common path uniform (flagged pixels cost 4 taps total); both paks reconverted. GPU Δ + field verdict pending the ritual bench                                                                                                                                                                                                                     |
| 2026-07-12 | field round 2 + skygfx db         | LS beach missed round 1 (`sandnew_law`; `sw_sand` was the SF sand) → +6 names via the area scan; the mod's full texdb merged as a default source (307 tagged names): LS flagged verts 23 k → 172.8 k, SF 76.6 k. **FIELD ACCEPTED v1** ("overall good, keep as is" — user); bench: series row (12+13) — the combined night run costs +0.67 ms GPU avg for stochastic+coronas+emissive+moon, stochastic share inside its ≤+0.5 gate                                                                                   |
| 2026-07-12 | **CURATION RULE (field round 3)** | the skygfx-db merge BROKE structured textures (field screens): sidewalk grass-strips scrambled to random patches, pavement oil-stains ghost-smeared, beach dot-grid + steep-face UVs striped. The plain 3-tap is only honest on UNIFORM NOISE — default list trimmed to grass/dirt/gravel (LS 23.2 k / SF 6.2 k flagged verts), skygfx texdb demoted to OPT-IN (`--stochastic`). Structured textures may return with the histogram-preserving upgrade + per-texture review (rule written into `data/stochastic.txt`) |
| 2026-07-12 | **DEFAULT OFF (field round 4)**   | street-level grazing views smear high-contrast listed textures into dashes (3-tap ghosting of macro features along anisotropic footprints — bridge-road screen). Engine default flipped to `stochastic: 0`; `?stoch=1` keeps the A/B alive; the DATA stays flagged (no reconvert to re-enable). Re-enable criteria: histogram-preserving upgrade + a grazing-angle test added to the field checklist                                                                                                                 |
