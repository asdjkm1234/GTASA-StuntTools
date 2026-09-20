# Procedural ground clutter (procobj, plan 042)

`packages/renderware/src/parsers/text/procobj.parser.ts`, `surfinfo.parser.ts`,
`packages/renderware/src/map/procobj-*.ts`, `build-procobj.ts`, adapter integration, debug ProcObj
screen.

## The two hosts get it by DIFFERENT mechanisms (plan 014, 2026-08-10)

- **`sa` (the real game) — BAKED.** `sa-procobj-placement` scatters at build time and emits **one permanent text
  IPL row per object at `lod = -1`**, then raises those species' draw distance in the stock
  `data/maps/generic/procobj.ide` from **59 to 299**. No LOD twin, no binary stream: `CIplStore` only keeps a
  stream's slot resident within 190 units of the player, so a streamed row cannot use a long draw distance at
  all, and a generated LOD recovered ~0.2 % of a hand-modelled bush's geometry for the price of a whole entity.
  Costs 91 092 permanent `CBuilding` entries and 10 of SA's 40 inst-bearing IPL slots.
- **`opensa` (our engine) — RUNTIME.** No bake at all: the stage does not run for this target, so `procobj.dat`
  reaches the engine with all 95 rules (it used to arrive stripped to 9, all underwater) and the scatter below
  places them per cell. Draw distance is a setting rather than an IDE column, nothing is vertex-duplicated into
  the pak, and density is a runtime knob again.

**What that reverses:** density used to be "one profile, both hosts, not a per-target axis" (2026-08-09). It is a
build constant on `sa` and a setting on `opensa` now. What `opensa` gives up is the baked AO the pak computes per
HD vertex — runtime clutter is drawn instanced and has nowhere to keep it. Prelight is unaffected (it lives in the
stock DFFs).

## Implemented

- `procobj.dat` parsing (~95 rules, 18 `P_*` surfaces, 14 columns) and `surfinfo.dat` surface
  table (**row order = COL material id**, 179 rows; the `P_*` rows ARE the procobj surface
  names — no extra mapping).
- Deterministic per-cell scatter over collision faces: mulberry32 seeded by cell coords; world
  triangles from COL verts × placement matrices; area-weighted counts; sqrt-warped barycentric
  points; rule ranges for rotation/scaleXY/scaleZ/z-offset; face normal kept (align), flipped
  up when winding points down (upside-down-bushes fix).
- **`procobj.dat`'s columns are spent the way the game spends them** (corrected 2026-08-09, and it was worth
  5.9× the clutter): SPACING is a LENGTH, so the count per face is `area / spacing²`, and MINDIST is a
  distance to the CAMERA, never between two objects. Nothing culls by inter-object distance — the triangle IS
  the group, which is why authored clutter reads as clumps in some places and singles in others
  ([`gta-sa-original/procedural-objects.md`](../gta-sa-original/procedural-objects.md)).
- **Lottery mechanism**: 3× vanilla candidates with `lottery ∈ [0,3)`, sorted → live density
  slider = instance-count cutoff, no cell rebuild. The headroom is a PARAMETER since 2026-08-09
  (`scatterProcObjects(…, maxDensity)`, default 3), so a build-time cutoff above 3 is reachable — at the price
  of re-rolling the scatter from the second collision face on (each face consumes draws in proportion to its
  candidate count).
- **A scatter batch is one model on ONE SURFACE** (2026-08-09). `procobj.dat` keys its rules by surface+model
  and 19 of its 56 models appear on several surfaces, so a batch keyed by model alone took the category of
  whichever surface the collision walk reached first — six `p_rubble*` were mis-categorised, which mattered
  because category drives draw distance. See
  [`gta-sa-original/procedural-objects.md`](../gta-sa-original/procedural-objects.md).
