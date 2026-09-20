# 003 — Visibility-first LOD simplification (modifiers)

**Status: Phases 0–5 ✅ implemented (measured below).** Add the first real `LodModifier`s
to the shared core (plan 002): **remove what cannot be seen before deforming what can**. Three feature tracks — (1) screen-size + degenerate/alpha culls, (2) sampled
visibility culling ("does any reachable camera ever see this face?"), (3) coplanar remesh — all implemented once in
`lod-common`, inherited by both `opensa-lod-generator` (cell bake) and `sa-lod-generator` (per-object clone). The
generators only differ in how they _bake_; the simplification rules are identical.

## Motivation

- Both tools ship **verbatim HD** geometry today (plan 002). The LOD win is draw-calls + texture size only; the
  triangle count of a far cell equals the HD cell.
- The previous attempt (QEM at a 20% budget, see the decimation memory) failed for a structural reason: QEM
  minimises **geometric** error, but far-LOD quality is governed by **visibility and screen-space** error. It
  deleted visible surfaces (flat = zero quadric error → holes) while keeping invisible ones (buried/interior faces
  are not "cheap" to QEM). This plan inverts the order: cull invisible geometry first — culls **cannot create
  holes** (removed faces were never seen) — and only then reduce visible geometry with a method whose safety is
  provable (boundary-exact remesh), leaving budget-driven decimation as a last resort.

## Decisions

1. **One home:** every simplification step is a `LodModifier` (or a shared pre-merge predicate) in `lod-common`.
   Generators wire config + context, never geometry logic.
2. **Modifiers get context.** `LodModifier` becomes `(mesh, ctx) => mesh`. `LodContext` carries what the mesh alone
   cannot: the **view model** (min/max LOD view distance, camera FOV, viewport height, reachable camera height
   range → `unitsPerPixel(d)`, `pixelsSubtended(radius, d)`), the **placements** of this mesh in the world (opensa
   cell: one, already world-space; sa model: every IPL instance transform), optional **occluders** (extra read-only
   geometry, e.g. neighbour cells), optional **texture stats** provider (per-texture opaque-coverage for the alpha
   cull). Context is built by each adapter; all fields beyond `view` are optional so modifiers degrade gracefully.
3. **Order of the chain is fixed:** `dropDegenerateFaces → dropTransparentGroups → visibilityCull → coplanarRemesh`
   (future decimation, if ever needed, goes last). Each modifier is independently toggleable via config.
4. **Deterministic everything.** No RNG: camera positions, per-face sample patterns and thresholds are pure
   functions of the input — required for tests and reproducible builds.
5. **sa-lod-generator is gated.** Any modifier disables the verbatim fast-path and routes through the mesh path,
   which today loses 2dfx/multi-UV/material properties (plan 002 "out of scope"). Tracks 1–3 land + ship in
   **opensa first** (its mesh path is already the shipping path); sa enables them only after Phase 5 closes the
   mesh-path fidelity gap. The shared code is identical — sa is a config flip once Phase 5 lands.

## Design

### Track 1 — cheap deterministic culls (Phase 1)

