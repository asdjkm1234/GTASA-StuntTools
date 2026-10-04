# 012 — Every species survives the cap (no silently missing type)

> **SHIPPED 2026-08-11, default OFF.** Moved here 2026-08-09 from the roadmap chain
> `07-lod-generators-extended/01`, which was dissolved into the tools it touches — see
> [roadmap 0.5.0](../../../../docs/roadmap/0.5.0/readme.md) for what the chain was and what shipped out of it.

## SHIPPED 2026-08-11 — and the "latent on what we ship" verdict was DEAD before it was written down

**The defect is live on the build we run.** Every earlier reading of this plan closed with "latent, because
`convertProcObj` strips the converted species and leaves the runtime path 8 underwater rules". That stopped
being true on 2026-08-10, when the redesign moved the procobj bake inside the `sa` branch: `opensa` runs no
bake at all, so `build/original/opensa/data/procobj.dat` ships **95 rules** and measures **identically to
stock** — 17 of 96 clutter cells (**17.7 %**) lose at least one species, worst cell `8,-3` at **16 of 23**.
The fix's own plan said it would return "the moment a game does not run the placement tool", and that is
exactly what `opensa` now is. Nothing re-read this page when the shape changed; the same family as lesson 51.

**What shipped.** `procObjCellBudget` (`packages/renderware/src/map/procobj-scatter.ts`) — **one** function
resolving the per-category density knobs, the `procObjLimit` cap and the floor into **one keep-count per
batch**, which both the render path (`cellClutter`) and the collider path (`procObjColliders`) now spend.
That is task 5 satisfied by construction rather than by a matching rule: `procObjColliders` no longer computes
a cutoff at all, it takes the counts, so the render set and the collider set cannot diverge. Config:
`GtaSaWorldAdapterConfig.procObjSpeciesFloor`, **default 0 = OFF**, field knob `?procobjFloor=<n>`.

**The floor's unit is the MODEL, not the batch — decided here, and it is not cosmetic.** Batches are keyed
model×surface since 010, and 19 of the 56 models scatter on several surfaces; a bush still drawn from the
neighbouring surface has not gone missing, so a per-batch floor reserves twice for one visible species. The
model's floor is filled from its own lowest lotteries wherever they grew.

**The rescue is PAID FOR**, at the top of the lottery order: the placements the cap was about to cut are the
ones it now cuts, and no model is taken below its own floor. So `procObjLimit` stays a real number — the
script's binding identity (binding ⇒ exactly `limit` drawn) passes with the floor on, over all 96 cells.

### Measured 2026-08-11 — same sample, `--stride 3`, stock rules, `procObjLimit` 150, density 1

| Floor | Cells losing ≥1 species | Price (placements traded, of 10 825 drawn) |
| --- | --- | --- |
| OFF (0) | **17 of 96 (17.7 %)** | — |
| 1 | **0** | 35 (**0.32 %**) |
| 2 | **0** | 104 (0.96 %) |
| 3 | **0** | 197 (1.82 %) |

**Floor 1 is the whole fix**; 2 and 3 buy nothing measurable on this corpus and cost 3× and 6× as much
character. The ask was "none may be dropped to zero", and 1 delivers it — the case for 2 is only that a
species represented by a single object may read as an accident rather than as a species, which is a LOOK
call and belongs to the field, not to this table.

**ON by default since 2026-08-11 — his call, once the evidence was complete.** `?procobjFloor=0` is still the
A/B and is honoured as zero. The look decision was his to make and he made it: a patch of ground should show
its whole roster rather than probably-most of it.

### The field A/B, 2026-08-11 — and the first site was a dead one

**The picture is checkable, and it was checked.** Headless, `?loader=http-dir` against
`build/original/opensa`, `spawn=-1391,2044,55&look=-1361,2044,52&hour=12` — 30 m west of the `sand_josh2`
the cap zeroes in cell `-5,7`, aimed at it. Same spot, one URL apart:

