# 025 — Texel smear on big flat surfaces: a UV broken at the model's edges

**Status: CLOSED 2026-08-11 — diagnosis stands, the repair is RETIRED.** The scanner (family C + the three
world gates) and the diagnosis are the surviving output: the smear is authored R\* data and the optimizer is
innocent (0 UVs move at any pass). The `repair-uv-stretch` pass built on that diagnosis repaired 3 849 faces
across 104 models and was reversed by the first field before/after the same day — a partial repair of a
continuous UV defect trades a soft smear for hard-edged patchwork, and the mapping it writes is invented,
because no authored frame exists to restore. Full reasoning and the revisit conditions:
[`docs/postmortem/uv-stretch-repair.md`](../../../../docs/postmortem/uv-stretch-repair.md).

Original status: PLANNED 2026-08-11. Field report (user): large and/or flat map objects render with "broken
textures" — long directional smears — and **the class is absent before the map-optimizer stage runs**. Four
named spots below. This plan is DIAGNOSIS-FIRST: the decisive measurement is offline and costs no rebuild and
no field round, so it comes before anyone writes a fix.

**The user's reading, and this plan follows it: it looks like a broken UV coordinate on the model's EDGES.**

## Field cases

| model | txd | position | what it looks like |
|---|---|---|---|
| `road_lawn34` | `roads_lawn` | 1124.6, -951.4, 40.9 | long smears running along the road |
| `road_lawn08` | `roads_lawn` | 1163.1, -1046.4, 32.4 | same |
| `road_lawn32` | `roads_lawn` | 1268.4, -932.8, 37.7 | same |
| `sbseabed3_las20` | `seabed` | 2901.3, -2058.4, -51.4 | vertical striping along the sand/water edge |

`lae2_roads03` was reported alongside these and is NOT part of this plan — the user withdrew it the same day
after it was matched to plan [024](./024-broken-authored-vertex-data.md)'s parked non-goal (degenerate-UV
texel smear on the `lae2_roads*` curb fan, authored SA data, byte-identical in vanilla, parked 2026-07-15).

## The constraint that shapes everything below

**The class appears on the `sa` target as well as `opensa`.** `sa` is rendered by the real game's renderer, so
no sampler, shader or filtering decision of ours is in that picture at all. Whatever is wrong is carried in
the DATA both targets share, or in a texture the tool rewrote.

The corollary matters for how the phases are ordered: any explanation that lives in
`packages/engine` is disqualified as a single cause before it is tested. That is why the mip/filtering theory
is demoted to a secondary below rather than being Phase 0 — and the user's own "at the edges" observation is
the second reason, because an isotropic minification blur is a function of viewing angle across the whole
surface and would not localize into a band along one edge.

## What was READ on 2026-08-11, and what it killed

The obvious UV-corruption mechanisms were checked against the tree the same day. **Three are falsified**, and
recording that here is the point — each one is an axis nobody has to spend a round on again.

1. **`smooth-normals` cannot destroy a UV seam. FALSIFIED.** The worry was that its position-weld
   (`weldEpsilon` 0.001) collapses two coincident vertices carrying different UVs — which is precisely what a
   UV seam IS. It does not: `emitSplitVertices`'s `resolve` is keyed on the **original vertex index**, not on
   the welded `canonId`, so two coincident originals keep separate slots and separate UVs. `canonId` is used
   only to look up the group NORMAL. The vertex count only ever grows (024 measured `lae2_roads17`
   165 → 209), and split copies take their UV from `splitSources` via `appendSplitsF32`.
2. **`weld-vertices` cannot merge vertices with different UVs. FALSIFIED.** Its key is ALL attributes —
   position, normal, `uvs`, every `extraUvs` layer, prelit and night. Two vertices differing in a UV get
   different keys by construction.
3. **`dedupe-faces` cannot drop the mirror face of a two-sided sheet. FALSIFIED.** `canonicalKey` rotates the
   corner order but preserves winding, so `(a,b,c)` and `(a,c,b)` are different keys and both survive. This
   mattered because 024 measured 22 reversed-winding twin faces on a road sheet of this family.
4. **`remapVertices` (shared by weld and prune) carries `uvs` and every `extraUvs` layer through.** Read, no
   defect found.

### What that leaves, and one thing worth naming

**A missing guard, exactly where its absence is silent.** `geometry-rebuild.ts`'s `uvLayersOf` keeps an EXTRA
UV layer only when `layer.length === vertexCount * 2` — its comment says a topology plugin that forgot to
remap a layer "drops it here rather than corrupting the Struct". **Layer 0 (`mesh.uvs`) is pushed with no such
check.** So the protection the codec advertises covers every layer except the one every model uses. This is
not evidence of a bug — no plugin read today skips the remap — but it is the shape of hazard this repo files
under "silent by nature", and if the Phase 0 diff comes back non-empty it is the first place to look.

## Hypotheses, ordered

**H-A — the UVs really do change, and the diff will say where.** The user's reading, taken at face value. The
falsifications above narrow it: whatever changes them is NOT the weld, the dedupe or the normal split. That
leaves `prune-vertices`, `degenerate-triangles`, the re-encode path, or a pass interaction none of the four
covers alone. Phase 0 settles it in one run and, if positive, names the pass in the second.

**H-B — the UVs are untouched and something else changed what the same UVs LOOK like.** The candidates, all
data-side so both targets see them: the mip chain the `--textures` pass writes into single-level TXDs (plan
[010](./010-texture-mipmaps.md)), which is what lets minification happen at all; the rebuilt normals, which
change shading rather than texturing; and the `flat`-model per-vertex AO (`bake-vertex-ao`), which bakes
occlusion onto models with a handful of vertices spanning tens of metres and Gouraud-smears one vertex's value
across the whole slab. On this branch the smear is not a texture defect at all and the word "texture" in the
report is the symptom's costume.

**H-C — engine-side filtering, secondary and cannot be the whole story.** The world sampler is trilinear with
**no `maxAnisotropy`** — a grep for it over `packages/engine/src` returns nothing, so every sampler in the
engine runs at 1. That is a real defect worth its own fix, but it is disqualified as THE cause by the `sa`
constraint above. It stays on the list only because it may be making the real defect look worse in `opensa`
than it is in `sa`, and the user's screenshots are from `opensa`.

