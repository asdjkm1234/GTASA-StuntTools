# 013 — Density budgets and integration, PER TARGET

> **DONE 2026-08-11.** Every task is closed or struck; the last one — end-to-end on `sa` — closed on the
> user's field run of the 18:04 rebuild, the first build carrying the species-roster floor (91 419 objects,
> 43 species, 110 382 map-wide permanent rows). Both perf budgets were answered in our favour and neither
> binds, so the plan ships no cap it was written to find. The measurement is at the bottom of this file.
>
> Moved here 2026-08-09 (UNBUILT at the time) from the roadmap chain `07-lod-generators-extended/04`, which was dissolved into the tools it touches — see
> [roadmap 0.5.0](../../../../docs/roadmap/0.5.0/readme.md) for what the chain was and what shipped out of it.
>
> **Partly superseded 2026-08-10 by [014](./014-permanent-rows-no-lod-twins.md).** Three of this plan's premises
> moved: `linkedHeight` no longer exists, the layer's price is now 1.000 permanent rows per object (so the ratio
> it tracked is fixed), and the second price it never had — inst-bearing area IPLs against SA's 40 slots — is now
> reported and gated. The perf budget for `opensa` this plan owns is UNAFFECTED and easier: clutter density is a
> runtime knob again there, so the two-pak workaround it was forced into is retired.


> The file is still named for the slot economy because its links are; the plan is not. Slots stopped being a
> currency on 2026-08-08 — see the banner below.