- **Screen-size instance cull (pre-merge, opensa; resolve-stage, sa).** Not a mesh modifier — a shared predicate
  `subtendsAtLeast(radiusWorld, minPixels, view)`. An object whose bounding radius covers `< minPixels` (default
  ~2 px) at the **closest** distance the LOD can be seen from is dropped whole: fences, poles, bins, signs, wires.
  A sub-pixel hole is invisible by definition — zero risk. opensa: filter `cell.instances` before `mergeCell`
  (radius from the model's bsphere × instance scale); minDistance = the engine's HD ring (the distance at which a
  cell first renders as LOD). sa: skip cloning LODs of models below threshold (stock LOD stays — no regression),
  report `excludedTiny`; minDistance = the HD instance's IDE draw distance (where HD unloads and the LOD appears).
- **Degenerate-face cull (modifier).** Drop faces with ~zero area (collinear/duplicate verts). **Deliberately NOT
  an "area < N pixels" cull:** dense tessellation of a large surface is made of small triangles that _tile_ —
  deleting them individually punches pinholes. Small-but-tiling reduction belongs to the remesh (Track 3), which
  merges them safely. This modifier only removes faces that render nothing at any distance.
- **Transparent-group cull (modifier, needs `ctx.textures`).** Drop per-texture groups whose texture's opaque
  coverage is below a strict threshold (default conservative, e.g. < 15% opaque texels — chain-link, grates,
  wires): at LOD distances they resolve to sub-pixel noise. Threshold configurable per generator; groups without
  texture stats are kept. Coplanar decal-layer detection (z-fighting layers) is explicitly **deferred** — it needs
  the plane clustering from Track 3 and can be added there as a follow-up.

### Track 2 — sampled visibility cull (Phase 2)

The generalised "faces looking into the ground" idea. A face survives iff **some reachable camera sees some sample
of it**; per-winding results also replace blanket double-siding.

- **Raycast core:** a generic triangle BVH in `tool-kit/mesh` (build once per mesh + occluders; deterministic).
- **Camera model (in `view`):** a ring of viewpoints at distances `[minDistance, maxDistance]` × azimuth steps
  (e.g. 16) × heights spanning the reachable range (ground level … max terrain/flight height, e.g. 0–500), plus
  straight-down views. All positions are derived, not sampled randomly.
- **Face sampling:** centroid + extra samples proportional to face area (low-discrepancy barycentric pattern,
  deterministic) so a partially visible large face isn't killed by an occluded centroid.
- **Sidedness:** record _which winding_ each hit saw. Faces seen from one side only are emitted single-sided —
  `encode-dff`'s `doubleSided` upgrades from blanket index-doubling to a per-face mask (~halves the doubled
  indices for free). Faces seen from neither side are dropped.
- **Occluders:** the mesh itself always (buries foundations, interiors, faces under terrain). `ctx.occluders`
  optionally adds neighbours (opensa: the 8 adjacent cells) — first iteration ships **self-only** (conservative:
  removes less, never removes wrongly). This is also why the pure "normal points down → delete" heuristic is not
  used alone: bridge/overpass undersides ARE seen from below at distance; the ground-level ring cameras keep them
  while genuinely ground-facing faces near terrain get no unoccluded ray.
- **sa specifics:** the mesh is model-local and one LOD DFF is shared by every placement — `ctx.placements` carries
  all instance transforms; a face is dropped only if invisible in **all** placements (transform cameras into model
  space per placement). Optional half-space occluder ("ground plane at instance z") approximates terrain burial.
- **Safety margin:** optional one-ring dilation (keep faces adjacent to a visible face) against sampling misses;
  on by default until the harness proves it unnecessary.

### Track 3 — coplanar remesh (Phase 3)

Structural reduction for architectural geometry — where QEM broke, this is provably safe.

- **Cluster:** region-grow faces sharing a group/texture whose normals agree within `εn` and whose planes coincide
  within `εd`. Roads, roofs, walls, flat terrain tiling.
- **Retriangulate:** extract the cluster's boundary polygon(s) (holes included), ear-clip to a minimal fan.
  **Boundary vertices are kept byte-exact** — silhouette and texture seams cannot move, so no holes and no cracks
  by construction (this is the invariant unit tests assert).
- **Attributes:** interior UV/prelit/night are re-derived by fitting an affine map over the plane from boundary
  values (planar SA mapping is affine in practice); clusters where the affine residual exceeds tolerance are left
  **untouched** (per-cluster fallback = original triangles). Night colours ride the same fit.
- Wins compound with Track 2: visibility deletes buried triangles first, remesh then merges the surviving flats.

## Phases