## Phase 0 — diff the UVs offline. No rebuild, no field round

For each model in the table: resolve its source DFF exactly as the build does (the resolver in
`scripts/debug/model-repack.ts`, plan 024 Phase 0 — last mod shipping it in numeric folder order, else
vanilla), run the geometry chain in memory, and compare UVs **before vs after**, per vertex and per face.

Report per model: vertex count before/after; count of vertices whose UV changed at all and the max delta;
count of faces whose UV-triangle area changed sign or collapsed; and the same restricted to vertices on the
model's boundary edges, because that is where the user says it lives.

- **Byte-identical UVs** ⇒ H-A is dead, the tool is exonerated on this axis outright, and Phase 2 takes over.
  This is the answer plan 024's parked non-goal predicts, so it must not be treated as a surprise.
- **Any change** ⇒ H-A is alive; re-run per pass (the chain is five plugins) and the first one that moves a UV
  is the answer. Record the table here either way.

A control belongs in the same run: a model NOT in the report (any nearby building) through the same
instrument, so a non-empty diff is known to mean "this model" and not "every model".

### RAN 2026-08-11 — the chain never moves a UV, and the degenerate ones are AUTHORED

Throwaway instrument (deleted; its metric is what Phase 1 folds into the scanner): resolve the source DFF the
build way, run the five geometry plugins one at a time, and after each one compare the `position → {uv}`
associations carried by the FACE CORNERS. Positions are never moved by any pass, so a position identifies a
vertex across re-indexing.

| model | source | authored normals | verts → | uv moved | uv lost | uv-degenerate faces before → after |
|---|---|---|---|---|---|---|
| `road_lawn34` | vanilla | **NO** | 359 → 368 | **0** | 0 | **30 → 30** |
| `road_lawn08` | vanilla | **NO** | 223 → 223 | **0** | 0 | **0 → 0** |
| `road_lawn32` | vanilla | **NO** | 330 → 328 | **0** | 0 | **26 → 26** |
| `sbseabed3_las20` | vanilla | **NO** | 71 → 71 | **0** | 0 | **16 → 16** |
| `lae2_roads17` (control) | `0. Map Fixes Pack` | yes | 168 → 211 | **0** | 2 | **8 → 8** |

- **H-A is dead.** Not one UV moved, at any pass, on any model. The tool is exonerated on this axis.
- **Positive control on the instrument**: `lae2_roads17` reads **8** UV-degenerate faces — the exact number
  plan 024 recorded by hand for its parked non-goal. The metric reproduces an independently-measured value,
  which is what makes the zeros above worth believing.
- The control's `uv lost 2` is not a defect: it appears at `remove-degenerate-triangles` and is a
  zero-position-area face taking its own corner association out with it.
- **The degenerate UVs are authored and untouched** — same count in, same count out, on vanilla data.
- **And they do not explain the report**: `road_lawn08` has **zero** of them and was reported anyway. So
  degenerate UVs are a real property of this asset family but cannot be the whole cause.

### The thing the run actually turned up: all four ship NO normals, and we give them some

Every reported model carries **no authored normals** in vanilla — and `smooth-normals` runs with
`addWhereAbsent: true`, so the chain CREATES them (`road_lawn34` even splits 359 → 368 verts doing it).

Two lines in this repo already say that is dangerous, written before the report existed:

- `createWhereAbsent`'s own skip branch is commented **`// real SA must not gain normals`**.
- `run.ts` documents the flag as: *"`--no-add-normals` **if vanilla-renderer vertex lighting looks off**."*

And it reaches the real game, because `perfect-map-builder` sets `optimizerPasses: { addNormals: true }`
globally (`config.ts:75`, justified as "normals created for OpenSA's SSAO") while the `optimize` stage runs on
the COMMON build (`pipeline.ts:182`) — the `sa`/`opensa` split happens later. **One optimize run feeds both
targets, so the real game's own renderer receives world models carrying normals it never shipped.**

That fits every constraint the report puts on a cause: present on BOTH targets (it is in the shared build),
absent before this stage (nothing else creates normals), and worst on big flat objects (a road that was
prelit-only now takes a directional term across a slab with a handful of vertices). It is now **H-B1**, the
leading hypothesis, and Phase 2 tests it directly.

