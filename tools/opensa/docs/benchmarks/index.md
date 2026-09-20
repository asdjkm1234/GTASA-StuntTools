# The benchmark record, in chronological order

**This index is the PERFORMANCE family.** The vehicle-physics captures keep their own chronology in
[`vehicle-physics/readme.md`](vehicle-physics/readme.md) — a lap measures behaviour, not frame cost, and the
two must not be read against each other.

Every run in this folder, oldest first, with the conditions it was taken under. **Conditions are the whole
point:** two runs are only comparable when the machine, the scene set, the pak and the flags match, and most
of the confusion in this project's perf history came from comparing rows that did not.

Format and the standing rule: [readme.md](readme.md). How to produce a run:
[`../development/benchmarks.md`](../development/benchmarks.md).

## Read this before comparing any two rows

- **Two different harnesses live here.** The `drive` / `city` / `map` / `teleport` / `whip` runs are
  **headless lab** paths (`tools-debug/bench-harness`, ANGLE, a small `pak-ls`/`pak-map`), reporting
  `frameMs` + `gpuPassMs` + `residencyMb`. The `ingame` runs are the **in-game `?bench=all` sweep** on the
  real display, reporting per-scene `avgMs`/`p95Ms`/`fps`/`avgDrawCalls`. Their numbers are NOT comparable
  to each other — only within a family.
- **Everything through 2026-07-18 was vsync-locked at 120 fps / 8.33 ms.** A frame average of 8.33 does not
  mean "8.33 ms of work"; it means the frame finished early and waited. Use `gpuPassMs`, `p95Ms` and
  `draws` to see the real cost in those rows — the frame average is saturated and will hide a regression
  until it exceeds the budget.
- **The pak is a variable.** Converter output decides what the world contains; a pak missing far LODs
  benchmarks faster than one that has them. Older lab rows carry a `converter` block naming the build;
  the in-game rows mostly do not, and that gap blocked the 07-20 diagnosis until #21 rebuilt the paks layer
  by layer.

## The three-engine (prod) line — the record we migrated away from

Kept because every own-engine claim is expressed against it. Same six bench scenes throughout.

| Date    | File                                                                      | Conditions                                                                    | Headline numbers                                                                              |
| ------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 2026-06 | [classic-baseline](three-engine/2026-06-classic-baseline.json)            | classic pre-overhaul WebGL pipeline, M3 Pro, ANGLE→Metal                      | 18.7–78.2 fps · avg 12.8–53.5 ms · draws **62–10 445** · GPU timer unreliable                 |
| 2026-07 | [modern-default](three-engine/2026-07-modern-default.json)                | full 064–071 chain on, clouds off, same machine/scenes                        | avg **33.5–97.3 ms** · draws 86–15 165 — the modern pipe cost +62…162 % frame                 |
| 07-12   | [webgl-webgpu-babylon](three-engine/2026-07-12-webgl-webgpu-babylon.json) | the shoot-out that justified an own engine, ls-noon                           | three WebGL 65 ms / 14 454 draws · three WebGPU **300–400 ms** · Babylon 0.12 ms submit @15 k |
| 07-17   | [prod-display-c1](three-engine/2026-07-17-prod-display-c1.json)           | user's display, **841 road cars** — partner of own-engine row #13             | 13.5–54.3 fps · avg 18.4–74.0 ms · draws 55–8 956                                             |
| 07-18   | [preflip-prod](three-engine/2026-07-18-preflip-prod.json)                 | user's display, 841 cars, back-to-back with the own engine — **the flip row** | 16.2–59.6 fps · avg 16.8–61.6 ms · draws 60–10 119                                            |

## The opensa-engine line, chronologically

| #   | Date        | File                                                                                                                                                                                                                                                                           | Harness / scene                                | Conditions                                                                                                                                                                                                    | Headline numbers                                                                                                                                                                                                          |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 07-12 07:13 | [drive-ao](opensa-engine/2026-07-12-drive-ao.json)                                                                                                                                                                                                                             | lab `drive`                                    | `?pak=1&stream=1`, dpr 2, 3456×1846                                                                                                                                                                           | frame 8.333 / p95 9.3 · GPU pass **1.94** (p95 2.75) · draws 255 avg / 334 max · resid 265 MB                                                                                                                             |
| 2   | 07-12 07:31 | [drive-sunvis](opensa-engine/2026-07-12-drive-sunvis.json)                                                                                                                                                                                                                     | lab `drive`                                    | same as #1, + sun-vis bake                                                                                                                                                                                    | frame 8.333 / p95 9.2 · GPU pass **2.08** · draws 255 / 334 · resid 265 MB                                                                                                                                                |
| 3   | 07-12 07:57 | [drive-wind-hd](opensa-engine/2026-07-12-drive-wind-hd.json)                                                                                                                                                                                                                   | lab `drive`                                    | same as #1, + HD wind                                                                                                                                                                                         | frame 8.335 / p95 9.3 · GPU pass **2.79** · draws 296 / 394 · resid 359 MB                                                                                                                                                |
| 4   | 07-12 08:14 | [drive-tobj-night](opensa-engine/2026-07-12-drive-tobj-night.json)                                                                                                                                                                                                             | lab `drive`, **night**                         | `&hour=22`, timed objects                                                                                                                                                                                     | frame 8.334 / p95 9.3 · GPU pass **2.86** · draws 302 / 401 · resid 360 MB                                                                                                                                                |
| 5   | 07-12 11:10 | [drive-stoch-coronas-night](opensa-engine/2026-07-12-drive-stoch-coronas-night.json)                                                                                                                                                                                           | lab `drive`, **night**                         | `&hour=22`, stochastic coronas                                                                                                                                                                                | frame 8.334 / p95 9.3 · GPU pass **3.53** (p95 4.85) · draws 303 / 402 · resid 360 MB                                                                                                                                     |
| 6   | 07-12 13:02 | [city-full-ls](opensa-engine/2026-07-12-city-full-ls.json)                                                                                                                                                                                                                     | lab `city`, full LS                            | `src=pak-ls`; converter: 345 cells, pak 1151 MB, AO bake 418 s                                                                                                                                                | frame 8.339 / p95 9.3 · GPU pass **2.67** · draws 225 / 582 · resid 409 MB                                                                                                                                                |
| 7   | 07-12 14:54 | [whip-full-ls](opensa-engine/2026-07-12-whip-full-ls.json)                                                                                                                                                                                                                     | lab `whip` (fast camera whip), full LS         | `src=pak-ls`; converter: 345 cells, pak 500 MB                                                                                                                                                                | frame 8.333 / p95 9.3 · GPU pass **0.88** · draws 17.7 / 103 · resid 406 MB                                                                                                                                               |
| 8   | 07-12 14:55 | [teleport-full-ls](opensa-engine/2026-07-12-teleport-full-ls.json)                                                                                                                                                                                                             | lab `teleport` (streaming stress), full LS     | `src=pak-ls`; same converter as #7                                                                                                                                                                            | frame 8.334 / p95 **9.4** · GPU pass 1.33 · draws 85 / **481** · resid 407 MB · heap 257 MB                                                                                                                               |
| 9   | 07-13 07:01 | [drive-meshopt](opensa-engine/2026-07-13-drive-meshopt.json)                                                                                                                                                                                                                   | lab `drive`                                    | after meshopt; converter: 40 cells, pak 69 MB                                                                                                                                                                 | frame 8.333 / p95 9.3 · GPU pass **2.93** · draws 290 / 388 · resid 360 MB                                                                                                                                                |
| 10  | 07-13 08:06 | [map-full-map](opensa-engine/2026-07-13-map-full-map.json)                                                                                                                                                                                                                     | lab `map`, **whole map**                       | `src=pak-map`; converter: 1121 cells, pak 770 MB, 176 timed objects                                                                                                                                           | frame 8.332 / p95 9.2 · GPU pass **2.90** · draws 393 / 680 · resid **637 MB**                                                                                                                                            |
| 11  | 07-13 09:34 | [drive-lightpool-night](opensa-engine/2026-07-13-drive-lightpool-night.json)                                                                                                                                                                                                   | lab `drive`, **night**, narrower window (2444) | `&hour=22`, light pool; converter: 40 cells, pak 69 MB                                                                                                                                                        | frame 8.334 / p95 9.1 · GPU pass **3.64** (p95 4.92) · draws 267 / 378 · submit 0.43                                                                                                                                      |
| 12  | 07-14 20:36 | [ingame-vehicles](opensa-engine/2026-07-14-ingame-vehicles.json)                                                                                                                                                                                                               | **in-game sweep**, 6 scenes                    | commit `33c74c9` (vehicles B5), pak-map bakeless, Chrome / M3 Pro                                                                                                                                             | 119.9–120 fps · p95 9.2–9.4 · draws **8–462**                                                                                                                                                                             |
| 13  | 07-14 20:36 | [ingame-particles](opensa-engine/2026-07-14-ingame-particles.json)                                                                                                                                                                                                             | **in-game sweep**, 6 scenes                    | commit `3cf13e7` (reflections v1 + 2dfx particles/coronas B5r+B6), same pak                                                                                                                                   | 120 fps · p95 ≤ 9.4 · draws **8–463**                                                                                                                                                                                     |
| 14  | 07-18       | [series](opensa-engine/2026-07-18-series.md) + [preflip-baseline](opensa-engine/2026-07-18-ingame-preflip-baseline.json)                                                                                                                                                       | **in-game sweep**, 6 scenes, engine vs prod    | M3 Pro @2× retina, **841 road cars**, after the 07-18 fix batch (night-NaN, live-VFS timecyc, fog dissolve, regional weather). **Pak build unrecorded.**                                                      | **119.6–120.3 fps** · p95 9.2–9.3 · draws **11–1065** · pass 1.85–4.09 · probe 0.23–0.55 · submit 0.33–0.49                                                                                                               |
| 15  | 07-20       | [ingame-regression](opensa-engine/2026-07-20-ingame-regression.json)                                                                                                                                                                                                           | **in-game sweep**, 6 scenes                    | same machine, same 841 cars, **after a pak rebuild**. Chat paste, not a file capture.                                                                                                                         | **58.3–117.3 fps** · p95 **17.5–56.2** · draws 19–1678 · pass 1.80–**12.56** · probe 0.53–1.94 · submit 0.20–**3.33**                                                                                                     |
| 15b | 07-19/20    | bisect, 4 files: [B `95bd544`](opensa-engine/2026-07-19-ingame-95bd544.json) · [C `52b4ec9`](opensa-engine/2026-07-20-ingame-52b4ec9.json) · [D `03f05b1`](opensa-engine/2026-07-20-ingame-03f05b1.json) · [HEAD `436d2f2`](opensa-engine/2026-07-20-ingame-436d2f2-head.json) | in-game sweep, 6 scenes                        | four-point commit bisect of the 07-18 → 07-20 jump, all on ONE fixed pak, same machine, 841 cars; chat pastes                                                                                                 | no commit in the window caused it — identical draws, noise-level frame times; only D costs ~5 % on the two heaviest scenes. Narrative in [readme.md](readme.md)                                                           |
| 18  | 07-21       | [http-dir-sweep](opensa-engine/2026-07-21-http-dir-sweep.md) + [json](opensa-engine/2026-07-21-httpdir-sweep-8eaa287.json)                                                                                                                                                     | headless sweep, 6 scenes                       | first sweep through the REAL loader (`?loader=http-dir`, plan 079 phase 3), fresh `10:45 21-07` build, DPR 2                                                                                                  | 120 fps all six · late 0 · draws 16–1647 (**+57/+71 % vs 07-18 on lv-night/country** — the fuller build)                                                                                                                  |
| 19  | 07-21       | [scale-ladder](opensa-engine/2026-07-21-scale-ladder.md) + [json](opensa-engine/2026-07-21-scale-ladder.json)                                                                                                                                                                  | headless sweep ×3 (`?scale=1/0.75/0.5`)        | 072 tier-ladder decision data; same build/harness as #18, DPR 2                                                                                                                                               | 120 fps everywhere · pass −4…−32 % at 0.5 (floor ~2 ms is resolution-independent) · targets 345→88 MB · **no ladder needed**                                                                                              |
| 20  | 07-21       | [soak30-headless](opensa-engine/2026-07-21-soak30-headless.json)                                                                                                                                                                                                               | headless `?soak=30`, 102 legs                  | 063 cell-disposal GPU-leak check; same build/harness, DPR 2                                                                                                                                                   | **PASS 8/8** · residency 1805→1804 MB · texture 1277→1276 · heap flat · late 0 · long tasks 0 — **no leak**                                                                                                               |
| 21  | 07-21       | [layer-decomposition](opensa-engine/2026-07-21-layer-decomposition.md) + [json](opensa-engine/2026-07-21-ingame-layer-decomposition.json)                                                                                                                                      | in-game `?bench=all`, 8 scenes, ×6 builds      | THE 6-layer build decomposition (original/mods/opt/trees/procobj/all), each `.work` stage re-converted through opensa-pack; user's display, **1126 road cars**                                            | **trees = ~90 % of the regression** (ganton pass 5.36→13.72 ms, 53 fps) · procobj/lods ≤ +0.4 ms · opt buys nothing · same tris cost 3.3× at street level → **overdraw-bound, not geometry**                              |
| 22  | 07-21       | [trees-no-greenpiece](opensa-engine/2026-07-21-ingame-trees-no-greenpiece.json) (analysis in [layer-decomposition](opensa-engine/2026-07-21-layer-decomposition.md))                                                                                                           | in-game `?bench=all`, 8 scenes                 | A/B on the `trees` layer with mod `39. Green Piece 1.47` stripped (233 placements + 210 linked LODs, index-safe) and re-packed; pack verified 1123 cells / 1.048 GB vs the 1.054 GB reference; 1126 road cars | ganton pass **13.72 → 7.63 ms**, fps **53.0 → 81.8** · tris −18 % but pass −44 % → **cost is per-pixel, not per-triangle** · 6.09 of the trees layer's 8.36 ms from 2.1 % of the map's vegetation · 6 control scenes flat |

### The rows that were only tables until now

| #   | Date  | File                                                                                       | Conditions                                                               | Headline numbers                                                         |
| --- | ----- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| 0   | 07-11 | [early-milestones](opensa-engine/2026-07-11-early-milestones.json)                         | M0 first light: synthetic 12×12, then ls-bench (40 entries)              | 8.33 ms vsync · GPU **1.44 → 1.84** · draws 528 → 807 · resid 224→294 MB |
| 13  | 07-16 | [ingame-display-c1](opensa-engine/2026-07-16-ingame-display-c1.json)                       | user's display, **841 road cars** — partner of the prod 07-17 row        | **120 fps all six** · p95 ≤ 9.2 · draws 11–1 243 · pass 1.86–3.48        |
| 16  | 07-18 | [headless-regional-weather](opensa-engine/2026-07-18-headless-regional-weather.json)       | after the regional-weather fix (074/21); headless DPR 2                  | 119.8–120 fps · world pass 1.58–2.12 · draws 9–1 044 · late 0            |
| 17  | 07-18 | [headless-postteardown-ritual](opensa-engine/2026-07-18-headless-postteardown-ritual.json) | the 074/13 phase-8 ritual after `three` was deleted; same harness as #16 | 119.9–120 fps · pass 1.94–2.40 · draws within ±5 of #16 — **PASS**       |

## Ganton, street level — WITHDRAWN (2026-07-20)

The `ganton-noon` / `ganton-night` datasets and the `?scale=0.75` decomposition that stood here were
**deleted as invalid**. Every one of them was taken through the folder picker, and at the time the folder
picker did not select the world: `engine-canvas-host.tsx` always fetched the pak from `public/pak-map`. So
the runs measured whatever sat in `public/`, not the pak they were labelled with, and the pak-to-pak
comparisons they supported measured nothing at all.

The scenes themselves (`bench-scenes.ts`) are kept — the street-level path was the right idea. The pak
source now follows the loading mode (plan 079: folder mode reads `opensa/` from the picked folder, and the
harness boots `?loader=http-dir&src=<served build>`), so re-measured runs are trustworthy again.

## What the chronology shows

**07-12 → 07-13, lab:** the world got heavier feature by feature and the GPU pass tracked it honestly —
1.94 ms (bare drive) → 2.08 (sun-vis) → 2.79 (HD wind) → 2.86 (timed objects at night) → 3.53 (stochastic
coronas) → 3.64 (light pool). Every step stayed vsync-locked; the pass number is the only one that moved,
which is exactly how these rows should be read.

**07-14 → 07-18, in-game:** draws roughly doubled (462 → 1065 at the top end) while fps held at 120. That
jump is content, not regression — the 07-18 batch restored fog/draw distance via the regional weather remap,
so more world became visible. Cost stayed inside the budget.

**07-18 → 07-20: not a break — a fuller map.** A four-point bisect on a fixed pak (B `95bd544`,
C `52b4ec9`, D `03f05b1`, HEAD `436d2f2`) put identical draw counts and noise-level frame times at every
point, so no commit in the window caused it. The pak is the improved map — our LODs, vegetation and
procobj — and the 07-18 baseline predates them. `ocean-horizon`, the only scene without that content, did
not move. Full tables in [readme.md](readme.md).