- **Phase 0 — foundations. ✅** `LodContext` (`textures?`/`view?`) + new `LodModifier(mesh, ctx)` signature
  (`applyModifiers`/`hdToLod` thread ctx); `view.ts` (`LodView`, `unitsPerPixel`, `pixelsSubtended`,
  `subtendsAtLeast`; engine FOV 60 / 1080 px defaults); `bounds.ts` (`clumpBoundingRadius`, frame-aware);
  `compact.ts` (orphan-vertex compaction after face drops). opensa ctx: `lodView(hdDrawDistance 300)` — the
  engine HD ring from `apps/web` `canvas-host`; sa: per-link `hdDrawDistance` from the HD's IDE def (`ModelRef`
  in `game-build/partition` now carries `drawDistance`).
- **Phase 1 — Track 1. ✅** `dropDegenerateFaces` + `createDropTransparentGroups(minOpaqueCoverage)` wired into
  opensa's chain (`lod.config.ts`: `minLodPixels 2`, `minOpaqueCoverage 0.15`); screen-size instance cull in
  opensa `resolveCells` (`cull.ts`, logged) and sa `resolvePairs` (`excludedTiny`, sub-pixel HD at its draw
  distance → clone skipped, stock kept). Synthetic-fixture tests throughout (negative-first).
- **Phase 2 — Track 2. ✅** `tool-kit/mesh/bvh` (deterministic median-split BVH, any-hit segment query);
  `lod-common/visibility-cull` (`createVisibilityCull`: camera ring 16 azimuths × heights [2, 60, 250, 500] above
  the mesh's lowest vertex + top-down, at `view.minDistance`; centroid + area-proportional samples; per-side
  verdicts; one-ring dilation default on); per-face sidedness via `MergedGroup.twoSided` masks (carried through
  compact/normals/splitMesh; `encode-dff` doubles ONLY masked faces when masks are present). Wired into opensa
  behind `cullHiddenFaces: true`. Also: the engine grid was aligned to the generator — `apps/web` `CELL_SIZE`
  250 → **256** (plan 002 "Engine fit" was silently violated). Fixtures: buried cube in a closed box, down-wound
  lone plate reoriented upward, bridge deck two-sided over ground, dilation keeps an edge-sharing hidden face.
  Shared-model multi-placement visibility (sa) is deferred to Phase 5 with the rest of sa enablement.
- **Phase 3 — Track 3. ✅** `lod-common/coplanar-remesh` (`createCoplanarRemesh`): edge-adjacency clustering per
  group (seed plane + uniform `twoSided` flag), single-loop boundary extraction (holes/non-manifold → fallback,
  v1 scope), ear-clip re-triangulation with **byte-exact boundary**, affine UV/prelit/night validation with
  per-cluster fallback. Wired into opensa behind `mergeCoplanar: true`. Fixtures: dense flat grid → boundary-only
  fan (area preserved, interior verts compacted); grids with a hole / non-affine UV / non-affine prelit / a bent
  vertex → untouched; masked grid → clusters split per flag. **Measured outcome: ~0.2 % — see the Phase-3
  measurement note; SA's hand-modelled geometry simply has almost no dense flat tessellation to collapse.**
- **Phase 4 — measurement harness + opensa rollout. ✅** Implemented as a deterministic **CPU raster** harness
  (no browser/GL — fits the unit-test lane): `lod-common/preview` (z-buffered software rasterizer for
  `MergedMesh`, per-vertex prelit × per-texture mean colour, Bayer screendoor for alpha coverage, `cull:
'none'` = vanilla-SA HD reference vs `cull: 'back'` on the encoder-expanded LOD) + `previewDiff` (colour +
  coverage mismatch fraction), and `opensa-lod-generator/src/harness.ts` (CLI `--game/--cells`; dense/median/
  sparse cell spread; cameras deliberately offset from the cull's own ring — half-step azimuths, heights
  [10, 100, 350], distances [1×, 2×] minDistance). **Tuning outcome:** `minOpaqueCoverage` default 0.15 → 0.05
  (0.15 deleted whole visible objects — 8.6 % mean diff; 0.05 is visually free at 0.07 %); `dilate` stays ON
  (off adds +0.14 pp mean for negligible triangle win). See the Phase-4 measurement section.
