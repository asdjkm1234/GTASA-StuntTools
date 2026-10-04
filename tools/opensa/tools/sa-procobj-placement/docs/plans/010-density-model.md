# 010 — Procobj density model (build-time, configurable, PER TARGET)

> **UNBUILT.** Moved here 2026-08-09 from the roadmap chain `07-lod-generators-extended/02`, which was dissolved into the tools it touches — see
> [roadmap 0.5.0](../../../../docs/roadmap/0.5.0/readme.md) for what the chain was and what shipped out of it.
>
> **Partly superseded 2026-08-10 by [014](./014-permanent-rows-no-lod-twins.md):** density is no longer "one
> profile for both hosts". It is a build constant on `sa` (which bakes) and a runtime setting on `opensa` (which
> scatters at load), and `linkedHeight` — the knob this plan reasoned about — is gone with the LOD twin. The
> density MODEL itself (per category, per category×surface, the candidate ceiling) is unaffected and shipped.


Turn density from one hardcoded constant into a
configurable, per-category/per-surface model.

> **The baseline this plan sits on changed under it, and the change SHIPPED (2026-08-09).** The plan's first
> task turned out to be a bug fix, not a density feature: both numeric columns of `procobj.dat` were being
> read the way the file's header describes them rather than the way the game spends them. That step is done,
> field-accepted, and its record moved to the tool —
> [`sa-procobj-placement/009`](009-procobj-dat-columns-as-the-game-reads-them.md).
> **What it means for everything below:** the layer now places **91 092** objects at *vanilla* density, not
> 15 286, so every multiplier this chain ever quoted against 15 286 was a multiplier against a defect —
> including [density-target.md](../density-target.md)'s 3.77×, whose 57 583-object aiming point is itself
> **0.63× vanilla**. "More procobj" is no longer the goal; **shaping** it is, and that is this plan.

## The two targets, and what each can actually take

| Target | What it is | The wall that binds first | Density it reaches |
| --- | --- | --- | --- |
| **`sa/`** | the real game as we ship to it: OLA (`EntitiesPerIpl` / `EntityIpl` = `unlimited`, `Buildings = 100000`) + FLA (its whole `[IPL]` section disabled) + **`perfect-map.asi`** | **int16** `IplDef` building indexes — the ONE ceiling OLA leaves stock — until our asi applies; then memory and frame time | vanilla density already crosses int16 (see below) |
| **`opensa/`** | our own engine, own formats, own streaming | **nothing SA has** — no slot array, no `LoadScene` per-file buffer, no int16. Memory and frame time, plus the per-cell `procObjLimit` | vanilla ships today; the perf budget is [04](013-density-budgets-per-target.md)'s |

Sources: [density-target.md](../density-target.md) for the row/slot arithmetic (its MULTIPLIERS are stale —
read the banner there), [`gta-sa-original/reference-install.md`](../../../../docs/gta-sa-original/reference-install.md)
for what the target install lifts, [`restrictions/sa-target.md`](../../../../docs/restrictions/sa-target.md)
for why `opensa/` is a separate representation rather than a mode of `sa/`.