**Rewritten PER TARGET 2026-08-08 (the user's call), and narrowed to TWO targets the same day.** The premise
banner this file carried — three corrections stacked on an original that was wrong — is spent: what it was
groping toward is that there is no single answer, because there is no single target. Its history, kept short
because [density-target.md](../density-target.md) and [the closed route review](008-limit-route-review-closed.md) carry it in full:
written as an int16 story; corrected to a slot story when the layer measured 38/40 slots; corrected again
when the target install turned out to set both `EntitiesPerIpl` and `EntityIpl` to `unlimited`; and corrected
a third time when the layer's own baseline fell from 24 552 to **15 286** objects, which put int16 back on the
path for the 3.77× target.

**And then the target itself was declared, which settles it: stock SA is not one.** The configuration we ship
to is OLA + FLA plus our own `perfect-map.asi`
([`gta-sa-original/reference-install.md`](../../../../docs/gta-sa-original/reference-install.md)). So the slot
array and the per-file buffer — the two ceilings this plan is named after — are `unlimited` where it matters,
and **this stops being a slot-economy plan**. What is left is one correctness gate and two perf budgets.

Depends on [02](010-density-model.md)/[03](011-biome-zone-density.md) (the
density model) and on [the closed route review](008-limit-route-review-closed.md)'s route decision. Delivers the actual "MORE objects":
the caps 02/03's density ships against, per target, and perf as the limiter now that no ceiling is.

## The two targets, and what limits each

| Target | Correctness ceiling | Then what limits it | Density it reaches | Needs our asi? |
| --- | --- | --- | --- | --- |
| **`sa/`** | **int16 only** — OLA lifts the slot array, the per-file buffer and the building pool, and demonstrably does NOT lift int16 (`0x404B4A` byte-stock on the reference install) | memory + frame time in SA | the full **3.77×** target | **yes, above 32 767 map-wide rows** — the target is 38 096 |
| **`opensa/`** | none of SA's — no slot array, no per-file buffer, no int16 | memory + frame time in OUR engine, and the per-cell `procObjLimit` | unmeasured | no |

Three things fall out and they are the plan:

1. **The slot economy is dead as a density lever.** `EntityIpl = unlimited` and `EntitiesPerIpl = unlimited`
   on the target, so packing areas, folding files and recovering slots buy nothing they were meant to buy.
   What survives of the area split is STREAMING GRANULARITY — a reason to keep areas bounded, not a ceiling.
2. **int16 is the whole correctness story, and it is OURS.** No adjuster lifts it; `perfect-map.asi` does,
   and is already carrying a 72 914-row map on that install. A density profile past 32 767 map-wide rows
   declares that dependency or it is not shippable.
3. **`opensa/` has no ceiling and is currently capped by SA's.** See the guard finding below. This is where
   [project-goals directive 3](../../../../docs/project-goals.md) applies hardest: a 2004 limit is not our
   limit, and matching one is the choice that needs an argument.

## The guard split — SHIPPED, and it left this plan

**Done 2026-08-08 and moved to the tool:**
[`perfect-map-builder/003`](../../../perfect-map-builder/docs/plans/003-target-split-and-budget-guards.md)
carries the finding (`checkTextIplSlotBudget` ran on the COMMON build, so an opensa-only build threw at a
30 000-row int16 cap and warned at 39 SA slots — two 2004 numbers no OpenSA code path reads), the target
selector, and `checkTextIplBudgets` on the built `sa/` tree with int16 throwing and the slots reporting.

**What stays this plan's:** the two perf budgets, the `opensa` streaming guard the announcement stands in
for, and the stock report. None of it is a builder change until a measurement exists.

**And the guard now FIRES.** The 2026-08-09 column fix put the layer at 25 560 permanent rows — ≈ 38 189
map-wide with stock's 12 629, against int16's 32 767 — at *vanilla* density, with no profile involved. A full
build including `sa/` throws today. That is decision 3 of [02](010-density-model.md) arriving by accident
instead of by design, and turning it into a declared profile gate is this plan's.

## The scope call that reshaped this plan (2026-08-09)

**`sa` ships the SAME density as `opensa`** (the user's call), and the exe is fixed — the reference build,
the only one our asi accepts, is the one we ship to. Three consequences, and they are the plan now:

1. **Density stops being a per-target lever.** [010](010-density-model.md) ships ONE profile. This plan keeps
   per-target CAPS and REPORTING; it no longer sets per-target content.
2. **int16 is crossed by construction, on every `sa` build.** Measured on the built tree with
   `ipl-row-census.ts`: **39 219 permanent text rows / 32 767**, and **76 IPL slots** (not a wall —
   `EntityIpl = unlimited`). So the throw can never be right: it fails every build to guard a case that
   cannot arise on the target. **SHIPPED 2026-08-09** — see the first task below. It went further than
   decision 5b's warning: the target always carries the asi, so the build reports its COST and quotes no
   ceiling at all. That also demoted
   [asi/perfect-map 006](../../../../asi/perfect-map/docs/plans/006-pipeline-integration.md) back off the
   critical path — shipping the asi from pmb is the honest finish, not a prerequisite.
   **Caveat carried forward:** 39 219 is a LOWER BOUND until a census with no missing files confirms it (the
   old counter read an absent IPL as zero rows). The `CBuilding`-pool task below is the one that depends on it.
3. **The `sa` perf budget stops being a lever and becomes a VERIFICATION.** It can no longer answer "how
   dense may `sa` be" — that is settled. It answers "does the real game cope with the density we ship", and
   **if the answer is no, this plan has no lever left to pull.** That question is open and belongs to whoever
   takes the measurement.

### The ceiling this surfaces — DEFERRED, on his call

**`CPool<CBuilding>`, `Buildings = 100000` on the reference install — OLA's, not ours.** SA instantiates a
building per `inst` row, so 39 219 of that pool is spent before anything streams, and the binary streams hold
157 091 more records of which whatever is resident adds on top.

**Not a design constraint (2026-08-09, the user's call): measure it when the work is done, and solve it if it
bites.** The reasoning is the project's own — we ship OLA + FLA, and where a plugin stops we write the patch
ourselves, so an SA pool is a number to raise rather than a wall to design down to
([project-goals directive 3](../../../../docs/project-goals.md): a 2004 limit is not our limit, and matching
one is the choice that needs an argument). It stays a task, at the bottom, and nothing waits on it.

### And what it costs `linkedHeight`

`linkedHeight`'s remaining purpose was **staying under int16 on `sa/`** — decision 3 called it "the cheapest
way to stay under the one ceiling left". With int16 no longer a constraint to design against, it is back to
being plain memory and draw economy, which is worth having and worth nobody's schedule. **Both of its tasks
drop to the bottom of this plan.**

## Decisions

1. **Caps are target-gated, and the gate is a build INPUT, not a flag an operator remembers.** One target
   selector drives limits, particle policy (the 2dfx chain's `--strip-particles` opt-out) AND procobj caps —
   consistent across the pipeline. `sa` is perf-bounded *above* an int16 gate; `opensa` is perf-bounded with
   no SA ceiling in it at all. **There is no stock mode** — see decision 8 for what replaces it.
2. **Guards move to the branch they describe, and shed the ceilings the target lifted.** On `sa/` the
   39-slot check and the 4 096-row per-area budget become REPORTS, not throws — they describe an install we
   do not target — while the int16 row check stays a throw, because it is the one ceiling that is still real
   and it is the asi's gate. The `opensa/` branch gets its OWN budget guard (decision 5) rather than none:
   the answer to a ceiling that does not apply is a different ceiling, not the absence of one.
3. **The `linkedHeight`/binary-stream economy STAYS on every target.** It is memory and draw economy
   independent of any ceiling (shorter species ride binary streams costing zero permanent rows). It is worth
   **0.424 rows/object against a text-IPL mod's 1.000** — a 2.36× edge that
   [density-target.md](../density-target.md) warns is thinner than the chain once believed, and that these
   plans may not trade away to buy density.
4. **Perf becomes the budget — and a budget NAMES ITS HOST.** With no ceiling left on either target this is
   now the ONLY thing that sets a cap. The same density lands in two engines with different limiters, so
   there are two measurements and neither substitutes for the other:
   - `opensa`: the 074-era perf HUD + streaming settle machinery, on the canonical build. This is the
     measurement we can take today, with instruments we own.
   - `sa`: SA's own frame time and streaming on the real install, under Wine, above the asi gate. Slower to
     take, smaller sample, and it is the number that decides whether 3.77× is shippable there at all.
   A cap set from the wrong host's number is a guess wearing a measurement's clothes.
5. **New guard, not no guard.** For `opensa`, replace the int16 row throw with a **streamable-object budget
   guard**: fail (or warn) when a cell or area exceeds the measured count the engine streams without
   hitching. Silent over-scatter that hitches in-game is as bad as the old crash — guard it loudly, same
   spirit as `checkImgIdBudgets`. **Still OPEN after the guard move (2026-08-08):** the branch ANNOUNCES that
   it carries no ceiling (`OPENSA_BUDGET_NOTICE`) because the number does not exist yet. It is gated on the
   `opensa` perf budget in the tasks below — that measurement is the whole of what is missing.
5b. **The int16 THROW goes away too — the guard becomes a WARNING that names the ini knob** (the user's
   call, 2026-08-08). Decision 2 kept the row check as a throw "because it is the one ceiling that is still
   real". On the declared target it is not: our asi lifts int16 (patch #1, field-proven at 2.14× on a
   third-party map), OLA lifts the per-file buffer, the slot array and the building pool. Keeping a 30 000-row
   throw there is decision 8's mistake one level up — rationing the install we ship to — and it blocks this
   plan's own 38 096-row target by design. **The shape it takes instead:**
   - **pmb SHIPS the generated `perfect-map.asi` into the `sa/` target** (asi/perfect-map 006 task 1). That is
     what makes "this build needs the asi" true by construction instead of true by the operator remembering.
   - **Every ceiling becomes a console WARNING that says what to change**, naming the actual ini knob —
     OLA `EntitiesPerIpl` / `EntityIpl` / `Buildings`, FLA's `FILE_TYPE_*` pools — and, for int16, naming the
     asi this build already carries. A number the operator can act on, not a build that refuses to exist.
   - **Order: the perf budgets first, this second** (the user's call). Until the asi is shipped by the build,
     the throw stays as the stand-in for a dependency nothing checks — dropping it before then would turn a
     loud build error into silent heap corruption on any install without the plugin, or on another exe (the
     asi accepts exactly one).
   The one unretired assumption to carry into that work: patch #1 covers `firstBuilding/lastBuilding` and
   leaves `firstDummy/lastDummy` int16 ("no over-int16 dummies" — diagnosed live, not proven).
6. **Fallback honesty, and it now covers TWO plugins.** An `sa` build past 32 767 map-wide rows REQUIRES
   `perfect-map.asi`; without it the int16 corruption returns on our own data exactly as it did on
   ProperFixes'. Past the stock slot and per-file ceilings it also requires **OLA**, which our installer has
   never checked for — dropping stock as a target makes an adjuster a dependency rather than a bonus.
   Both go in the installer's presence check, loudly. (Field-proven both directions in
   [`open-issues/fixed/ghost-barriers.md`](../../../../docs/open-issues/fixed/ghost-barriers.md).)
7. **A raised cap is not a raised density.** Every cap this plan moves is a ceiling; what fills it is
   [02](010-density-model.md)'s profile, measured, with [01](012-species-representation-floor.md)'s
   species-floor check re-run at the new density. Raising a cap and reporting the headroom is not a result.
8. **Stock is a REPORT, not a mode.** Not a target is not the same as not a failure mode: someone will drop
   this build on a plain 1.0. The build prints what the artifact needs (OLA, and `perfect-map.asi` past
   int16) and what it would breach on stock — cheap, honest, and it never rations the install we do ship to.
   A guard that fails a supported build to protect an unsupported one is the wrong trade.

## Tasks

**First — the three tasks that needed no ASI, no rebuild and no density decision. All three landed
2026-08-07/08 and their record is [`perfect-map-builder/003`](../../../perfect-map-builder/docs/plans/003-target-split-and-budget-guards.md):**
`AREA_ROW_CAP = 4000` was answered from the target install's own ini (it guards a `gpLoadedBuildings` buffer
OLA sets to `unlimited`, so the cap is inert where we ship); the **target selector** shipped as
`@opensa/tool-kit/target` + pmb `--target`, derived from `--exclude`; and the **guard move** shipped as
`checkTextIplBudgets` on the built `sa/` tree. Two deliberate deviations are recorded there —
`--allow-text-row-overflow` survives for the `sa-int16-repro` consumer, and `opensa/` got an announcement
rather than a guard, because its number does not exist yet.

**What is left here:**

- [~] ~~**Keep the permanent-row cost per object as a first-class knob.**~~ **STRUCK 2026-08-11: there is no
      knob left to make.** The 0.424 rows/object it was protecting came from the binary-stream LOD economy, and
      [014](014-permanent-rows-no-lod-twins.md) deleted that economy on purpose — a stream's IPL slot is not
      resident past ~190 m, so it could never carry the range it was bought for. Every object is one permanent
      row now: the ratio is **1.000 by construction** and cannot vary with a density profile. Still REPORTED,
      because a ratio that cannot move is exactly the kind of thing that quietly starts moving again.
- [~] ~~**What area size does STREAMING want?**~~ **STRUCK 2026-08-11 — the layer streams nothing.** 014 left
      it 10 permanent text areas and zero binary streams, so there is no settle time to tune an area size
      against. What the area split still decides is the **40-slot** budget, and that is guarded rather than
      tuned (`checkInstBearingIplSlots`, and the field crash that set it).
- [x] **Report the slot, row and object cost of a build as a first-class output — DONE.** The layer's share
      prints with the target selector (objects · permanent rows · rows/object · inst-bearing areas), and the
      MAP-wide roll-up it was missing is `reportTextIplCensus` on the built `sa/` tree: rows, inst-bearing
      IPLs, and how many of the IPLs `gta.dat` lists it could actually read — that last column because both
      halves used to read a missing file as zero and the error only ever ran DOWNWARD.
- [~] ~~Raise `linkedHeight` deliberately and measure it~~ **STRUCK 2026-08-11: `linkedHeight` does not
      exist.** It was the height at which a species earned a permanent row instead of a stream pair; 014
      removed the streams, so there is no trade to make and nothing to raise.

**FIRST, and it is the only thing blocking a full build: drop the int16 throw. — DONE 2026-08-09.**

- [x] **The int16 guard is gone, and it did not become a warning.** Decision 5b said "a WARNING that names
      what to change"; the user's call while it was being written took it further, and the plan is corrected
      here rather than in a footnote: **the `sa` target ALWAYS carries OLA + FLA + our `perfect-map.asi`, so
      a lifted ceiling is not something a build reports on every run.** A warning firing on every build is a
      throw one severity down — the condition is constant (39 219 rows at vanilla density), and a constant
      condition is a print statement wearing a guard's clothes.
      **What shipped** (`tools/perfect-map-builder/src/pipeline.ts`):
      - `checkTextIplBudgets` → **`reportTextIplCensus`**: permanent rows, inst-bearing IPLs, and how many of
        the IPLs listed in `gta.dat` it could actually read. No ceiling quoted.
      - **deleted**: the throw, `TEXT_ROW_CAP = 30000`, `TEXT_IPL_SLOT_CAP = 39`, `--allow-text-row-overflow`
        and its `BuildPerfectMapOptions` field. The 30 000 was 2 767 of unmeasured headroom under a lifted
        ceiling and **nothing ever culled to fit it**, so removing it moved no content.
      - **the census now names its scope.** Both halves used to read a missing file as zero rows — an IPL
        listed in `gta.dat` but absent on disk silently subtracted its rows, and an absent `gta.dat` skipped
        the whole check without a line. The error only ever ran DOWNWARD, so 39 219 was a lower bound sold as
        a total. Missing files now WARN and the count is labelled as a lower bound.
      - `checkImgIdBudgets` **keeps its throw** — FLA's pools are what the target is really configured with
        (not `unlimited` — TXD 6000 / COL 400 / IPL 1024 since 2026-08-10, and the numbers this line quoted
        until then were partly wrong: see the measurement below), and exhausting one corrupts the heap at boot. The
        rule is "delete the museum pieces, keep the gates", now a standing rule in `CLAUDE.md`.
      - tests: 35 pass, and the two that matter were **run against the reverted behaviour** — re-adding the
        throw and the silent zero fails exactly those two and nothing else.
      *Verified 2026-08-10:* the chain DOES complete at 91 092 objects — every stage, `sa/` at 2.3 GB in
      ≈ 10.6 min. But the throw was not the only blocker: `checkImgIdBudgets` then failed on FLA's IPL pool
      (522 of 280), which is the gate doing its job. See the measurement below.

**Then the numbers, one host at a time:**

- [x] **`opensa` perf budget — MEASURED 2026-08-10, and the answer is that it does not bind. See the
      "ANSWERED" block at the end of this section.** Measure how much clutter the engine streams without hitching (perf HUD +
      streaming settle-watcher) and set `procObjMax`, the candidate ceiling and the per-cell `procObjLimit`
      from THAT. Record the rows in `docs/benchmarks/` before analysing them. This is the first real ceiling
      the target has ever been given.
      **UNBLOCKED 2026-08-09, and the instrument states its own limits.** The harness blocker is gone —
      [bench-harness plan 001](../../../../tools-debug/bench-harness/docs/plans/001-bench-settle-fall.md) shipped and merged, and the A/A floor
      was re-taken on THIS pak (91 092 clutter objects, not the lighter 08-08 one 102 measured):
      [`2026-08-09-headless-aa-floor-current-pak.json`](../../../../docs/benchmarks/opensa-engine/2026-08-09-headless-aa-floor-current-pak.json).
      - **Content holds still**: `avgTriangles` worst-of-nine **0.094 %**, draws 0.52 %.
      - **Cost does not**: `gpuMs.pass` worst **13.37 %** on a single sweep, and `avgMs` is SATURATED at the
        120 fps frame cap (8.333 ms) on seven of nine scenes in the headless lane at DPR=2.
      **So this budget may not be read off one sweep's `avgMs`.** It has to come from hitching — `p95Ms`,
      `[slow]` frames, stream stats, `lateCreates` — plus repeated `gpuMs.pass` samples, or from the user's
      uncapped display lane (which is why the density A/B could see `country-dusk` +12.6 % there and the
      headless lane cannot). Deciding WHICH lane, and how many repeats a `gpuMs.pass` claim needs, is the
      first task of the measurement rather than an assumption inside it.
      **2026-08-10 — two things the measurement now knows, and both change its shape.**
      *(a) The instrument grew a tail.* `avgMs` is not the only saturated column — `p95Ms` reads **9.1 on all
      nine scenes in both A/A arms**, so this plan's own fallback ("read it from p95") was as dead as the
      mean. The `[bench]` report now carries a **`hitch`** block (`maxMs`, `slowFrames` at the host's own
      20 ms `[slow]` threshold, `p99Ms`, `blobMaxMs`, `uploadMaxMs`, `pendingMax`) plus per-frame stream
      numbers, and it does print signal: `maxMs` 9.4-21 ms across five arms pinned at `avgMs` 8.33. `p99Ms`
      needs 1 % of a leg to move, so it answers "is the budget exceeded", never "did it hitch once".
      `UNCAPPED=1` on the harness drops the presentation clock for the cost question; untested so far.
      *(b) The load knob is a BUILD, not a URL.* The runtime clutter layer (`updateClutter` ->
      `adapter.cellClutter`, per-cell `procObjLimit`) **draws nothing on a built map**: `convertProcObj`
      strips every species it bakes, so the shipped `procobj.dat` is 9 rules of 96, all underwater. Measured
      as a null result — `?procobj=0` and `procObjLimit` 1 -> 3000 move `country-dusk` triangles by 0.007 %
      against a 0.41 % A/A drift
      ([`2026-08-10-headless-runtime-clutter-null-result.json`](../../../../docs/benchmarks/opensa-engine/2026-08-10-headless-runtime-clutter-null-result.json)).
      **So the per-cell `procObjLimit` cannot be swept in the field at all**, and the two arms this budget
      needs are two PAKS. One is already on disk: `NO_COMMIT/old_map` carries 15 286 objects against today's
      91 092 — a 5.96x load step, both real builds, nothing to rebuild.

      **ANSWERED 2026-08-10 (late), on the unbaked pak, and the two-pak workaround was never needed.** Plan
      014 took the bake out of the `opensa` branch, so `data/procobj.dat` is back to all **95** rules and both
      knobs are live again. 15 single-scene `country-dusk` sweeps, two lanes, an A/A control in each:
      [`2026-08-10-headless-procobj-runtime-knob-ladder.json`](../../../../docs/benchmarks/opensa-engine/2026-08-10-headless-procobj-runtime-knob-ladder.json).
      - **The knob is live**: `?procobj=0` moves triangles **−2.72 %** (1 206 029 → 1 173 177) and draws
        830 → 815, against an A/A drift of **0.007 %**. The 08-10 null result really was a SITE failure —
        same code, same scene, same harness, only the pak changed.
      - **`procObjLimit` saturates at 300, and THAT half is data-limited**: 150 → 300 is +0.41 % of the scene;
        300 / 600 / 1200 / 3000 agree to 0.015 %. The candidate pool per face is `area / spacing²`
        ([009](009-procobj-dat-columns-as-the-game-reads-them.md)), so at cutoff 1 a cell does not hold 300
        placements. **Read the +0.41 % with its scope**: 4 923 triangles of a 37 775-triangle layer, so the
        shipped 150 trims **13.0 % of the layer** while costing 0.41 % of the scene.
      - **Density saturates at ×3, and THAT ceiling is OURS.** Corrected on review, before this went out as a
        verdict: `scatterProcObjects` generates `area / spacing² × PROC_OBJ_MAX_DENSITY` candidates with a
        lottery uniform in `[0, PROC_OBJ_MAX_DENSITY)`, the renderer keeps `lottery < density`, and the runtime
        adapter takes the default **3** (`gta-sa-world.adapter.ts:632`, no argument) — so a cutoff ≥ 3 keeps
        every candidate and nothing above it can exist. The arms measure exactly that: clutter triangles over
        the clutter-off baseline run **37 788 : 78 689 : 118 405 : 118 576 : 118 540 = 1 : 2.08 : 3.13 : 3.14 :
        3.14**, linear in the cutoff and then flat at 3 (the ~4 % over an exact 1:2:3 is species mix).
      - **So "+10.11 % of the clutter scene" is the layer's cost at 3× vanilla, not its ceiling.** Raising
        `PROC_OBJ_MAX_DENSITY` buys more at a linear cost in candidates and scatter time. Draws move only at
        the on/off boundary — it is instanced, so a per-pixel cost, not a draw-count one.
      - **There is no hitch to find.** `hitch.maxMs` 9.7–36.0 and `slowFrames` 0–4 across the 11 capped arms
        with **no relation to load** (worst: `lim600` 35.4/4 and `d8` 36.0/1; the heaviest arm `d16` reads
        12.3/0; the A/A pair alone spans 21.9 vs 9.7). `blobMaxMs`/`uploadMaxMs`/`pendingMax` 0 everywhere.
      - **`UNCAPPED=1` works and retires the "needs his display" half**: `avgMs` unpins 8.33 → 5.42–5.64,
        `p95Ms` 9.1 → 6.7–7.2. **But it destroys the hitch block** — 148–196 ms `maxMs` and 16–19 slow frames
        in *every* arm including clutter-off. Capped for hitching, uncapped for cost, never mixed. Even
        uncapped the layer is below the noise: `gpuMs.pass` A/A is 6.5 % apart, *wider* than off → max (6.3 %).

      **So the three numbers this task was to SET have no perf ceiling to be given on this host** — at 3×
      vanilla the layer still costs less than one sweep's A/A drift. `procObjLimit` stays **150** unless the
      look wants back the 13 % of the layer it trims (300 is the only value above it worth choosing);
      `procObjMax` and the candidate ceiling are unconstrained by frame time here, and the density ceiling is
      **available headroom rather than a measured maximum**. **Decision 5's streaming guard therefore has no
      number to guard the clutter layer with** — see the task below, which changes shape because of this.
      **What is NOT covered**: one scene, camera flights rather than a drive, n=1 per arm. A streaming-shaped
      hitch under continuous movement is sampled by no arm here, and the three streaming columns reading 0
      everywhere means that pressure never arose, not that it was survived. **Nor what raising
      `PROC_OBJ_MAX_DENSITY` costs** — every arm above ×3 measured the same world.
- [x] **`sa` perf budget — ANSWERED IN PASSING 2026-08-10, in our favour.** He rebuilt `sa` at `opensa`'s
      procobj count, installed it, and **the game plays**: the clutter reaches 299 m and nothing hitches. So
      the open question this task carried — "if SA does not cope there is no lever left" — resolved without
      the lever being needed. Not a bench run and not claimed as one; it is a field verification, which is
      what the task asked for.
- [x] **Price the `CBuilding` pool — DONE 2026-08-10, and it bit exactly as predicted.** The crash at
      `0x005381A5` was this pool at exactly 100 000; `Buildings` went **100 000 → 150 000** in the install's
      OLA ini and was verified there rather than assumed. Map-wide permanent rows are **110 055** today, so
      the headroom is 39 945 — and `reportInstallRequirements` now names this pool on every build, which is
      what makes the next approach visible before it is a crash.
- [x] **The stock REPORT (decision 8) — SHIPPED 2026-08-11.** `reportInstallRequirements` prints, every `sa`
      run, each stock ceiling this artifact crosses and **the setting that lifts it**: int16 rows →
      `perfect-map.asi` (no adjuster provides it), the `CBuilding` pool → OLA `Buildings`, rows in one IPL →
      OLA `EntitiesPerIpl`, and the three FLA id pools. A LINE, never a throw — the guards beside it own the
      ceilings that are REAL on the target, and this one owns the ones we deliberately design past. It is the
      honest replacement for the int16 throw deleted on 2026-08-09: the build stopped shaping its output down
      to an install we do not ship to, so what it owes instead is a plain statement of the install it needs.
      Pure `installRequirements` underneath, so the wording is tested without a game dir.
- [~] ~~Target-gate the remaining procobj caps~~ **STRUCK 2026-08-11.** `STREAM_MAX_INST` guards a stream
      layout 014 deleted; `procObjMax` and the candidate ceiling were measured NOT to bind (100 000 against
      91 379) and the `opensa` budget found no frame-time ceiling to gate them from, so a target gate would
      be a switch between two identical answers.
- [x] **End-to-end on `sa` — DONE 2026-08-11, on the build that carries the roster floor.** The first field run
      (2026-08-10) proved the build installs with `perfect-map.asi`, plays, and shows no ghost barriers and no
      int16 corruption at 91 092 objects — but it predated `procObjSpeciesFloor: 1`. The rebuild of 2026-08-11
      18:04 carries it, and **his field verdict on it is that the placement reads right: the objects sit where
      they belong.** The layer is now **91 419 objects across 43 species** in `plobj0..9.ipl` (map-wide
      permanent rows **110 382**) — **+327 against the pre-floor build on both counts**, which is the floor's
      own cost, measured rather than modelled. The slope gate is NOT in this verdict and does not need to be:
      `procObjSlope` ships undefined (= unchanged), so it is a knob awaiting a look judgement, not a behaviour
      in the build. The "02/03 profiles" half stays void: task 8 shipped `base: 1` as the profile
      ([010](010-density-model.md)) and 011's biome multipliers were struck as redundant, so there is no denser
      build to test.
- [x] **Docs/memory sweep — DONE 2026-08-11.**
      - **007 (binary streams)** already carries its superseded banner from 2026-08-10, with the reason
        (`CIplStore` keeps a stream's slot resident only within 190 units, so it cannot carry range) and the
        note that lod-trees' overflow areas still want the shape. Nothing to add.
      - **[ghost-barriers](../../../../docs/open-issues/fixed/ghost-barriers.md)** gained the density this
        unlocks and a banner over its "what shipped" list: items 1, 2 and 5 there are the WORK-AROUND era, and
        two of them (streams, `linkedHeight`) no longer exist in the code. The number that makes the point is
        **110 055 permanent rows — 3.4× the int16 ceiling the issue is about**, which exists because the cause
        is fixed rather than dodged.
      - **`docs/restrictions/`**: the rule the task guessed at ("a guard must live on the branch whose target
        it describes") is already stated in `sa-target.md` — *delete the museum pieces, keep the gates* — and
        it is in `CLAUDE.md` as a standing rule. No new entry: the target SPLIT stopped being an axis when
        stock ceased to be a target, so there is no split for a rule to describe.

## Verification

- **Per target, and never averaged.** `sa`: a build past 32 767 map-wide rows ships and runs WITH the asi,
  the installer warns without it (and without OLA), and the slot/per-file checks are reports rather than
  throws. `opensa`: the SA guards no longer run, a streamable-object guard does, and the cap it enforces came
  from a measurement in that engine.
- No target can be built with another's profile ([02](010-density-model.md) decision 3) — checked at config
  time, in a test per pair.
- Denser biomes visible in-game; streaming smooth (no hitch regression); species floor unchanged or handed to
  [01](012-species-representation-floor.md).

## Measurements / notes

**2026-08-08 — the first budget attempt, and what it actually found.** Two builds from the canonical
build's kept `.work/5-trees` stage, density 1 vs 3 (cap raised so it could not bind), benched by the user
in-game over 9 scenes ([`benchmarks/…/2026-08-08-ingame-07-04-density-ab.json`](../../../../docs/benchmarks/opensa-engine/2026-08-08-ingame-07-04-density-ab.json)):

- **The density cutoff is not the density lever.** 3× the cutoff yields **15 840 objects vs 15 286 — +3.6 %**
  (rows 6 728 vs 6 487, pak +0.30 %, 1139 cells both). `procObjMax` never bound, so MINDIST culled the extra
  candidates: the authored spacing is already saturated at vanilla density. **This falsifies
  [02](010-density-model.md)'s premise** that "raising density is mostly raise the cutoff" — the only lever
  left that moves the count is the authored `procobj.dat` MINDIST, which is a data-honesty decision, not a
  knob, and it is now the gate on this whole plan's density.
- **What the A/B can honestly say**: +3.6 % clutter costs nothing measurable — six scenes identical to ±0.0 %
  triangles with `gpuMs.pass` within ±0.03 ms, and `country-dusk` (the clutter scene) +0.3 % triangles for
  +0.013 ms. It says NOTHING about a streaming budget, because the arms are 3.6 % apart.
- **The harness drifts more than the content does**, and that is a new blocker: three scenes disagreed by
  amounts no 3.6 % change can produce (control scene `ocean-horizon` +107 % triangles). Filed as
  [`open-issues/bench-scene-transition-collision.md`](../../../../docs/open-issues/bench-scene-transition-collision.md)
  — collision is missing across a scene teleport. **The perf budgets below cannot be taken until it is
  fixed**: a sweep whose control scene moves by 107 % cannot resolve a cap.

**2026-08-10 — the first `sa` build since the int16 guard came out, and the throw was NOT the only blocker.**
Run: `pmb --exclude vehicles,peds,opensa --keep-work` on the 91 092-object layer.

*The chain completes.* Every stage ran and `sa/` built out at 2.3 GB — `mods` 98.8 s · `optimize` 79.4 s ·
`trees` 83.7 s · `procobj` 10.5 s · `sa` 366 s (≈ 10.6 min; the 44 m 54 s figure is a FULL build, whose pack
is ~¾). The layer priced itself at **91 092 objects · 25 560 permanent text rows · 0.281 rows/object**.

*The census closed its own caveat.* `read 97/97 listed` — no missing files, so the map-wide count is a total
and not a lower bound: **44 523 permanent text-IPL rows, 75 inst-bearing IPLs.** (The 39 219 this plan carried
was the lower bound the old silent-zero census produced.)

*And then `checkImgIdBudgets` threw, correctly.* **Binary IPL files: 522 of 280** — FLA's `FILE_TYPE_IPL`
pool, a configured number the target really has. Counted per archive, the cause is this layer:

| | `plobj*_stream*` (ours) | all `.ipl` entries | vs the 280-slot pool (margin 8) |
| --- | --- | --- | --- |
| BEFORE — `NO_COMMIT/old_map`, 15 286 objects | 50 | 241 | fits, 31 slots spare |
| AFTER — 91 092 objects | **331** | **522** | 250 over |

50 → 331 is 6.62× against a 5.96× object count — slightly super-linear, from median-split underfill. The
knob is **`STREAM_MAX_INST = 512`** (`tools/map-placement/src/streamed-areas.ts`), instances per binary tile:
the streams hold ~156 600 records (25 560 linked at one row + 65 532 unlinked at two), and 156 600/512 ≈ 306
against 331 measured, so tiles run ~92 % full. **`AREA_MAX_PAIRS` is not what sets the file count** — the
tile size is. Note the BEFORE had only 31 slots of headroom, so this pool was near the wall before the
density change and nobody had looked.

*Resolved by raising the pool, not by shaping the build* (the user's call, and directive 3 applied directly):
his ini now carries `FILE_TYPE_TXD = 6000` · `FILE_TYPE_COL = 400` · `FILE_TYPE_IPL = 1024`, and
`IMG_ID_BUDGETS` mirrors them. The guard re-run on the built tree: TXD 4999/6000, COL 264/400, IPL 522/1024.
**Streaming granularity was deliberately NOT traded** — raising `STREAM_MAX_INST` would have cut the file
count 4× at the cost of 4× coarser position streaming, which is a behaviour change on both targets and
belongs to the streaming measurement below, not to a build-fixing patch.

*The second finding is the dangerous one, and it was silent.* `IMG_ID_BUDGETS` had always read **TXD 6000
while the install's pool was 5000** — `FILE_TYPE_TXD` carries a `#` in the ini, so FLA left it at default, and
its log says `20000 - 24999 (5000)`. The build measures 4999 TXD archives. So the pool with **one slot of
real headroom** was the one printing `4999 of 6000`, and no build could ever have warned: a guard number
ABOVE the install's can only fail to fire. Corrected in the guard and in
[`reference-install-config.md`](../../../../docs/gta-sa-original/reference-install-config.md), which now says
to read a pool off FLA's LOG rather than off the ini.

*The clean re-run, with the raised pools* — **the `sa` target builds end to end at 91 092 objects.** This is
P0's deliverable, and it is now measured rather than assumed:

| Stage | Wall clock | Share |
| --- | --- | --- |
| mods | 1m 20s | 13 % |
| optimize | 1m 19s | 13 % |
| trees | 1m 21s | 13 % |
| procobj | 5.7s | 1 % |
| **sa** | **6m 3s** | **60 %** |
| **TOTAL** | **10m 9s** | |

Guard output on that run: `TXD 4999/6000 · COL 264/400 · binary IPL 522/1024`, and `build-timings.json` is
written (the failed run lost its timings — the throw preempts the write, which is worth knowing before
reading a missing timings file as a missing feature).

**2026-08-10 — the two targets carry the SAME WORLD, and it is measured on both halves.** The scope call
("`sa` ships the same density as `opensa`") is stronger than a density match: the two must hold the same
objects at the same coordinates, or every cross-target verdict — above all this plan's own "does the real
game cope at the shipped density" — compares two maps while reading as one engine comparison. procobj
positions are DERIVED (seeded scatter over collision geometry), so a divergence would look entirely
plausible on both sides.

*Half one — the shared input.* `sa/` (built 08-10) against `opensa/` (built 08-09 13:53), two independent
runs: **all 46 `plobj*.ipl` and all 331 `plobj*_stream*.ipl` byte-identical**, 91 092 HD objects / 25 560
permanent LOD rows / 65 532 stream LODs each side. Being two separate runs, this also measures what the
evening's "RNG untouched ⇒ bit-identical scatter" claimed on a reading: **the scatter is reproducible
map-wide, so a rebuild does not move the world.** Now pinned by a test — `buildPerfectMap target split` in
`perfect-map-builder/src/pipeline.test.ts` asserts the procobj stage runs ONCE and that both target builders
receive that one stage dir (verified against the broken state: pointing `opensa` at another dir fails it).

*Half two — the convert.* `opensa/` reads the pak, not the game dir, so the input parity is only half the
claim. New verifier `scripts/debug/pak-placement-parity.ts`: **182 184 / 182 184 instances covered** (156 624
binary + 25 560 text), each inside its own placement AABB within **0.05 u**. The 15.6 % that miss at slack 0
are float32 rounding on the stored bounds, not displacement. **Positive control run before believing it** —
the same game dir against `NO_COMMIT/old_map/pak` (15 286 objects) reports 98.3 % uncovered, so the
instrument can print non-zero.

*Still unproven:* FLA rewrites its log at boot, so nothing yet confirms it accepts 1024 — that needs a launch.

**2026-08-11 — the field run that closes the plan, on the first build with the roster floor in it.** Full
rebuild of both targets (`report-sa.json` 18:04, the first live run of pmb's per-target report — plan
[005](../../../perfect-map-builder/docs/plans/005-one-report-per-target.md)). `sa` chain 586.6 s total:
`mods` 74.9 · `optimize` 76.6 · `trees` 80.1 · `sa` 351.6 · `procobj` 3.4.

| | 2026-08-10 (pre-floor) | 2026-08-11 (`procObjSpeciesFloor: 1`) | Δ |
| --- | --- | --- | --- |
| procobj objects (`plobj0..9.ipl`) | 91 092 | **91 419** | +327 (+0.36 %) |
| map-wide permanent rows | 110 055 | **110 382** | +327 |
| species placed | 43 | **43** | — |

The two deltas being the same number is the check that the floor did what it says: it ADDS objects (it does
not swap), and each added object is one permanent row. **The user's field verdict: the result is good, the
objects are placed sensibly.** Which is the whole acceptance test this task ever had — the floor exists so a
patch of ground shows its complete roster rather than a probable one, and that is a claim only the eye settles.

Reported install requirements on this build, all inside the target's lifted ceilings: 110 382 rows against
int16's 32 767 (our `perfect-map.asi`, sha `c6b87f95…`), 110 382 against OLA `Buildings` 150 000, largest IPL
9 142 against `EntitiesPerIpl`, and the FLA id pools at TXD 4 998 / COL 263 / IPL 191.

_(the rows below are still to be recorded)_

- `opensa` streamable-object budget per cell/area, and the caps set from it: …
- `sa` frame/stream numbers under Wine, above the asi gate: …
- area size chosen from the streaming measurement (2 000 pairs was a ceiling artefact): …
- rows/object per shipped profile (today: 0.424): …
- dense full-map counts + fps + hitch stats vs vanilla, per host: …