- **Phase 5 — sa enablement. ✅** The audit first (as planned): of 4,277 cloned HD models — **multi-UV 0, real
  MatFX 0** (an earlier byte-scan's 822 was pure false positives), tinted materials 177, 2dfx lights 63 models /
  448 coronas. So the fidelity gap closed with just two carries: **per-group material colour**
  (`MergedGroup.color`, bucketed by texture+tint, threaded through every modifier, written back by the encoder,
  honoured by the harness preview) and **raw 2dfx transplantation** (rw-codec `extract2dfxEntries` /
  `build2dfxSection`: whole entries as byte blobs, only the 12 position bytes rewritten — unparsed fields
  survive; `collectClumpEffects` applies the geometry frames). sa clones now route through `createBudgetedDecimate`
  (`decimateBudget: 0.01`): within budget → re-encoded mesh (night prelit + tint + transplanted coronas, particles
  stripped); over budget → **verbatim byte-copy** (keeps even the breakable plugin, zero risk). Roadsign 2dfx text
  is dropped on decimated clones (sub-pixel at LOD range). Bonus: **opensa cells now bake coronas** — light
  entries gathered per instance with the merge's own transform, and the engine's build-cell corona gate opened to
  LOD cells → the distant city glows at night, which even stock SA's far view never did.

## Measurements

Record the before/after numbers here after **every** phase, measured on `game-src/original` (the canonical
unmodified SA copy). Method: resolve the full exterior grid, merge every cell twice (raw vs post-cull) and run
each modifier in sequence, counting triangles/vertices — no build emitted.

### After Phase 1 (2026-07-02, defaults: minLodPixels 2 @ hdDrawDistance 300, minOpaqueCoverage 0.15)

**opensa-lod-generator** (563 cells):

| stage                   | instances | triangles | Δ vs raw | vertices   |
| ----------------------- | --------- | --------- | -------- | ---------- |
| raw merge (before)      | 34,443    | 7,719,514 | —        | 11,277,716 |
| screen-size cull        | 34,339    | 7,693,610 | −0.34 %  | 11,266,856 |
| + dropDegenerateFaces   | 34,339    | 7,617,643 | −1.32 %  | 11,160,911 |
| + dropTransparentGroups | 34,339    | 7,486,064 | −3.02 %  | 10,924,368 |

Reading: the honest 2 px threshold at 300 u (≈ 0.64 u diameter) barely bites — only 104 instances / 4 models on
the whole map (SA's exterior placements are mostly building-scale; street clutter that would qualify is largely
dynamic, not in the IPL layer we bake). Degenerates + mostly-transparent groups are the real Phase-1 win
(−2.7 %). Total −3.0 % triangles / −3.1 % vertices — the safe-cleanup floor; the meaningful reduction is
expected from Phase 2 (visibility) and Phase 3 (remesh). A `minLodPixels` raise (4–8 px) is a Phase-4 harness
tuning question, not a default change.

**sa-lod-generator**: links 5,342 HD instances / 4,271 LOD models; `excludedTiny` = **0** at the default 2 px —
every stock-LOD'd HD subtends more than 2 px at its draw distance (Rockstar only authored LODs for big objects),
so the skip changes nothing on the stock map. Wiring verified by raising the threshold to 200 px →
`excludedTiny` = 140. The predicate will matter for modded maps and for Phase-2/3 modifiers.

### After Phase 2 (2026-07-02, visibility cull defaults: 65 cameras, dilate on; full run 735 s / 563 cells)

**opensa-lod-generator** (post-instance-cull raw = 7,693,610 tris / 11,266,856 verts):

| stage                          | triangles  | Δ vs raw    | notes                                   |
| ------------------------------ | ---------- | ----------- | --------------------------------------- |
| after Phase-1 chain            | 7,486,064  | −2.70 %     |                                         |
| + visibility cull              | 7,100,004  | −7.72 %     | verts 10,360,382 (−8.0 %)               |
| **encoded indices** blanket 2× | 46,161,660 | —           | the old cost: every face double-sided   |
| **encoded indices** masked     | 30,076,755 | **−34.8 %** | 2,925,581 / 7.1 M faces truly two-sided |

Reading: face-level culling removes a further ~5 % (SA exteriors carry fewer fully-buried faces than city
intuition suggests, and one-ring dilation deliberately keeps the borderline ones). The headline win is
**sidedness**: 59 % of kept faces are seen from one side only, so the encoded/rendered index volume drops by a
third vs the blanket double-sided DFF — that is GPU-facing geometry, not just file size. Tuning candidates for
the Phase-4 harness: `dilate` off (measure the visual cost), fewer/more camera heights, neighbour-cell occluders
(would cull cell-boundary walls currently "seen" through the void where the neighbour building stands).

### After Phase 3 (2026-07-02, full chain incl. coplanar remesh; run 750 s / 563 cells)

| stage                    | triangles | Δ vs raw | notes                                                     |
| ------------------------ | --------- | -------- | --------------------------------------------------------- |
| after visibility (Ph. 2) | 7,100,004 | −7.72 %  | encoded indices 30,076,755                                |
| + coplanar remesh        | 7,087,853 | −7.87 %  | verts 10,354,310; indices 30,026,607 (65.05 % of blanket) |

**Finding: the remesh premise mostly doesn't hold on stock SA.** A tolerance sweep (no visibility masks, colour
residual up to 255, UV residual 1, plane distance 0.05) still only reaches **−0.6 %** — the binding constraint is
not the affine checks but the source geometry itself: Rockstar's 2004 hand-modelled meshes are already
near-minimally triangulated (a flat road piece is already 2 triangles; there is no lightmap-style dense flat
tessellation to collapse). The modifier stays on (it is provably safe and free), but further polycount reduction
on stock SA would need cross-model welding + plane merging (UV-atlas territory) or actual decimation — i.e. the
explicitly out-of-scope tail. The remesh will matter more on modded maps with dense exported geometry. Diagnostic
variants (post-degenerate base 7,617,643): default 99.81 %, looseColor(24) 99.69 %, loosePlane(0.05/2e-3)
99.81 %, looseBoth 99.68 %, looseAll 99.41 %.

