# 2026-07-21 — the 6-layer decomposition of the map build

Data: [`2026-07-21-ingame-layer-decomposition.json`](2026-07-21-ingame-layer-decomposition.json).
This is the run that answers "where did the map get heavier" (the open question in
[`2026-07-21-http-dir-sweep.md`](2026-07-21-http-dir-sweep.md), rows #18).

## Conditions

User's machine and display, in-game `?bench=all` sweep, **1126 road cars** (the older series ran 841 — do
not compare absolute draw counts to any pre-07-21 row). Six builds, each taken from a pmb `.work`
intermediate and re-converted through `opensa-pack`:

`original → modifications → optimizations → trees → procobj → all (+lods)`

Numbers came as a chat paste of the console `[bench]` lines. Anything reporting fps 120 is vsync-locked —
read `gpuMs.pass`, `avgTriangles`, `avgDrawCalls` there, never `avgMs`.

## The headline: trees is the whole regression

`ganton-noon` (street level, the scene that matches the field report), GPU pass in ms and triangles/frame:

| Layer         | pass ms |    Δ pass | triangles | draws |      fps |
| ------------- | ------: | --------: | --------: | ----: | -------: |
| original  |   4.779 |         — |   371 031 |  1129 |    114.5 |
| modifications |   5.323 | **+0.54** |   459 941 |  1229 |    105.5 |
| optimizations |   5.360 |     +0.04 |   459 009 |  1216 |    104.1 |
| trees         |  13.718 | **+8.36** | 1 455 734 |  1255 | **53.0** |
| procobj       |  13.787 |     +0.07 | 1 455 773 |  1257 |     53.2 |
| all (+lods)   |  14.011 |     +0.22 | 1 722 869 |  1374 |     51.9 |

**Trees account for ~90 % of the total pass regression** (8.36 of 9.23 ms). Every other layer is between
noise and half a millisecond. The same shape holds on every ground-level scene:

| Scene         | base pass |  +trees Δ | +procobj Δ | +lods Δ |
| ------------- | --------: | --------: | ---------: | ------: |
| ganton-noon   |     4.779 | **+8.36** |      +0.07 |   +0.22 |
| ganton-night  |     4.850 | **+8.40** |      -0.02 |   +0.19 |
| country-dusk  |     4.289 | **+7.35** |      +0.38 |   +0.37 |
| lv-night      |     3.411 | **+4.42** |      +0.07 |   +0.81 |
| ls-noon       |     2.699 | **+1.60** |      +0.27 |   +0.52 |
| ls-rain-night |     2.875 | **+1.50** |      +0.01 |   +0.02 |
| ocean-horizon |     1.831 |     -0.04 |      +0.01 |   +0.00 |

`ocean-horizon` (no map content in frame) does not move at any layer — the control scene behaves.

## The cost is overdraw, not geometry

The decisive comparison is inside the trees layer itself:

| Scene       | triangles | pass ms | camera                |
| ----------- | --------: | ------: | --------------------- |
| ls-noon     | 1 480 819 |    4.15 | flyover, 90–120 m     |
| ganton-noon | 1 455 734 |   13.72 | street level, 20–30 m |

**Same triangle count, 3.3× the pass time.** Triangle throughput is therefore not the limit. What differs
is screen coverage: at street level the alpha-tested foliage fills the framebuffer and layers on itself, so
the frame is fragment-bound on foliage overdraw. The corroborating signal is `probe`, which also rasterises
the world: at Ganton it goes 0.71 → 2.45 ms across the trees layer (3.5×), tracking the same cause.

That also explains why the field report ("Ganton ~40 fps") never reproduced on the old flyover scenes.

## Secondary readings

- **`optimizations` buys nothing measurable.** Draws move 1–3 % (within run-to-run noise), triangles do not
  move at all, pass does not move. Whatever the optimize stage is doing does not show up at any of these
  eight scenes. That is a finding about the stage, not about the renderer.
- **`modifications` is mostly texture memory.** Texture residency roughly doubles (ls-noon 300 → 662 MB,
  lv-night 370 → 765 MB). Geometry moves a little (sf-fog-dawn 293 k → 470 k triangles, +61 %; ganton
  +24 %), pass moves ~0.3–0.5 ms. It costs ~9 fps at Ganton — real, but an order below trees.
- **`lods` is cheap in time, expensive in residency.** ls-noon triangles 1.48 M → 2.45 M (+65 %) and draws
  1010 → 1201 for +0.52 ms of pass; `cellVertex` residency 78 → 172 MB. Far LODs are small on screen, so
  they cost bandwidth and memory rather than fill.