**int16 is now crossed by the DATA, not by a profile — and it stopped mattering on 2026-08-09.** At vanilla
density the layer costs 25 560 permanent text rows; with stock's 12 629 that is **≈ 38 189 map-wide against a
32 767 stock ceiling**. That ceiling is lifted on the target (`perfect-map.asi` patch #1), so
[04](013-density-budgets-per-target.md) deleted the guard rather than gating a profile behind it: the build
now reports the row cost and stops there. **A density profile no longer has an int16 gate to declare** — what
prices it is the perf budget, which is still unmeasured.

**And a build that lands on a stock install is a build nobody guarded.** Not a target is not the same as not
a failure mode: someone will install this over a plain 1.0. The honest form is a build-time REPORT — "this
build needs OLA and perfect-map.asi; on stock it corrupts" — plus the installer's presence check
([04](013-density-budgets-per-target.md) decision 6), not a cap that rations the target we do ship to.

## Context

Procobj scatter (`packages/renderware/src/map/procobj-scatter.ts`, reused at build time by
`map-placement/src/procobj/convert.ts`):

- candidate count `expected = area / spacing² × PROC_OBJ_MAX_DENSITY` (`PROC_OBJ_MAX_DENSITY = 3`); each
  placement gets `lottery = random() × PROC_OBJ_MAX_DENSITY` — **uniform, with no per-species term** (a
  species' density is its `spacing`, already spent above).
- build-time density is the `--procobj-density` cutoff, `placement.lottery < density` (**1 = vanilla**), then
  a global lowest-lottery slice to `procObjMax` (100 000 — clearance, not a budget).
- category is already derived per placement: `procObjCategory(model, surface) →
  bushes/cacti/flowers/grass/rocks/trees` (`procobj-categories.ts`). Surface name is available
  (`surfinfo.dat`).

So the machinery to scale density exists; what does not exist is CONTROL — denser bushes, not denser
everything.

### Which number is "the 300"

Four caps, and they are not interchangeable:

| Knob | Where | Meaning | Per target? |
| ---- | ----- | ------- | --- |
| `lottery < density` | `map-placement/src/procobj/convert.ts` | the build-time density cutoff — **this is what this plan makes per-category** | **yes** — it IS the profile |
| `PROC_OBJ_MAX_DENSITY = 3` | `procobj-scatter.ts` | how many CANDIDATES are generated at all; a cutoff above 3 needs this raised too | **yes** |
| `procObjMax = 100000` | `sa-procobj-placement/config.ts` | global safety cap on placed objects | **yes** ([04](013-density-budgets-per-target.md) sets the real one) |
| `procObjLimit` (150 in `engine-canvas-host`) | the OpenSA runtime adapter, per cell | a runtime render/collide budget, **not** a build knob. The 2026-08-09 fix shrank the candidate pool ~19×, so it binds far less often and its value is now unowned rather than tuned | `opensa/` only |

## Decisions

1. **Density cutoff becomes configurable, per category and per surface.** Replace the global
   `lottery < density` with `lottery < densityFor(category, surface)` — a config table (default all-1.0 =
   the authored density). `densityFor > 1` keeps more candidates for that category/surface; `< 1` thins.
2. ~~**The MACHINERY is target-independent; the PROFILE is per target.**~~ **STRUCK 2026-08-09 (the user's
   call): `sa` ships the SAME density as `opensa`.** There is ONE profile, not two, and density stops being a
   per-target axis at all. What survives of the split is per-target CAPS and reporting, not per-target
   content — the two hosts render the same world or they are not the same game.
3. ~~**Every profile declares its target, its cost and its GATE, and the build refuses a mismatch.**~~
   **Collapsed by decision 2.** With one density the `sa` target crosses int16 on EVERY build by
   construction (measured on the built tree: **39 219** permanent rows against 32 767), so "does this profile
   need `perfect-map.asi`" has one answer, always yes. A per-profile gate would be a guard over a constant.
   What replaces it is a real check of the real dependency — the build SHIPS the asi
   ([asi/perfect-map 006](../../../../asi/perfect-map/docs/plans/006-pipeline-integration.md)) and the int16
   throw becomes a warning. **That moves 006 onto the critical path**: it is now what makes an `sa` build
   shippable at all, not an integration nicety.
4. **Category is the primary control axis** (forest→bushes, mountain→rocks, desert→cacti maps to categories
   bushes/rocks/cacti). Surface is the secondary axis. Zone/biome is [03](011-biome-zone-density.md).
5. **A density multiplier changes GROUPING as a side effect, and that is not a bug to design out.** Objects
   are rolled per collision triangle, so a count per triangle IS what decides clump-vs-single; nothing in the
   original prevents clumping. Measured per rule (`procedural-objects.md`): on the SAME surface
   `sand_combush02` puts **59 %** of its objects on a face carrying ≥2 of itself while `sand_josh1` puts
   **2 %**, and 85–97 % of everything stands on a face that also carries another species. **The species' own
   `spacing` decides the look, not the biome** — a warning [03](011-biome-zone-density.md) has to answer.
6. **Build-time only, deterministic.** Same seed → same scatter; the config is a build input, not a runtime
   slider (the runtime keeps its live preview slider, unchanged).
7. **Honest capping.** `procObjMax` and the area budgets bite sooner as density rises — log how many
   placements the caps drop (`CAP DROPPED n`), so raising density without raising budgets is visibly a no-op
   past the cap rather than a silent truncation.
8. **A per-category knob is only LOCAL below the global cap.** All categories feed one lowest-lottery cut
   (`selectPlacements` sorts every surviving placement together and slices to `procObjMax`). At 91 092 against
   100 000 the cut is 1.10× away — any interesting profile crosses it, so state which side of it a test is on.
   **CORRECTED 2026-08-09, by the test written for it.** The original wording — "once that cut binds, boosting
   bushes DISPLACES rocks and cacti rather than adding to them" — is wrong in the common case, and the
   mechanism says why: the slice keeps the globally lowest lotteries, and raising a cutoff only ever adds
   placements ABOVE the old one.
   - **From a uniform base, a boost past a binding cap is TRUNCATED, not traded.** Every other category's kept
     placements sit below the old cutoff, so the added ones sort last and are exactly what the cap takes. The
     boost buys nothing — and costs nobody anything. *This is the shape a naive profile will actually hit.*
   - **Displacement needs an UNEVEN profile**: another category already above the boosted one (rocks at 2.5
     while bushes go 1 → 2), so the added `[1, 2)` band undercuts rocks' `[2, 2.5)` entries. Only then does a
     boost take slots from a neighbour.
   Both are pinned in `select-placements.test.ts`. The practical rule for a profile author is unchanged in
   spirit and sharper in fact: **past the cap, check the per-category line — a boost that shows no gain is the
   cap eating it, and a neighbour losing objects means the profile is uneven.**
9. **The species floor is [01](012-species-representation-floor.md)'s, and this plan owns its trigger.** The
   2026-08-09 fix cuts both ways: far fewer candidates per cell (the cap binds less), but the surviving
   placements now CLUMP (the cap, when it binds, drops a clump). **01's 19.8 % measurement predates the fix
   and has to be re-taken** with `scripts/debug/procobj-species-floor.ts --stride 3`; the number to watch is
   *cells losing ≥1 species*, not the cap's binding rate.

## Tasks

- [x] **The global half of the cutoff knob** — `lottery < density` (default 1 = vanilla), threaded
      `convert.ts` ← generator (`--density`) ← pmb (`--procobj-density`), with `--procobj-max` and a
      `CAP DROPPED n` line. **Shipped 2026-08-08, and it is what falsified the old decision 5**: the knob
      worked and moved almost nothing, which is the finding that started the reverse.
- [x] **Read the two columns the way the game does.** **SHIPPED 2026-08-09, field-accepted** — moved to
      [`sa-procobj-placement/009`](009-procobj-dat-columns-as-the-game-reads-them.md)
      with every measurement (census, built layer, on-disk size, the nine-scene sweep).
- [x] **`densityFor(category, surface)` — SHIPPED 2026-08-09.** `ProcObjDensityConfig` +
      `densityFor`/`densityProfile`/`validateDensityProfile`/`densityLabel` live in
      `map-placement/src/procobj/density.ts` (export `@opensa/map-placement/procobj-density`); `convert.ts`
      resolves a cutoff PER BATCH. Default is the empty profile = 1.0 everywhere, so the scatter is unchanged.
      A plain number is still accepted and means `base` — `--procobj-density` keeps working untouched.
      **The plan's premise here was wrong and cost a fix.** "Category is already on the placement, thread
      surface through" — category is on the BATCH, and the batch was keyed by MODEL ALONE while
      `procobj.dat`'s rules are keyed by surface+model. **19 of the 56 models scatter on more than one
      surface** (`p_rubble` on `p_wasteground`, `p_mountain` and `p_underwaterbarren`), and
      `procObjCategory(model, surface)` reads the surface — so a batch took the category of whichever surface
      the collider walk reached first and handed it to placements from all the others. Six rubble models were
      mis-categorised at runtime (draw distance follows category), silently and differently per cell.
      Keying `ProcObjBatch` by model×surface fixes it by construction and is what makes the surface axis
      exist at all. The RNG is untouched by the split, so the scatter is bit-identical — the regression the
      verification section asks for holds by construction, not by luck.
      Tests: `density.test.ts` (16) + a scatter test that fails against the model-only key (run reverted).
- [x] **Candidate-ceiling knob — SHIPPED 2026-08-09.** `ProcObjDensityConfig.maxDensity` (default 3) is
      threaded into `scatterProcObjects(…, maxDensity)`; the converter scatters against the same number the
      cutoffs are validated against, so a raised cutoff cannot keep candidates that were never rolled.
      **It is explicit, never derived from a cutoff**, and two properties measured while wiring it say why:
      - what a cutoff MEANS does not change with headroom (`d` is `d ×` the authored density at any ceiling),
        because the lottery is uniform over `[0, maxDensity)` and the candidate count scales with the same
        number — verified at ceilings 3 and 6;
      - but **the scatter moves from the SECOND face on.** Each face consumes RNG draws in proportion to its
        candidate count, so raising the headroom shifts where every later face starts in the seeded sequence.
        The first face's placements survive; nothing after them does. Two builds with different headroom
        compare only statistically. (The first version of this note claimed the whole scatter re-rolls — the
        test disagreed, and the precise statement is the one above.)
      Below 1 is refused outright: the scatter could not reach the authored density, so `base: 1` would
      silently thin the map.
- [x] **ONE shipped profile — DECIDED 2026-08-11 (his call): it is `base: 1`, and that is a RESULT rather
      than a default nobody got round to changing.** The perf gate this task waited on was lifted by
      [013](013-density-budgets-per-target.md) (there is no frame-time ceiling for this layer at all), which
      turned the task into a pure look call — and the look was then answered by the data:
      - **The total is already past the aiming point.** 91 379 objects at cutoff 1.0 against the
        field-accepted reference's 57 583 — **1.58×** it. The 3.77× multiplier this plan was written under
        was a ratio against the pre-2026-08-09 spacing defect, not against vanilla.
      - **And so is the DISTRIBUTION, which is the half that decides the look.** This plan's own
        qualification was that a profile has to *earn* the reference's hand-authored skew, and the authored
        data lands on it unaided: **our top 2 species of 56 are 42.0 %** of the layer against the reference's
        **40 % of 46**. Two independent readings of "what a good scatter looks like", 2 points apart.
      - **A per-category move would be either invisible or unargued.** `flowers` is 0.25 % of the layer and
        **cannot exceed 678 objects** at any cutoff — the category is rare in the DATA, not in our reading of
        it; `bushes` at 64.3 % is the only category worth thinning and there is no perf reason to, which
        leaves taste against [project-goals](../../../../docs/project-goals.md)' honour-the-authored-data.
      So `density: 1` stays, now as the shipped decision with its evidence. **Any later multiplier is a new
      argument, not the completion of this one** — and it starts from "the data already looks like the
      reference", which is the opposite of where this plan began.
      *Measured off `game-src/original`; the per-species table is
      `scripts/debug/procobj-spacing-census.ts --json`, the per-category one is the build's own log.*
- [~] ~~The mismatch guard of decision 3~~ — **struck with decision 3.** One density means one answer to
      "does this need the asi", so the guard would test a constant. Its job passes to
      [asi/perfect-map 006](../../../../asi/perfect-map/docs/plans/006-pipeline-integration.md): ship the asi
      from the build, then downgrade the int16 throw to a warning that names it.
- [x] **Logging — SHIPPED 2026-08-09.** `convertProcObj` returns a per-category cost (`generated` candidates,
      `objects` shipped, `dropped` by the global cap) and `categoryCostLines` prints one row per category
      under the existing layer-cost line, which keeps the rows/object ratio. The breakdown exists because a
      TOTAL cannot show DISPLACEMENT: past `procObjMax`, "bushes +8 000 / rocks −8 000" and "+0 objects" are
      the same total and a different result. The density line now names the PROFILE (`base=1 rocks=2`), not
      just a number — a build that doubled the rocks may not print "density 1".
- [x] **Unit tests — DONE 2026-08-09, and they needed no game dir.** The selection step was extracted as
      `selectPlacements(batches, profile, procObjMax)` — profile → cutoff → global slice, with no file or
      collision work in it — so the claim is testable where the decision is MADE. Batches with lotteries
      spread evenly over `[0, max)` make a cutoff's effect a COUNT rather than a probability.
      Covered: the empty profile is the authored density (a third of the candidates — the regression
      baseline); 2.0 on `bushes` exactly doubles bushes and leaves rocks and cacti untouched below the cap;
      a per-surface cutoff moves one surface with the SAME model unchanged on another; per-category
      `generated` counts every candidate whatever survived; plus profile resolution and key-naming validation
      in `density.test.ts`.
      **And the cap case corrected the plan — see decision 8 below.**
- [x] **Wired through — SHIPPED 2026-08-09.** `ProcObjLodConfig.density` and pmb's `BuilderConfig.procobjDensity`
      both take `number | ProcObjDensityConfig`; **neither is keyed by target** (decision 2). Default stays 1.
      `--procobj-density` remains the scalar override the perf sweeps use.
- [x] **A/B the corner-biased sampler — DONE 2026-08-11, and it is one `sqrt`.** Expand the original's
      recovered routine (`pos = V1 + (V2−V1)·o1 + (V3−V2)·o2`, `o2 = o1 × rand()`) into barycentric weights
      and you get `1−o1`, `o1(1−s)`, `o1·s` — **our formula exactly**, with `o1 = rand()` where ours reads
      `o1 = sqrt(rand())`. So the alternative is not an approximation of the original; it IS the original.
      `ProcObjSampler` (`'area'` | `'corner'`) in the shared scatter, so both targets take it from one place:
      `--sampler corner` and `?procobjSampler=corner`, **default `area`**.
      **Measured map-wide** (`procobj-spacing-census.ts --sampler corner`, whole-map colliders):

      | | `area` (ours) | `corner` (the original's) |
      | --- | --- | --- |
      | placements | 103 122 | **103 122** — the count is untouched by construction |
      | same-species nearest neighbour, p05 | 3.5 m | **3.2 m** (−8.6 %) |
      | same-species nearest neighbour, median | 9.3 m | 9.4 m |
      | any-species nearest neighbour, p05 | 2.2 m | **2.0 m** (−9.1 %) |

      **It tightens the CLOSE TAIL and leaves the median alone**, which is exactly what a corner bias
      predicts: a few more very-near pairs where a triangle's placements pile toward its first vertex, the
      same overall spread everywhere else. Unit-tested on the property the recovered write-up quotes rather
      than on a look — mean barycentric weight on V1 is **0.5** for `corner` against **1/3** for `area`,
      which is an independent confirmation of the recovery.
      **Why `area` stays the default, and the argument is not "ours is better":** V1 is whichever vertex the
      COL happens to list FIRST, so the bias clumps on arbitrary tessellation corners — a property of the
      MESH, not of the landscape. That makes it 2004 sampling logic rather than authored data
      ([project-goals](../../../../docs/project-goals.md) directive 3), which is the case for departing.
      **But it is also the look the world was tuned in front of**, and a look is not settled by an argument —
      hence the knob, and hence the call is his.

## Verification

- Density 1.0 → count-identical to today's scatter (regression fixture), on every target.
- Per-category multiplier changes only that category's count below the global cut.
- A profile that breaches its target's wall fails at config time, naming the wall and the number — never at
  the guard, never in-game.
- Cap-drop counts and rows-per-object logged for every profile (sets up 04).
- `procobj-species-floor.ts` re-run per profile; any rise in *cells losing ≥1 species* hands the plan to
  [01](012-species-representation-floor.md).

## Measurements / notes

The 2026-08-09 reverse and fix, with all their numbers, live in
[`sa-procobj-placement/009`](009-procobj-dat-columns-as-the-game-reads-them.md).
Two by-products of that work belong to the tasks above rather than to the fix, so they are kept here:

- **17 of the 95 rules can never fire**: `p_grass_dry` (9 rules), `p_flowerbed` (6) and `p_wasteground` (2)
  have ZERO collision area map-wide, so a profile that boosts a category through one of them buys nothing.
  Controlled against `procobj-stats.ts -450 1500` before it was believed — the surfinfo→COL mapping resolves
  the other 14 surfaces correctly.
- **The per-rule grouping table** (decision 5) is in
  [`gta-sa-original/procedural-objects.md`](../../../../docs/gta-sa-original/procedural-objects.md) — the input
  [03](011-biome-zone-density.md) needs before it picks a biome multiplier.

_(still to record, per profile)_

- vanilla counts per category (baseline): …
- placements at 2× bushes / 2× rocks / 2× cacti, and which side of `procObjMax` the test sat on: …
- per profile: objects, permanent rows, rows/object, and which wall it stops at: …
- per profile: cells losing ≥1 species (`procobj-species-floor.ts --stride 3`), re-taken after the fix: …