### After Phase 4 (2026-07-02, harness: 12 cells dense/median/sparse × 49 offset views, 240×180)

Per-modifier pixel diff vs the two-sided HD reference (isolation sweep):

| stage                        | mean diff | max diff | verdict                                      |
| ---------------------------- | --------- | -------- | -------------------------------------------- |
| dropDegenerateFaces          | 0.000 %   | 0.00 %   | provably invisible                           |
| + dropTransparentGroups 0.15 | 8.580 %   | 100 %    | **rejected** — deleted whole visible objects |
| + dropTransparentGroups 0.05 | 0.072 %   | 2.03 %   | **new default**                              |
| visibility cull (dilate on)  | 0.772 %   | 16.85 %  | default                                      |
| visibility cull (dilate off) | 0.915 %   | 16.88 %  | rejected — +0.14 pp for negligible tri win   |
| full default chain (0.05)    | 0.789 %   | 16.85 %  | shipped                                      |

Full-map re-measure with the tuned 0.05 threshold (563 cells, 754 s): tris 7,693,610 → **7,196,301 (−6.46 %)**,
verts 10,558,021 (−6.3 %), encoded indices **30,584,967 = 66.26 % of blanket** (−33.7 %). The threshold change
gave back ~1.4 pp of triangle reduction to eliminate an 8.6 % visual error — the exact trade the harness exists
to expose. Known worst case: 16.85 % on one sparse-cell view (cell 8,11 view 6) from the visibility cull —
candidate causes for a follow-up: harness cameras sit at heights the cull ring doesn't sample (10 vs 2/60), and
cell-boundary faces "seen through the void" where the neighbour cell's occluder would stand. Both are Phase-2
option work (extra cull heights, `ctx` neighbour occluders), not new machinery.