**07-21: answered.** Rebuilding the map one pmb stage at a time (#21) put **~90 % of the regression on the
`trees` stage alone** — procobj and lods cost ≤ 0.4 ms and are retired as suspects, and the `optimize`
stage turned out to buy nothing measurable. A follow-up A/B (#22) traced **73 % of the trees cost to one
placement-only mod** ("39. Green Piece 1.47", 233 instances): removing it took ganton-noon from 13.72 to
7.63 ms of pass, 53 → 82 fps. Triangles fell 18 % while the pass fell 44 % and draws did not move, so the
cost is **per-pixel foliage fill** — draws and triangle counts mislead on these scenes. The mod was deleted;
all other foliage work is parked. Analysis:
[layer-decomposition](opensa-engine/2026-07-21-layer-decomposition.md).

**07-24: 087 LOD-ring rebuild — perf-neutral, pak 12 % smaller.** The fresh `original` rebuild after the
087 arc (per-game `PACK_RECTS`, per-cell `aabb` rings, bake grid 256→250, water row-C fix) benchmarks
**within noise of the 07-20 `436d2f2` head** on every shared scene (ls-noon 112.2, lv-night 76.2,
country-dusk 60.5, ls-rain-night 117.7, ocean-horizon 120), with `sf-fog-dawn` a touch faster (105.4→113.7,
draws 1019→995) — and it did so with a **34 % fuller car population** (1126 road cars vs 841), so the ring +
250-bake work is free. The pak shrank from **1 453 903 872 B → 1 272 901 632 B (−181 MB, −12.4 %)** at the
same 1137 cells: the 250 bake + aabb rings dropped bytes with no coverage loss. This is the 078 merge-gate
re-baseline (fps re-measured with `admiral`/`comet` converted — road cars ≠ 0 — plus the mapper pak-size
delta). Run: [`2026-07-24-ingame-617556f-087ring.json`](opensa-engine/2026-07-24-ingame-617556f-087ring.json).

**07-24: IfpSampler crossfade microbench (plan 088/02, CPU-only).** The two-clip blended sample costs
**8.24 µs vs 6.01 µs single** (1.37×) on a synthetic 32-bone/20-key clip, 20k iterations — one extra
per-bone evaluate + slerp. Invisible next to the ~2 ms pass floor; crossfades shipped with no perf gate.
Not a scene run (no pak, no GPU). Run:
[`2026-07-24-microbench-ifp-sampler-blend.json`](opensa-engine/2026-07-24-microbench-ifp-sampler-blend.json).

**07-25: camera director wired in (plan 080/01), headless check.** `ls-noon` on the 087-ring pak ran
**120 fps / 8.334 ms avg, p95 9.2, draws 1181** — vsync-capped, so it proves the bench path still runs and
draws the same class of frame, NOT the absence of a small CPU cost. Taken by Claude headless (DPR=2, road
cars 296), so it is not pass-comparable to the user's in-game rows. The director itself was microbenched
instead: **0.078 µs mean / 0.089 µs p95 per `stepCamera` call**, against plan 080's 0.1 ms p95 budget —
**0.185 µs / 0.208 µs once 080/02's smoothing channels went live** (2.4×, still 240× under the stage
budget) and **0.203 µs / 0.214 µs with 080/03's auto-center + look-ahead on top**. Run:
[`2026-07-25-headless-080-camera-director.json`](opensa-engine/2026-07-25-headless-080-camera-director.json).

### 2026-07-25 — the 080 close-out sweep (the bench-bypass proof)

The full ritual 8-scene `?bench=all` leg with the WHOLE camera chain live (rig + composition + collision +
vehicle camera + additive motion), headless, on the dev machine. **`ls-noon` 8.333 ms avg / 1181 draws
against the 080/01 headless row's 8.334 / 1181** — identical, which is the point: a running bench owns the
frame outright (`resolveCamera` priority bench > fly eye > follow rig), so camera work cannot move these
numbers, and now it is measured rather than argued. The other seven scenes had no headless predecessor and
are recorded as the headless baseline (every leg is vsync-capped at 120 fps, so this sweep can prove the
bypass but cannot resolve a small CPU regression — the user's in-game rows remain the pass-comparable
series). The director itself costs **0.568 µs mean / 0.620 p95** per call with every layer live, and the
camera issues **2 casts/frame** (one sphere cast — the whiskers are off since the 04 field round — plus one
ground ray) against a budget of 5. Run:
[`2026-07-25-headless-080-closeout-sweep.json`](opensa-engine/2026-07-25-headless-080-closeout-sweep.json).

### 2026-07-27 — what the CARS cost per fixed step (081/07 §3)

The first sweep to carry the `vehicles` field: the raycast controllers plus the vehicle system's fixed
update, per fixed step, beside the live car count. Same canonical pak (buildTime `08:41 24-07-2026`),
headless, M3 Pro. **The budget was written for 8 live cars; the bench world runs up to 80.** Per step:
`ls-noon` **0.605 ms at 80 cars**, `sf-fog-dawn` 0.555 at 66, `lv-night` 0.484 at 58, `ls-rain-night` 0.547
at 57, `country-dusk` 0.176 at 13, `ocean-horizon` **0.003 at 0** — so the slice is ~**7.6-9.5 µs per car**
and costs nothing when there are no cars. Eight cars is therefore ~**0.07 ms**, about a seventh of the
0.5 ms budget, and even the 80-car scene sits at 0.6 ms — a tenth of the fleet's worth of headroom.
Run: [`2026-07-27-headless-vehicle-step-cost.json`](opensa-engine/2026-07-27-headless-vehicle-step-cost.json).

### 2026-07-27 — the same slice, three times: it repeats to ±5 % (081/07 close-out)

The 081 close-out re-ran the sweep twice more — after plan 06 landed air control and camber, and again after
the camber geometry moved from per-step to per-car. Same pak, same harness, same machine, `vehicles.meanMs`
per fixed step:

| scene         | live | before 06 | after 06 | after the memo |
| ------------- | ---: | --------: | -------: | -------------: |
| ls-noon       |   80 |     0.605 |    0.639 |      **0.663** |
| sf-fog-dawn   |   66 |     0.555 |    0.613 |      **0.554** |
| lv-night      |   58 |     0.484 |    0.515 |          0.535 |
| ls-rain-night |   57 |     0.547 |    0.583 |          0.579 |
| country-dusk  |   13 |     0.176 |    0.186 |      **0.166** |
| ocean-horizon |    0 |     0.003 |    0.004 |          0.006 |

**Read the columns across, not down.** `sf-fog-dawn` and `country-dusk` end BELOW where they started while
`ls-noon` ends above, so the ~5 % spread is the metric's own repeatability, not the change — the per-car
camber arithmetic is under its noise floor, and so was the work removed from it. **A single vehicle-slice
number is worth ±5 %**, which is what the next tuning round needs to know before reading two of them as a
regression. `lateCreates` is **0** on all six scenes in all three runs: the 841 registered road cars stream in
and spawn without a late model build, which is 07 §1's mass spawn-sanity check.
Run: [`2026-07-27-headless-081-closeout-vehicle-step.json`](opensa-engine/2026-07-27-headless-081-closeout-vehicle-step.json).

### 2026-07-27 — the texture-upload hitch, before/after the budgeted drain

The 15–85 ms between-frames stall located earlier the same day (a whole texture array uploaded in the pak
worker's `message` handler) was fixed by making the upload resumable: decode + `createTexture` in the
handler, the (layer, mip) writes drained from `StreamingDriver.update` at ≤1.5 ms/frame. Same `u-turn` lap,
same pak (`08:41 24-07-2026`): the drive's streaming-driven slow frames went from `blob` 84.7/65.8/59.5/15.2
ms to **zero slow frames during the drive**; worst single handler call 84.7 → 0.1 ms; the one boot-adjacent
frame with stream cost reads `blob 0.4 worst 0.1 upload 1.5` — the drain sitting exactly on its budget. The
remaining boot/spawn `other` 19–134 ms frames are the still-unmeasured second door (the vehicle-model build
resolving from a worker `onmessage` continuation).
Run: [`2026-07-27-headless-texture-upload-hitch-fix.md`](opensa-engine/2026-07-27-headless-texture-upload-hitch-fix.md).

### 2026-07-27 — user's in-game re-baseline after the texture-upload fix

The user drove first (field verdict: no lags noticed) and then ran `?bench=all` on the same session — same
pak and host as the 07-24 `617556f` baseline, so the two sweeps compare directly. **Performance-neutral on
every scene**: seven of eight within a tenth of a millisecond; `lv-night` moved 13.121 → 13.784 avgMs
(76.2 → 72.5 fps) with an IDENTICAL gpu pass (8.692 vs 8.668) — a CPU-side wobble at the single-run ±5 %
noise boundary, not a regression. Neutral averages are the fix's expected shape (it buys smoothness, not
throughput); the smoothness itself shows in the same paste's `[slow]` lines — every streaming slow frame
reads `blob ≤0.6 worst ≤0.4 upload ≤2.4` where the pre-fix shape was one 15–85 ms `blob` call, and
`lateCreates` is 0 on all eight scenes, so the pop-in price did not materialize. What remains slow are
scene-teleport/spawn frames (`other` 76–225 ms — the vehicle-model-builder door, still unmeasured) and
`country-dusk`'s known GPU-bound pass.
Run: [`2026-07-27-ingame-after-texture-upload-fix.json`](opensa-engine/2026-07-27-ingame-after-texture-upload-fix.json).

### 2026-07-27 — 080/09 follow-policy microbench: the new writers cost nothing measurable

The camera revision (directional yaw authority, run/idle distance breathing, the vehicle launch stretch)
re-ran the 080-series stepCamera microbench with the new writers live every step: foot 0.51/0.60 µs
mean/p95, vehicle 0.68/0.79 — ~60–100× under plan 080's 0.05 ms budget. A DIFFERENT trace from the
2026-07-25 rows (the foot leg runs away so the authority works every step), so compare against the budget,
not row-to-row.
Run: [`2026-07-27-microbench-080-09-follow-policy.json`](opensa-engine/2026-07-27-microbench-080-09-follow-policy.json).

### 2026-07-28 — plan 091: the spike frames, finally decomposed

A headless `?bench=all` sweep taken FOR the `[slow]` lines rather than for the averages (which are all at
the 120 Hz headless cap: 8.33 avgMs, p95 9.2–9.3, `lateCreates` 0 on every scene, gpu pass at or below the
07-27 row). Three findings, all from the same run:

- **The boot frame is 576.1 ms, not 250.** `dt` is clamped at 250 ms for the simulation and the line used to
  print the clamp, so a third of the worst frame in the record had never been visible.
- **Roughly half of a teleport spike is now named**, and both named costs are **per NEW car type**: the
  `.osm` read + parse (worst single 20.5 ms — `bus`) and the GPU upload (worst single 18.2 ms — `tahoma`);
  typical types are 0.5–2 ms. A bench teleport pays 27–43 of them in one frame, which is a bench shape — in
  play a type arrives alone. Cell collision is the other named cost (COL parse 9.6–78.3 ms, Rapier bodies
  5.6–28.1 ms).
- **`unattributed` still holds 40–55 % of a spike**, and 100 % of the two frames that FOLLOW a teleport
  (68.2 and 38.9 ms with no span open at all) — GC-shaped, and the honest next question.

The two earlier runs of the same day are in the file's `priorRuns`: the pre-091 baseline, where `other` was
one anonymous number (223.6 ms on the boot frame) with nothing under it, and the intermediate three-span run
that still left 163.8 ms unattributed — which is what sent the last two spans into the adapter. **Careful:
the baseline's `250.0` boot frame and this run's `576.1` are the SAME frame**, not a regression; the first
printed the clamp.
Run: [`2026-07-28-headless-091-frame-attribution.json`](opensa-engine/2026-07-28-headless-091-frame-attribution.json).

### 2026-07-28 — plan 089/01: the dynamic one-shot particle lane, priced at its probe worst case

HUD-read numbers from three `gate-check.js` boot screenshots (NOT a sweep — single Grove Street night boot,
player idle, DPR=1). The probe (`?fxprobe=prt_collisionsmoke`, 60 spawns/s × 5 s life ≈ 300 live one-shot
particles) parks a plume beside the player that fills about a third of the 1440×900 viewport — a denser
fill than any single gameplay effect will produce. Cost: **+2.3 ms GPU at that worst-case coverage**
(2.77 → 5.10 ms submit), +1 draw call, frame pinned at the 120 Hz cap throughout; the CPU side (pool
spawn/prune + one ~10.8 KB partial `writeBuffer` per frame) does not register. The delta is overdraw-bound —
it scales with the plume's SCREEN COVERAGE, not with the particle count.
Run: [`2026-07-28-headless-089-dynamic-particle-probe.json`](opensa-engine/2026-07-28-headless-089-dynamic-particle-probe.json).

### 2026-07-28 — plan 089/02: tyre smoke on the brake-strip lap (and the dead rotation channel)

HUD-read from screenshots of the scripted brake-strip lap with tyre smoke live: at gameplay-shaped coverage
(two wheel plumes trailing a braking infernus) the frame stays at the 120 Hz cap, GPU 1.87 ms — the smoke
does not register; 089/01's +2.3 ms worst-case fill stays the lane's cost story. The run also recorded the
SIGNAL finding: Rapier's `wheelRotation` follows the ground exactly (max 0.05 m/s of rotation-derived slide
during the sustained −1.1 g locked stop), so rotation-based slip can never see a lockup or burnout — the
shipped signal is demand-over-cap recorded by `setVehicleControls`.
Run: [`2026-07-28-headless-089-02-brake-strip-smoke.json`](opensa-engine/2026-07-28-headless-089-02-brake-strip-smoke.json).

### 2026-07-28 — plan 089/02 close-out: the "performance dropped" impression, answered with a sweep

A field impression after three smoke-tuning rounds ("perf dropped a little, in general, not during braking")
against a full `?bench=all` sweep on the branch: **no regression** — every scene at the 120 Hz cap, gpu pass
within ±0.04–0.16 ms of the same-day 091 reference in both directions, draw counts equal within units. The
impression's own `[slow]` lines showed a GPU-bound frame at display resolution with the car population
fluctuating 950 → 1623 bodies plus the known cell-collision spikes — none of it branch-attributable (an idle
dynamic lane issues zero draws and zero writes; the user also noted other host processes may have interfered).
Run: [`2026-07-28-headless-089-02-no-regression-sweep.json`](opensa-engine/2026-07-28-headless-089-02-no-regression-sweep.json).

### 2026-07-28 — plan 089/03: the skid-mark decal lane on the brake-strip lap

HUD-read from lap screenshots (not a sweep): ~280 laid segments — two full braking ribbons — with GPU
submit in the same range as the day's lane-less runs; no measurable delta at gameplay-shaped mark counts.
The lane's steady cost is structural: one ~168 B upload per laid segment, ranged draws over LIVE segments
only (expired ones leave the window), one 344 KB buffer + a 32² texture at install.
Run: [`2026-07-28-headless-089-03-skid-marks.json`](opensa-engine/2026-07-28-headless-089-03-skid-marks.json).

### 2026-07-28 — plan 089 close-out: the vehicle-effects chain prices at zero on the sweep

All five steps merged, full `?bench=all` vs the same-day 091 reference: every scene at the 120 Hz cap,
gpu pass within ±0.05–0.25 ms in both directions (bench car populations differ run to run), draws equal
within units. The chain's real prices are per-event, recorded in the step runs: +2.3 ms GPU at the probe's
worst-case ⅓-viewport plume (overdraw-bound), ~10.8 KB/frame particle upload at full smoke, ~168 B per
laid skid segment, one surface ray per contacting wheel per fixed step (driven car only).
Run: [`2026-07-28-headless-089-closeout-sweep.json`](opensa-engine/2026-07-28-headless-089-closeout-sweep.json).
Audit: [`../audit/vehicle-effects-089.md`](../audit/vehicle-effects-089.md).

### 2026-07-29 — plan 092: the alpha-mask rule costs nothing on the sweep (but the pass column is not an A/B)