- **Build-time density is a PROFILE, not one number** (2026-08-09, lod-procobj plan 010):
  `lottery < densityFor(category, surface)` — category-on-a-surface beats category beats base beats the
  authored density, default 1.0 everywhere so the scatter is unchanged. `tools/map-placement/src/procobj/
  density.ts`; the converter reports per-category `generated / objects / dropped-by-cap`. A bad entry throws
  naming its key. **The shipped profile is `base: 1`, decided 2026-08-11 — a result, not a placeholder.** The
  authored density already places **1.58×** the field-accepted reference (91 379 against ProperFixes' 57 583)
  AND reproduces its hand-authored skew unaided: **our top 2 species of 56 are 42.0 %** of the layer against
  their **40 % of 46**. So the profile machinery has nothing left to earn, and `flowers` — the poorest
  category at 0.25 % — **cannot exceed 678 objects at any cutoff**, because it is rare in the DATA. Raising
  anything is a new argument, not the completion of this one
  ([plan 010](../../tools/sa-procobj-placement/docs/plans/010-density-model.md) task 8).
- Semantic categories (grass/flowers/bushes/cacti/trees/rocks/underwater; sea floor overrides
  to underwater) with per-category `{enabled, drawDistance, density}` in `graphics.procobj` +
  debug **ProcObj** screen.
- **`drawDistance` became REAL on 2026-08-10, and until then it was dead config.** It was written by
  `setProcObj` and by the debug slider and read by NOTHING, so the seven values (50–150) described a behaviour
  the engine did not have: clutter was drawn for every instance of every loaded cell, the cells came from
  `streaming.collisionDrawDistance` (150), and cells are 256 units — so the effective reach was cell-shaped and
  depended on where in the cell you stood, up to ~360 units at a corner.
  **How it works now:** the range rides to the engine per group (`CellClutter.drawDistance`, keyed off the
  batch's category, which is why `CellClutterRender` carries `category`) and is applied **per instance** in
  `vsClutter` — an instance whose ORIGIN is past the range is pushed outside the clip volume. Per instance
  rather than per group because one group spans a 256-unit cell and a whole-group test cannot express 100.
  A group that is *entirely* out of range is skipped on the CPU as well, so it costs no vertex work either.
  The streaming ring is now `clutterRingRadius` — the widest ENABLED category — because a category cannot draw
  past the radius its cell is loaded at. **Clutter COLLIDERS deliberately stay on the collision ring**: a bush
  300 units away is scenery, and Rapier static bodies at that radius are the cost that once bought 17 ms/step.
  **The shipped values, and the reasoning rather than the numbers**: SA draws ALL procedural clutter at a flat
  `PLANTS_MAX_DISTANCE = 100`, one number with no species variation. That is our FLOOR, not our target — so
  grass/flowers/underwater sit at 100, bushes 150, rocks 200, and cacti/trees 300, on the rule that what reads
  as a silhouette carries and what reads as ground texture does not. 300 is also what `sa` shows (plan 014's
  permanent rows at 299), so the two targets stop disagreeing about the same world.
  **Measured**: monotone across 100 / 150 / per-category / 300 against a 0.020 % A/A control, a **4× lever in
  layer terms** (9 110 → 36 191 triangles) reading as +2.3 % of the scene, and **free** — `gpuMs.pass` spans
  1.7 %, inside its own A/A drift
  ([bench row](../benchmarks/opensa-engine/2026-08-10-headless-procobj-per-category-ranges.json)).
  `?procobjRange=<units>` overrides every category with one number (the A/B knob; `150` reproduces the old
  ring, `100` is SA's own). **Caveat for anyone measuring this**: `frameTriangles` counts SUBMITTED instances,
  so a group the camera stands inside is counted whole — the column is accurate about vertex load and blind to
  the fill saving.
- **One `procObjLimit` (default 150/cell, `?procobjLimit=<n>`)** caps BOTH rendering and collision, and since
  2026-08-11 through **one function**: `procObjCellBudget` resolves the per-category density, the cap and the
  species floor into a keep-count per batch, and the render path and the collider path each spend that array
  — so they cannot diverge by anyone forgetting to apply the same rule twice. Vanilla pools at ~300 for the
  same physics-cost reason. **Its value is unowned since the 2026-08-09 column fix** — the candidate pool it
  rations shrank ~19×, so it binds far less often and the number was calibrated against a density that no
  longer exists.
- **A patch of ground shows its whole species roster — `?procobjFloor=<n>`, ON at 1 since 2026-08-11.**
  Without it the cap pools every candidate in the cell and keeps the lowest lotteries, so what decided whether
  a species survived was how many species competed there: **17.7 % of clutter cells lost at least one model**
  (worst `8,-3` at 16 of 23), reading as terrain that simply has no cacti. The floor guarantees every eligible
  MODEL at least `min(n, its eligible count)` placements — per model, not per batch, because 19 of 56 models
  scatter on several surfaces — and **pays for them at the top of the lottery order**, so the budget is
  unchanged and the skew above the floor is untouched. Cost: 0.32 % of the drawn placements and **no
  measurable frame time** (`avgDrawCalls` identical across four legs). `?procobjFloor=0` is the A/B.
- **The in-triangle sampler is a knob, and `corner` IS the original's routine rather than a copy of it**
  (`--sampler` / `?procobjSampler=`, default `area`). Expand the recovered `pos = V1 + (V2−V1)·o1 +
  (V3−V2)·o2` with `o2 = o1 × rand()` into barycentric weights and it is our own formula with `o1 = rand()`
  where ours reads `o1 = sqrt(rand())` — **the whole difference is one `sqrt`**. `corner` pulls toward
  whichever vertex the COL lists first (mean weight 0.5 against area-uniform's 1/3, unit-tested). Map-wide it
  keeps the placement count identical and tightens only the close tail — same-species nearest neighbour p05
  **3.5 → 3.2 m**, median unmoved. `area` is the default because V1 is a MESH fact, not a landscape one, so
  the bias clumps on arbitrary tessellation corners; the knob exists because it is nonetheless the look the
  world was tuned in front of ([plan 010](../../tools/sa-procobj-placement/docs/plans/010-density-model.md)
  task 12).
- **Slope-aware candidate density (`--slope` / `?procobjSlope=`), built 2026-08-11, NEUTRAL by default.** Per
  category, a multiplier on how many candidates a STEEP (`|normal.z| < 0.85`) or a FLAT face generates. It is
  **the only terrain signal not already carried by the surface**: 12 of the 14 rule-bearing surfaces sit ≥90 %
  inside one region and carry that region's species, but `p_mountain` splits **48.8 / 51.2 steep-flat** while
  holding all six `p_rubble*` rock species. **It lives in the shared scatter, not in a density cutoff** —
  slope is a per-FACE fact and both selection paths resolve a cutoff per BATCH, which pools every normal the
  faces happened to have; so a cutoff cannot express it, generation can, and **both targets get it from one
  place**. Priced: `2,0.5` nets **+14 % rock objects** (+1.05 % of the layer), which says the rock area is
  already weighted toward steep ground. **It re-rolls the seeded scatter**, so two settings compare
  statistically, never placement by placement
  ([plan 011](../../tools/sa-procobj-placement/docs/plans/011-biome-zone-density.md)).
- **The `sa` bake makes the same guarantee, through a WIDER gate** (`--species-floor`, default 1). Nothing
  caps that path — the global `procObjMax` slice does not bind at the shipped density — so what empties a
  species locally there is the density LOTTERY, not a budget: three candidates on a patch roll all three above
  the cutoff about 30 % of the time. Its gate is therefore "had a candidate in this 250 u cell" rather than
  "survived the density", and it ADDS objects instead of swapping them: **+312 of 91 067 (+0.34 %)**, with the
  layer still at 10 inst-bearing area IPLs of SA's 40. Floored objects sort ahead of the lottery order, so a
  binding `procObjMax` would displace ordinary objects rather than silently undo the guarantee
  ([plan 012](../../tools/sa-procobj-placement/docs/plans/012-species-representation-floor.md)).
- **The bake left the `opensa` branch on 2026-08-10 (plan 014), so the runtime scatter is the WHOLE clutter
  layer there again.** `convertProcObj` STRIPS every species it bakes, so while the bake ran on this target the
  shipped `data/procobj.dat` carried 9 rules of 96 (all `P_UNDERWATERBARREN`) and the runtime knobs measured a
  null result on dry land — `?procobj=0` and `?procobjLimit` 1 → 3000 moved `country-dusk` by 0.007 % against a
  0.41 % A/A drift ([the null row](../benchmarks/opensa-engine/2026-08-10-headless-runtime-clutter-null-result.json)).
  **That was a SITE failure, not an instrument one, and it is closed**: on the unbaked pak the same arm moves
  −2.72 % against a 0.007 % drift.
  **What still holds from it:** the two layers are disjoint (there is no double clutter), and a knob test on a
  dry scene could not have printed non-zero — check that the thing you are switching off is PRESENT where you
  measure before reading a null.
  **What no longer holds:** clutter load on `opensa` is a runtime quantity again, so a density sweep is URL
  params on one pak rather than two builds. Its ceilings, measured: `procObjLimit` saturates at 300 (the
  candidate pool per face is `area / spacing²`, so a cell has no 300th placement at cutoff 1) and the density
  multiplier at ×3, which is OUR `PROC_OBJ_MAX_DENSITY` and not a wall
  ([the ladder](../benchmarks/opensa-engine/2026-08-10-headless-procobj-runtime-knob-ladder.json)).
- Collision = rendered set ∩ models that ship a COL (rocks/cacti/trees collide; grass/flowers
  walk-through); knob changes re-stream physics (debounced invalidate + reload).
- Wind mod's `decoratePart` runs on clutter parts (procedural bushes sway when listed).
- Clutter is pickable through the engine Map screen (`CellStore.pick` over the placement mapper, plan
  074/22). Offline sanity tool: `scripts/debug/procobj-stats.ts`.
- **"Show procobj"** (Map Viewer checkbox, 2026-08-11): `Engine.clutterEnabled` gates the DRAW, so the
  generated layer subtracts out of the frame and leaves the map the IPLs actually place. The scatter, its
  buffers and its COLLIDERS are untouched — switching back costs no re-upload, and the draw/triangle counters
  move by exactly what procobj costs at that pose. Restored on map-viewer exit.

## Known gaps / candidates

- `useGrid` column unimplemented (no vanilla rule uses it).
- Vanilla's create-around-camera MINDIST behaviour intentionally replaced by per-category
  drawDistance + per-cell budget.
- **`sa`'s baked layer uses one flat draw distance (299)** — ProperFixes' value, matched before improving on it.
  Ours is 1.6× their object count, so 58 638 bushes now draw to 299 m; the IDE column is per model, so
  per-category distances are the open lever THERE
  ([`014` step 6](../../tools/sa-procobj-placement/docs/plans/014-permanent-rows-no-lod-twins.md)) — on
  `opensa` they shipped 2026-08-10 and are measured, so that step now has a reference set to argue against
  rather than a blank. Nothing measured asks for it on `sa`, where 299 flat is the proven value.
- Density defaults left at 1 (authored). Since the column fix that IS the authored density: the build-time
  layer places **91 419** objects across 43 species against 15 286 before (91 092 before the species-roster
  floor turned on, 2026-08-11). Shaping it per category/surface/biome is
  [`sa-procobj-placement/010`–`012`](../../tools/sa-procobj-placement/docs/plans/010-density-model.md).
  **The perf budget that was to own `procObjLimit` and `procObjMax`
  ([`013`](../../tools/sa-procobj-placement/docs/plans/013-density-budgets-per-target.md)) is DONE and set
  neither**: measured on both targets, frame time does not bind at this density, and the layer is
  field-accepted on `sa` as of 2026-08-11. A cap here needs a new measurement, not this one.

## Test coverage anchors

`procobj.parser.test.ts` (incl. shipped-file invariants), `procobj-scatter.test.ts`
(determinism, counts, normal flip, lottery cap), `procobj-runtime.test.ts`,
`procobj-colliders.test.ts`, `build-procobj.test.ts`.