### After the double-surface + transparent-occluder fixes (2026-07-02, post-Phase-4)

Two real-map artifacts reported from the first full bake led to two root-cause fixes:

1. **Coplanar double surfaces (map-wide z-fighting).** opensa's resolve classified redundant far-LODs by NAME
   (`hasHdTwin`), which misses underscored (`lod_conhoos2` ↔ `conhoos2`) and renamed (`lodcepalcst02` ↔
   `ce_grndpalcst02`) twins — those LOD sheets were baked ON TOP of their HD. Resolve now skips instances that
   are **IPL `lod`-index targets** (ground truth, per-instance; binary streams index their companion text IPL),
   name plays no role. This removed ~497k triangles of duplicate geometry from the bake (6.5 % of the raw merge
   was double surface!) and kills the z-fighting at its source. Predates plan 003 — verbatim builds had it too.
2. **Transparent occluders (the LA-river sawtooth).** Visibility rays treated chain-link/ivy quads as solid,
   so walls behind them were judged invisible → flipped/culled. Occluder BVH now excludes groups with texture
   opaque coverage < `minOccluderCoverage` (0.5) — see-through things no longer block rays (they remain cull
   subjects). Harness: chain mean diff 0.789 % → **0.141 %**, worst view 16.85 % → **3.85 %** (the old worst
   case was exactly this bug). Also shipped: `hiddenFaces: 'cull' | 'orient' | 'off'` (orient = never drop,
   holes impossible, single-siding win kept) as a config-level safety.

**Follow-up: `stripOldLods` upgraded to the same ground truth.** The strip was name-based (`lod*` prefix), so
renamed stock LODs (`nw_lodbit_18`, `laelodpark01`) survived in the shipped stock layer — the engine buckets
them as LOD (target-based) and they render alongside the cell-LODs → residual doubling. The strip now also
removes, per instance, every exterior IPL lod-index **target row** regardless of name (`stripTextIpl` grew a row
index in its keep callback), repairs the pointers, and deletes a model's DFF/TXD only when **no placement of it
survives anywhere** (dual-role standalone rows stay). Integration test: `strip.test.ts` (pure-target renamed
model removed + DFF deleted; dual-role standalone row + DFF kept).

Full map after both fixes (563 cells, 478 s): raw merge 7,196,886 tris (double surface already gone) →
**6,888,260** after the chain; verts 10,023,205; encoded indices **30,697,863**. End-to-end vs the original
verbatim baseline: triangles **−10.5 %**, vertices **−11 %**, encoded indices **−33.5 %**, at 0.14 % mean pixel
diff. Next lever for real polycount reduction: the budgeted-QEM tail (decimate until the per-cell preview diff
hits a pixel budget) — the harness now makes it safe to bring back.

### Budgeted QEM decimation — the tail, returned under harness control (2026-07-02)