| Arm | Changed pixels vs its pair | What it shows |
| --- | --- | --- |
| `?procobj=0` vs `?procobj=3` — **the positive control** | **9.81 %** (mean Δ 11.2) | bare sand against dense scrub: the layer draws here, so the site can answer |
| `?procobjFloor=0` vs `?procobjFloor=1` — **the measurement** | **1.00 %** (mean Δ 0.85, max Δ 194) | one Joshua tree, standing in the floored arm and absent without it. `draws` 533 → 534 |
| `?procobj=3` vs `?procobj=1` | 0.07 % | **the density knob does nothing here** — `procObjLimit` binds, which is exactly the regime the floor is for |

**The first site chosen was a null, and the control is why that is known.** The census's worst cell (`8,-3`,
the redwood forest at ~2125, −625) was the obvious place to stand, and four frames there showed no difference
at all — because `?procobj=0` and `?procobj=3` showed no difference there either. The layer draws almost
nothing under those redwoods, so the A/B was measuring an empty stage. **Most species lost is not the same
question as most clutter drawn**, and only the control separates them (lesson 46, second instance).

**What the picture says about N.** One plant per lost species is a variety change, not a density change: it
moves 1 % of the frame where turning the whole layer off moves 10 %. On this frame the restored species is
the only TALL thing in the patch, so it reads clearly; a restored grass tuft would not. That is an argument
for the floor being about the roster, and against ever growing it into a quota.

### Frame cost, measured 2026-08-11 — none, and the design is why

Four `country-dusk` legs, two per side so each carries its own A/A drift
([the run](../../../../docs/benchmarks/opensa-engine/2026-08-11-headless-procobj-species-floor.json)):
`avgDrawCalls` **821 in every arm**, triangles **+0.002 %** against a 0.011 % same-side spread, `gpuMs.pass`
+0.52 % between the two pairs' own drifts of 0.30 % and 0.14 %. **The floor never adds a placement, it swaps
one** — so "no cost" is a property of budget conservation, not a lucky reading. `avgMs`/`p95Ms` are saturated
in this lane and answer nothing. Gap: no positive control in this lane, so this says "no cost", not "an
effect was present and cost nothing" — the effect is proven by the picture below instead.

### The `sa` half — SHIPPED 2026-08-11, and it needed a WIDER gate than the runtime's

**His call, and it corrected the answer below.** "If a desert surface is eligible for ten species, all ten
should be there at least once." The section below is still right that the runtime's mechanism (a budget cap
zeroing a species) does not exist on `sa` — but it was answering the wrong question. On `sa` nothing caps
anything, so what empties a species locally is the **density LOTTERY**: a rule that fires three times on a
patch rolls all three above the cutoff about 30 % of the time, and that species is simply absent there.

So the `sa` gate reads **"had a candidate in this cell"**, not "survived the density" — and it **ADDS**
objects where the runtime floor **SWAPS** them. That asymmetry is forced by the two paths, not a choice:
there is no binding budget here to take the payment from.