- **`procobj` is essentially free** everywhere (≤ +0.38 ms), which retires it as a suspect.
- **Caveat — thermals.** Inside the trees/procobj/all sweeps the per-frame `gpu` line climbs steadily from
  ~12 to ~30 ms and falls back. Ganton runs last in the scene order, so its absolute numbers may carry some
  of that. The layer-to-layer deltas still stand: the base layer's Ganton rows sit at the same position in
  the sweep and stay at 4.8 ms.

## Asset audit — what is actually standing at Ganton

Counted statically from the build intermediates (`4-optimize` = stock trees, `5-trees` = swapped), joining
every text IPL plus the 165 binary IPLs inside `gta3.img` against the IDE tables, then keeping instances
whose own IDE draw distance covers the `ganton-noon` camera path:

|                                        | value                        |
| -------------------------------------- | ---------------------------- |
| HD vegetation instances in draw range  | **156** (15 distinct models) |
| their triangles, stock                 | 13 524                       |
| their triangles, after the trees stage | **645 433** — **×47.7**      |
| their leaf/bark surface area, stock    | 353 482 m²                   |
| their surface area, after              | 587 239 m² — **×1.66**       |

Everything else in range for comparison: 298 non-vegetation HD instances = 63 921 triangles, and 2935 LOD
instances = 100 517 triangles (the tree impostors are 16 triangles each — they are not the problem).
Adding the ~1126-car population's share accounts for the rest of the measured 1.46 M.

**There is no duplication.** Each mod DFF is a single clump: 1 atomic, 1 geometry, and duplicate-triangle
counts of 0–470 out of ~5000. The models are simply built at a density the near field cannot afford:

| model          | instances | stock tris | mod tris | stock avg tri | mod avg tri | stock area |  mod area |
| -------------- | --------: | ---------: | -------: | ------------: | ----------: | ---------: | --------: |
| `veg_palm04`   |        45 |         48 | **5036** |      12.94 m² |    0.104 m² |     621 m² |    524 m² |
| `sm_veg_tree4` |        20 |        132 |     5813 |       5.83 m² |    0.668 m² |     769 m² |   3882 m² |
| `veg_bevtree2` |        20 |        118 |     5572 |      90.82 m² |    2.872 m² |  10 717 m² | 16 003 m² |
| `veg_treea1`   |        14 |         68 |     2224 |      27.60 m² |    2.257 m² |    1877 m² |   5019 m² |

Two different failures hide in that table, and they need different fixes:

1. **Over-tessellation that buys nothing.** `veg_palm04` has **105× the triangles for slightly LESS painted
   surface** (524 vs 621 m²). Its average triangle is 0.104 m² — about 32 cm across — so at 20–30 m viewing
   distance a large share of them land under the rasteriser's 2×2 quad granularity, where every triangle
   costs four shaded samples regardless of size. Pure waste: no silhouette, no coverage, no visual gain.
   45 palms of these alone are 226 620 triangles, a third of all vegetation geometry in the scene.
2. **Genuinely more leaf surface.** `sm_veg_tree4` paints **5×** the area of the stock model, `veg_treea1`
   2.7×. That is real added overdraw and it does show up as image quality — it is a trade, not a bug.

Aggregate: geometry went up **47.7×** while painted surface went up **1.66×**. Roughly **96 % of the added
triangles do not add coverage.**

## What "39. Green Piece 1.47" cost — predicted, then measured

> **Outcome: the user deleted the mod on 2026-07-21 and parked every other foliage lever.** The paths in
> this section describe the build as it was when measured; `mods-src/original/mods/39. Green Piece 1.47` no longer
> exists, so any pak built after that date is not comparable to the "with Green Piece" column below.

`mods-src/original/mods/39. Green Piece 1.47` shipped **no models at all**: it was one `Green Piece.IPL` with 233 `inst`
lines that PLACE extra vegetation, installed at the `mods` stage (appended into `stadint.ipl`; all 233 were
located in the built map). It is therefore invisible in the mods-layer measurement — at that point the trees
it places are still the stock 48–132-triangle models, which is why the whole mods layer cost only +0.54 ms.
The trees stage then swaps those same models to 1451–5813 triangles, and the mod's placements inherit it.

The placements sit in **east Los Santos only** (bbox x 1935..2920, y −1861..−1079) — squarely on the
`ganton` path:

| in draw range of the ganton path | instances |          triangles |               leaf area |
| -------------------------------- | --------: | -----------------: | ----------------------: |
| all HD vegetation                |       156 |            645 433 |              587 239 m² |
| — placed by Green Piece          |    **62** | **245 181** (38 %) | **380 027 m² (64.7 %)** |
| — stock placement                |        94 |     400 252 (62 %) |     207 212 m² (35.3 %) |

Map-wide it is only 209 of 10 117 HD vegetation instances (**2.1 %**), and the other bench scenes barely
see it: ls-noon / ls-rain-night 11 % of in-range leaf area, sf-fog-dawn / lv-night / country-dusk / ocean
**0 %**. It is a Ganton-specific cost almost exclusively.

It is 65 % of the leaf area but only 38 % of the triangles because it placed the **big-canopy** models:
15 of the 20 `sm_veg_tree4`, 15 of 20 `veg_bevtree2`, 13 of 14 `veg_treea1`, 14 of 15 `sm_bevhiltree` — while
40 of the 45 palms are stock placements.

### MEASURED — the A/B was run

Data: [`2026-07-21-ingame-trees-no-greenpiece.json`](2026-07-21-ingame-trees-no-greenpiece.json). The mod was
stripped index-safely (233 HD instances + their 210 linked LOD partners, surviving `lod` fields remapped) and
the game dir re-packed; the pack matches the reference (1123 cells both sides, pak 1.048 vs 1.054 GB, AO
triangles 110.2 M vs 111.6 M). Same machine, same sweep, 1126 road cars. The `trees` layer above is the
BEFORE side.

| ganton-noon | with Green Piece |      without |                    Δ |
| ----------- | ---------------: | -----------: | -------------------: |
| gpu pass    |        13.718 ms | **7.626 ms** | **−6.09 ms (−44 %)** |
| fps         |             53.0 |     **81.8** |            **+28.8** |
| avgMs       |           18.858 |       12.220 |                −6.64 |
| p95Ms       |             24.4 |         14.8 |                 −9.6 |
| triangles   |        1 455 734 |    1 193 831 |     −261 903 (−18 %) |
| draws       |             1255 |         1258 |                   +3 |
| probe       |         2.453 ms |     1.567 ms |             −0.89 ms |

`ganton-night` is the same to within noise: pass 13.855 → 7.705, fps 53.3 → 81.1.

**The estimate was beaten.** Predicted 8.6–10.8 ms of pass and ~62–70 fps; measured 7.63 ms and 81.8 fps.
The static triangle prediction was near-exact — 245 181 predicted, **261 903 measured** (7 % out).

**And it settles the mechanism.** Triangles fell 18 % while pass fell 44 % — a 2.4× disproportion. Cost is
per-pixel, not per-triangle; the leaf-area model (64.7 % share) predicted the direction and still
under-called the size. Draw calls did not move at all, retiring them as a factor for good.

**Scale of it:** the whole trees layer costs +8.36 ms at Ganton, and **6.09 ms of that — 73 % — comes from
233 instances placed by one mod**, 2.1 % of the map's HD vegetation.

The six non-ganton scenes were the control and came back flat (pass within ±0.07 ms, triangles within
0.3 %, `ocean-horizon` identical at 116 031) — so the experiment moved only what it was supposed to.

## What this points at — PARKED, not queued

The user's decision on 2026-07-21 was: delete Green Piece, change nothing else, observe. **Nothing below is
in progress.** It is written down so a future perf push knows where to dig, in order of expected return:

1. **Decimate the mod trees to their own silhouette.** Target the models whose surface area did NOT grow —
   `veg_palm04` first (105× triangles for less area than stock). A budget in the 300–800 triangle range
   keeps the shape and removes the micro-triangle tax. `lod-common`'s budgeted QEM already exists for this.
2. **An intermediate LOD ring.** Today the chain is 5000-triangle HD → 16-triangle impostor with nothing
   between, so the full HD mesh is carried to the edge of a 150 m draw distance. A mid LOD at ~30–50 m
   would cut most of the in-range instances without touching what the player stands next to.
3. Only then the shader side: fewer overlapping leaf layers, and keeping foliage out of the probe pass
   unless it is needed there (probe went 0.71 → 2.45 ms on the same layer).

Draw distance is worth a look too: `veg_palm04` and `veg_treea1` carry `150` in `vegepart.ide`, unchanged
from stock — sized for 48-triangle models, not 5000-triangle ones.