The first pak carrying the mask classification — 1 602 textures out of the blend pass into the depth-writing
cutout pass (shipped layers: 1 422 cutout / 661 soft-blend / 380 opaque across the pak's 43 RGBA8 arrays).
All eight scenes at the 120 Hz cap, p95 9.2–9.3, `lateCreates` 0, unchanged. **The `gpuMs.pass` deltas are
NOT attributable**: the 07-28 baseline read a different pak (buildTime 08:41 24-07-2026), and the largest
moves land where the rule cannot reach (ocean-horizon 1.961 → 0.915 at 27 draws). Two paks from the same
tree with only the rule flipped is the run nobody has taken.
Run: [`2026-07-29-headless-092-alpha-cutout-sweep.json`](opensa-engine/2026-07-29-headless-092-alpha-cutout-sweep.json).

### 2026-07-29 — plan 093: the world ambient term costs nothing (and this one IS a clean A/B)

The engine gained SA's additive ambient term + the deliberate day floor
(`max(lin(timecyc Amb) × knob, 0.13 × (1 − dn))`) in `worldShade`/clutter; frame uniform 100 → 104
floats. Same pak as the 092 row (buildTime 10:53 29-07-2026 — the change is engine-side only), same
harness: all NINE scenes at the 120 Hz cap, p95 9.2–9.3, `lateCreates` 0, `gpuMs.pass` 1.50–2.69
within the 092 band. One MAD per fragment is noise-level, as expected. The sweep also debuts
**`strip-noon`** (south Strip street level at the Flamingo block, added after the 093 field round):
119.9 fps steady-state — proving the field-reported hitches at that spawn are the COLD-LOAD
transient (first-frame `cell-collision-read` 235 ms, then ~20 frames of 110–170 ms mostly
UNATTRIBUTED while cells stream 0 → 95, plus the known per-type vehicle build), not a regression.
The unattributed transient and a `[slow]`-line double-count (collision counted in both `collision`
and `other` → `unattributed -226.1`) are the queued 091 follow-up inputs.
Run: [`2026-07-29-headless-093-world-ambient-sweep.json`](opensa-engine/2026-07-29-headless-093-world-ambient-sweep.json).

### 2026-08-01 — video mode's own per-frame cost (096/08)

Not a sweep: what the VIDEO MODE module adds to a frame, measured directly rather than by an on/off
comparison (with video off nothing drives, nothing streams and the camera does not move, so the difference
would be the scene, not the module). Its whole per-frame footprint is one call, and over **235 348 frames of
a 32.7-minute unattended run** it averages **0.0096 ms** — under a fiftieth of a millisecond, i.e. under
0.2 % of a 120 Hz frame; drive-only scenes, the expensive kind, average 0.0172 ms. `performance.now()` is
coarsened to 0.1 ms headless, so only the mean is a measurement. The same run carries the soak evidence
(settle flat at 249-250 ms across all 40 scenes, no drift in step cost or safe frame, 0 throws) and the
staging timeline. Run:
[`2026-08-01-headless-video-mode.json`](opensa-engine/2026-08-01-headless-video-mode.json).

### 096/09 — what the planted-shot occlusion check costs (2026-08-01)

A `flyby` now checks the line to the car before it plants, walking three candidate spots. Over two runs
(seed 47 scenes 1-4, seed 911 scenes 1-10; 14 captures, 77 024 directed frames) the worst per-frame cast
count anywhere was **3**, inside 080's ≤ 5 rule with the follow rig's 2, and `stepMs` stayed at
**0.0153-0.0180 ms** against 08's drive-only 0.0172 — the check is free at this resolution. **`blockedPlants`
was 0 in both**: three plants, three clear authored spots, so the ladder has never actually been walked in a
measured run. That bounds how common the problem is; it is not evidence it cannot happen. Run:
[`2026-08-01-headless-planted-occlusion.json`](opensa-engine/2026-08-01-headless-planted-occlusion.json).

### 091 — the field drive that closed the fork (2026-08-02)

The first row in this record taken from a HUMAN DRIVE rather than a harness: one continuous session,
Ganton → Downtown LS → the countryside → the desert → the whole of Las Venturas, in a `comet`, censused from
the game's own `[slow]` lines (every frame over 20 ms). **223 slow frames, p50 21.9 ms, only four above
30 ms** — and **zero of them carried a vehicle span**, so the per-type car cost 091 was written to bound
(worst `bus` 20.5 + `tahoma` 18.2 ms) never landed on a slow frame across four popcycle zones. What the slow
frames actually are: **GPU pass mean 13.73 ms (max 19.79) against a CPU render of 0.1–0.6 ms**, 204 of 223
above 8 ms. `unattributed` on a real drive is the CPU waiting on the GPU, not the GC tail the bench shape
suggested. Run:
[`2026-08-02-drive-091-field-verdict.json`](opensa-engine/2026-08-02-drive-091-field-verdict.json).

**Read the note before comparing it to anything**: it is a DEV build, it carries no pak buildTime (the
console was opened after boot) and no timestamps, and it is a census, not a scripted sweep.

### 091 — the re-drive on a POPULATED map, which closed the fork (2026-08-02)

The same day's second drive, after the map got its cars back (059's 1043 generators wired in, `parked.json`
registered lazily): LS → countryside → SF → Chilliad → LS → Las Venturas at dusk. **1004 slow frames, p50
21.3 ms, p90 24.1** — a *tighter* distribution than the empty-map run (21.9 / 25.0) with five times the cars,
though the raw counts are not comparable (neither run recorded its duration).

**`vehicle-spawn` spans appeared for the first time** — 14 frames over 12 models, at **0.2–0.3 ms each**, free.
**`vehicle-osm` and `vehicle-model` stayed at zero**, and now that is evidence rather than an empty world: the
per-TYPE cost never coincides with a frame the game calls slow when types arrive one at a time. GPU pass mean
rose 13.73 → **15.64 ms** (max 21.89, draws p50 1049 → 1113) — that is what the cars cost, and it is the same
GPU-bound shape the first drive found. Run:
[`2026-08-02-drive-091-populated-map.json`](opensa-engine/2026-08-02-drive-091-populated-map.json).

### 097/07 — the CLEO VM cost close-out (2026-08-06)

The 097 big-rework benchmark, headless-first: the whole shipped corpus costs **465 µs/tick** on the
VM (boot 0.23 ms for 7 scripts, `enabled: false` = one branch, tracer ×1.9 as a debug toggle) — and
the run CAUGHT a field bug: both hosts answered `carInSphere` ignoring `findNext`, so vandoor's
recursive walk never exhausted and burned its full 10 000-instr budget every tick (corpus 3 771 →
465 µs/tick after the walk-cursor fix, vandoor ~100×). Field verify on `build/original/opensa`:
census 6 scripts, F2 CLEO screen live at 1 572 instr/tick, 21 script objects. Same-day frame-level
A/B/A (`?bench=all` ×3, run-order controlled): CPU frame parity (avg 8.33 ms, p95 ~10, 120 fps in
all three variants), GPU pass +0.45 ms mean with CLEO on — the RENDER cost of the wheel/turbines
existing (ocean-horizon 27 → 84 draws, 136 k → 843 k tris), not VM cost. Analysis:
[`2026-08-06-headless-cleo-vm-cost.md`](opensa-engine/2026-08-06-headless-cleo-vm-cost.md); raw
rows [`2026-08-06-ingame-cleo-ab.json`](opensa-engine/2026-08-06-ingame-cleo-ab.json).
## Mobile

Newest first. The 08-09 row is the chain's baseline; everything above it in date order is first-light or off-ground record — see each `note`.

| Date | File | Harness / scene | Conditions | Headline numbers |
| --- | --- | --- | --- | --- |
| 08-04 | [mobile-first-light](opensa-engine/2026-08-04-mobile-first-light.json) | dispatch console status bar, `?demo=1` | **Mali-G51 / Android 10**, Yandex Browser 26.6 (Chromium 148), 360x800 CSS px @ DPR 2. SYNTHETIC world (no pak — this GPU has no BC). Needed `#enable-unsafe-webgpu` + the same day's "BC optional at device creation" change. No `timestamp-query`, so no GPU timings. | **41 fps** · cells 38/144 · draws 162 · resident 37 MB |
| 08-07 | [mobile-district-inventory](opensa-engine/2026-08-07-mobile-district-inventory.json) | dispatch console, `?inventory=1`, streamed district pak (`23:12 07-08-2026`, rect 9,-7,10,-6 Ganton) | **Mali-G51 / Android 10**, 360x364 CSS px @ DPR 2. FIRST real-world mobile row on a streamed SA district — supersedes the synthetic 08-04 row. 2482 frames / 209 s, `warnings` empty. No `timestamp-query`, so GPU time is ABSENT; `spans` empty (static camera, 4 resident cells). Taken on Ganton, **not** on 201/1-01's pinned `los-santos-centre`. | **31 fps** · p50 31.8 ms · p95 51.3 ms · submit 1.78 ms (5.6 % of frame) · cells 4/4 · draws 121 · **resident 239 MB** |
| **08-12** | **[mobile-pinned-district-astc](opensa-engine/2026-08-12-mobile-pinned-district-astc.json)** | dispatch console, `?inventory=1`, ASTC pak of the pinned district, camera at street level (h 29.7) | **Mali-G51**, 685 frames / 24.1 s, `warnings` and `errors` both empty. The format A/B's ASTC side against the 08-09 rgba8 rows, and the run that proved the `requireFormatSupport` fix — the capture 3.5 h earlier on this same pak had all 20 arrays refused as "BC-compressed" and streamed nothing. | **resident 74.9 MB against 148 MB on rgba8** — texture category **25.81 MB**, a quarter of the same texels as RGBA8 · and `target` **36.54 MB** is now the LARGEST category, bigger than every texture · 31 fps · p50 32.0 ms · p95 51.4 ms · cpu share **16.5 %** · cells 4/4 · draws 111 |
| **08-09** | **[mobile-pinned-district-bytes](opensa-engine/2026-08-09-mobile-pinned-district-bytes.json)** | dispatch console, same pak and district, camera WORKED to street level (h 25.7) — the bytes column fills with what the streamer requests | **Mali-G51**, 799 frames / 33.1 s, `warnings` empty. 201/1-01's BYTES table: what the surface reads against what the build contains. | **36.4 MB read in 28 requests** — texture arrays **20 of 20 (99.9 % of the pak's texture payload)**, water 2.66 MB, cells 4 hd + 3 lod of 8 · **collision: ZERO requests** against a 49 870-triangle bake · cpu share **15.9 %** · body max **1068 ms** on one frame |
| **08-09** | **[mobile-pinned-district-inventory](opensa-engine/2026-08-09-mobile-pinned-district-inventory.json)** | dispatch console, `?inventory=1&district=los-santos-centre`, pak `02:47 09-08-2026` (rect 5,-7,6,-6, `--textures rgba8 --max-texture 256`) | **Mali-G51 / Android 10**, 360x364 CSS px @ DPR 2. **THE 201/1-01 BEFORE-TABLE** — clean by the collector's own test (`warnings` empty), 414 frames / 153.9 s, 4/4 cells, on the PINNED ground. Supersedes the 08-07 Ganton row as the chain's baseline. No `timestamp-query`; `spans` empty (all cells resident). | **33 fps** · p50 30.3 ms · p95 48.1 ms · **CPU body 5.83 ms = 21.2 % of the frame** (idle 21.7 ms) · overlay-2d 2.44 > engine-frame 2.10 · draws 110 · tris 265 k · **resident 148 MB** |
| 08-07 | [mobile-inventory-void](opensa-engine/2026-08-07-mobile-inventory-void.json) | dispatch console, `?inventory=1`, first real district pak (`23:12 07-08-2026`, rect 9,-7,10,-6) | **VOID — DO NOT CITE.** Same Mali-G51. The world never streamed: `cellsTotal 0`, and the 113 494 triangles are exactly this pak's water mesh, so the capture is water over nothing. Taken 1.6 s after the collector started (15 frames). Also carries a poisoned `dtMax` — the first delta included page load, fixed the same day. | *none usable* — kept for the trap, not the numbers |

Not comparable with anything above it: different host, different world, no p95, no GPU timers. It closes the
gap `docs/features/mobile-controls.md` names ("no touch-device frame-time row exists"), and it is owed a
successor on a real `--rgba8` district.

### 100/04 — per-system fx cull distance (2026-08-08)

A/B on `build/original/opensa`, headless DPR=2: replacing the flat `DRAW_DISTANCE = 300` with each fx
system's authored `cullDist` (plus two recorded departures) is **below what the bench can measure**. The
verdict rests on a POSITIVE CONTROL, not on the A/B: forcing every emitter quad to collapse gives
`country-dusk` a GPU pass of 3.880 ms against 3.875 (after) and 3.867 (before) — culling every particle in
the map is indistinguishable from drawing them, so the scene has no power to judge this change either way.
The only column that moves is `avgTriangles`: `lv-night` −2890 of 2 049 828 (−0.14 %), which is 26 `fire`
anchors going from 300 u to their authored 35. `avgMs` is pinned at the 120 fps cap in every row. Rows:
[`2026-08-08-ingame-fx-cull-distance.json`](opensa-engine/2026-08-08-ingame-fx-cull-distance.json).

### Post-plan-100 rebuild — the density baseline (2026-08-08)

The first full rebuild after plan 100 shipped, and the "before" plan 07/04 owes: an 8-scene sweep at
TODAY's procobj density, against a pak that now carries 2dfx at **both** levels (particles 943 → **1831**,
roadsigns 481 → **962**, 1137 cells, buildTime `11:42 08-08-2026`). Nothing moved: `country-dusk` 3.868 ms
GPU pass against 3.875 on the pre-100 pak, `lv-night` 3.603 against 3.600, `avgMs` pinned at the 120 fps cap
throughout. **That is a baseline, not a verdict** — the positive control in the row above proves this sweep
cannot price emitter cost at all, and it never enters the 440–1000 u transition band where the doubling
question lives. Rows: [`2026-08-08-ingame-post-100-rebuild.json`](opensa-engine/2026-08-08-ingame-post-100-rebuild.json).

### Minor-8 re-pack — the baseline that still exists (2026-08-08)

The post-100 sweep above named a pak that was then replaced: the canonical build was re-packed onto `.oscell`
minor 8 (the roadsign glyph-quad count), so its rows point at a `buildTime` nothing on disk matches. The same
8 scenes re-taken on the pak that DOES exist (`13:19 08-08-2026`) are
[`2026-08-08-ingame-minor8-repack.json`](opensa-engine/2026-08-08-ingame-minor8-repack.json) — **this is the
density baseline plan 07/04 compares against**. Scene-to-scene `gpuMs.pass` moves between −0.16 and +0.14 ms
in both directions, which is run-to-run spread: minor 8 adds one header word per cell and no geometry, and the
positive control two rows up already showed this sweep cannot resolve differences of that size.

### Procobj density sweep — the arm that was cut, and why the sweep could not answer anything (2026-08-08)