- `selectPlacements(batches, profile, procObjMax, speciesFloor)` — per 250 u cell (`PROC_OBJ_FLOOR_CELL`, the
  runtime's own `CELL_SIZE`, so both targets guarantee a roster over the same patch of ground), every model
  with a candidate keeps `min(N, its candidates)`, promoted from its **own lowest rejected lotteries** — the
  most vanilla of the ones the cutoff turned down.
- **Floored objects sort AHEAD of the lottery order**, so a `procObjMax` that ever binds displaces ordinary
  objects instead of silently undoing the guarantee.
- Config `procObjLodConfig.procObjSpeciesFloor`, **default 1**, CLI `--species-floor`. pmb passes only
  `density`/`procObjMax`, so a pipeline build takes the default.

**Measured on `game-src/original`, density 1:** **91 067 → 91 379 objects, +312 (+0.34 %)** — and the layer's
scarce price is unchanged: still **10 inst-bearing area IPLs of SA's 40**, still 39 species raised, and
`procObjMax` still does not bind (91 379 of 100 000). The number is the near-twin of the runtime floor's
0.32 %, which is the same fact seen from both paths: a roster guarantee is cheap because the species it
rescues are rare by construction.

### The boundary of the guarantee: a species with no candidate ANYWHERE

Neither floor can place a species the scatter never rolls, and **17 of the 95 stock rules are in exactly that
state** — their surfaces (`p_grass_dry`, `p_flowerbed`, `p_wasteground`) carry zero collision area map-wide,
so their authored expectation is 0.000 objects, including the densest rule in the file
(`p_wasteground p_rubble`, spacing 4). Confirmed independently 2026-08-11 by the spacing census's per-rule
table, against the 2026-08-09 measurement in
[`gta-sa-original/procedural-objects.md`](../../../../docs/gta-sa-original/procedural-objects.md). Five
models reach 0 across ALL of their rules and are therefore absent from the world however the knobs are set.
**That is the original's data, not our pipeline** — a cutoff multiplies zero — and it is the honest limit of
"every species appears": every species with somewhere to appear does.

### Does the runtime's own fix belong in `sa-procobj-placement`? No — that mechanism is not there

**Checked against the code, not assumed.** The `sa` bake runs `selectPlacements`
(`tools/map-placement/src/procobj/convert.ts`): **one global lowest-lottery slice at `procObjMax`, no
per-cell cap and no MINDIST thinning**. The defect this plan fixes is per-CELL competition for a shared
budget, and that regime does not exist on that path — a species can only be zeroed there if the global cut
binds, which it does not (**91 092 placed against a `procObjMax` of 100 000**, `config.ts:42`) and which says
so loudly when it ever does (`build.ts:210` prints `CAP DROPPED …`).

**So on `sa` every baked species already appears everywhere it was placed** — the 43 species in
`lod_procobj.models` are permanent static IPL rows at `lod = -1`, and nothing caps a static instance. The
species the bake does NOT take (the short ones and the underwater set) still scatter through **SA's own**
`CProcObjectMan` with the original's own pooling, which our floor cannot reach and should not try to.

**Which answers the question the other way round:** turning the floor ON for `opensa` moves the two targets
CLOSER together, because `sa` already behaves as if the floor were on. It is `opensa`'s default that is the
odd one out. **The one thing to re-check if density ever rises on `sa`**: once `procObjMax` binds, the global
slice takes from every category at once and could zero a species map-wide — the same idea would then be
needed there, and the cap's own log line is the tripwire.

**Equivalence, checked rather than asserted:** with the floor off, `procObjCellBudget` returns byte-identical
counts to the old `lottery < min(density, procObjLotteryCap(batches, limit))` cut — **0 mismatches over the
96 real clutter cells** of the same sample (throwaway `.tmp-` script, deleted).

**Instrument correction, and it matters for reading this page's history:** the sizing script counted a
species per BATCH, which reads **19 cells / 19.8 %** and a worst cell of 18 of 26. Counted per MODEL — the
unit the floor protects and the unit a player sees — it reads **17 / 17.7 %** and 16 of 23, reproducing this
plan's own 2026-08-09 table exactly. The per-batch reading was measuring the model×surface split, not the
world. The script counts per model now; do not compare a number from it against a pre-2026-08-11 per-batch run.


Independent of the ASI question
([00](008-limit-route-review-closed.md)) — this is a FAIRNESS defect in how the caps choose survivors, not a limit
question. ~~And independent of raised density ([02](010-density-model.md)) — worth fixing at today's
density.~~ **Both halves of that were wrong and the 2026-08-08 sizing struck them: at today's density the
shipping build loses no species at all, and [02](010-density-model.md) is what brings the defect back. This
plan now RUNS AFTER 02** (the user's call, same day).

**The ask:** a section allows 300 objects and three species are eligible there. All three must appear. Not
in equal proportion — but none may be dropped to zero.

**"Not in equal proportion" is the load-bearing half, and there is now evidence for it.** The reference set
in [density-target.md](../density-target.md) — 57 583 hand-tuned instances from a shipping mod — puts **40 %
of everything into two of its 46 species**, with a tail running down to a couple of hundred. A skew that
extreme is what a good-looking scatter actually is. So the deliverable here is a FLOOR that outlaws zero,
never a quota that flattens the distribution; an implementation that evens the mix out would be a
regression measured against the only reference we have.

## Context — why a species can vanish today

Both cap sites select survivors the same way: pool every candidate, sort by `lottery`, keep the lowest.

1. **Build-time, global** (`tools/map-placement/src/procobj/convert.ts`):

   ```ts
   const vanilla = batch.placements.filter((p) => p.lottery < 1);   // vanilla cutoff (02 makes it configurable)
   …
   placed.sort((a, b) => a.placement.lottery - b.placement.lottery);
   const final = placed.slice(0, procObjMax);                        // ONE global cut, procObjMax = 20 000
   ```

2. **Per cell, runtime and colliders** (`packages/renderware/src/map/procobj-scatter.ts`,
   `procObjLotteryCap`): pools the lotteries of ALL of the cell's batches, sorts, and returns the
   `limit`-th as the cutoff — "lowest lotteries win — the most-vanilla subset".

### What the mechanism actually is (corrected 2026-08-08, against the code)

This plan was written around a bias that does not exist. It said `lottery = random × density` with `density`
coming from the species' own `procobj.dat` rule, so a low-density species would produce systematically low
lotteries and crowd the others out. The code says otherwise:
`lottery: random() * PROC_OBJ_MAX_DENSITY` (`procobj-scatter.ts:195`) — **uniform in [0, 3) for every
candidate of every species**, with no per-species term. `ProcObjRule` has no density field at all
(`procobj.parser.ts`): `procobj.dat` expresses density as **`spacing`**, one object per N m², and it is spent
at candidate GENERATION (`expected = area / rule.spacing × PROC_OBJ_MAX_DENSITY`).

So the cross-species draw is unbiased and the global cut is **proportional** — each species keeps roughly the
same fraction of its own candidates. Which kills the cheapest of the three candidate fixes below outright:
"per-species lottery NORMALISATION, divide by the rule density" has nothing to divide by and nothing to
correct.

**A species can still reach zero, by two routes that are not the one this plan described:**

1. **Rounding.** A species whose eligible count × the surviving fraction falls below 1 disappears — a rare
   species on a small patch, not a low-density one. The tighter the cap the more species this reaches.
2. **MINDIST before the cut.** `cullByMinDistance` runs per species on the lottery-filtered set
   (`convert.ts:115`) and can thin a tightly-spaced species to almost nothing before the cross-species cut
   ever sees it. It is not the innocent bystander the old text made it.

Both are real; neither has been observed. **That makes the first task below the whole plan for now** — the
defect is structural in a weaker form than claimed, and it may well be latent at shipping density.

Nothing today detects it either way: the caps are silent, and a missing species looks like terrain that
simply has no cacti.

This is still why the fix belongs here and not inside 02: raising density changes which species round to
zero, it does not stop the rounding.

## Decisions (to settle during the plan)

1. **The guarantee is a FLOOR, not a quota.** Every species with at least one eligible placement in the
   section keeps at least `min(N, its eligible count)` placements, with N small (1–3, config). Above the
   floor, the existing lowest-lottery order continues to rule — vanilla character is preserved, only the
   zero case is outlawed.
2. **"Section" must be named.** The two cap sites have different units — a CELL (`procObjLotteryCap`) and
   the WHOLE MAP (`procObjMax`). A floor per cell is what the user is describing and is the useful one; a
   global floor is nearly meaningless at map scale. Decide whether `procObjMax` gets a per-species floor
   too, or whether the global cut is simply applied after per-cell floors are reserved.
3. **Candidate algorithm — largest-remainder apportionment over species.** Give each species a share of
   the section budget proportional to its eligible count, floor each share at N, then fill the remaining
   budget by the existing lottery order. It is deterministic, needs no RNG, degrades to today's behaviour
   when the budget is not binding, and is the standard fix for exactly this "smallest party gets zero
   seats" problem. One cheaper alternative to weigh against it: a stratified draw (round-robin one per
   species until the budget runs out, then lottery order). ~~Per-species lottery normalisation~~ is struck —
   the draw is already unbiased, see the mechanism section.
4. **Determinism is non-negotiable.** Same seed and same inputs → same placement set, as today. Any
   apportionment must be a pure function of the candidate set.
5. **Make the drop visible.** Whatever the algorithm, log per-section which species were floored and which
   were cut to zero before the fix — the diagnostic is what proves the defect is real and, later, gone.

## SIZED 2026-08-08 — the defect is real, and it is not where this plan looked

`scripts/debug/procobj-species-floor.ts` runs both cap sites with the pipeline's own functions. Numbers in
[Measurements](#measurements--notes); the shape of the answer:

- **Neither BUILD-time cap can zero a species.** MINDIST provably cannot — `cullByMinDistance` starts with an
  empty spatial grid, so the first placement of every non-empty batch always survives; it thins savagely
  (`sjmcacti2` 152 → 2 map-wide) and never to zero. The global `procObjMax` cut zeroed nothing either, and on
  the real converted set it **does not fire at all**: the layer places 15 286 against a cap of 20 000. The
  rounding route zeroed nothing. **So the whole Context section above describes the wrong site.**
- **The RUNTIME cell cap does zero species, in one clutter cell in five.** On stock rules, `procObjLimit` 150
  binds in 98 % of cells that scatter anything and drops at least one eligible species to zero in **19.8 %**
  of them — worst case 14 of 25 species placed, with eight desert `dead_tree_*` variants and the tallgrass
  gone at once. That is exactly the "a desert cell shows only one shrub species" the ask describes.
- **And on the SHIPPING build it is latent — because of the generator, not because the cap is safe.**
  `convertProcObj` strips every converted species from `procobj.dat`, so what still scatters at runtime in
  `build/original/opensa` is **8 underwater rules on one surface**. Over the same geometry those lose
  **zero** species: 8 species share a 150 budget comfortably. The tall species are static instances now, and
  a static instance is never capped.

**What that means for the decision.** The defect is genuine and worth fixing, but nothing in the shipped
`original` build shows it today. It returns the moment either of two things happens: a game that does NOT run
`sa-procobj-placement` (its runtime scatter is the full stock set), or [02](010-density-model.md) raising
density — more candidates per cell is more cap pressure, and the cap is what zeroes.

**DECIDED 2026-08-08 (the user's call): this plan runs AFTER [02](010-density-model.md), re-scoped to the
runtime cell cap alone.** The build-time half is closed as a non-defect and its tasks below are struck. The
plan is not closed as latent — it is sequenced, because 02 is what makes the defect bite in the shipping
build, and building the floor before the density that provokes it would mean tuning a fix against a
population nothing produces yet.

**What 02 must therefore carry away from here:** the moment it raises density it owns this defect. The
measurement to repeat at the new density is the first table below — the same script, same `--stride 3`
sample, so the two runs are comparable — and the number to watch is *cells losing ≥1 species*, not the cap's
binding rate, which is already 97.9 % and says nothing on its own.

## Tasks

- [x] **Reproduce and SIZE the defect first, and nothing else until it reports.** Done — see above and
      [Measurements](#measurements--notes). The split by cause it asked for came out one-sided: MINDIST and
      both build-time cuts zero nothing, the runtime cell cap zeroes plenty.
- [x] Decide the section unit (cell vs global) and the floor N; record why. **Unit DECIDED: the runtime
      CELL, and only it** — the global cut has no zeroing to prevent, so ~~a per-species floor on
      `procObjMax`~~ is struck along with decision 2's second half. N is still open and is 02's to pick,
      against the density it lands on.
- [x] Implement the chosen algorithm behind a config flag, defaulting OFF until the numbers justify it.
      **DONE 2026-08-11** — `procObjCellBudget`, `procObjSpeciesFloor` / `?procobjFloor=<n>`, default 0.
      Not the largest-remainder apportionment decision 3 leaned toward: a reservation + a payment at the top
      of the lottery order is the same guarantee with none of the quota, and apportionment would have
      flattened the skew the reference set says a good scatter has.
- [x] Unit tests: three species with skewed rule densities and a budget of 300 — all three present, and the
      proportions still follow the lottery order above the floor; with the flag off, the placement set is
      byte-identical to today (regression). **DONE** — `procobj-scatter.test.ts`, plus the two multi-surface
      cases the model-not-batch unit needs and a real-scatter regression against the old cut.
- [x] Apply the same rule to `procObjLotteryCap` so the RENDER set and the COLLIDER set agree — the two
      share one budget by design ("what isn't rendered is never collided"), and a floor applied to only one
      of them would break that invariant. **DONE, structurally**: the two paths no longer each compute a
      cutoff, they spend one keep-count array, so agreement is not a rule anyone can forget to apply.
- [x] In-viewer check: a desert cell that previously showed only one shrub species shows its full roster.
      **DONE 2026-08-11, headless, with a passing positive control** — see
      [the field A/B](#the-field-ab-2026-08-11--and-the-first-site-was-a-dead-one) below. The
      `sand_josh2` the cap had zeroed in cell `-5,7` stands in the `?procobjFloor=1` frame and is absent
      from `?procobjFloor=0`; nothing else in the frame moves.

## Verification

- A section with a hard cap and skewed species densities places all eligible species; none reaches zero.
- Flag off → identical output to today (the regression fixture is the guard).
- Render and collider sets still agree placement for placement.
- Determinism preserved: two builds of the same input produce identical placements.

## Measurements / notes

**The sizing run, 2026-08-08** — `scripts/debug/procobj-species-floor.ts`, corpus `game-src/original`
(95 scatter rules on 17 surfaces, 562 populated 250 u cells), collision and map defs from the same tree.
Both modes call the shipping functions (`scatterProcObjects`, `procObjLotteryCap`, `cullByMinDistance`), so
these are the pipeline's numbers, not a model's.

### Runtime cell cap — `procObjLimit` 150, density 1

| Rule set | Cells sampled | With clutter | Cap binding | Cells losing ≥1 species |
| --- | --- | --- | --- | --- |
| stock `procobj.dat` (95 rules) | 188 (stride 3) | 96 | **94 (97.9 %)** | **19 (19.8 %)** |
| the SHIPPING set — `build/original/opensa/data/procobj.dat` (8 rules) | 188 | 11 | 11 (100 %) | **0** |
| **stock, RE-MEASURED after the column fix** (2026-08-09) | 188 | 96 | **56 (58.3 %)** | **17 (17.7 %)** |
| **the SHIPPING set, re-measured** (built tree of 2026-08-09 13:53) | 188 | 11 | 8 (72.7 %) | **0** |

**The re-measure was the gate on this whole plan, and the plan survives it unchanged.** The 2026-08-09
`procobj.dat` column fix reads SPACING as a length, which cuts CANDIDATES per cell by roughly an order of
magnitude, so the runtime cell cap now binds in **58.3 %** of clutter cells rather than 97.9 %. The defect it
causes barely moved: **17.7 % against 19.8 %**. That is the plan's own finding restated by an independent
change — *what kills a species is not total pressure but how many species compete in one cell*, and the fix
changed the pressure without changing the competition. Worst cell today is `8,-3` at **16 of 23** species
placed (was `-10,-8` at 14 of 25).

Two things follow. The task is **neither killed nor made urgent** — its size, its shape and its priority band
are what they were. And it stays **latent on what we ship**: the shipping set still loses zero species,
because the tall species are static instances and a static instance is never capped.

Most-often zeroed on stock, by cells: `dead_tree_3` 7, `dead_tree_6` 7, `dead_tree_2` 6, `dead_tree_5` 6,
`dead_tree_8` 6, `dead_tree_9` 6, `dead_tree_7` 4, `genveg_bush13` 4, `rockbrkq` 4 — 18 species in all.
Worst cells: `-10,-8` (~−2375, −1875) places **14 of 25** eligible species, losing eight `dead_tree_*` plus
two tallgrasses and a bush; `-4,-4` places 13 of 23; `-2,-7` loses nine species worth 268 instances.

The cap binds almost everywhere and costs nothing most of the time — what decides whether a species dies is
how many species compete in the cell, which is why 8 underwater rules are safe and 25 desert ones are not.

Self-check in the script: **binding ⇒ the cell draws exactly `limit`; not binding ⇒ it draws everything
vanilla would.** It failed on one cell first time and the rig was wrong, not the engine — a cell can hold
more than `limit` candidates and still have its 150th lottery above 1, in which case density is the cutoff
and the cap costs nothing.

### Build-time pass — whole-map colliders, `procObjMax` 20 000, all 95 rules

7019 collider groups → 51 batches → **20 265 placed, cut to 20 000** (the cut binds by 1.3 %; on the real
converted set it does not fire at all — the layer places 15 286).

| Zeroed by | Species |
| --- | --- |
| the `lottery < 1` cut (rounding) | **0** |
| MINDIST | **0** — and it *cannot*: `cullByMinDistance` starts with an empty grid, so a non-empty batch always keeps its first placement (asserted by the script) |
| the global `procObjMax` cut | **0** |

MINDIST is nonetheless where the population goes: `sjmcacti2` 485 candidates → 152 vanilla → **2** after
MINDIST; `sm_des_pcklypr1` 336 → 113 → **2**; `veg_pflowers03` 14 431 → 4869 → **70**; the eight
`dead_tree_*` land on 140–149 each. A rare species is rare because of its MINDIST column, not because a cap
took it.

### The shipping rule set, re-measured 2026-08-11 — the row that killed the "latent" verdict

| Rule set | Cells sampled | With clutter | Cap binding | Cells losing ≥1 species |
| --- | --- | --- | --- | --- |
| stock `procobj.dat` (95 rules) | 188 (stride 3) | 96 | 56 (58.3 %) | **17 (17.7 %)** |
| `build/original/opensa/data/procobj.dat` — **95 rules**, no bake since 2026-08-10 | 188 | 96 | 56 (58.3 %) | **17 (17.7 %)** |

The shipping set is now the stock set. The 8-underwater-rules row in the table above is the pre-2026-08-10
build and says nothing about what runs today.

- floor N chosen + why: **1**, and OFF by default. 1 is the smallest number that satisfies the ask, removes
  the defect completely on this corpus (17.7 % → 0), and costs 0.32 % of the drawn placements; 2 and 3 remove
  nothing further at 3× and 6× the price. It stays OFF because what it changes is the PICTURE and nobody has
  judged that picture yet.
- proportion shift against vanilla (how much character the floor costs): **35 of 10 825 drawn placements
  traded at N=1** (0.32 %), 104 at N=2, 197 at N=3. The budget itself never moves — every rescued placement
  is paid for by the highest-lottery placement that survived, so the shift is entirely from the abundant
  species to the rare ones, which is the trade the plan is asking for.