Owed before it is treated as fact (standing rule — recover the original's formula, do not fit one): confirm
against gta-reversed / SkyGfx **which SA building pipeline a geometry with normals selects**, and whether that
is what changes the shading of a previously prelit-only road.

### RE-MEASURED the same day — the Phase 0 metric asked the wrong question

The user's close-ups of `road_lawn34` reframed it: the texture **tiles correctly with its repeat neighbours**,
so the UVs at the shared edges are right — but inside a band of faces it is *stretched*, with fine detail
preserved ACROSS the streaks and destroyed ALONG them. That is a texel magnified on one axis, not a mip blur
(which loses detail on both axes equally). So the question is not "is the UV triangle exactly collapsed" but
**by what FACTOR is it stretched** — and a face does not have to be degenerate to smear.

Metric: for each face solve the linear map `M` with `M·(t1−t0) = p1−p0`, `M·(t2−t0) = p2−p0`; its singular
values are world units per UV unit along the mapping's principal axes, and `σmax / σmin` is how many times
longer than wide a texel is drawn on that face.

| model | faces | world area | aniso > 8 | aniso > 16 | worst face |
|---|---|---|---|---|---|
| `road_lawn34` | 203 | 3 619 u² | 80 (11.6 % area) | 66 (**5.3 %** area) | collapsed (σmin = 0) |
| `road_lawn08` | 130 | 3 097 u² | 33 (2.5 % area) | 31 (1.5 % area) | **284×** (11.3 × 0.040) |
| `road_lawn32` | 200 | 5 505 u² | 60 (3.3 % area) | 56 (2.3 % area) | collapsed |
| `sbseabed3_las20` | 39 | 44 491 u² | 16 (**23.6 %** area) | 16 (23.6 % area) | collapsed, 443–678 u² each |

- **`road_lawn08`'s zero was a threshold artefact.** It has no exactly-collapsed face, which is why Phase 0
  scored it 0 — and a face stretched **284×** is what the field is looking at. The strict metric would have
  sent the whole plan after the wrong model.
- **`sbseabed3_las20` is the extreme**: 16 of its 39 faces map one UV axis to nothing, and they are **a
  quarter of the model's surface**, 443–678 u² apiece. A single texel row is drawn across each.
- All of it is **vanilla, authored, and untouched by the chain** (Phase 0 proved the chain moves no UV).

**So the smear itself is explained, and it is authored data.** What is NOT explained is the user's timing —
"absent before map-optimizer" — and that premise is now the thing under test, not a given. A plan's premise
about what is BROKEN is as untrusted as its premise about code.

### TIMING SETTLED 2026-08-11 — the stage is exonerated

User ran `sa-map-viewer.html` against the pre-optimizer original: **the defects are there too.** So this is
original-game data, and map-optimizer neither causes nor worsens it. Confirmed per model, `sbseabed3_las20`
included — its lower band "slips" in the untouched original exactly as it does in the build.

**`sbseabed3_las20` is therefore the acceptance test for any repair, not the roads.** It is the model where
the local pass reaches the fewest broken faces (50 %) while the broken ones are the largest share of surface
(23.6 %, at 443–678 u² each). A design that fixes 97 % of `road_lawn08` and half of the seabed will read in
the field as "still broken", because the unfixed half is the part anyone looks at. H-B1 (created normals) is not needed to
explain the smear and drops off this plan's critical path.

One thing survives from the report and is now a SEPARATE finding: *"in SA we see them too, but not as harshly
as in OpenSA."* Same data, worse on our side. That is where H-C legitimately lives — it does not CAUSE the
defect, it AMPLIFIES it, and `maxAnisotropy` is exactly the term that decides how badly a stretched texel
smears. **Split out and DEFERRED by the user 2026-08-11 to
[`docs/roadmap/0.6.0/plans/06-anisotropic-filtering`](../../../../docs/roadmap/0.6.0/plans/06-anisotropic-filtering/readme.md)**
— it is a whole-world look change with an unmeasured frame cost, and running it now would confound this
plan's own field rounds, since both change how the same spots look.

### Can it be REPAIRED here? — measured feasibility, 2026-08-11

**The obvious mechanism failed its own test.** Plan A was: fit the affine world→UV map the good faces agree
on, re-derive the broken faces from it, and the texture keeps tiling with the neighbouring MODELS for free.
Measured residual of that fit **on the good faces themselves**: p50 **1.84** uv units on `road_lawn34`, 1.36
on `road_lawn08`, 2.60 on `sbseabed3_las20`. A uv unit is one whole tile, so the good faces do not share one
world→UV map at all — the authored UVs restart per strip rather than running continuously. There is nothing
global to re-derive from, and any repair that assumed there was would have moved the texture by whole tiles.

**A LOCAL repair is viable, and here is the share it can reach.** Extend a GOOD neighbour's mapping across the
shared edge instead of fitting a global one. Broken = anisotropy > 8 for this probe:

| model | broken faces | have a good neighbour | good-face texel density (world u per uv u): min … median … max |
|---|---|---|---|
| `road_lawn34` | 80 / 203 | 50 (**63 %**) | 0.33 … 5.15 … 7.45 |
| `road_lawn08` | 33 / 130 | 32 (**97 %**) | 4.95 … 6.62 … 9.95 |
| `road_lawn32` | 60 / 200 | 48 (**80 %**) | 3.63 … 5.83 … 8.15 |
| `sbseabed3_las20` | 16 / 39 | 8 (**50 %**) | 20.49 … 28.49 … 36.98 |

- **Reachable in one local pass: 50–97 % of broken faces.** The rest sit in the interior of a broken band with
  no healthy edge to inherit from — they need the repair to propagate outward in rounds, or they stay broken
  and get REPORTED. A pass that silently leaves half the seabed unfixed while claiming the model is repaired
  is the failure mode to design against.
- **There IS a per-model scale to match**: good-face texel density holds inside ~2× within a model (and
  differs 5× BETWEEN models — the seabed is a far coarser mapping than a road). So the repair matches its own
  model's median density, never a constant.
- **The shared-edge UVs may not move**, because that is what makes the texture join the neighbouring models —
  the user verified that joint is correct today. So a correction goes onto a SPLIT copy of the vertex, which
  is machinery this tool already has (the count-changing re-encoder, plan 004; `smooth-normals` splits daily).

**Risk to price before building it**: some degenerate UVs may be deliberate — a face collapsed onto a single
texel row to read as a flat colour strip. Repairing one of those changes the look for the worse. The scan has
to sample what the TEXTURE actually holds under the collapsed faces before the pass is allowed to touch them.

### The arm that settled the timing, offline

`sa-map-viewer` reads SA-native trees — `game-src/<game>` (untouched vanilla) AND `build/<game>/sa` (after the
stage). The compare server already pairs them:
`npx tsx tools/map-optimizer/src/compare-serve.ts --before ./game-src/original --after ./build/original/sa`.

Same renderer, same camera, one variable, no rebuild and no field round. If `road_lawn34` smears on BOTH
sides, the stage is exonerated outright and this becomes a question about authored SA data (and what, if
anything, we are allowed to do about it). If it smears only on the `after` side, the timing premise is real
and H-B1 (created normals) is what to chase.

## Phase 1 — RAN 2026-08-11: the population kills the curated list, and the metric with it

Family C added to `scripts/debug/scan-model-defects.ts` (`--aniso`, default 8), same shape as A and B:
area-weighted, ranked by the SHARE of the model's own surface the flagged faces cover, with the map-wide
population printed next to the ranking — because how many models carry it is what decides curated-list vs
general-rule. 8 051 placed models, 7 148 with a DFF source, ~1 min.

| share of the model's own surface flagged at > 8× | models | placements |
|---|---|---|
| any at all | **4 708** | 28 472 |
| ≥ 1 % | 3 082 | 21 671 |
| ≥ 5 % | 1 540 | 14 370 |
| ≥ 10 % | 976 | 10 080 |
| ≥ 20 % | 493 | 5 007 |
| ≥ 50 % | 250 | 2 975 |

3 306 models carry at least one outright COLLAPSED face.

**So a curated list is out.** 66 % of the placed world is in this class at 8×, and even the strictest tier is
250 models / 2 975 placements. This is the same wall plan 024 hit when Family B came back with 2 243 models
and the answer stopped being per-model repair.

**And the metric does not separate the class.** The whole top of the ranking is `cables`, `wires_01..18_sfs`
and `ltslasky*` — power lines and cables, 100 % of their surface flagged, most of their faces collapsed
outright. **That is how you texture a wire.** A long thin ribbon SHOULD map a texel far off square; it is
authoring, not damage. Ranking by raw anisotropy therefore ranks "how ribbon-like is this geometry", which is
the exact failure mode 024 round 1 already recorded once, when `standard01_lawn` topped a naive angle metric
with a legal vegetation trick.

**What actually distinguishes `road_lawn34` from `cables`** is not the magnitude — it is the DISAGREEMENT.
A wire is uniformly stretched end to end; the road is a slab where most faces are healthy and a band of them
is not, which is why the smear reads as a defect against its own neighbours rather than as a look. The next
criterion has to be a per-face mapping discontinuity ACROSS SHARED EDGES (a face whose texel density or
orientation departs from the adjacent faces of the same surface), not a threshold on the face alone. The
53–97 % "has a good neighbour" numbers measured above are the same signal seen from the other side.

### RAN the same day — the edge criterion, and then a third, and BOTH mis-rank

**Attempt 2 — disagreement with edge-neighbours.** A face flagged only when it is stretched past 8× AND its
crushed axis is 4× finer than the median of the faces across its edges. Population collapsed exactly as
hoped — 584 models ≥1 % of surface (from 3 082), 89 ≥5 %, 32 ≥10 %, 5 ≥20 % — and most wires left the top.

But the positive control failed: **`sbseabed3_las20` scored 1 flagged face of 39** (0.5 % of surface) while
the field calls a quarter of it wrong, and the three roads landed at 0.5–2.1 %. The reason is structural and
was visible in the earlier feasibility numbers: a face in the MIDDLE of a broken band has broken neighbours,
so nothing disagrees. The criterion detects isolated bad faces among good ones; the field's worst case is a
whole band.

**Attempt 3 — disagreement with the MODEL's own healthy median**, refusing a verdict when the healthy set is
under 20 % of the faces (meant to exclude ribbons by construction). The control now passes:
`sbseabed3_las20` **16/39, 23.6 % of surface** and `road_lawn34` **75/203, 7.5 %** — the bands are caught,
and both numbers match the hand measurement above.

And the wires came straight back to the top: `wires_04c_sfs` 81.1 %, `vgsewires04/05_lvs`, `vgntelwires21`.
The refusal gate does not fire on them **because a wire model also carries its poles** — so it HAS a healthy
baseline, and the strands duly deviate from it.

### Where that leaves the criterion, stated plainly

Three formulations, three mis-rankings, and they fail in opposite directions: raw magnitude ranks ribbons
first, neighbour-disagreement misses bands, model-baseline catches bands and ranks ribbons first again.
**Geometry alone has not separated "stretched by design" from "stretched by mistake"**, and it may not be
able to — in the mesh the two are the same thing. What differs is what the surface IS.

The next idea, recorded as a hypothesis and NOT implemented: compare a face's UV anisotropy against its own
GEOMETRIC elongation. A wire strand is a long thin triangle, so its stretched mapping matches the shape it
sits on; a road-band face is a broad triangle carrying a sliver UV, and that mismatch is the defect. Related
form: check whether the UV's crushed axis lines up with the face's own thin axis.

**But the standing lesson applies before another metric is written** — several wrong axes in a row means
stop guessing and let the FIELD answer. The cheap move is to take the ~32 models at ≥10 % of surface, have
the user look at a handful, and FIT a criterion to labels instead of guessing one. That also finally gives
the population an honest denominator.

**Until then the map-wide count for this defect class is UNKNOWN.** 4 708 is the count for "extreme mapping"
and 3 464 for "extreme and off the model's baseline"; both are strictly larger sets that mostly are not
broken, and quoting either as the defect count would be a scope error.

### The labelling set — Phase 1c, awaiting the user's eyes

Population under the model-baseline criterion (a tier is "flagged faces cover ≥ N % of the model's own
surface"; the last column drops models too small to be worth a trip):

| tier | models | placements | over 200 u² |
|---|---|---|---|
| ≥ 1 % | 2 114 | 15 836 | 1 733 |
| ≥ 5 % | 825 | 5 011 | 643 |
| ≥ 10 % | 417 | 2 160 | 326 |
| ≥ 20 % | 169 | 614 | 134 |
| ≥ 50 % | 35 | 37 | 25 |

Thirty models to look at, chosen to make the labels DECIDE something rather than confirm: the four the field
already reported (they must come back TRUE or the criterion is worthless), the ribbon families it is
suspected of over-flagging (they must come back FALSE), and a spread of ordinary world surfaces where nobody
knows the answer. Near-identical siblings are collapsed to one entry — there is no information in the second
`vgntelwires`.

| group | models | what a verdict decides |
|---|---|---|
| field-known controls | `road_lawn34` 7.5 % · `road_lawn32` 3.3 % · `road_lawn08` 1.6 % · `sbseabed3_las20` 23.6 % | the criterion's floor: it must rank these as defects, and today three of them sit BELOW its 10 % tier |
| wires / cables | `wires_04c_sfs` 81.1 % · `vgsewires04_lvs` 74.8 % · `vgntelwires21` 62.1 % · `cewirestown09` 61.6 % · `ce_wires01` 50.4 % | the suspected false positives. If these read fine in the field, the ranking is upside down and the geometric-elongation idea is the fix |
| thin signage / neon | `triadneon01` 63.3 % · `burgershotneon1` 57.3 % · `vgsn_burgsht_neon01` 59.5 % · `drvin_sign` 35.8 % | whether "thin emissive strip" is a second by-design family alongside cables |
| fences / mesh | `snpedteew1vv_las` 69.9 % · `snpedteew8_las06` 54.6 % · `snpedteairt_las` 39.7 % | same question for wire mesh |
| ordinary surfaces — the informative ones | `road03sfn` 40.1 % · `backalleys1_sfe` 43.2 % · `track01_sfn` 41.5 % · `ferrybit3_sfw` 45.8 % · `garse_85_sfe` 40.4 % · `pigpenblok1tr_lae` 72.4 % · `cstwnland03` 44.7 % · `archbuild_wins` 35.2 % · `stationstuff` 41.8 % · `rdwarhus` 40.4 % · `wc_lift_sfse` 48.2 % | the actual unknown. `road03sfn` is the single most valuable spot: a ROAD at 40 %, five times `road_lawn34`'s share |
| interiors, skip unless convenient | `airport_int2` 54.6 % · `airport_front` 35.6 % · `snowover04` 64.7 % | z > 1 000 — interior space, needs its own access |

Positions and the exact per-model counts are in the run output; every row is reachable with
`npx tsx scripts/debug/teleport-spot.ts <model> --game original`.

### FIRST LABEL, 2026-08-11 — `road03sfn` is CLEAN, and it explains the ranking

User looked at it: the 40 % flagged share is a **SKIRT hanging under the road** — a vertical apron authored
to mask the gap below, textured by dragging the road's UV downward, so the vertical axis maps to no UV
movement at all and every face of it collapses. *"It is hidden from the world… in game you cannot see it at
all, there are no other anomalies there."* A false positive, and a label worth more than the four rankings
above it: the same shape is what puts cables, neon strips and mesh fences on top. **All of them vertical.**
The reported class is the opposite — a surface you look DOWN at.

**So a 4th formulation: flag only UP-FACING faces** (`--up`, default `|nz| ≥ 0.5`; absolute because a
two-sided sheet ships its mirror copy wound the other way). Building it exposed a self-inflicted bug worth
recording — filtering the DENOMINATOR too made a vertical fence keep a 0 u² denominator, so one flagged face
read as 99.9 % and signs with no measurable surface topped the list. The denominator is the whole model now.

**And it still does not rank.** On the only labelled pair that exists:

| model | field label | before the up-filter | after |
|---|---|---|---|
| `road03sfn` | **CLEAN** | 40.1 % | **16.1 %** (42/862 faces) |
| `road_lawn34` | **BROKEN** | 7.5 % | **3.7 %** (6/203) |
| `road_lawn32` | BROKEN | 3.3 % | 1.0 % (2/200) |
| `sbseabed3_las20` | BROKEN | 23.6 % | 4.5 % (4/39) |
| `road_lawn08` | BROKEN | 1.6 % | drops out entirely |

The clean model still outranks the broken one by 4×. And the filter takes most of the flagged faces off the
BROKEN models too — 69 of `road_lawn34`'s 75 were not up-facing — which says most of what the earlier
criteria were counting on the reported models was their kerbs and skirts as well.

Population after the filter: 959 models ≥1 % of surface, 314 ≥5 %, 144 ≥10 %, 54 ≥20 %, 4 ≥50 %. **These
numbers are not to be quoted as a defect count** — the criterion producing them is inverted on its only
labels.

### Where this stops, and why

Four formulations — raw magnitude, edge-neighbour disagreement, model baseline, up-facing — and the ranking
is still backwards on the one labelled pair. Each was a reasonable idea and each failed differently, which is
the pattern this repo already has a name for: several wrong axes in a row means **stop guessing and let the
field answer.**

What the next step needs is LABELS, not another metric. Concretely: the remaining spots in the table above,
each answered CLEAN or BROKEN, so a criterion can be fitted to them rather than invented. Two questions the
labels have to settle, which no amount of offline measurement can:

1. **What is the visible smear actually ON?** If most of `road_lawn34`'s flagged faces are kerbs and skirts,
   the faces the user photographs may be BELOW the 8× threshold entirely — in which case the threshold, not
   the shape test, is what is wrong.
2. **Is "vertical" really exempt?** The skirt is invisible, but a kerb face is not. `--up 0.5` currently
   throws both away.

### THREE MORE LABELS, and they close the question the wrong way — 2026-08-11

`backalleys1_sfe` (41.2 %) and `garse_85_sfe` (40.4 %): both **CLEAN**, both the same thing as `road03sfn`.
User: *"the same situation — the neighbouring buildings STAND on these skirts, they are not visible."*

So all three labels the field has produced are by-design hidden geometry, and every high-ranking model is one
of two families: a ribbon (wire/neon/fence) or a skirt. Meanwhile the four models the field actually reported
sit near the bottom of every ranking.

**A per-face anisotropy profile of the VISIBLE surface says why, and it kills the model-local approach.**
Up-facing faces only, area-weighted:

| model | field label | 1–1.5× | 1.5–3× | 8–16× | 16×+ / collapsed |
|---|---|---|---|---|---|
| `road_lawn34` | BROKEN | 65.3 % | 26.4 % | **6.4 %** | 1.1 % |
| `road_lawn08` | BROKEN | 46.2 % | 51.0 % | 1.0 % | 0 % |
| `sbseabed3_las20` | BROKEN | 43.1 % | 49.7 % | 0 % | 7.1 % |
| `road03sfn` | **CLEAN** | 24.8 % | 53.5 % | 0 % | **21.3 %** |
| `backalleys1_sfe` | **CLEAN** | — | — | 0 % | **44.4 %** |
| `garse_85_sfe` | **CLEAN** | — | — | 0 % | **40.4 %** |

`road03sfn` carries **42 up-facing collapsed faces over 21 % of its visible area and looks fine**, while
`road_lawn34` is called broken on 7.5 %. Signed vs absolute `nz` changes nothing — those faces genuinely
point up. What makes them invisible is that **another placement stands on them**.

**That is the finding, and it is about the method rather than the data: visibility is a property of the
WORLD, not of the model, so no model-local metric can separate this class.** Five formulations failed for
one reason, and it was never the formula.

### What the next attempt has to be

A world-context pass, not a metric tweak. map-optimizer already has the machinery to hang it on — plan 019's
`buildPrelitContext` is a world pre-pass over every placement, and `seam-weld` already reasons about what a
model's neighbours are at shared borders. The criterion becomes: a stretched face is a DEFECT only if it is
exposed in the assembled world — nothing resting on it, nothing covering it.

### BUILT 2026-08-11 on branch `025-world-visibility`

Both halves, judged in WORLD space through each instance's own position AND rotation quaternion:

- **Water** — `scripts/lib/water.ts` over the built tree's `data/water.dat`; a face whose EVERY corner sits
  `--water-depth` under the sea is dropped. `sbseabed3_las20` leaves the ranking on it.
  Two traps it cost: **`water.dat` stores a quad's corners in GRID order, not around its perimeter**, so a
  perimeter point-in-polygon test traces a bowtie and hits nothing — 311 polygons loaded and `heightAt`
  answered null over the whole map, silently. The triangulation is the engine's own now (`flatWaterMesh`:
  `0,1,2` + `2,1,3`), and the same OCEAN FRAME is added, or a face past the authored bbox reads as dry while
  the game draws sea over it.
- **Cover** — `adapters/gta-sa/world-cover.ts`, beside the world pre-pass as the user directed; every
  placement reduced to its world AABB, and a face whose centroid another model rests over is dropped.

`--reach` was then MEASURED rather than guessed. Dumping the 30 faces `road03sfn` still carried at `reach 2`
showed every one of them covered at **5–10 units**, not 2 — the deck over that skirt clears it by more than a
metre. Default set to **5**: the smallest value that satisfies the labels, because hiding something visible is
the expensive mistake.

| | before the gates | reach 2 | **reach 5** | reach 10 |
|---|---|---|---|---|
| models ≥ 1 % of surface | 954 | 163 | **151** | 137 |
| models ≥ 10 % | 141 | 16 | **12** | 12 |
| any flagged face | 2 544 | 735 | **667** | 627 |
| `road03sfn` (CLEAN) | 16.1 % | 10.1 % | **1.5 %** | gone |
| `road_lawn34` (BROKEN) | 3.7 % | 3.0 % | **2.0 %** | 2.0 % |

**The inverted pair is resolved**: at reach 5 no CLEAN model outranks a BROKEN one, and `backalleys1_sfe`,
`garse_85_sfe`, `sbseabed3_las20` are out of the ranking entirely. The population is a sixth of what it was
and is now a set a person can label through.

### The label set corrected, and the recorded "cost" was never real

User, same day: *"I re-checked — my mistake, the picker grabbed the wrong object. Not `road_lawn08`, it is
fine. It is `road_lawn17` (txd `roads_lawn`, 1149.7, −1040.0, 31.0)."*

So the false negative this plan recorded against the gates was a **mislabelled control**, not a gate failure —
`road_lawn08` dropping out is the CORRECT answer, and the real broken model was never in the set. Worth
keeping as a method note: a wrong label makes a right instrument look broken, and it is the kind of error that
survives every amount of re-measurement because the measurement is not where it lives.

Where the seven labels stand at `reach 5`:

| model | label | rank |
|---|---|---|
| `road_lawn17` | BROKEN | **3.2 %** — highest of the three |
| `road_lawn34` | BROKEN | 2.0 % |
| `road03sfn` | CLEAN | 1.5 % |
| `road_lawn32` | BROKEN | 0.5 % |
| `road_lawn08` | CLEAN | not ranked ✓ |
| `backalleys1_sfe` | CLEAN | not ranked ✓ |
| `garse_85_sfe` | CLEAN | not ranked ✓ |

**Six of seven are consistent**, and the newly-named broken model tops the three. The one blemish left is
`road03sfn` at 1.5 % sitting above `road_lawn32` at 0.5 % — a single-face margin on both sides, which is the
weakest kind of disagreement and the first thing more labels would settle.

### The whole top tier — 12 models at ≥ 10 % of surface, awaiting labels

| model | share | flagged / total | ×inst | position | note |
|---|---|---|---|---|---|
| `wires_04d_sfs` | 43.0 % | 464 / 1 079 u² | 1 | −2679.9, −183.0, 12.0 | SF power lines |
| `wires_04c_sfs` | 42.0 % | 742 / 1 766 u² | 1 | −2775.9, −206.8, 17.1 | biggest of the wire set |
| `wires_07_sfs` | 32.1 % | 194 / 606 u² | 1 | −2717.5, 111.9, 14.0 | |
| `airport_front` | 28.2 % | 10 088 / 35 800 u² | 1 | −1860.2, −24.1, 1076.7 | INTERIOR |
| `wires_04_sfs` | 27.4 % | 386 / 1 410 u² | 1 | −2676.4, −105.1, 11.6 | |
| `airport_int2` | 26.7 % | 1 253 / 4 696 u² | 1 | −1861.4, 7.7, 1073.1 | INTERIOR |
| `airtwer_las` | 15.0 % | 1 942 / 12 955 u² | 1 | 1610.8, −2285.8, 52.8 | **informative unknown** |
| `wires_05_sfs` | 14.2 % | 442 / 3 120 u² | 1 | −2758.7, 8.5, 15.9 | |
| `wires_04b_sfs` | 12.2 % | 147 / 1 203 u² | 1 | −2777.8, −96.0, 16.7 | |
| `nwwarhus` | 12.0 % | 481 / 4 021 u² | 4 | 2415.5, −2468.6, 16.7 | **informative unknown** |
| `gdyn_barrier17` | 10.8 % | **2 / 16 u²** | 26 | 1393.8, 927.1, 10.7 | see the area note |
| `traincross1` | 10.2 % | **1 / 8 u²** | 41 | 2204.3, −1650.3, 16.8 | see the area note |

**Half the tier is one family.** Six of the twelve are the SF power-line set — the ribbon family the cover
gate cannot touch by construction, because nothing stands on a wire. If they label CLEAN, that is the next
thing to solve and it is not an occlusion problem.

**A ranking flaw the tier exposes**: `gdyn_barrier17` and `traincross1` reach the top on a share of **16 u²
and 8 u² of total surface** — 2 u² and 1 u² flagged. Share alone is meaningless at that size, and a minimum
flagged AREA would drop both. Recorded rather than silently applied: it is a change to the ranking and it
should land with a label behind it, not a hunch.

So the labels worth the user's time are `airtwer_las` and `nwwarhus` (real area, genuinely unknown), plus one
wire as the family's representative — `wires_04c_sfs`, the biggest.

### `airtwer_las` labelled CLEAN — and it points off the geometric axis entirely

User: *"visually I see no problems. Maybe something small."* A false positive at 15 % / 1 942 u², which is the
largest one left.

Dumping its 77 surviving faces: they are a **roof strip** — x 1592–1601, y −2275…−2298, world z median
**37.6** (min 28.8, max 85.9), every one of them up-facing, uncovered, UV collapsed outright, and 55–76 u²
each. Not small, and not hidden by anything this branch can query. A person walking the airport simply never
looks at them.

**Two readings, and they are not the same problem:**

1. *Out of reach* — a third kind of hiding after water and cover: high enough that no ordinary viewpoint gets
   close. Tempting, but it is a guess of the same shape as the five that already failed, and it is wrong on
   its face for a game where you fly.
2. **What the TEXTURE holds** — a collapsed UV smears *one texel row across the face*. If that row is
   uniform, there is nothing to see however collapsed the mapping is. **This plan already priced exactly this
   risk** ("some degenerate UVs may be deliberate — a face collapsed onto a single texel row to read as a
   flat colour strip"), and it explains a plain roof panel precisely.

Reading 2 is the stronger one and it is measurable offline: sample the texture along the face's own collapsed
axis and take its variance. A flat-colour row is not a defect at any anisotropy. **That is a different axis
from every criterion tried so far — none of them looked at the texture at all** — which is also the reason to
run it before inventing a sixth geometric test.

Label tally so far: BROKEN `road_lawn17`, `road_lawn34`, `road_lawn32`; CLEAN `road_lawn08`, `road03sfn`,
`backalleys1_sfe`, `garse_85_sfe`, `airtwer_las`.

### MEASURED — the texture separates the labels where five geometric criteria could not

Two more labels closed the pattern: **`nwwarhus` is a roof** and **`wires_04c_sfs` is wires**, so the entire
≥10 % tier is by-design (wires ×6, roofs ×2, interiors ×2, two sub-20 u² models) while every model the field
calls broken sits at **0.5–3.2 %**. The ranking's top and the defect population do not overlap at all.

So the texture was sampled directly: for each flagged face, walk the LINE its UVs span (the smeared texel
row), 64 samples, and take the luma standard deviation.

| model | label | what it is | luma spread p50 |
|---|---|---|---|
| `road_lawn32` | **BROKEN** | road | **25.7** |
| `road_lawn17` | **BROKEN** | road | **23.2** |
| `road_lawn34` | **BROKEN** | road | **23.2** |
| `road03sfn` | clean | road skirt | 9.8 |
| `nwwarhus` | clean | roof | 5.3 |
| `airtwer_las` | clean | roof | 3.3 (p90 46.0) |
| `wires_04c_sfs` | clean | wires | **0.0** (p90 0.0) |

**The three broken models cluster at 23–26 and every clean one sits at 0–10.** A gap that wide, on eight
independent field labels, is the first clean separation this investigation has produced — and it comes from
the axis none of the five geometric criteria ever looked at.

`wires_04c_sfs` reading exactly **0.0 at p90** is the by-design case proven rather than argued: a wire's
collapsed UV samples a constant colour, so there is nothing to smear however extreme the mapping.
`airtwer_las`'s p90 of 46 says a minority of its roof faces DO carry varying texture — plausibly the
"maybe something small" the user allowed for.

### WIRED IN, lazily — and the full scan

`scripts/lib/texture-probe.ts` (5 unit tests) + the gate in the scanner, `--texvar`, default **15** from the
evidence above and marked provisional. **Lazy by construction**: a TXD is decoded only for a model that
already has a geometrically-flagged face, so the cost lands on a few hundred models rather than 7 148 — the
whole scan still runs in **12 s**. A face whose texture cannot be resolved is KEPT, never silently dropped:
no verdict without evidence, the same rule the cover gate follows.

**The eight labels, after all three gates:**

| model | label | before any gate | after visibility | **after texture** |
|---|---|---|---|---|
| `road_lawn17` | **BROKEN** | — | 3.2 % | **3.2 %** ✓ top of the three |
| `road_lawn34` | **BROKEN** | 3.7 % | 2.0 % | **2.0 %** ✓ |
| `road_lawn32` | **BROKEN** | — | 0.5 % | **0.5 %** ✓ |
| `road03sfn` | clean | 16.1 % | 1.5 % | **gone** ✓ |
| `airtwer_las` | clean | 15.0 % | 15.0 % | **0.5 %** ✓ (77 → 32 faces) |
| `wires_04c_sfs` | clean | 42.0 % | 42.0 % | **gone** ✓ (134 → 0) |
| `road_lawn08` | clean | — | gone | gone ✓ |
| `backalleys1_sfe` / `garse_85_sfe` | clean | 41–43 % | gone | gone ✓ |
| `nwwarhus` | clean | 12.0 % | 12.0 % | **11.6 %** ✗ (18 → 4 faces) |

**Seven of eight at first** — the one failure was `nwwarhus`, and chasing its four surviving faces closed it.

**They carry an EMPTY texture name.** Their material references no texture at all, only a colour. A face with
no texture cannot smear one, so it is decidable — and the gate was keeping it under the "no verdict without
evidence" rule, which is right for a texture that is NAMED but unresolvable and wrong for a material that
names none. The two cases are now distinct: **untextured ⇒ dropped, unresolvable ⇒ kept**.

That single distinction removed `nwwarhus` (confirmed CLEAN by the user on a second, longer look: *"turned it
around, looks good"*) and both `airport_*` interiors, which were the same thing.

**Every label now agrees.**

| model | label | outcome |
|---|---|---|
| `road_lawn17` | BROKEN | **3.2 %**, top of the three |
| `road_lawn34` | BROKEN | **2.0 %** |
| `road_lawn32` | BROKEN | **0.5 %** |
| `road03sfn`, `road_lawn08`, `backalleys1_sfe`, `garse_85_sfe`, `wires_04c_sfs`, `nwwarhus` | clean | **all out of the ranking** |
| `airtwer_las` | clean | 0.5 % — 15 % → 0.5 %, down at the floor beside the weakest broken model |

**Population, all three gates:**

| | no gates | visibility | + texture | **+ untextured** |
|---|---|---|---|---|
| models ≥ 1 % of surface | 954 | 151 | 41 | **34** |
| models ≥ 5 % | 310 | ~45 | 7 | **3** |
| any flagged face | 2 544 | 667 | 329 | **317 / 810 placements** |

From 2 544 models to **317**, in a 12-second scan, and the top of the ranking is no longer a by-design family
— every wire, roof, skirt and interior has left it.

### The minimum-area flaw, fixed — and the threshold is derived, not picked

`--min-area`, default **10 u²** of flagged surface per INSTANCE. The number comes off the labels rather than
taste: the three field-confirmed broken models carry **28 u²** (`road_lawn32`), **53 u²** (`road_lawn17`) and
**72 u²** (`road_lawn34`), while `traincross1` reached 10.2 % on a model whose ENTIRE surface is **8 u²** —
0.8 u² flagged, three orders of magnitude under the smallest real defect. 10 sits comfortably below every
label and far above the noise.

**Per instance, never multiplied by the placement count**: 41 copies of a 0.8 u² patch are 41 invisible
patches, not one visible 33 u² one.

| | + texture | **+ min-area** |
|---|---|---|
| models ≥ 1 % of surface | 34 | **31** |
| models ≥ 5 % | 3 | **2** |
| any flagged face | 317 models / 810 placements | **127 / 134** |

The placement count is what moved most — 810 → 134 — because the tiny-but-numerous models were exactly the
ones inflating it. All four labelled rows survive unchanged (`road_lawn17` 3.2 %, `road_lawn34` 2.0 %,
`road_lawn32` 0.5 %, `airtwer_las` 0.5 %).

**Still owed before any of this becomes a repair pass**: the 15 texture threshold rests on nine labels and no
more; `airtwer_las` is demoted rather than separated (0.5 %, level with a broken model); and the models now
at the top — `las_runsignsx_las`, the `cs_landbit_*` set, `smallshop_16_sfs` — have not been looked at by
anyone.

Cost and risk still to price for the eventual PASS (this is the scanner, not the pass): the occlusion query is
per candidate face over the placed world,
which is a different order of work from the scans above, and its own failure modes (an interior, a model
placed once vs 1 374 times, a face covered in one instance and open in another — `rdwarhus` is placed 13×).
**Do not start it on the strength of six labels.** The cheap thing that must come first is more labels on the
LOW end of the ranking, where the reported models actually live, because everything measured so far says the
ranking's top is a different subject entirely.

## Phase 1b — if a criterion ever separates it: find every model it happened to

Extend `scripts/debug/scan-model-defects.ts` with the Phase 0 metric as criterion **(e)**, area-weighted and
top-N with instance positions, the shape 024's criteria were rewritten into after an un-weighted metric was
field-falsified once already. Fix the pass, add the real-asset fixture (one manifest line in
`scripts/test-fixtures.ts`), re-run the tool-kit + LOD-generator consumer sweep — `tool-kit/mesh` is shared.

## Phase 2 — NEXT: test H-B1 (created normals) on the model the field named

Phase 0 settled that the UVs did not move, so this phase now owns the case. One variable at a time on
`road_lawn34`, each arm sharing a viewpoint (a spawned player SLIDES on a slope, and three arms once returned
the same diff because the diff was measuring the camera):

1. **normals not created** — `model-repack.ts` already runs the chain per model with per-pass options; the arm
   is `addWhereAbsent: false` on the target model only. If the smear goes, H-B1 is confirmed on the data side
   without touching the rest of the map. **This is the cheapest arm and the one the evidence points at.**
2. **prelit off** (`debugPrelitScale = 0`, already in `apps/viewer`) — if the smear survives, every
   vertex-colour mechanism including `bake-vertex-ao` is dead.
3. **`--no-textures`** — the mip chain suppressed, geometry untouched. Data-side, so it is testable on BOTH
   targets, which is what makes it worth more than any engine toggle here.

A zero from any arm counts only if the loop is first shown to REPRODUCE the smear with everything on.

**The `sa` arm matters more than the `opensa` one here**, because the report's whole weight is that the class
survives into the real game's renderer — and that is the half no engine change of ours can reach.

## Phase 3 — decide where the fix lives, once a phase has named it

- **Tool bug** ⇒ fixed here, with the fixture and the sweep.
- **Authored data** ⇒ **"that is what the original does" is the beginning of an argument, never the end**
  (`docs/project-goals.md`). The user's own framing, 2026-08-11: *"maybe it is not transformed at all, maybe
  it is just a bug of the game that we have to fix."* `road_lawn34` ships in NO mod — it is stock R\* geometry,
  confirmed by the resolver — so nobody's authored intent is being overridden by repairing it; a texel drawn
  284× longer than it is wide is a 2004 authoring slip, not a design.
  The repair must still DERIVE from the asset: faces whose own `σmax/σmin` exceeds a threshold read off the
  map-wide distribution, never a per-model list. It changes geometry a mod may also ship, so it lands with the
  `docs/contracts/` + `docs/hacks/` treatment and a field verdict, and the threshold is picked from data.
  Open question the threshold has to answer: a road legitimately carries 2–4× anisotropy (density along the
  road differs from across it), and 22–38 % of these models' area sits above 2× — so the cut is nowhere near
  the obvious place.
- **Engine filtering** ⇒ moved out of this plan entirely, to
  [`roadmap/0.6.0/06-anisotropic-filtering`](../../../../docs/roadmap/0.6.0/plans/06-anisotropic-filtering/readme.md).
  Not a substitute for whatever this plan finds: it sharpens what the mapping still carries and cannot undo a
  stretch that is authored into the UVs.
- Whichever way it goes, `--textures` is NOT the thing to switch off: it exists because single-level DXT
  shimmers at distance and WebGL cannot generate those mips at runtime.

## Phase 4 — field AFTER round and the record

Re-shoot the four spots, before/after per spot, into this plan, on BOTH targets since both show the class.
Anything perf-visible into `docs/benchmarks/` naming the pak build the run read. If the outcome is "the
original does this too", that goes to `docs/edge-cases/` with the measurement and a one-line rule in
`docs/restrictions/`.

## Non-goals

- Re-opening plan 024's families A (authored normals shading dark) and B (prelit black holes) — diagnosed,
  and B's fix is already an engine plan (`docs/plans/093-world-ambient-term/`).
- `lae2_roads03` / the `lae2_roads*` curb fan — withdrawn by the user, see above.
- Turning the mip pass off as a "fix". It would trade a blur for the shimmer it was built to remove.
- Reshaping authored UVs by default. A mod author's data has to keep working.