Two builds were made for 07/04's opensa perf budget, both from the canonical build's kept `.work/5-trees`
stage so the ONLY variable is the procobj density: `bench-d1` (`--procobj-density 1`, vanilla) and `bench-d3`
(`--procobj-density 3`, the scatter's candidate ceiling, cap raised to 200 000 so it could not bind).

**The builds already answered the question the bench was meant to ask, and the answer is that the arms are not
arms.** Three times the candidates yields **15 840 objects against 15 286 — +3.6 %, not 3×** (rows 6 728 vs
6 487; pak 1 275 777 024 vs 1 272 020 992 B, +0.30 %; 1139 cells in both). No `CAP DROPPED`, so `procObjMax`
never bound: the extra candidates were culled by **MINDIST**, which is already saturated at vanilla density.
Two builds 3.6 % apart cannot price a streaming budget — the layer's whole GPU cost is 0.07–0.38 ms
([layer decomposition](opensa-engine/2026-07-21-layer-decomposition.md)), so 3.6 % of it is far below what
this instrument resolves.

The headless `d1` sweep was killed externally after 5 of 6 scenes and `d3` never ran headless; those partial
rows are [`2026-08-08-headless-07-04-density-d1-partial.json`](opensa-engine/2026-08-08-headless-07-04-density-d1-partial.json).
**The user then ran both arms in full on his own machine** (9 scenes each, in-game `?bench=all`):
[`2026-08-08-ingame-07-04-density-ab.json`](opensa-engine/2026-08-08-ingame-07-04-density-ab.json).

**Result: +3.6 % clutter costs nothing this instrument can see.** Six scenes come back with triangle counts
identical to ±0.0 % and `gpuMs.pass` within ±0.03 ms; `country-dusk` — the clutter scene — moves **+0.3 %
triangles for +0.013 ms**. That is the whole verdict, and it is a statement about 3.6 %, not about density.

**Three rows are contaminated, and the partial headless run is what identifies which arm is wrong.** The
scenes where the arms disagree do so by amounts no 3.6 % content change can produce — `sf-fog-dawn` −4.2 %
triangles, `lv-night` +15.5 %, `ocean-horizon` **+107.3 %** (the control scene, which
[the layer decomposition](opensa-engine/2026-07-21-layer-decomposition.md) showed does not move for ANY map
layer). In all three the `d3` arm agrees with the independent headless `d1` run (ocean-horizon 848 670 vs
846 535 triangles; lv-night 2 070 601 vs 2 058 684; sf-fog-dawn 1 483 818 vs 1 482 512) while the user's `d1`
arm is the outlier — so the content is the same and the **`d1` run's scene states drifted**, under-streaming
two scenes and over-streaming one.

That matches the defect the user reported on both runs: collision is lost across scene transitions (cars fall
through the ground) and the player falls when the sweep ends —
[`open-issues/bench-scene-transition-collision.md`](../open-issues/bench-scene-transition-collision.md).
**Until that is fixed, no scene-to-scene A/B on this harness can be trusted below its own drift**, which
these rows measure at up to 107 % of a scene's triangles.

What a real density measurement needs is a lever that MOVES the count, and the only one left is the authored
`procobj.dat` MINDIST — a data-honesty decision, not a knob.

### A/A reproducibility — is this harness a measuring instrument? (2026-08-08)

**No, not yet.** Two headless `?bench=all` sweeps of the SAME canonical pak (buildTime `13:19 08-08-2026`,
verified on disk) with **no content and no code change between them**, plus the minor-8 row set as a third
point. `avgTriangles` swings up to **10.19 %** (`lv-night`), 6.00 % (`sf-fog-dawn`), 3.27 %
(`ocean-horizon`) — and the outlier lands on a **different scene in each run**, so this is a lottery, not a
drift. `lateCreates` is **0 on every row**, including the ones 10 % apart.

Two candidate causes are ruled out by the rows themselves: `vehicles.live` is identical scene for scene
(24→24, 43→43, ocean-horizon 0→0) and so is `residency` to the megabyte (`cellVertex 193→193`). The world
loaded is the same; what is SUBMITTED differs, because the settle exits on a signal that answers for the
previous scene — four of nine settle in ONE frame, and `lv-night` begins measuring at 11 cells loaded / 81
queued. Full forensics, exact repro and the eight killed hypotheses:
[`open-issues/bench-scene-transition-collision.md`](../open-issues/bench-scene-transition-collision.md).

Rows: [`2026-08-08-headless-bench-aa-reproducibility.json`](opensa-engine/2026-08-08-headless-bench-aa-reproducibility.json)
— **evidence about the instrument, not a performance baseline; do not compare against them.**

### A/A again, after plan 102 — yes, it is an instrument now (2026-08-09)

Same question, same pak, same harness, one day later, with the settle chain fixed (notice → ring → **ground
under the anchor** → warp onto that ground → wait until he is **at rest** → warmup) and a warp reset derived
inside the character controller. `avgTriangles` spread per scene is **0.00–0.36 %** — `lv-night` went 10.19 %
→ **0.14 %**, `sf-fog-dawn` 6.00 % → **0.36 %** — and `avgMs` agrees to **≤ 0.02 %**. The camera-jump wall is
gone: **1** `[cam]` line per run against a baseline of **89 255**.

Eight of nine scenes now report `legStart.ok` true (`dz −0.08 m`, grounded, worst frame drop 0): the player
stands still where the settle put him for the whole leg. The ninth, `strip-noon`, is RED in both arms, and
the row says so instead of quietly measuring a falling camera — **its anchor was authored inside the
Flamingo**, fixed hours later the same day
([`open-issues/fixed/strip-noon-anchor-inside-a-building.md`](../open-issues/fixed/strip-noon-anchor-inside-a-building.md)):
moved to `[1933, 1127, 18]`, re-run clean (`dz −0.08 m`, grounded, 27 cars live, `avgTriangles` 1 893 061).
**Every `strip-noon` row in this record, including the two arms above, predates that fix and measured a
falling player.**

### The density A/B, re-taken on the repaired harness (2026-08-09)

The 07/04 question, asked again now that the instrument holds still. Three sweeps on the user's display lane
(oldmap · `bench-d1` · `bench-d3`, 1219 road cars and 212 parked on every arm, all nine scenes `legStart.ok`):
**d1 and d3 are indistinguishable** — `avgTriangles` 0.00–0.25 % apart, `avgDrawCalls` 0–3 calls, `avgMs`
≤ 1.6 % with the sign flipping between scenes, all of it under the harness's own 0.36 % A/A floor. The
2026-08-08 audit's finding stands, now on evidence: the selector shipped, the lever does not move anything.

Both d-builds do differ from the oldmap pak (+0.2…+1.5 % triangles, +5–7 % draws, same direction on both
arms) — so they carry something the old map does not; it is not the density value.
Rows: [`2026-08-09-ingame-user-display-density-ab.json`](opensa-engine/2026-08-09-ingame-user-display-density-ab.json)
and [`…-oldmap-baseline.json`](opensa-engine/2026-08-09-ingame-user-display-oldmap-baseline.json).
**`ocean-horizon` sits at the 120 fps cap on every arm — read its content columns, never its milliseconds.**

Rows: [`2026-08-09-headless-bench-aa-after-102.json`](opensa-engine/2026-08-09-headless-bench-aa-after-102.json).
The arm-A run that found the anchor-height defect on the way there:
[`2026-08-09-ingame-102-probe-arm-a.json`](opensa-engine/2026-08-09-ingame-102-probe-arm-a.json) —
**diagnostic, not a baseline.**

### A/A on the CURRENT pak — the content column is solid, the cost column is not (2026-08-09)

Plan 102's floor (worst-of-nine **0.36 %** triangles) was taken on the minor-8 pak of 08-08. lod-procobj
013's `opensa` perf budget will be read on the post-column-fix pak (13:53, **91 092** clutter objects), so
the floor was re-established there: two back-to-back headless `?bench=all` sweeps of the SAME build, Claude's
lane, M3 Pro, DPR=2, 1219 road cars, `legStart.ok` on all nine scenes in both arms, `lateCreates` 0.
Rows: [`2026-08-09-headless-aa-floor-current-pak.json`](opensa-engine/2026-08-09-headless-aa-floor-current-pak.json).

| column | worst-of-nine A/A spread | verdict |
| --- | --- | --- |
| `avgTriangles` | **0.094 %** (lv-night) | trustworthy — better than the 0.36 % of the lighter pak |
| `avgDrawCalls` | 0.52 % | trustworthy |
| `avgMs` | 0.62 % — but **SATURATED at the 120 fps cap** (8.333 ms) on 7 of 9 scenes, both arms | carries no signal on this machine at DPR=2 |
| `gpuMs.pass` | **13.37 %** (sf-fog-dawn) | the real cost floor, and it is large |

**What this bounds.** The harness holds still on CONTENT, so an A/B may be read on triangles and draws. It
does NOT hold still on cost: a single sweep's `gpuMs.pass` cannot resolve anything under ~13 %, and `avgMs`
is a frame cap rather than a measurement. So 013's perf budget has to come from HITCHING — `p95Ms`, `[slow]`
frames, stream stats — plus repeated `gpuMs.pass` samples, and never from one sweep's `avgMs`. The earlier
density A/B read `avgMs` on the user's uncapped display lane, which is why it could see 12.6 % there.

### The procobj density recovery — one scene moved, and it is the rural one (2026-08-09)

The first sweep on a pak built with `procobj.dat` read the way the game reads it (`area / spacing²`, no
MINDIST cull): the clutter layer went **15 286 → 91 092 objects**. User display lane, his run, same nine
scenes, 1219 road cars / 212 parked on both arms, all nine `legStart.ok`. Baseline is the same-day
[oldmap row](opensa-engine/2026-08-09-ingame-user-display-oldmap-baseline.json).
Rows: [`2026-08-09-ingame-user-display-procobj-recovered.json`](opensa-engine/2026-08-09-ingame-user-display-procobj-recovered.json).

| scene | avgMs | Δ | gpu.pass Δ | triangles Δ |
| --- | --- | --- | --- | --- |
| **country-dusk** | 16.366 → **18.434** | **+12.6 %** (61.1 → 54.2 fps) | **+16.3 %** | **+16.4 %** |
| strip-noon | 10.166 → 10.464 | +2.9 % | +2.3 % | +2.4 % |
| ls-noon | 9.452 → 9.564 | +1.2 % | +0.3 % | +0.9 % |
| ganton-noon / -night | 13.55 / 13.655 → 13.644 / 13.73 | +0.7 / +0.6 % | +1.5 / +0.6 % | +0.6 / +0.8 % |
| ls-rain-night · sf-fog-dawn · ocean-horizon | — | +0.4 / −0.1 / −0.0 % | +1.5 / +1.5 / +1.5 % | +0.9 / −0.1 / +6.7 % |
| lv-night | 14.321 → 13.898 | **−3.0 %** | +1.8 % | +1.7 % |

**Read it as one scene, not a regression.** Eight of nine sit inside ±3 %, and `lv-night` moved the wrong
way while its triangles rose — a car-heavy scene's run-to-run spread (`vehicles.maxMs` 1.1 → 0.7), not a
saving. The one real move is `country-dusk`, the only RURAL scene in the set, which is exactly where a
ground-clutter layer lives.

**The cost is GPU geometry, and the columns say so without inference**: `country-dusk`'s frame grew
**+2.07 ms** while its `gpu.pass` grew **+2.03 ms** — the whole delta is raster of the added triangles, with
CPU flat (`avgDrawCalls` +1.7 %, so it is not batching either). Across all nine scenes the ms delta tracks
the triangle delta; that is the relationship to watch when 07/04 sets a budget.

**What this run cannot say**, and it bounds any decision taken on it: the two paks differ in more than
procobj — their `report.json` says particles 943 → 1 831 and roadsigns 481 → 962 (`a48ffa2f`, `493fe926`
landed between the builds). Every rise above is an UPPER BOUND on the density's cost. `ocean-horizon` is at
the 120 fps cap as always — its +6.7 % triangles are the only readable column.

### The runtime clutter layer draws nothing on a built map — a NULL result (2026-08-10)

The pak bakes the procobj layer into its cells AND `updateClutter` feeds `adapter.cellClutter` into an
instanced render every frame, which reads like the clutter is drawn twice. It is not. Five single-scene
`country-dusk` sweeps, Claude's headless lane: `?procobj=0` and a per-cell cap swept **1 → 3000** both leave
`avgTriangles` unchanged to **0.007 %**, against this pair's own same-config A/A drift of **0.41 %**.
**Cause, by construction:** `convertProcObj` strips every species it bakes, so a built `data/procobj.dat`
carries **9 rules of 96**, all `P_UNDERWATERBARREN` — the runtime layer is alive with nothing to scatter on
dry land. The positive control failed on the SITE, not on the instrument.
Rows: [`2026-08-10-headless-runtime-clutter-null-result.json`](opensa-engine/2026-08-10-headless-runtime-clutter-null-result.json).

**What this settles for lod-procobj 013:** clutter load on `opensa` is a **BUILD-time** quantity. Neither
`?procobj` nor `?procobjLimit` is a lever for the streaming budget, so that measurement needs two BUILDS —
and one already exists on disk (`NO_COMMIT/old_map`, 15 286 objects, against today's 91 092).

**Also from these runs:** the new `hitch` block carries signal where the averages do not — `maxMs` spans
9.4–21 ms across five arms whose `avgMs` is 8.329–8.334 and whose `p95Ms` is 9–9.1. Its three streaming
columns (`blobMaxMs`, `uploadMaxMs`, `pendingMax`) printed 0 on every arm; a settled leg streams nothing, so
they still owe a positive control before a zero from them counts as evidence.

## 2026-08-10 — the pak, before and after the clutter moved to the runtime scatter

[`opensa-engine/2026-08-10-pak-clutter-runtime-vs-baked.json`](opensa-engine/2026-08-10-pak-clutter-runtime-vs-baked.json)
— a BUILD measurement, not a frame one, and it does not mix with the rows above. Plan 014 took the procobj
clutter off the bake for `opensa`: **pak 1 551 → 1 168 MB (−24.7 %)**, **AO bake 21 m 14 s → 14 m 25 s
(−32 %)**, **welded HD vertices 105.8 M → 60.4 M (−42.9 %)**. The cause is that welding duplicates vertices per
instance, so 91 092 baked objects were ~45.4 M vertices of copies; the runtime path uploads ~48 geometries.

**No frame number attaches to this yet.** Whether per-cell scatter at stream-in costs more than a baked cell is
a hitch question, and it is the user's `?bench=all` run to make. The pair is also 30 h apart with one mods-stage
change in it, so the deltas are attributed rather than isolated — the file lists the confounds, including a
`breakables` −991 that turned out to be the 6 breakable clutter species leaving the pak for a runtime path that
already handles them (074/20).

## 2026-08-10 — the clutter on the runtime path, measured on the user display

[`opensa-engine/2026-08-10-ingame-user-display-clutter-runtime.json`](opensa-engine/2026-08-10-ingame-user-display-clutter-runtime.json),
directly against the two 2026-08-09 arms of the same lane (`-oldmap-baseline` = 15 286 clutter objects baked,
`-procobj-recovered` = 91 092 baked). All three run by him, same machine, same nine scenes.

| scene | 15 286 baked | 91 092 baked | 91 092 RUNTIME | Δ vs 91 092 baked |
| --- | --- | --- | --- | --- |
| ls-noon | 9.452 / 105.8 | 9.564 / 104.6 | 9.651 / 103.6 | +0.9 % |
| sf-fog-dawn | 9.025 / 110.8 | 9.019 / 110.9 | 9.052 / 110.5 | +0.4 % |
| lv-night | 14.321 / 69.8 | 13.898 / 72.0 | 14.545 / 68.8 | **+4.7 %** |
| **country-dusk** | 16.366 / 61.1 | **18.434 / 54.2** | **16.091 / 62.1** | **−12.7 %** |
| ocean-horizon | 8.334 / 120 | 8.333 / 120 | 8.333 / 120 | 0.0 % |
| ls-rain-night | 8.652 / 115.6 | 8.684 / 115.1 | 8.664 / 115.4 | −0.2 % |
| ganton-noon | 13.550 / 73.8 | 13.644 / 73.3 | 13.668 / 73.2 | +0.2 % |
| strip-noon | 10.166 / 98.4 | 10.464 / 95.6 | 10.358 / 96.5 | −1.0 % |
| ganton-night | 13.655 / 73.2 | 13.730 / 72.8 | 13.735 / 72.8 | 0.0 % |

**The verdict: moving the clutter to the runtime path costs no frame time anywhere, and gives back the one scene
the baked layer had taken.** `country-dusk` — the only scene clutter has ever moved — goes 18.434 → 16.091 ms and
is now faster than even the 15 286-object baseline. Seven of the other eight are inside ±1 %.

**The honest caveat, and it is a content one.** country-dusk's triangles fell 1 442 102 → **1 218 261 (−15.5 %)**
and its draws 907 → 851, so the runtime path is drawing **less clutter than the bake did** — its per-cell
`procObjLimit` binds where the bake had none. The −12.7 % is therefore "less drawn AND faster", not "same content,
cheaper mechanism". What is measured is that the change costs nothing; what is NOT measured is whether it is
cheaper at equal content. That question is now askable at all, which it was not: the bake stripped `procobj.dat`
to 9 rules, so density and `procObjLimit` were dead knobs on this target and plan 013 had to invent a two-pak A/B.

**lv-night +4.7 % is the one number not to over-read.** That scene's own arm-to-arm spread across the two 08-09
runs is 3.0 % (14.321 vs 13.898) in a scene with almost no clutter, so +4.7 % sits just outside its noise with
−2.3 % fewer triangles. One sweep cannot separate that from run-to-run variance.

**First hitch numbers on this lane** (the block shipped 2026-08-10, so the 08-09 arms have none — these are a
reading, not a delta): only the two heaviest scenes show slow frames at all, `country-dusk` **5** (maxMs 34.6) and
`ganton-night` **1** (maxMs 26.1); every other scene is 0. And `country-dusk` carries the highest
`gpuMs.pass` of all nine (**12.03**) on the FEWEST draws and second-fewest triangles — high pass cost on little
geometry is where to look when the runtime scatter is tuned.

## 2026-08-10 — the runtime clutter knobs, swept on the unbaked pak: BOTH saturate before the engine notices

[`opensa-engine/2026-08-10-headless-procobj-runtime-knob-ladder.json`](opensa-engine/2026-08-10-headless-procobj-runtime-knob-ladder.json)
— 15 single-scene `country-dusk` sweeps in Claude's headless lane, on the pak rebuilt 2026-08-10 17:47 **without**
the procobj bake (`data/procobj.dat` back to all 95 source rules). This is the P1 measurement plan 013 owns.

**The null result above is now closed as a SITE failure, exactly as it was diagnosed.** Same code, same scene,
same harness, different pak: `?procobj=0` moves triangles **1 206 029 → 1 173 177 (−2.72 %)** and draws 830 → 815,
against this session's own A/A drift of **0.007 %** (a vs a2). On the baked pak the identical arm moved 0.007 %.

**Both knobs saturate, neither saturates on the engine — and they stop for two DIFFERENT reasons.**

| knob | ladder | triangles | verdict |
| --- | --- | --- | --- |
| `procObjLimit` (per-cell cap) | 150 → 300 | 1 206 029 → 1 210 952 (+0.41 %) | +0.41 % of the SCENE is **13.0 % of the LAYER** |
| | 300 → 600 → 1200 → 3000 | 1 210 952 / 1 210 827 / 1 211 008 / 1 210 965 | flat to 0.015 %, 20× the cap for nothing |
| `?procobj` (density ×) | 1 → 2 → 4 | 1 210 965 → 1 251 866 → 1 291 582 (+6.66 %) | linear in the cutoff |
| | 4 → 8 → 16 | 1 291 582 / 1 291 753 / 1 291 717 | flat — the ceiling is ×3, and it is OURS |

**The cap's ceiling is the data.** The candidate pool per face is `area / spacing²`
([009](../../tools/sa-procobj-placement/docs/plans/009-procobj-dat-columns-as-the-game-reads-them.md)), so at
cutoff 1 a cell does not hold 300 placements and no cap above 300 can bind. What it *does* trim at the shipped
150 is 4 923 triangles of a 37 775-triangle layer — read that +0.41 % with its scope.

**The multiplier's ceiling is ours.** `scatterProcObjects` generates `area / spacing² × PROC_OBJ_MAX_DENSITY`
candidates with a lottery uniform in `[0, PROC_OBJ_MAX_DENSITY)`, the renderer keeps `lottery < density`, and
the runtime adapter takes the default **3** (`gta-sa-world.adapter.ts:632`, no argument). So a cutoff of 3 or
more keeps every candidate. The arms measure exactly that: clutter triangles over the clutter-off baseline run
**37 788 : 78 689 : 118 405 : 118 576 : 118 540 = 1 : 2.08 : 3.13 : 3.14 : 3.14** — linear, then flat at 3.
(The ~4 % over an exact 1:2:3 is species mix; models do not carry equal triangle counts.) **So "+10.11 % of the
scene" is what the layer costs at 3× vanilla, not a ceiling** — raising `PROC_OBJ_MAX_DENSITY` buys more at a
linear cost in candidates. Draws move only at the on/off boundary: the clutter is instanced, so its cost is
per-pixel, not per-draw.

**And there is no hitch to find.** Across the 11 capped arms `hitch.maxMs` reads 9.7–36.0 ms and `slowFrames` 0–4
with **no relation to load** — the two worst arms are `lim600` (35.4 / 4) and `d8` (36.0 / 1), while `d16`, the
heaviest world of the ladder, reads 12.3 / 0 and the A/A pair alone spans 21.9 vs 9.7. `blobMaxMs`, `uploadMaxMs`
and `pendingMax` are 0 on every arm. The hitch columns' own noise on this lane is larger than anything the layer
can produce.

**`UNCAPPED=1` works, and it costs the other half of the report.** `avgMs` unpins 8.33 → **5.42–5.64** and `p95Ms`
9.1–9.2 → **6.7–7.2**, at 177–185 fps — so the "this needs the user's display" half of P1 is retired. But every
uncapped arm, clutter-off included, reads `maxMs` 148–196 ms and `slowFrames` 16–19: the loop runs flat out and
scheduling stalls swamp the hitch block. **Capped for hitching, uncapped for cost, and the two lanes are never
comparable.** Even uncapped the layer stays below the noise: `gpuMs.pass` A/A is 6.5 % apart (4.164 vs 3.910),
*wider* than off → max (3.952 → 4.201), and on `avgMs` the two default arms bracket the maximum arm outright.

**What this settles for plan 013:** at 3× vanilla density the whole layer still costs less than one sweep's A/A
drift, so there is no perf number to set `procObjMax`, the candidate ceiling or `procObjLimit` from — the budget
cannot be read off a hitch measurement because the layer cannot be pushed into one. Keep `procObjLimit` at 150
unless the look wants back the 13 % of the layer it trims (300 is the only value above it worth choosing), and
treat the density ceiling as **available headroom, not a measured maximum**. The certified room goes to the P2
draw distances, which is a look decision.
**Not covered:** one scene, camera flights rather than a drive, n=1 per arm — a streaming-shaped hitch under
continuous movement is sampled by no arm here, and the three streaming columns reading 0 everywhere means that
pressure never arose rather than that it was survived. **Nor what raising `PROC_OBJ_MAX_DENSITY` would cost:**
every arm above ×3 measured the same world.

## 2026-08-10 — the per-category clutter ranges, which had never been connected to anything

[`opensa-engine/2026-08-10-headless-procobj-per-category-ranges.json`](opensa-engine/2026-08-10-headless-procobj-per-category-ranges.json)
— five `country-dusk` sweeps, same lane and pak as the knob ladder above. **The seven per-category draw
distances were dead config**: written by the debug slider, read by nothing, so every category really drew at
whatever its 256-unit cell reached and the cell ring was `streaming.collisionDrawDistance` = 150. They are now
applied per INSTANCE in the clutter vertex shader, with the streaming ring widened to the widest enabled
category.

| range | draws | triangles | layer on screen¹ | `gpuMs.pass` |
| --- | --- | --- | --- | --- |
| 100 — SA's flat `PLANTS_MAX_DISTANCE` | 818 | 1 182 287 | 9 110 | 3.636 |
| 150 — the collision ring | 819 | 1 186 367 | 13 190 | 3.633 |
| **per-category (shipped)** | **821** | **1 191 188** | **18 011** | **3.694** |
| 300 — every category at the widest | 830 | 1 209 368 | 36 191 | 3.678 |

¹ against the same pak's clutter-off baseline of 1 173 177 triangles.

Four points, one direction, against an A/A control of **0.020 %** on triangles and **zero** on draws. **In
layer terms the range is a 4× lever** (9 110 → 36 191) while reading as +2.3 % of the scene — the scope matters
or it sounds like nothing. And it is **free in frame terms**: `gpuMs.pass` spans 1.7 % across the whole ladder,
inside this column's own 6.5 % A/A drift, with every hitch column flat. **Choosing a range is a look decision
with a free budget**, which is what the P1 measurement above predicted for this layer.

**Two things to carry forward.** The old behaviour was never "150" — it was "every instance of whatever cell you
are in", so the effective reach depended on where in the cell the camera stood (~360 units at a corner); the win
is determinism as much as reach. And **`avgTriangles` under-reports this feature**: it counts SUBMITTED
instances, so a group the camera stands inside is counted whole and culled per instance in the shader. The
column is accurate about vertex load and blind to the fill saving.

## 2026-08-11 — the species floor, and what "the budget is conserved" is worth in frame terms

[`opensa-engine/2026-08-11-headless-procobj-species-floor.json`](opensa-engine/2026-08-11-headless-procobj-species-floor.json)
— four `country-dusk` legs, same lane and pak as the two 08-10 rows above: **two `?procobjFloor=0` arms and
two `?procobjFloor=1` arms**, so each side carries its own A/A drift. The floor guarantees every eligible
clutter MODEL at least one placement in a cell where `procObjLimit` binds, paying for it with the
highest-lottery survivor ([plan 012](../../tools/sa-procobj-placement/docs/plans/012-species-representation-floor.md)).

| arm | draws | triangles | `gpuMs.pass` | `hitch.maxMs` |
| --- | --- | --- | --- | --- |
| floor 0 (A) | 821 | 1 191 107 | 3.661 | 16.7 |
| floor 0 (A′) | 821 | 1 191 235 | 3.672 | 9.5 |
| floor 1 (B) | 821 | 1 191 176 | 3.688 | 31.8 |
| floor 1 (B′) | 821 | 1 191 206 | 3.683 | 15.2 |

**No resolvable cost.** Triangles move **+0.002 %** on the pair means against a floor-0 pair spread of
0.011 %, and `avgDrawCalls` is **821 in every arm** — which is what the design predicts rather than a lucky
result: the floor never adds a placement, it swaps one. `gpuMs.pass` +0.52 % is the only column that moves
and it sits between the two pairs' own drifts (0.30 % and 0.14 %).

**Read the saturation before the columns.** This is the capped lane, so `avgMs` sits on 8.33 and `p95Ms` on
9.0–9.2 in all four arms; neither could have answered a cost question here (the same trap as the 08-10
ladder). `hitch.maxMs` spans 9.5–31.8 with no relation to the arm — one slow frame in B, none in B′.

**The honest gap, and it is the one the 08-10 null taught:** no positive control was run in THIS lane, so
nothing here establishes that the floor changes anything in `country-dusk` specifically. The proof that the
knob does something is a picture taken elsewhere — cell `-5,7` in the desert, 1.00 % of the frame against a
9.81 % clutter-off control, recorded in plan 012. **This run supports "no cost", not "an effect was present
and still cost nothing".**

## 2026-08-12 — the UV-anim lane guard: a standing sweep, and a pair that cannot be measured

[`opensa-engine/2026-08-12-ingame-uv-anim-lane-guard.json`](opensa-engine/2026-08-12-ingame-uv-anim-lane-guard.json)
— 8 of the 9 `?bench=all` scenes in Claude's headless lane, **uncapped** (DPR=2), on the user's
2026-08-11 18:04 pak. The frame numbers of the day, for the record and as the baseline the next UV-lane
question is asked against: `avgMs` 2.85 (ocean-horizon) → 5.03 (lv-night / country-dusk), `gpuMs.pass`
1.84 → 3.70, draws 39 → 2 213.

**This is a standing number, not a delta — and that is the finding.** Plan 099/02 owed a before/after on a
scene with no animated models. Both ways of building the "before" arm failed, and they failed for reasons
worth keeping:

- **Reverting the commit onto HEAD** (`git revert -n 402a450d`) conflicts in three places with later engine
  work, one of them an unrelated `drawClutter` signature change. A hand-merged engine is the instrument
  this project has already been burned by; the arm was abandoned rather than resolved.
- **A worktree at the pair itself** (`402a450d^` = `fc0f89c8`, and `402a450d`) boots, runs CLEO, prints the
  bench protocol — and renders **zero frames**. Both sides die identically: `texture array 5 not loaded
  (cells must load after their arrays)`, then an index-range overflow on a LOD render bundle (65 538
  indices into a 27 284-byte buffer). The incompatibility is between the 2026-08-07 engine era and the
  2026-08-11 pak; it says nothing about the UV lane. Both arms also registered **1 196 road cars against
  today's 1 219**, so even a rendering old arm would not have shared the workload.

A true delta needs an era-matched pak, and such a pak would no longer describe today's world (mod 39 gone,
the procobj species floor added since). What stands without it: the always-on cost of the lane is one
integer compare per rigid submesh bind — a model with no animations allocates no uniform, writes nothing
per frame and binds dynamic offset 0 everywhere (pinned by `engine.uv-anim.test.ts` on the fake device).
Companion numbers from the built ferris fixture the same day: `stepUvAnimation` **132.2 ns/call** over
2 000 000 calls with the real 261-keyframe `f13d`, and an observed strip cadence of **0.225 s exactly**
(130 steps across the 29.25 s loop) — the authored value, reproduced by the engine's own walker.

## The gap this record has

**The pak build was not recorded on the in-game rows**, and it turned out to be the whole answer to
07-18 → 07-20: what the map CONTAINED changed under us while the numbers were read as if it had not. The
lab rows carry a `converter` block; the sweeps did not. Every new in-game run must name its pak in `note`
— that is now in the readme's comparability checklist, and the 07-19/07-20 bisect rows carry it.

## 2026-08-17 — the first sweep with the FULL high-poly fleet (and a rebuilt map): nothing holds 120 any more

[`opensa-engine/2026-08-17-ingame-full-hipoly-fleet-sweep.json`](opensa-engine/2026-08-17-ingame-full-hipoly-fleet-sweep.json)
— the user's in-game `?bench=all` (his machine, capped 120 Hz) on the 2026-08-17 `build/original/opensa`
(pak 1 269 600 256 B, 1124 cells; the first build in which ALL 212 mod cars are the 30k–100k-polygon fleet,
`vehicles.img` 1781 MB + `vehicles2.img` 1415 MB of `.osm`). Baseline for the delta:
[08-09 A/A arm1](opensa-engine/2026-08-09-headless-bench-aa-after-102.json) (headless, DPR=2, capped, the
08-08 pak) — a different surface AND an 8-days-older map, so the delta is build + fleet + surface.

| scene | avgMs | p95 | gpu.pass | tris (M) | draws | cars |
| --- | --- | --- | --- | --- | --- | --- |
| ls-noon | 8.3 → 11.5 | 10.0 → 13.1 | 2.7 → 6.9 | 2.31 → 3.91 | 1094 → 1967 | 24 |
| sf-fog-dawn | 8.3 → 10.3 | 9.9 → 12.8 | 2.5 → 5.4 | 1.56 → 2.31 | 968 → 1394 | 22 |
| lv-night | 8.3 → 17.2 | 10.0 → 19.2 | 3.6 → 11.8 | 2.06 → 4.25 | 2251 → 3464 | 43 |
| country-dusk | 8.3 → 16.3 | 10.0 → 18.6 | 3.8 → 12.4 | 1.23 → 1.45 | 874 → 948 | 4 |
| ocean-horizon | 8.3 → 8.3 | 10.1 → 9.3 | 2.3 → 2.2 | 0.41 → 0.41 | 47 → 41 | 0 |
| ls-rain-night | 8.3 → 10.5 | 10.0 → 12.4 | 2.7 → 5.9 | 1.75 → 3.06 | 841 → 1663 | 24 |
| ganton-noon | 8.3 → 15.2 | 9.9 → 17.5 | 3.1 → 10.4 | 1.57 → 3.14 | 1264 → 1898 | 33 |
| strip-noon | 8.3 → 12.1 | 10.0 → 15.2 | 3.2 → 7.3 | 2.01 → 3.22 | 1075 → 2076 | 1 → 27 |
| ganton-night | 8.3 → 15.7 | 9.8 → 18.3 | 3.2 → 10.8 | 1.57 → 3.14 | 1274 → 1908 | 33 |

**GPU pass ×2.5–3.3 on every scene with content; the CPU side is flat** (vehicles 0.28–0.45 ms mean as
before, physics 1–3 ms, lateCreates 0, every `legStart` green). What the fleet explains: +50–100 %
triangles and +50–80 % draws where cars stand. **What it does not: `country-dusk` holds 4 cars, +18 %
triangles, +8 % draws — and its pass still triples (3.8 → 12.4 ms).** `cellVertex` residency is 2.0–2.9× on
EVERY scene (150–228 → 349–516) and texture residency +15–25 %: a large share is the WORLD — what the
2026-08-17 map contains and how much of it is resident — not the cars. **Next measurement, before any
fix**: the same sweep on the same pak with `?benchcar=<one stock low-poly model>` (pins every road car to one
cheap model) — if `gpu.pass` returns to ~3–4 ms the fleet is the cost, if `country-dusk` stays at ~12 the
world is; then a rect-repack / `model-repack` A/B on the suspect layer. The cost question itself belongs to
the `UNCAPPED=1` headless lane; this run answers "does it hold 120" — no.

**The pair, same day, same pak: `?benchcar=caddy`** —
[`opensa-engine/2026-08-17-ingame-benchcar-caddy-pin.json`](opensa-engine/2026-08-17-ingame-benchcar-caddy-pin.json)
(every road car pinned to the lightest `.osm` of the fleet, 2.2 MB — all 143 car slots are mod cars, so no
stock pin exists). `gpu.pass` baseline / fleet / caddy: ls-noon 2.7 / 6.9 / **5.6**, sf-fog-dawn 2.5 / 5.4 /
4.5, lv-night 3.6 / 11.8 / 10.8, **country-dusk 3.8 / 12.4 / 12.0**, ls-rain-night 2.7 / 5.9 / 4.9, ganton-noon
3.1 / 10.4 / 9.1, strip-noon 3.2 / 7.3 / 6.2, ganton-night 3.2 / 10.8 / 11.4. Triangles and draws come back
most of the way to the baseline; the GPU pass gives back ~1 ms where cars stand and nothing where they do
not. **Verdict: the fleet is ~10–15 % of the regression on car-heavy scenes and ~0 on `country-dusk`; the
rest is the WORLD as drawn today.** First suspect by the record: the RUNTIME clutter — the 08-09 baseline
predates the 08-10 per-category ranges and the 08-11 species floor, and the worst scenes are the grass ones.
Next: `?bench=all&benchcar=caddy&procobj=0`, then `parked=0` / `cargen=0` / a smaller `draw`, then pak-vs-pak.

**Third arm, `?benchcar=caddy&procobj=0`** —
[`opensa-engine/2026-08-17-ingame-caddy-procobj0.json`](opensa-engine/2026-08-17-ingame-caddy-procobj0.json):
**no measurable change** against the caddy arm on any scene (country-dusk 12.0 → 12.0, ganton-noon 9.1 → 9.2,
ls-noon 5.6 → 5.6); draws and triangles identical to the caddy arm everywhere (country-dusk 788/787 draws,
1.31/1.29 M tris) — either the runtime clutter costs nothing on the pass or the knob did not apply on this
path (the boot line would tell). Either way it is not where the ×3 lives. Same-ish geometry as the 08-09
baseline (country-dusk 1.3 M tris / 787 draws vs 1.23 M / 874) at 3× the GPU pass, with the sky-only scene
unchanged, points at per-pixel cost — overdraw / alpha classes / texture footprint of what the cells carry
now, or the far LOD ring's content. Next: `?benchcar=caddy&draw=400`, then `probe=0`, then the UNCAPPED lane
and a rect-repack A/B per mod layer.

**Fourth arm, `?benchcar=caddy&draw=400`** —
[`opensa-engine/2026-08-17-ingame-caddy-draw400.json`](opensa-engine/2026-08-17-ingame-caddy-draw400.json):
**the far ring is not it either.** country-dusk with half the resident cells (25 → 11), half the draws (788 →
408) and 0.97 M tris still costs 11.6 ms of pass (12.0 before); ganton-noon 9.1 → 10.9. Only the city scenes
with many far cells give some back (ls-noon 5.6 → 4.4, lv-night 10.8 → 8.6). The cost is NEAR the camera and
per pixel. Two facts that narrow it: the ENGINE has not changed since the 08-12 uncapped sweep (no
`packages/`/`apps/` commit since 08-11 but one debug-spawner change), so the delta is pak + surface; and
residency `target` reads 422 on every 08-17 row against 345 on every 08-09/08-12 row — the render targets
are ~22 % bigger on this surface (matches ocean-horizon's +20 %, not a ×3). Next: take the surface out —
the UNCAPPED headless sweep on THIS pak (same lane as 08-12 → a pure pak-vs-pak delta), then `probe=0`, then
a rect-repack A/B on country-dusk's cells per mod layer.

## 2026-08-18 — the surface taken out: the "×3" was two lanes read as one

[`opensa-engine/2026-08-18-headless-uncapped-0817-evening-pak-surface-out.json`](opensa-engine/2026-08-18-headless-uncapped-0817-evening-pak-surface-out.json)
— Claude, headless, DPR=2, **UNCAPPED**, all 9 scenes, on the user's 2026-08-17 EVENING pak (`world.ospak`
1 269 690 368 B, buildTime 18:10 — session 22's two fixes on top of the 10:54 pak arms A–D read), the full
1219-car fleet unpinned. **The same lane as the 08-12 uncapped record, so this is the pure pak-vs-pak delta:**
country-dusk pass 3.70 → 4.02 (×1.09), ocean-horizon ×1.04, and the city scenes ×1.5–1.7 (ls-noon 2.67 → 4.43,
lv-night 3.69 → 6.19, ganton-noon 3.06 → 4.77) — tracking their triangles (×1.5–2.1) and draws (×1.5–2.0), i.e.
the fleet, which arm B priced at ~1 ms. **The ×2.5–3.3 of the open issue was the user's DISPLAY lane read
against Claude's HEADLESS lane** — the comparison this readme forbids. His own lane already read country-dusk
**12.47** on 2026-08-09 (`2026-08-09-ingame-user-display-oldmap-baseline.json`, before mods 64/65, the pow2
resample, the LOD-link repairs and the fleet), against 12.37 on 08-17; lv-night 9.20 → 11.75, ganton-noon
8.54 → 10.36. On his lane, fleet pinned (arm B), the world's own residual is **+7–17 % on city scenes and −4 %
on country-dusk** — the cellVertex ×2–3 and texture +25 % of a fuller map, not a per-pixel ×3. What DOES stand
and was never this issue: his display costs 2–3× the headless canvas on the same content (country-dusk 12.5
vs 3.9 since at least 08-09, ocean-horizon only 1.2×), a standing fact about that surface.
`docs/open-issues/opensa-gpu-pass-regression-2026-08-17.md` closes on this.

## 2026-08-18 — two A/B builds on the user's display lane: the recent mods, and the fleet

**Build 1 — mods 64–67 out, the full fleet kept** (the four 08-16 map mods: GTA 5 Cranes, Watts towers, Urbanize only MAP, Binco Improved — `66–69` since the 2026-08-18 insert)
([`opensa-engine/2026-08-18-ingame-ab1-no-recent-mods-full-fleet.json`](opensa-engine/2026-08-18-ingame-ab1-no-recent-mods-full-fleet.json),
`build/ab1-no-recent-mods`, pak 1 189 171 200 B, buildTime 13:54; the user's in-game sweep, capped 120,
`target 422`, pair = [arm A](opensa-engine/2026-08-17-ingame-full-hipoly-fleet-sweep.json)): the four
2026-08-16 mods (GTA 5 Cranes, Watts towers, Urbanize only MAP, Binco Improved) cost **2–6 % of pass** —
ls-noon 6.86 → 6.46, ganton-noon 10.36 → 9.68, lv-night 11.75 → 11.27, country-dusk 12.37 → 12.08,
ocean-horizon 2.19 → 2.16 (control). Triangles −6..−19 %, draws ±1 %, cellVertex −3..−11 %. Decomposition on
this lane against the 08-09 oldmap row (ls-noon 5.07): fleet ≈ +1.2 ms (arm B), mods 64–67 ≈ +0.4 ms, the rest
since 08-09 ≈ +0.6 ms. `country-dusk` sits at 12.0–12.5 in EVERY arm — the surface, not the content.

**Build 2 — all mods, STOCK cars** (the vehicle stage excluded;
[`opensa-engine/2026-08-18-ingame-ab2-all-mods-stock-cars.json`](opensa-engine/2026-08-18-ingame-ab2-all-mods-stock-cars.json),
`build/ab2-stock-cars`, pak 1 260 396 544 B, buildTime 13:11, `vehicles.img` 272 MB; same lane, same pair):
**the pass returns to the 08-09 level** — ls-noon 6.86 → 5.52 (08-09: 5.07), lv-night 11.75 → 9.19 (9.20),
ganton-noon 10.36 → 9.03 (8.54), ganton-night 10.83 → 9.19 (8.70), sf-fog-dawn 5.39 → 4.40 (4.37), country-dusk
12.37 → 11.98 (12.47), ocean-horizon 2.19 → 2.18 (control). **On the display lane the fleet is +1.0..+2.6 ms of
pass on the city scenes and the whole map's growth since 08-09 is +0.0..+0.5 ms.** Two side findings: the fleet is
~700 draws in view on ls-noon (1967 → 1265 — the batching lever), and the `cellVertex` residency counter INCLUDES
vehicle geometry (ocean-horizon 349 → 57 with zero live cars — the registered road-car `.osm` buffers), so the
"×2–3 cellVertex on every scene" the closed issue read as world growth was the fleet's buffers.

## 2026-08-22 — the first OpenSA pak carrying lod-trees 013, on the user's display lane

[`opensa-engine/2026-08-22-ingame-lod-trees-013-sweep.json`](opensa-engine/2026-08-22-ingame-lod-trees-013-sweep.json)
+ the write-up [`opensa-engine/2026-08-22-lod-trees-013-sweep.md`](opensa-engine/2026-08-22-lod-trees-013-sweep.md).
`build/original/opensa` of 09:57 (repo `efe28767`), same lane and window as
[arm A](opensa-engine/2026-08-17-ingame-full-hipoly-fleet-sweep.json) — `ocean-horizon` pins at 120.0 fps /
8.333 ms in both, which is what says the lane matches.

**No frame cost: mean frame 13.008 → 12.767 ms (−1.9 %), GPU pass 8.099 → 7.872 (−2.8 %), 8 of 9 scenes equal
or faster, slow frames 35 → 24** (ganton-night 12 → 4, lv-night 11 → 3). Plan 013's own gate for the phase B it
never built was *"no measurable change on the Ganton lap"* — Ganton reads −1.4 % noon, −2.6 % night. The single
slower scene is `sf-fog-dawn` (+9.1 %), and its **+25.8 % triangles / +23 % draws** say it is submitting more
geometry rather than paying more per triangle; what gained geometry in SF between the two builds is a separate
question this row does not guess at. **Not a controlled A/B of 013**: the two paks are five days apart and also
differ by `mod-installer` 015/016, `img-splitter` 002, `vehicle-installer` 014 and `lod-common`'s blended-last
rule — what the pair carries is the absence of a regression, on the build where the LOD cells started welding
49 820 impostor triangles in the cutout class.

### 2026-08-22 — `timecyc-fog-ab` (look A/B, not a frame-cost run)

[2026-08-22-timecyc-fog-ab.md](opensa-engine/2026-08-22-timecyc-fog-ab.md). Nine headless captures on the
2026-08-22 `opensa` build (**not rebuilt**), one pose in SF, `weather=9` FOGGY_SF at hours 12/18/21, three
arms: the fog start floored at 0 (the old code), the same table as authored, and Dante's 552-row table as
authored. The figure is the fog contribution at the CAMERA — 0 % floored, 4/27/43 % from stock's own
authoring, 83/91/15 % from Dante's. Hour 21 is the control: Dante is LIGHTER there, so the arms track the
table rather than a bias. The only cost number is the boot parse: 0.859 / 1.698 / **2.016** ms for
184 / 504 / 552 rows, i.e. **+0.32 ms once** for the bigger table. `draws` and residency unchanged between
arms. **Not comparable to any row above** — no sweep was run and no scene flight was flown.

## 2026-08-22 — plan 104 on an unchanged world: an ENGINE-only A/B

[`opensa-engine/2026-08-22-ingame-plan-104-engine-ab.json`](opensa-engine/2026-08-22-ingame-plan-104-engine-ab.json),
user display lane, `?bench=all`, vsync-capped. **The cleanest pair this folder has**: the SAME pak
(`build/original/opensa`, 2026-08-22 09:57, unrebuilt) against
[the lod-trees 013 sweep](opensa-engine/2026-08-22-ingame-lod-trees-013-sweep.json) taken on it, with the
only variable being our code — that sweep's engine plus all of plan 104 (the one timecyc resolver, the boot
report line, and the fog start no longer floored at 0).

**Mean frame 12.788 ms against 12.767 — +0.17 %.** Nothing else in the sweep moves: every scene is within
±1.7 % on `avgMs`, triangles within ±0.3 %, draws within ±1.3 %, `legStart.ok` true on all nine legs,
`lateCreates` 0. Slow frames **24 → 21**. Plan 104 costs nothing measurable.

| scene | avgMs | p95 | gpu pass | draws | slow |
| --- | --- | --- | --- | --- | --- |
| ls-noon | 11.136 (−0.2 %) | 12.6 (−3.8 %) | 6.489 (−0.2 %) | 2085 | 1 ← 0 |
| sf-fog-dawn | 11.409 (**+1.7 %**) | 14.8 (**+8.8 %**) | 6.327 (**+2.8 %**) | 1713 | 0 ← 0 |
| lv-night | 16.537 (+0.4 %) | 18.9 (0.0 %) | 11.185 (+0.5 %) | 3530 | 8 ← 3 |
| country-dusk | 16.227 (+0.2 %) | 18.7 (0.0 %) | 12.113 (−0.5 %) | 995 | 7 ← 13 |
| ocean-horizon | 8.347 (+0.2 %) | 9.3 (−1.1 %) | 2.175 (+0.3 %) | 42 | 1 ← 0 |
| ls-rain-night | 10.284 (+0.9 %) | 12.2 (+0.8 %) | 5.622 (−1.2 %) | 1805 | 3 ← 1 |
| ganton-noon | 14.757 (−1.4 %) | 17.1 (−4.5 %) | 9.999 (−2.6 %) | 2000 | 0 ← 2 |
| strip-noon | 11.118 (+0.6 %) | 14.4 (+0.7 %) | 6.276 (+0.4 %) | 2005 | 1 ← 1 |
| ganton-night | 15.278 (−0.2 %) | 18.0 (+0.6 %) | 10.489 (−0.3 %) | 1991 | 0 ← 4 |

**The one scene worth a sentence is `sf-fog-dawn`**, and it is the only one where a mechanism exists rather
than noise: it is the FOG scene, plan 104 raised its fog factor everywhere by unflooring the start, and
`fogColorFor` runs its cloud math only on meaningfully fogged pixels (`smoothstep(0.7, 1.0, fogFactor)`,
`shaders.ts`) — so more fogged pixels means more pixels taking that branch. Pass +2.8 %, p95 +8.8 %, and its
`probe` also reads 2.932 against 2.408, which is the same population being sampled. **Stated as a mechanism
that FITS, not as a measured cause**: one run cannot separate it from the lane's own spread, and the same
scene moved +9.1 % between the two previous builds for a different reason. If it matters, the arm to run is
the floored/unfloored pair on this scene alone.

Everything else in the table is inside the noise this lane has shown before — `ganton-noon` reads −2.6 % on
pass in the same run, and nothing in plan 104 could make Ganton faster.

### 2026-08-22 — `sf-fog-dawn` floored vs unfloored (the arm the row above asked for)

[write-up](opensa-engine/2026-08-22-sf-fog-dawn-floored-vs-unfloored.md) ·
[runs](opensa-engine/2026-08-22-sf-fog-dawn-floored-vs-unfloored.json). Headless lane, `DPR=2`, **uncapped**
(the capped lane saturates at 8.333 ms and cannot see a 1 % move), six runs **alternated** `U F U F U F`,
one line of the driver the only variable.

**World pass +1.53 % unfloored** (median 3.969 vs 3.909) and **the arms do not overlap** — the cheapest
unfloored run is dearer than the dearest floored one, against a within-arm spread of 1.09 % / 0.75 %. So the
mechanism is real. **`avgMs` is flat to 0.1 %** with the frame clock removed, and every other column moves
the wrong way or on overlapping ranges (`p95` −12.5 %, `submit` +13.5 %, `probe` −2.3 %) — noise, shown
rather than hidden. No case for reinstating the floor: 1.5 % of the world pass on a fog scene buys back the
near haze that 112 of stock's own 504 rows author. **It does not explain the display lane's +8.8 % p95** —
different lane, one run, and `ganton-noon` read −2.6 % in that same sweep.

## Tool trials (not engine runs, never comparable to one)

| Date | File | What | Headline numbers |
| --- | --- | --- | --- |
| 08-06 | [district-texture-budget](opensa-engine/2026-08-06-headless-district-texture-budget.json) | The first REAL texture price of a mobile district, read off the user's own `--rgba8 --max-texture 256` pak on the phone (manifest computation, no GPU). 8 cell entries, 18 arrays, 663 layers, 21.4 M texels. | **115.4 MB** resident as built · **13.6 MB** if BC1 · **27.2 MB** if ASTC 4x4 → RGBA8 is **8.5x** BC1 and **4.2x** ASTC on real SA content |
| 08-06 | [astc-encoder-trial](opensa-engine/2026-08-06-headless-astc-encoder-trial.json) | The ASTC encoder chain 2 turned to (`astc-encoder.js` 1.0.0, wasm bindings of ARM astc-encoder), on a 128x128 synthetic with a HARD alpha edge — the shape SA's cutout foliage is made of. x64 container, one thread, no GPU. | **1.00 B/texel** (a quarter of RGBA8) · **PSNR 49.3 dB** (RGB 48.0, alpha 58.7) · 115 ms at MEDIUM |
| 08-09 | [dispatch-bundle-inventory](opensa-engine/2026-08-09-dispatch-bundle-inventory.json) | 201/1-01's BUNDLE column: what `dispatch.html` ships, per chunk and per source module (vite build + a sourcemap walk). Desk measurement, no device. Also the change that made the dead-code lane see this app at all — `apps/dispatch` was absent from `knip.json`. | **501.5 kB raw · 166.5 kB gzipped** over 6 chunks · **react-dom 44.1 %** (173.9 kB) > engine 35.5 % (139.8) > the console's own code 11.0 % (43.2) · biggest engine file after `engine.ts`: `hosek-wilkie-data.ts` at 33.4 kB · dead code: one unused export |
| 08-09 | [district-texture-budget-los-santos-centre](opensa-engine/2026-08-09-district-texture-budget-los-santos-centre.json) | The texture price of the district 201/1-01 PINNED (`los-santos-centre`, rect 5,-7,6,-6), off the user's own `--textures rgba8 --max-texture 256` pak on the phone (manifest computation, no GPU). 8 cell entries, 20 arrays, 597 layers, 18.4 M texels. Same tool and phone as the 08-06 row, different (denser) ground — comparable in kind, not in content. | **99.7 MB** resident as built · **11.7 MB** if BC1 · **23.4 MB** if ASTC 4x4 → ASTC is worth **76 MB** on this district, and textures alone are a fifth to a third of the 300–500 MB ceiling |
| 08-07 | [astc-preset-knee](opensa-engine/2026-08-07-headless-astc-preset-knee.json) | The two settings `createAstcEncoder` defaults to, measured rather than assumed: quality preset and thread count, on a 256x256 synthetic whose every block boundary meets a binary-alpha edge. x64 container, 4 cores, no GPU. | **MEDIUM is the knee** — +3.07 dB over FAST for 1.35x the time; THOROUGH adds 0.30 dB for 1.41x again · astcenc's own pool is **2.38x** one thread, bit-identical |
| 08-10 | [district-texture-budget-los-santos-centre-astc](opensa-engine/2026-08-10-district-texture-budget-los-santos-centre-astc.json) | The same pinned district on the ASTC build, and the FIRST pak built from a restored game copy — the earlier ones were converted off a source the pipeline had eaten (`--out` and `--game` were two symlinks into one folder; `gta3.img` carried 1073 `.osm` bundles, `gta_int.img` 155, both re-extracted from `Download/GTA CORP.rar` and verified `clean`). 8 cell entries, 20 arrays, 619 layers, 18.8 M texels, 281 map objects converted where the damaged source gave 0. **Not a format A/B against the 08-09 row** — the source integrity moved too. | **25.4 MB** resident as built (ASTC 4x4) · **15.7 MB** on disk · **95.9 MB** if RGBA8 → 3.8x, taken rather than priced · the estimator's own ASTC column reads 24.0 MB, i.e. 6 % optimistic on this content |
| 08-12 | [dispatch-render-target-attribution](opensa-engine/2026-08-12-dispatch-render-target-attribution.json) | Where the `target` category of the 08-12 phone capture goes, per texture. Desk arithmetic over every `createTexture('target', …)` in the engine at that capture's own surface (720x728 device px, MSAA 4x, renderScale 1), using the same byte estimates the ledger charges. No GPU, no timing — it answers the capture's second open question, which named this the first place 201/1-03 should look. | **36.54 MB over 23 textures, summing to the measured 36.54** · **MSAA 4x is 23.99 MB of it (65.7 %)** — more than the whole district's textures after ASTC (25.81) · bloom chain 6.67 (the ONE full-res prefilter is 4.00 of it) · env probe 1.88 · **and the category is FIXED**: a function of resolution and sample count, identical on a full-map build where everything else grows |
| 08-12 | [dispatch-bundle-inventory](opensa-engine/2026-08-12-dispatch-bundle-inventory.json) | 201/1-06's table, taken with a COMMITTED instrument (`scripts/debug/bundle-inventory.ts`) because the 08-09 row's one-off script left nothing behind. Same method, same entry, and the first bundle reading after merging 161 upstream commits. | **506.5 kB raw · 167.6 kB gzip** over 6 chunks (+5.0 / +1.1 against 08-09 — four days of upstream cost this surface 1 kB of gzip) · **the 08-09 table had a 107.3 kB HOLE**: `shaders.ts` went unattributed (394.2 + 107.3 = 501.5 exactly), so `packages/engine` is **48.8 %** and react+react-dom+scheduler **36.5 %** — the engine is the LARGER half, not the smaller · dead code: none that costs a byte · the one lever: WGSL comments/indentation, **22.1 kB gzip (13.2 %)**, priced and not taken |
| 08-21 | [dispatch-symbology-call-counts](opensa-engine/2026-08-21-dispatch-symbology-call-counts.json) | 201/5-02's desk half: what the 2D symbology layer ASKS OF THE CANVAS per frame at the declared 150 units + 40 calls, driven through a stub 2d context. A call count, **not a timing** — 1/01 measured `overlay-2d` at 2.44 ms (the largest item in the body, more than `engine-frame`'s 2.10) while drawing NINE units, and nothing on a desk says what it costs at 150. | **190 `measureText` + 190 `ctx.font` per frame → 151 measures once, then 0**, and one font assignment a frame · `fillText` unchanged at 190 (one per chip) — the remaining per-symbol cost, and 3/03's problem, not this step's · the ms at 150 is owed by 2/03 |
| 08-22 | [dispatch-track-memory](opensa-engine/2026-08-22-dispatch-track-memory.json) | 201/8-01's owed number: what the time axis costs for 150 units x a shift. A Node run, no GPU and no device — 150 units ticked through 8 h at the app's own 20 Hz into the real `UnitTracks`, with `process.memoryUsage()` either side. Also the reading that would have lied: `heapUsed` alone reports 0.2 MB for 17.5 MB of typed arrays, because a backing store lives outside the V8 heap. | **17.51 MB host, and the accounting is EXACT** (`arrayBuffers` moves by 17.51 against an accounted 17.51) · **it is HOST memory and may not be added to the 300-500 MB residency ceiling**, which counts GPU bytes · the ring is pre-allocated, so the stationary collapse buys HISTORY not bytes: the same 17.51 MB holds **8.0 h when every unit moves all shift and 24.0 h at a 25 % duty cycle** |
| 08-22 | [dispatch-scrub-cost](opensa-engine/2026-08-22-dispatch-scrub-cost.json) | 201/8-03's owed number: what a drag along the timeline costs, since it re-solves every entity per frame. A Node run against the real `BoardHistory` — a whole 8 h shift of 150 units + 40 calls recorded at 20 Hz, then 300 resolves spread across the full span (nothing warm). The resolve, not the paint. | **p50 0.071 ms · p95 0.193 · worst 0.636** — 0.4 % of a 16.7 ms frame typical, 3.8 % worst · the units are the cheap half; the tail is the calls' event lists at a deliberately absurd 49 transitions each · the call event list is the one structure here that is NOT bounded (125 kB at that rate, so nothing to do — but that is the thing to watch) |
| 08-22 | [dispatch-trail-cost](opensa-engine/2026-08-22-dispatch-trail-cost.json) | 201/8-04's owed numbers: what 150 trails cost, and how far back one goes. A Node run against the real `BoardHistory` — an 8 h shift of 150 units at 20 Hz, status changing every ~6 min, 200 full trail resolves. | **p50 0.200 ms · p95 0.649 · worst 1.055** for all 150 legs, resolved at the BOARD's rate not the frame's · **51 points/unit, 7 500 segments, 176 kB of line buffer per frame** — the number to watch on a phone · the span is DERIVED (the unit's leg, back to its last status change) so 8/04's warning about a constant chosen by eye does not apply · and a measurement defect worth keeping: the first run's confident **0 points** was the probe landing exactly on a status change, not the code |
| 08-22 | [dispatch-residency-census](opensa-engine/2026-08-22-dispatch-residency-census.json) | 201/1-05's desk half: what the residency rule ASKS FOR per zoom, ring policy vs view policy, counted out of the shipped `StreamingDriver` over a fake engine and a fake worker (its unit tests' harness shape). Synthetic 41×41 grid of 250 u cells — the run measures the RULE, not a district. **Block zoom 276 → 26 cells tilted / 16 in the plan view (a tenth); city zoom 276 → 202 / 176, because at city zoom the view really is most of the ring.** The HD column is the other half: the rings ask for 12 HD cells at every zoom, the screen-error rule for 14/16 at block zoom and **0 at district and city** — and 14 > 12 is the rule working, since a phone's 1600 px buffer resolves more than the bake's assumed 1080p and HD falls due at ~660 u rather than 450. Seconds and megabytes are [2/03](../plans/201-dispatch-console/2-real-device-truth/readme.md)'s to record |
| 08-22 | [dispatch-overlay-census](opensa-engine/2026-08-22-dispatch-overlay-census.json) | **201/3-03's owed budget** plus 7-04's and 7-05's costs, on the same stub-context method as 5/02's symbology count: what the round radar and the sketch layer ask of the 2D canvas. **A radar repaint is 914 calls at 150 units + 40 calls + a 160-box city; a frame where nothing moved is 0** — the dirty check returns before touching the context, which is the answer chain 4 needs rather than a retrofit. Ten annotations of eight points cost 422 calls (42 a shape). **The labels: 179 of 190 placed on a 1920×1080 desk and 86 on a 360×640 phone**, against ceilings of 1371 and 152 — the budget is the screen, not a constant. The static district outline is 160 of the 914 and [caching it is priced, not taken](../performance/deferred-optimizations/radar-outline-cache.md). Milliseconds are [2/03](../plans/201-dispatch-console/2-real-device-truth/readme.md)'s |
| **08-23** | **[mobile-pinned-district-inventory](opensa-engine/2026-08-23-mobile-pinned-district-inventory.json)** | dispatch console, `?inventory=1&district=los-santos-centre`, pak `17:45 12-08-2026` (rect 5,-7,6,-6, `--textures astc`), app = the prebuilt archive refreshed 08-23. **Taken and committed BY THE PHONE ITSELF** through `tools-debug/phone-console` — the first capture that reached the repository without a chat paste | **MGA-LX3 / ARM Bifrost**, 403x334 CSS px @ DPR 2 (806x668 device). ASTC + ETC2, **no BC, no `timestamp-query`** (GPU time unmeasurable). 605 drawn frames / 64.8 s, **599 skipped by the idle gate**, 4/4 cells, `warnings` and `errors` empty. **IDLE-DOMINATED — `fps 16` is the rate of DRAWN frames, not a frame cost**: the 100 ms idle poll is the histogram hump at 94-100 ms (156 of 605). Not comparable to the 08-09 row, which predates render-on-demand and ran RGBA8 at `--max-texture 256` | CPU body **mean 3.43 ms**, 5.8 % of the interval · **worst frame 600.3 ms, of which overlay-2d 422 and engine-frame 163.5** · submit mean 1.89 / max 19.3 · draws 112 · tris 278 k · **resident 76.1 MB** (target 37.5 · texture 25.8 · cellVertex 10.3 · index 2.5) + picking 1.4 · transport 29.3 MB in 53 requests · 17 cell creates, 0 late · symbology 12 symbols, **4 chips dropped** · tracks 1.1 MB for 9 units |
| **08-25** | **[mobile-first-draw-warmed](opensa-engine/2026-08-25-mobile-first-draw-warmed.json)** | the AFTER row for the overlay warm — same device, same ASTC pak, app rebuilt with `warmOverlaySurface`, the drawing `warmTextMetrics` and the resize guard (616f1f2) | **MGA-LX3 / ARM Bifrost**, 360x377 CSS @ DPR 2. **The frame-rate figures here are NOT a before/after**: this run is ortho at height 267 with 42 cell creates against 14 and a 46.9 s window, so `fps 21→30` belongs to the workload, not the fix | **`overlay:clear` 212.1 → 0.1 ms on the first frame** (window mean 0.566 → 0.000113), worst frame **333.1 → 123.0**, `dtMax` **390.5 → 140.1**. NOT claimed: the `fillText` glyph warm bought 2.3 ms of 22.6, so `overlay:symbols` at 20.3 is still unexplained; and **`engine-frame` is 77.9 ms in BOTH captures to the tenth** — a fixed first-frame engine cost, now the largest item and the next target · content **38.6 MB for 4 cells**, fourth running · 42 creates, **0 late** · **0 of 12 chips dropped** pulled back in plan view against 5 of 10 at street height |
| **08-25** | **[mobile-first-draw-split](opensa-engine/2026-08-25-mobile-first-draw-split.json)** | the same device and ASTC pak with the overlay's first draws split into `overlay:clear` / `overlay:symbols` / `overlay:sketches` (5757e2b) — written because `warmTextMetrics` was a guess that the first measurement after it did not support | **MGA-LX3 / ARM Bifrost**, 360x377 CSS @ DPR 2 (a shorter viewport than the row below, hence `target` 37.8 vs 59.9). 140 of 515 frames skipped; the 144-frame spike at 100 ms IS the idle gate | **The first `clearRect` is the cost, not the glyphs: worst frame 333.1 ms of which `overlay:clear` 212.1 (64 %), `engine-frame` 77.9, `overlay:symbols` 22.6.** One-shot, not per-frame — the split runs three draws, so the 0.566 ms window mean IS 212 ms of total. Absolute value is not stable (1 850 ms in the row below, same place, taller viewport, colder start); the SHAPE is. Content **38.6 MB for 4 cells**, third capture running to land there · **5 of 10 symbols dropped** at this height against 4 of 13 at 609 |
| **08-25** | **[mobile-centre-moving-camera](opensa-engine/2026-08-25-mobile-centre-moving-camera.json)** | dispatch console, the FIRST moving-camera capture on real content on the phone (556 drawn / 35.7 s, `errors` and `warnings` empty). **READ THE PAK LINE:** opened against `?src=…/build/phone-ls-rgba8` after an rgba8 convert, but the manifest says `20:18 12-08-2026` and the resident texture cost is 25.8 MB — the ASTC figure (23.4), not the rgba8 one (99.7). **It is an ASTC pak from 12 August and NOT the rgba8 side of the texture A/B**, whatever the folder is called. Not the symlink trap — `readlink -f` showed three distinct directories. The device's own pak check the next day confirms `build/phone/pak` IS this pak (20 arrays, ASTC4x4, 25.4 MB, built 20:18 12-08-2026) and that `phone.sh` reused it correctly for a default `astc` run — so the capture read `build/phone`, one of the URLs the script printed, not the hand-typed `phone-ls-rgba8`. It was invisible because the reuse line named the rect and the collision side but not the FORMAT; `textures=`/`models=` are on it now | **MGA-LX3 / ARM Bifrost**, **360x609 CSS @ DPR 2** — the first capture at the real phone width (08-23 was 403x334). ASTC + ETC2, no BC, no `timestamp-query`. 332 of 888 frames skipped by the idle gate; the 93-frame spike at 100 ms IS that gate. **IDLE-DOMINATED — `fps 21` is the DRAWN rate**: CPU body mean 7.48 ms against a 58.2 ms interval (12.8 %), `outside` 50.7 | **Worst frame 1 996.9 ms, of which overlay-2d 1 850.3**, at 1 896 ms with 0 cells visible — the first overlay draw, and it is LARGER than the 1 528 ms the 08-25 first-frame row measured before `warmTextMetrics` landed, so **the warm did not cover what actually costs it** (unconfirmed: whether the device had extracted the rebuilt archive) · resident **98.5 MB** (target 59.9 — bigger canvas than 08-23 — texture 25.8, cellVertex 10.3) so content is **38.7 MB for 4 cells**, on the 08-23 finding to within 0.1 · 112 draws · 278 k tris · transport 27.7 MB in 47 requests · 16 creates, 0 evictions, 0 late · **4 of 9 chips dropped** at this width · submit mean 1.78 / max 7.5 |
| **08-25** | **[mobile-first-frame](opensa-engine/2026-08-25-mobile-first-frame.json)** | dispatch console on the phone — the operator FLEW the map for minutes, but the inventory panel's poll was starved by the host's re-renders and the report was frozen at its first tick (fixed the same day; until then every capture of a moving map was a capture of the boot). Same device and pak as the 08-23 row | **Not a performance row**: window 1.6 s, `frames` 1, `cellsTotal` 0, 12 draws. It isolates what the 08-23 capture only hinted at with its 422 ms worst frame | **first frame 1654.9 ms — overlay-2d 1528.1, engine-frame 113.1** · resident 66.2 MB before any cell (target 37.5 + texture 25.8 are allocated at boot) · the symbology layer touching the canvas for the first time is the whole cost, and `warmTextMetrics` now moves the font resolution out of the loop |
| **08-26** | **[mobile-boot-split](opensa-engine/2026-08-26-mobile-boot-split.json)** | dispatch console on the phone with the boot shell, the pak slice cache and the async pipeline compile in (c6249be) — the capture that was taken to give the 08-25 leftover a name. Same device, same ASTC pak `20:18 12-08-2026`. Field note from the operator: **the map showed nothing for roughly 50 frames and then buildings appeared at once** | **MGA-LX3 / ARM Bifrost**, **360x444 CSS @ DPR 2**. 140 of 326 frames skipped; the 64-frame spike at 100 ms IS the idle gate. Idle-dominated as usual — body mean 5.07 ms of a 45.9 ms interval (11.1 %), `outside` 40.8. `errors` and `warnings` both empty | **`frame:sky-lut` is the 77.9 ms: 75.8 ms on the first frame, 0 on the second and 0.1 on the third.** One-shot CPU, and the split named it in ONE capture — the same instrument that found `overlay:clear`. The rest of that frame is noise by comparison (`record` 7.5, `submit` 0.8, `probe` 0.6, `cull` 0.3, `targets` 0.1) · **`boot.gpuMs` 2 607.5** — `engine.init` is now by far the largest single item in the whole boot, and it has NO before/after partner: the counter shipped in the same commit as the async compile, so what that change bought is unmeasured and is not claimed · **the cache answered 10.67 MB of 32.68 (33 %) over 59 of 88 requests** — working, but the misses are the big ones (texture arrays 16.8 MB / 52 requests) because this open reached further than the one that filled it · worst frame **148.1 ms** at 70 ms with 0 cells visible, of which `engine-frame` 95.8 and `overlay:symbols` 22.2 · 35 creates, **0 late**, 0 evictions · resident **75.8 MB** (target 44.2, texture 25.8) · p50 33.4 · **1 of 10 chips dropped** |
| **08-26** | **[sky-lut-build](opensa-engine/2026-08-26-sky-lut-build.json)** | what `buildSkyLut` costs per build, and the fix — taken straight off the row above, where `frame:sky-lut` owned 75.8 of the first frame's 77.9 ms | **DESKTOP NODE, not the device** — 40 builds at moving sun elevation, one warm-up discarded. The ratio is what carries to the phone; the absolute number does not | **13.29 → 4.05 ms per build, 3.3x**, and the cause was not the atmosphere maths: `f32ToF16` allocated **a new `Float32Array(1)` plus a `Uint32Array` view on every call**, 18 432 calls per build. Hoisting that pair to module scope did 13.29 → 4.38; passing the cosines the builder already holds instead of `acos`-ing them for the radiance form to `cos` back did 4.38 → 4.05. **Output verified bit-identical** across all three builds over 55 296 f16 values (hosek day, hosek near-horizon, preetham overcast). This is not only a boot cost — the LUT rebuilds whenever the hour or the weather moves, so it was a ~76 ms main-thread hitch on every one · **owed: the device number** |
| **08-26** | **[mobile-boot-warm-second-open](opensa-engine/2026-08-26-mobile-boot-warm-second-open.json)** | dispatch console on the phone, a SECOND open of the pinned district — taken to collect the three numbers the row above owed. **READ THE BUILD LINE FIRST: this capture carries no `boot.openMs` and no `boot.overlapMs`, so the device was running the app WITHOUT the boot overlap** (08bdb7a) — it is a capture of 00c6eaa, and nothing here says anything about that change. Same device, same ASTC pak `20:18 12-08-2026` | **MGA-LX3 / ARM Bifrost**, 360x377 CSS @ DPR 2, `renderScale` 1. Perspective at height **245.7** — street level and MOVING (112 draws, 278 k triangles) against the 08-26 row's 900. Window 18.2 s, 186 of 496 frames skipped; the 54-frame spike at 100 ms IS the idle gate. Idle-dominated as always — body mean **4.02 ms of a 52.7 ms interval (7.6 %)**, `outside` 48.7, so `fps 25` is the DRAWN rate and not a frame cost. `errors` and `warnings` empty | **The sky-LUT fix has its device number: `frame:sky-lut` 75.8 → 15.4 ms on the first frame, 4.9x** — against 3.3x in node, so the device gained MORE than the desktop bench predicted, and the whole first frame goes 85.1 → 23.7 ms · **the second open is answered: the cache served 23.60 MB of 26.26 (89.9 %) over 40 of 41 requests**, against 33 % / 59-of-88 when the open reached past what filled it; blob handler mean halves (0.130 → 0.065 ms). **The single miss is `water.bin`, to the byte** (26 258 610 − 23 599 854 = 2 658 756) — a loose file beside the pak rather than a pak slice, so it is a miss BY CONSTRUCTION and not a cache failure; whether those bytes crossed the network is not visible from here · **`boot.gpuMs` 2 607.5 → 398.4 (6.5x), and it is NOT claimed for anything**: the only code difference is the sky-LUT fix, which can own at most the 17.6 ms of `init:sky-lut`. The split says where the rest lives — **`init:pipelines` 226.8, `init:device` 117.4**, resources 28.9, targets 4.9, canvas 2.0 (397.6 of 398.4 attributed) — and the standing hypothesis for the missing ~2.2 s is the browser's persisted pipeline cache being WARM here and COLD there. The test is one capture with the site's data cleared against one straight after it; until then the boot's first-ever open is unmeasured · worst frame **148.1 → 76.4 ms**, of which `engine-frame` 95.8 → 29.2 and **`overlay:symbols` 22.2 → 26.5 — now level with the engine and the largest item after it**, which is 5/02's business · 11 creates, **0 late**, 0 evictions · resident **76.4 MB** (target 37.8, texture 25.8, cellVertex 10.3), picking 1.42 · **4 of 12 chips dropped** at 360 px |
| **08-26** | **[mobile-warm-boot-repeat](opensa-engine/2026-08-26-mobile-warm-boot-repeat.json)** | the same second open again, taken after a `git pull` that was meant to bring the boot overlap onto the device. **It did not: the pull printed `no such ref was fetched` — the phone's branch still tracked `claude/opensa-engine-g60fc1`, so nothing merged, the archive that was extracted was the one already in the tree, and this capture carries no `openMs` either.** Third capture of 00c6eaa in a row, and the second one taken believing it was of something else | **MGA-LX3 / ARM Bifrost**, 360x377 CSS @ DPR 2. Perspective at height 290.9, 61 draws / 158 k triangles — a LIGHTER view than the row below (112 / 278 k), so no frame figure here is a comparison against it. Window 15.8 s, 75 of 397 frames skipped, body mean 4.77 of 45.9 ms (10.4 %) | **The warm boot reproduces: `boot.gpuMs` 347.2 against 398.4, and `init:pipelines` 218.3 against 226.8** — the phase is a stable ~220 ms across two runs, which makes 2 607.5 the outlier rather than the series. `init:device` is the noisy one (80.9 vs 117.4). **Still not a cold/warm A/B**: neither run cleared the site's data, so the hypothesis stands untested and the first-ever open stays unmeasured · the second open reproduces too — **22.26 MB of 24.92 (89.3 %) over 38 of 39 requests**, and **the miss is `water.bin` again at exactly 2 658 756 bytes**, the same figure to the byte · `frame:sky-lut` 21.8 on the first frame against 15.4 — the fix's floor moves run to run, the 75.8 it replaced does not · worst frame 68.5 ms (`engine-frame` 36.3, `overlay:symbols` 14.6) · 11 creates, 0 late · resident 69.4 MB · **5 of 12 chips dropped** |
| **08-26** | **[mobile-boot-overlap](opensa-engine/2026-08-26-mobile-boot-overlap.json)** | **the AFTER row for the boot overlap, and the first capture in this repo that names the app it ran** (`app: 67432d1+`). Fourth attempt: the three before it measured the pre-overlap build, twice unknowingly. Same device, same ASTC pak `20:18 12-08-2026`. **The `+` is spurious and the instrument was fixed for it** — `appBuild` ran `git status` from inside the build, after `tsc -b`, so the build's own leavings read as uncommitted work; it looks at tracked files only now, minus the incremental cache. The archive was built from the clean tree of 67432d1 | **MGA-LX3 / ARM Bifrost**, 360x377 CSS @ DPR 2. Perspective at height **29.8** — street level, 112 draws / 278 k triangles, 22 creates. Window 22.5 s, 223 of 736 frames skipped, body mean 3.94 of 38.9 ms (10.1 %). `errors` and `warnings` empty. **Not the cold/warm pair either** — `cachedBytes` is 27.2 MB, so the origin's storage was warm | **The overlap works and is counted, not claimed: `openMs` 230.5, `overlapMs` 227.7 — 98.8 % of the world open ran underneath the GPU.** The pair costs **690.8 ms of wall instead of 918.5**, so the boot is 227.7 ms shorter (24.8 %) for a change that added 0.41 kB and no machinery · `boot.gpuMs` **688** on this run (pipelines 358, device 265, resources 33.8, sky-LUT 23.7, targets 5.7, canvas 1.1 — 687.3 of 688 attributed), against 398.4 and 347.2 in the two before: **`init:pipelines` spreads 218–358 and `init:device` 81–265 over three warm runs**, so a single boot number means little and 2 607.5 is still an outlier nobody has explained · the second open reproduces a third time — **27.20 MB of 29.85 (91.1 %) over 55 of 56 requests** — and **`water.bin` is the one miss again, at exactly 2 658 756 bytes**, now for the third capture running. Its transfer check shipped in this build and did NOT count it as a hit, which means either it crossed the wire or Resource Timing had no entry yet; the capture cannot tell those apart, so the next change moves that fetch INTO the overlap instead of measuring it further · `frame:sky-lut` 45.8 on the first frame (15.4 / 21.8 / 45.8 across three runs — the fix's floor is noisy, the 75.8 it replaced was not) · worst frame **122.8 ms** at 71.8 with 0 cells visible: `engine-frame` 63.3, `overlay:symbols` **32.8** · p50 29.9, fps 33 · resident 76.4 MB · **4 of 8 chips dropped** at street height |
| **08-30** | **[dispatch-bundle-theme-contract](opensa-engine/2026-08-30-dispatch-bundle-theme-contract.json)** | 201/7-10's owed bundle number, and the reason it is three builds rather than two: the STEP's cost and one PRESET's cost are different questions, and only the second answers the claim the step actually makes. Baseline = the tree before 7-10's two commits; `four presets` = this tree with Mark43 alone out of `THEMES`; `five` = as shipped. Desk build, no device, no GPU — and NOT comparable in absolute terms to the 08-12 row (6 chunks / 171.6 kB gzip there against 9 / 241.1 here, eighteen days of engine and console work apart). | **one preset costs 689 B raw · 197 B gzip**, which is the step's own claim — bytes, not frame time — measured rather than asserted · the whole step is **+4.5 kB raw · +1.56 kB gzip**, so **87 % of it is the contract and the validator, not the palette**: `shape` + `density` on every preset, APCA moved into `src/ui/apca.ts` so the runtime validator and the guard share one formula, and the four sources of a skin resolved in one place · at 197 B a preset, the switcher's cost is not the thing to watch; the CSS sheet is (five palettes plus a `(pointer: coarse)` block of three variables each) |
| **08-30** | **[mobile-driven-map-150u](opensa-engine/2026-08-30-mobile-driven-map-150u.json)** | 201/2-03's unanswered half, and **the first round taken entirely through the panel's MCP channel** — the console was opened on the phone, flown, read and filed by tool calls, with no number relayed by a person. Pak `19:23 28-08-2026` (astc, rect 5,-7,6,-6, models), app `311f2d1` | **MGA-LX3 / ARM Bifrost**, 360x570 CSS @ DPR 2 — the surface GREW mid-run when the browser chrome collapsed. **MIXED WINDOW, and it must be read as one**: 1406 frames of which 903 are the render gate's idle poll plus one 18.2 s gap where Android froze the backgrounded tab, leaving **503 moving frames**. The report's own `dtP50` 100.4 / `dtP95` 106.0 average the poll in and are NOT frame costs | **The frame is a VSYNC LADDER, read off the histogram: p50 30 ms (33 fps), p90 64, p95 66.** 189 driven frames (38 %) land on one 16.7 ms interval, 152 (30 %) on two, 108 (21 %) on three — the console reaches 60 fps and does not hold it · largest CPU item is `overlay-2d` **2.37 ms** against `engine-frame`'s 0.57 · streaming kept up with every flight, `lateCreates` **0** over 37 creates · `chipsDropped` 93 of 148 symbols at 360 CSS px · the render target is **~69 MB per megapixel** over three surfaces the browser chose for itself |
| **08-30** | **[mobile-lens-ab-circuit](opensa-engine/2026-08-30-mobile-lens-ab-circuit.json)** | 201/7-01's ortho cost, over an IDENTICAL circuit — four poses, two laps, one height, one tilt, one heading, back to back in the same page, so only the lens differs | Same device and pak as the row above, app `311f2d1`. **The confound is the size of the result and is not buried**: the browser chrome collapsed between the legs and the surface grew 460 800 → 622 080 device px (+35 %), fragment cost only the ortho leg paid | Raw: perspective mean **28.8 ms** (p50 26, p95 52), ortho **36.3** (p50 32, p95 72) — but normalised by area the order REVERSES (62.5 vs 58.3 ms/Mpx). **A band, not a verdict**: what it supports is that the lens is not what costs; a number for either needs a re-run with a pinned surface |
| **08-30** | **[mobile-boot-cold-vs-warm](opensa-engine/2026-08-30-mobile-boot-cold-vs-warm.json)** | the 2 607.5 ms boot outlier 201/4-03 could not explain, finally paired. The panel's `webapp` job re-unpacks the served app, which gives every asset a new identity — so the first open after it cannot be answered by the browser's persisted pipeline cache | Same device, app `311f2d1`, pak `19:23 28-08-2026`. Three opens minutes apart, nothing else changed | **`init:pipelines` 4681.1 cold against 429.1 warm, 10.9x**, accounting for 4252 of the 4650 ms between the two boots (`gpuMs` 5339.7 / 689.2 / 404.3). **So the outlier has an owner, and the uncomfortable half is that the cold boot is the one an operator takes on a new build** — 4/03's 227.7 ms overlap was measured against a warm ~690 ms boot · the overlap reproduces both ways, 99.5 % cold and 99.4 % warm · `water.bin` is the repeat-open cache's one miss again, to the byte |
| **08-30** | **[mobile-overlay-ab-150u](opensa-engine/2026-08-30-mobile-overlay-ab-150u.json)** | **what the symbology costs against what the ENGINE costs** — the A/B `?overlay=0` was built for (201/2). Both halves one pak (`17:45 12-08-2026`, out `./build/phone-ls`), one app (`e3c4831`), one circuit | **Read the pak line**: this pair is on the 12-08 pak, so it is internally valid and NOT comparable to the driven-map row above. The overlay-off half ran on a 35 % LARGER surface, so that confound works AGAINST its result | **The CPU body is 5.114 ms per drawn frame with the overlay and 2.256 without, and 3.785 of the 5.114 — 74 % — is symbology and board, against the engine's own 0.723.** Moving-frame interval halves: mean 53.9 → 30.6 ms, p50 48 → 24 · **`engine-frame` goes UP, 0.723 → 1.463, and that is SELECTION not cost** — with nothing over the map the gate only draws while the camera flies · **19 of 98 draws and 36 886 of 234 852 triangles are symbology inside the 3D pass** (the beacons) · 5.9 drawn frames per second of wall clock against 10.4, which is 4/01's battery half |
| **08-30** | **[mobile-idle-timer-fix](opensa-engine/2026-08-30-mobile-idle-timer-fix.json)** | the field verification of a frame-scheduler defect the row above FOUND: `schedule(true)` kept the idle timeout's handle after the timer fired, so `wake()` read a dead handle as a pending wake and armed a second `requestAnimationFrame` on top of the drawn frame's — two loop entries per displayed frame | A timer defect no test can see, whose only signature is frames faster than a vsync interval. **The rate is the comparison, not the distribution**: the two windows read different paks (12-08 before, 28-08 after) and are different lengths | **192 of 808 frames under 8 ms (23.8 %) before, 6 of 229 (2.6 %) after — 9x**, the remainder being the legitimate case of a real touch waking a genuinely idling loop. Moving-frame p50 does not move (24 ms both), so what went away is wasted entries rather than work — **claimed for the loop entries and their wake-ups, and for no frame-time improvement** |
| **08-31** | **[mobile-honest-frame-counter-150u](opensa-engine/2026-08-31-mobile-honest-frame-counter-150u.json)** | 201/3-05's own verification, and **the first row read off the honest frame counter** — the console was opened, flown, read and released by tool calls, with no number relayed by a person. Pak `19:23 28-08-2026` (astc, district `los-santos-centre`), app **`016c1e7+`** — the `+` is the proof it ran the new chrome rather than `main`'s archive | **MGA-LX3 / ARM Bifrost**, 360x609 CSS @ DPR 2, no `timestamp-query` so GPU time is not measurable. **MIXED WINDOW like the 08-30 row and read the same way**: 835 samples of which **706 are the interval that SPANS the render gate's 100 ms idle wake**, leaving **129 moving frames**. The collector never samples a skipped pass — the sample call sits behind the gate — but a skipped pass schedules the next loop entry with `setTimeout(100 ms)`, so the frame after it carries a dt that is 99 % sleep. On a live 150-unit board the console alternates draw/skip, which is why that is 85 % of the window. `dtMaxMs` 16 550 is the frozen backgrounded tab, not a frame | **THREE readings of one run, and the spread is the finding: the report's own `fps` 10 / `dtP50` 100.6 ms (the idle poll), the new on-screen counter mid-flight `17 fps · 60.9 ms · cpu 10.3 ms`, and p50 48 ms (21 fps) derived over the 129 moving frames** (p90 66, p95 68, p99 78). The old readout used the collector's formula and would have shown 9–10 here, and the still-map heartbeat read 8–9 — so the fix is worth **~7 fps of truth**: the console was under-reporting itself by nearly half while it worked. A vsync ladder again but a rung lower than 08-30's (that run flew six poses at 260–1400 m, this one one pose to **420 m** at a shallow tilt, which places all 153 labels — `namesHidden` **0** against 152 at the opening 900 m): 19 % on one 16.7 ms interval, 25 % on two, **36 % on three**, 18 % on four. **The CPU block is diluted by the same tail** — `bodyMean` 2.66 ms and `shareOfFrame` 2.3 % are means over 835 samples of which 706 were mostly sleep, while the console's own `cpuMs` (the last DRAWN body) read **10.3 ms**; `overlay-2d` 1.33 ms against `engine-frame` 0.33 keeps 1/01's and 08-30's finding in SHAPE but ~6.5× low in absolute terms. **This row is the BEFORE for pushing that derivation down into the collector** — every capture since render-on-demand landed (08-22) has had its moving half derived by hand in prose |
| **08-31** | **[inventory-collector-storage](opensa-engine/2026-08-31-inventory-collector-storage.json)** | **a SYNTHETIC micro-benchmark, not a device row — do not compare it with one.** It exists because 201/3-05 replaced the collector's storage and *"this is cheaper"* needed a number. `FrameInventory` kept every `dt` in an array and copied-and-SORTED the whole thing on every `report()`, which the panel asks for every 500 ms | session container, x64, node 22 — **not the phone**, where ARM Bifrost would be worse. One function, 20 reports averaged per row | **At 216 000 frames (two hours at 30 drawn fps — 4/02's long session) a report cost 58.2 ms, and at 2 Hz that is 116 ms of main thread PER SECOND: the instrument taking ~12 % of the thread it was reporting on, and no capture ever said so because the collector does not measure itself.** After a bounded histogram: **0.002 ms**, and the kept samples go 1.65 MB → **0**. 1 k frames 0.195 → 0.008 ms (23×), 10 k 1.50 → 0.002 (703×), 100 k 22.3 → 0.002. The price is a percentile that is a BIN's floor — up to one bin low, never high — which is the precision every row since 08-22 already had, because they were all read off these bins by hand |
| **08-31** | **[mobile-split-collector-after](opensa-engine/2026-08-31-mobile-split-collector-after.json)** | 201/3-05's **AFTER** row — the first capture through the split collector, same link, district, pak and device as the before-row. App **`fd0c8ae+`** | **MGA-LX3 / ARM Bifrost**, 360x320 CSS @ DPR 2. **A STILL-MAP window, not a flown one** — `map_goto` answered `flyingTo` but the pose never left the opening one and only 47 of 527 drawn frames are paced; Android throttled the tab throughout (two commands unanswered, the attach lapsed twice, `map_open` had to raise the console again). So it is NOT comparable as a device number with the flown before-row — the before/after here is the COLLECTOR, and both sides come from this one capture's own data | **The same window: 10 fps before, 36 after.** The old collector's median over all 527 samples lands at index 263, and since only 46 fall below 100 ms the median IS a rest interval (~103 ms) → `fps` 10. Over the 47 intervals that are frame times: **p50 28 ms, fps 36**, p95 76, max 104.7. `shareOfFrame` 1.5 % → **41 %**. And the rest population is NAMED rather than derived: **480 frames, mean 103.74 ms** (`IDLE_WAKE_MS` plus the loop prologue, measured directly for the first time), **82 % of the 60.7 s window**. **It also found the next layer:** `cpu.bodyMs` is paired one pass late on purpose, so after a SKIPPED pass it carries the GATE's ~0.2 ms — `bodyMeanMs` read **1.48 ms against a real 13.84** (recoverable as `shareOfFrame` × `dtMeanMs`) and every segment ~11× low. Fixed the same day; **do not quote `bodyMeanMs` or `segmentsMs` from this row** |