`lod-common/budgeted-decimate` (`createBudgetedDecimate`): per cell, try triangle targets aggressive→gentle
(ratios 0.15…0.8) and accept the FIRST whose own before/after render (the Phase-4 CPU preview, 17 validation
views) stays within `pixelBudget` mean diff; nothing within budget → keep the original triangles. This is the
per-cell adaptivity the old fixed-20 %-QEM lacked (its global budget punched holes — see the decimation memory).
Runs BEFORE the visibility pass (QEM's regroup drops `twoSided` masks; also shrinks the raycast load). Kept
guards: `maxEdgeFactor` 1.5 (anti-spike), `minFacesPerGroup` 2. opensa config: `decimateBudget: 0.01` (0 = off).

Full map (563 cells, 831 s, budget 0.01):

| stage           | triangles  | Δ vs raw          | notes                        |
| --------------- | ---------- | ----------------- | ---------------------------- |
| raw merge       | 7,196,886  | —                 | verts 10,438,336             |
| + budgeted QEM  | 6,130,255  | −14.8 %           | edge cap bounds flat merging |
| full chain      | 5,936,159  | −17.5 %           | verts 9,017,418              |
| encoded indices | 26,480,742 | 61.3 % of blanket |                              |

**End-to-end vs the original verbatim baseline: triangles −22.8 %, vertices −20.0 %, encoded indices −42.6 %**,
at 0.240 % mean pixel diff (decimation's own share: +0.10 pp over the 0.141 % no-decimate chain; worst view
unchanged at 3.85 %). Tuning levers if more is wanted: raise `decimateBudget` (harness-measurable), relax
`maxEdgeFactor` for flat clusters, or add decimation-specific ratios per zone.

### Night correctness of cell LODs (2026-07-02)

- **Night vertex colours** (`0x253F2F9`): carried end-to-end (builder → every modifier incl. budgeted QEM →
  encoder) — cells are correctly dark/lit at night. Was already true; tests pin it.
- **tobj (lit windows / neon)**: were being baked into cells WITHOUT their hour gate → windows glowing at noon
  from afar (plus coplanar overlay layers in the merged mesh). Fixed on both sides: the generator now **excludes
  tobj instances from the bake** (`readTimedModels` via `parseTimedObjects`), and the engine's `buildWorldGrid`
  puts timed instances into **both** HD and LOD layers — the real, hour-gated instance renders at LOD range too
  (HD/LOD cells are mutually exclusive per cell, so nothing double-renders; the LOD build path already tags
  `userData.timed`, and night-lit variants draw additively, so no far z-fighting).
- **2dfx coronas** (street lights, casino lights): still missing from cell LODs — the mesh path doesn't carry
  2dfx. Deferred to the lossless-MergedMesh work (Phase 5 / plan 002 out-of-scope); carrying them would also GAIN
  distant night city lights the stock far view never had.
- **sa-lod-generator (real game), reported in-game: windows glowing at noon.** Root cause: 4 stock links pair a
  timed (`tobj`) HD with an **untimed neutral** LOD (`luxorlight_nt` → `lodorlight_nt`, `shutters01_lawn` →
  `lodblok08_lawn`, …) — Rockstar's always-on stand-ins are deliberately unlit, and cloning the lit HD geometry
  into them made the Luxor glow at noon. Fix: `resolveLodLinks` excludes timed-HD → untimed-LOD links
  (`excludedTimed`, reported in the CLI; verified 4 on stock). Timed→timed pairs (the 10 LV casino `_dy`/`_nt`
  LODs, themselves `tobj`) still clone — the game hour-gates them by their own IDE windows. The rest of tobj is
  a non-issue for sa: it never merges, and the game engine gates timed objects natively.

### After the no-flip + top-camera-grid fixes and Phase 5 (2026-07-02)

Ground-wedge artifact (blue triangles beside buildings, cells 8,-9 / 7,-8): ground faces partially under
buildings were judged "back-only visible" (rays escaping under non-watertight terrain to ring cameras below the
local ground) and flipped away → holes. Fixes: **winding is never flipped** (back-only → two-sided; a wrong flip
is a hole, two-sided is safe) and the single central top-down camera became a **3×3 grid** (ground pockets
between tall buildings are now seen). Harness: chain mean 0.200 % (was 0.240 %), worst view **2.19 %** (was
3.85 %). Full map: tris 5,878,527 (−18 % vs raw), indices 27,304,473 = 63.5 % of blanket (the no-flip price:
+0.8 M indices — accepted for structural hole-immunity).

**Phase-5 sa measurement** (4,249 clone models, budget 0.01): 579 models decimated within budget; clone LOD
layer 2,125,835 → **1,978,007 tris (−7 %)**, far-view weighted −6.1 %. Honest reading: most SA models sit under
the `minFaces: 500` floor and the anti-spike edge cap bounds the rest — per-object clones don't have opensa's
merged-cell slack. Knobs if more is wanted: lower `minFaces`, raise `decimateBudget` — both now
measured-not-guessed. The bigger sa win from Phase 5 is fidelity: decimated clones keep night prelit, tints and
coronas; everything else stays byte-verbatim.

### Road-stripes bug: UV-drift guard on QEM collapses (2026-07-07) — ✅ fixed, verified in-game

**Field report (opensa cells): tiled repeat textures — road surfaces, the Hampton Barns bridge deck — rendered
as lengthwise smeared stripes** (`lod_9_-7` @ 2432,−1664; `lod_2_1` @ 640,384). User-confirmed fixed in-game
after regen (2026-07-07). Bisected with a textured CPU
top-down render per stage (mean-colour previews can't see it — below): merge clean → budgeted-decimate smeared.

Root cause: **GTA map surfaces are UV patchwork.** Roads reset their tiled V every couple of segments (a 250-unit
road spans v ∈ [−4..4] via per-quad affine maps, seams duplicated), and rooftops/decks are stitched from quads
with individually offset mappings. QEM's attribute lerp is exact only for a globally affine mapping; a collapse
merging vertices across patch borders blends two different mappings, and the error compounds over successive
collapses into tile-scale smears (measured: a vertex dragged 7.2 units carried v = −1.00 where its face's own map
says −1.08 — one collapse; the shipped cells accumulated whole tiles). The budgeted-decimate self-check was blind
to it: `renderMeshPreview` paints per-group mean colour, not UVs — the same harness-blindness class as plan 012's
"relative diffs can't catch convention errors".

Fix: `simplify` (tool-kit) gained **`maxUvDrift`** — a collapse is rejected when its interpolated UV disagrees
with ANY surviving incident face's own position→UV affine map at the target by more than the limit (UV units).
Cross-patch collapses are rejected, so texture seams now survive like material seams; exact-affine merges pass
with ~0 drift. `decimateMesh` passes `MAX_UV_DRIFT = 0.1` (≈6 px of a 64 px LOD texture) — this also covers the
lod-procobj clone path (same `decimateMesh`).

Measured (cell 9,-7, the freeway/road cell): chain 52,529 → 42,023 tris (−20.0 %) with the guard — decimation
keeps ~25 % more road-area triangles than unguarded, the price of correct texel flow; the budget harness still
gates every cell. Textured re-render: roads/bridge deck clean at every stage, remaining top pixel-diff block is a
0.08-tile rooftop shift (below the 0.1 guard, invisible at LOD range). Unit pin: an 8-quad patchwork strip
decimated to 2 faces drifts 1.2 tiles unguarded vs ≤0.1 guarded (`simplify.test.ts`, `decimate.test.ts`).

Caveat for future harness work: any decimation validator must sample REAL texels through UVs (or check UV drift
directly) — mean-colour previews validate geometry only.

## Out of scope

- Budget-driven decimation (error-bounded QEM as a tail modifier) — only revisit if Phases 1–3 leave cells over
  budget; the decimation memory records what not to repeat.
- Voxel/shrink-wrap remesh with atlas re-projection (the "SLOD nuclear option") — superseded unless Tracks 1–3
  prove insufficient.
- Coplanar decal/z-fighting layer merge — follow-up on Track 3's clustering.
- Neighbour-cell occluders for opensa (context supports them; ship self-only first).
