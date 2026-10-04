# 008 — Which limit do we lift, and who lifts it? (CLOSED)

> **Moved here 2026-08-09 from `docs/roadmap/0.5.0/plans/07-lod-generators-extended/sa-procobj-placement/00`,
> closed with no live work left.** It was a go/no-go review, and its answer is what governs every ceiling this
> tool's output crosses, so it belongs beside the tool rather than in a chain of unbuilt plans. The answer
> shipped in three places: the target split (`--target`, `checkTextIplBudgets`, see
> [perfect-map-builder/003](../../../perfect-map-builder/docs/plans/003-target-split-and-budget-guards.md)),
> the rule in [`restrictions/sa-target.md`](../../../../docs/restrictions/sa-target.md), and the captured
> install in [`gta-sa-original/reference-install.md`](../../../../docs/gta-sa-original/reference-install.md).
>
> **Its two remaining tasks were struck the same day, both for the same reason** — slots stopped being a
> currency when stock SA stopped being a target (`EntityIpl = unlimited` on the install we ship to):
> *"verify the FLA slot-lift claim"* and *"measure the folding hygiene win"* would each have bought slots
> that are not scarce. The other two open lines ("write the decision into this file", "amend 04") are done —
> this banner is the first and [04](013-density-budgets-per-target.md)
> was rewritten per target on 2026-08-08.
>
> **One number below is now known to be a defect rather than a baseline.** Everything costed against "our
> layer places 15 286 objects" was costed against a misread of `procobj.dat`; the layer places **91 092** at
> the authored density ([009](009-procobj-dat-columns-as-the-game-reads-them.md)). The int16 conclusion
> survives — it gets stronger, since the crossing now happens without any density profile at all.

**A go/no-go review, not an implementation plan — and
the P0 of the whole density chain.** It runs BEFORE [04](013-density-budgets-per-target.md), because 04 assumes
the answer — it is written as "gated on Task 3, our own ASI" — and that assumption has never been argued
against the alternative the user raises: **a real SA install will definitely have FLA and OLA anyway.**

~~Nothing here should be built until this review closes.~~ **CLOSED 2026-08-08 by the user's scope call, not
by this review's own argument: stock SA is not a target.** The shipping configuration is OLA + FLA for the
pools and slots plus our own `perfect-map.asi` for int16 — the one ceiling no adjuster lifts
([`gta-sa-original/reference-install.md`](../../../../docs/gta-sa-original/reference-install.md)). That answers
the question in the title, so the density chain is unblocked and
[04](013-density-budgets-per-target.md) is rewritten around two targets, `sa` and `opensa`. **Everything below
is the record of how the question was costed, and its stock arithmetic is no longer a constraint to plan
against** — read it for the int16 story, not for the slot one. What survives as work is the asi's own
shipping and verification story, which is `asi/perfect-map`'s chain, not this one.

**Since 2026-08-07 the review has a TARGET to cost and a real corpus to test against.**
[density-target.md](../density-target.md) fixes the aiming point at **57 583 placed objects** (ProperFixes
2.2.1's vegetation set — a shipping mod, not a number we invented) and prices it. Read it before answering
anything below.

> **Re-measured 2026-08-08, and the price changed.** Our layer places **15 286** objects, not the 24 552 this
> review was costed against — that figure was the generated streams' RECORD count
> ([`procobj-layer-census.ts`](../../../../scripts/debug/procobj-layer-census.ts)). The target is therefore
> 3.77× rather than 2.35×, it costs **24 437** permanent rows rather than 16 312, and map-wide it lands at
> **38 096 — over the int16 ceiling**. So the conclusion below that "the int16 lift is not on the critical
> path" is **wrong**: on stock the target misses on rows AND slots, and on the reference install int16 is the
> only ceiling left standing, because it is the only one no adjuster lifts. Route 3 is not a hedge, it is the
> gate. What does NOT change: slots bind FIRST — at ~18 000 objects, 1.18× today — so the stock target's real
> headroom is 18 %, and everything past that needs the adjusters plus our ASI.

## Field run, 2026-08-07 — a clean A/B on someone else's 70k-row map

The user ran the test this review asked for, on the real game, and the install has since been captured in
full ([`gta-sa-original/reference-install-config.md`](../../../../docs/gta-sa-original/reference-install-config.md))
— so the configuration is no longer a report, it is a record. **FLA and OLA were BOTH loaded throughout**
(our own `perfect-map-asi.log` names both), with OLA owning the IPL zones and FLA's entire `[IPL]` section
disabled. A pool-raiser being present is required rather than incidental: [004's pivotal correction](../../../../asi/perfect-map/docs/plans/004-limit-patches.md)
records that the int16 bug **cannot manifest at all** without a pool-raiser, because stock `CBuilding` is
13 000 and a no-adjuster boot dies first at `0x5381A5`. So OLA is the floor the experiment stands on, and
holding it constant while toggling only the int16 patch is what makes this a single-variable A/B rather than
an observation:

| Configuration | Result |
| --- | --- |
| ProperFixes 2.2.1 **with** the vegetation optional, FLA+OLA, `ProperFixes.asi` REMOVED | **ghost barriers reproduced** |
| the same, FLA+OLA unchanged, **`perfect-map.asi`** in place of it | **barriers gone, and the new-game 2dfx crash gone** |

That is **70 212 permanent text rows — 2.14× the int16 ceiling — on a third-party corpus with real
positions**. Everything fix #1 had been proven on before was ours: the 33k synthetic repro dial and our own
30 566-row monolith. And the 2dfx half is 009's `FxSystem_c` guard confirmed on data nobody here authored
(the reported symptom was the new-game crash, i.e. `0x004AA3A1`).

**What it decides.**

- **Route 3 is no longer a bet** — for the int16 ceiling our patch is demonstrated at more than twice the
  limit on a foreign map, with the pool-raiser held constant across both arms.
- **OLA does not lift the int16 ceiling.** It was present in the failing arm too. This review's central
  premise stands, and 004's source study of OLA already predicted it (`0x404B4A` is byte-stock in OLA).
- **Neither route is sufficient alone, and that is the real answer to question 2 below.** The shipping
  configuration for a dense map is **OLA (or FLA) for the pools and slots, PLUS our ASI for int16** — until
  `004b` builds our own pool/array relocations. An external dependency is not a preference here; it is
  currently load-bearing, and the stock-target promise has to say so.
- **004's open item is closed, with a log line rather than an inference** — "our APPLY build still DEFERRED
  with OLA present". `perfect-map-asi.log` reads `int16 APPLIED` **and** names both adjusters as present, so
  the per-site diagnostic 004 asks for is unnecessary.

**What it does NOT decide.** **Slots were never stressed.** ProperFixes occupies 6 IPL slots and the install
runs 36 of 40, so `IplEntityIndexArrays` was not exercised. That turns out not to matter — see below.

## And then the install answered the rest of the review

Capturing the reference install closed the remaining questions from its ini files, without another field run:

- **`EntitiesPerIpl = unlimited`** — OLA grows `gpLoadedBuildings`, the 4 096 per-file buffer our
  `AREA_MAX_PAIRS = 2000` guards. **That is why ProperFixes' 9 627-row IPL files load**, and it means our cap
  is a stock-target cap that is simply inert here. Nothing was wrong with our model of the ceiling; the
  target does not have the ceiling.
- **`EntityIpl = unlimited`** — the 40-slot array, gone too.
- **`Buildings = 100000`** (stock 13 000) — which is what lets 72 914 rows exist at all.

**So the binding ceiling this review spent its length identifying does not exist on the install we ship to.**
Both remaining routes collapse into one answer: **the reference target needs the adjusters AND our ASI**, and
past that the limiter is memory and frame time. `004b` (our own pool/array relocations) stops being a
prerequisite for density and becomes what would free us from depending on someone else's plugin.

**One correction to that, from the 2026-08-08 re-measurement**: "past that the limiter is memory and frame
time" holds only up to ~45 000 objects. The target's 57 583 costs 38 096 map-wide permanent rows, and int16
is the ceiling those rows hit — the one OLA leaves in place. Between the slot wall and the frame budget there
is a third wall, ours to lift, and the target sits above it.

## The question

Three ways to place more procobj than vanilla limits allow:

| # | Route | Cost |
| - | ----- | ---- |
| 1 | Keep the current work-around (binary streams + budgets + `checkTextIplSlotBudget`) | already built and shipping; caps our density |
| 2 | Depend on **FLA + OLA** (user-installed limit adjusters, present on any modded install) | zero engineering for us; a hard external dependency |
| 3 | Our own **`asi/perfect-map`** | we own it; fix #1 done, #2/#3 (`004b`) not |

04 currently assumes 3. The user's point is that 2 is free. So: what does each route actually buy?

## Measured starting state

Before arguing, the numbers — because the whole discussion turns on how close we really are. Two runs, and
the second supersedes the first (they measured different trees: `build/original/sa` then, the canonical
`build/original/opensa` now):

| Limit | 2026-07-28 | **2026-08-07** | Ceiling | Build guard | Headroom now |
| ----- | ---------- | -------------- | ------- | ----------- | ------------ |
| int16 `IplDef` — permanent TEXT rows map-wide | 25 461 | **20 146** | 32 767 | 30 000 | 9 854 to the guard |
| `IplEntityIndexArrays` — gta.dat IPL slots with `inst` | 37 | **38** | 40 | 39 | **ONE slot** |
| per-area `LoadScene` rows (text + binary) | worst 3 822 | — | ~4 096 | `AREA_ROW_CAP` 4 000 | 4 % |

Generated procobj today (**re-measured 2026-08-08** by
[`procobj-layer-census.ts`](../../../../scripts/debug/procobj-layer-census.ts)): **15 286 placed objects**
— 6 487 of them tall enough for a permanent text LOD row (`plobj0..7`, 8 slots), the other 8 799 riding the
binary streams with their LOD unlinked. The 51 stream tiles hold **24 552 records** in total: those 15 286 HD
plus 8 799 LOD plus 467 tree impostors that share the `plotr0` overflow area. 43 species, no TXDs of its own
(the no-`--in` mode reuses the game's own models and textures). Per-area totals sit just under the 4 000-row
budget — that is what created seven areas beyond the first.

The three numbers this paragraph used to carry — 6 954 rows, "24 552 instances", 63 models — each counted
something adjacent: the trees' overflow rows folded into ours, stream RECORDS read as objects, LOD defs read
as species. See [density-target.md](../density-target.md).

**The finding that reframes everything: the binding constraint is SLOTS, not the int16 row ceiling.** We have
9 854 rows of headroom to the guard and **one IPL slot**. Any meaningful density increase needs more
generated areas, and we run out of slots long before we run out of rows.

This also explains why installing this build without any ASI shows no ghost barriers, and never could:
the bug needs >32 767 permanent text rows and the build guard fails at 30 000. The work-around is doing
exactly its job.

## What each route actually covers

The decisive fact is already recorded in [ghost-barriers.md](../../../../docs/open-issues/fixed/ghost-barriers.md)
and must not be re-litigated:

> Raising pools (FLA/OLA) **cannot** help: the int16 lives in the `IplDef` struct itself and **no limit
> adjuster exposes it**.

So the two limits fall on opposite sides:

| Limit | FLA/OLA | our ASI |
| ----- | ------- | ------- |
| `IplEntityIndexArrays` (40 slots) — **the binding one** | **YES** — FLA's `[IPL] Entity index array` | fix #2/#3, plan `004b`, NOT built |
| per-area `LoadScene` budget (~4 096 rows) | YES (pool/array relocation) | `004b`, NOT built |
| int16 `IplDef` row ceiling | **NO — structurally impossible** | **YES — fix #1, DONE; confirmed in-game, and on a foreign 70k-row map (2026-08-07)** |

Read together with the measurement, that is close to an answer:

- The limit we are actually about to hit (**slots**) is the one FLA already lifts and our ASI does not.
- The limit our ASI uniquely lifts (**int16 rows**) is the one we have 9 854 rows of headroom on — and,
  since the 2026-08-07 field run, the one it is demonstrably good for well past the ceiling.

## What to decide

1. **Does raising density need the int16 lift at all, or only the slot lift?** Estimate the row and slot
   cost of the 02/03 density profiles first. If more density mostly adds BINARY instances (which cost no
   text rows) and a handful of areas, the answer is "slots only" — and our ASI is not on the critical path
   for 0.5.0 density at all.
2. **Is an external dependency acceptable for the shipped product?** FLA is free but it is the user's to
   install, it can be absent or the wrong build, and the same doc records that **FLA×OLA double-patching
   the same LoadScene/IPL zones boot-crashes in `LinkLods`** — "exactly ONE adjuster may own IPL limits".
   Depending on a specific adjuster configuration is a support surface we currently do not have.
3. ~~**Is there a cheaper route than either?**~~ **CLOSED 2026-08-07 — folding cannot buy the target.** The
   idea was to fold the generated areas into fewer, larger `plobj` files the way `mod-installer` folds mod
   IPLs (`ipl-slot-merge.ts`), and buy the headroom with no ASI and no FLA. It does not work, and the reason
   is arithmetic rather than judgement: **area count is set by the ~4 000-row per-area `LoadScene` budget,
   not by how the files are grouped.** The target's 57 583 HD rows + ~16 312 LOD rows is ≥ 19 areas against
   the 9 we ship; fewer files simply means areas that breach the budget. Folding remains worth doing as
   HYGIENE (our 9 areas average 3 501 rows, so a repack could recover one or two slots) — it is not a route
   to density. See [density-target.md](../density-target.md).
4. **What does the stock target promise?** Today it is "runs on unmodded SA 1.0". If density ships gated
   on FLA, that promise needs restating.
5. ~~**What is ProperFixes actually getting away with?**~~ **ANSWERED 2026-08-07 in the field.** Its
   vegetation set is 57 583 permanent text rows on top of stock's 12 629 — **70 212 map-wide, 2.14× the
   int16 ceiling** — and the question was whether (a) OLA lifts the truncation, or (b) its users carry
   latent ghost barriers. **It is (b) plus its own `.asi`:** strip `ProperFixes.asi` and the barriers appear
   on its data. **OLA does not lift the int16 ceiling** — this review's central premise stands, and 004's
   source study of OLA already said so (`0x404B4A` is byte-stock in OLA). What lifts it is a dedicated
   patch: theirs, or ours. **Route 2 is therefore NOT free for int16.** It stays free for slots and pools,
   which is all it ever covered.
6. **Is our per-area row budget too tight by 2.4×, and does that dissolve the slot problem?** Their IPL files
   carry ~9 597 rows each against our `AREA_ROW_CAP` of 4 000, and they ran clean. If a file that size is
   genuinely safe, the density target is ~6 slots rather than ≥ 19 areas and the binding ceiling this review
   found simply goes away. **Do not conclude it from this run** — their rows are pure text with no LODs and
   no binary streams, ours are mixed, and `AREA_ROW_CAP` models a `LoadScene` budget that may not be
   per-file at all. It is now the highest-value measurement in the chain, and
   [04](013-density-budgets-per-target.md) is where it belongs.

## Tasks

- [x] Cost the density profiles in ROWS and SLOTS (not just object counts) — the number that decides whether
      the int16 lift is on the critical path. **Done 2026-08-07, redone 2026-08-08 off a self-checking
      census**: at the target, rows land at 38 096 (over the 32 767 ceiling) and slots at 59 (over 40) — it
      misses on BOTH, and the int16 lift **is** on the critical path. Slots still bind first, at 1.18× today.
      [density-target.md](../density-target.md) carries the arithmetic and the intermediate walls.
- [x] Test option 3 (fold generated areas into fewer files). **Closed** — see decision 3 above.
- [x] **Install ProperFixes 2.2.1 + its vegetation optional on the real game and look for ghost barriers.**
      **Done 2026-08-07, and it answers decision 5 in our favour** — the bug reproduces on its data without
      `ProperFixes.asi`, and `perfect-map.asi` fixes it (plus the 2dfx new-game crash). See the field-run
      section above, including the one thing that still has to be checked about the configuration.
- [x] **Name what was loaded during that run. Answered: OLA, alongside `perfect-map.asi`** — which is the
      only configuration in which the bug is reproducible at all, and which makes the run a single-variable
      A/B. It also **closes 004's deferred-with-OLA open item**: #1 applied and worked with OLA present.
- [~] ~~Verify the FLA claim on a real install~~ — **STRUCK 2026-08-08**: `EntityIpl = unlimited` on the target,
      so the 40-slot ceiling it would lift is not a ceiling we ship against.
- [~] ~~Measure the folding hygiene win separately~~ — **STRUCK 2026-08-08** for the same reason: it buys
      SLOTS, and slots stopped being a currency when stock stopped being a target.
- [x] Write the decision into this file, then amend [04](013-density-budgets-per-target.md)
      to match. **Done 2026-08-08** — 04 was rewritten per target and stopped being a slot-economy plan.
- [x] State what the answer costs the stock-target promise. **Done** — stock is a REPORT, not a mode
      (04 decision 8): the build says what the artifact needs and what it would breach on a plain 1.0, and
      never rations the install we do ship to. `asi/perfect-map` `004b` stops being a density prerequisite
      and becomes what would free us from depending on someone else's plugin.

## Verification

The review is closed when the plan can name, with measurements: which limit the target density hits FIRST,
which route lifts it, and what that route costs the user's install.

## Measurements / notes

- 2026-07-28 baseline (`build/original/sa`): 25 461 rows / 37 slots.
- **2026-08-07 baseline (`build/original/opensa`, the canonical tree): 20 146 rows / 38 slots.** Slots are
  the number to watch — headroom is ONE against the build guard.
- ~~2026-08-07, target costed: 57 583 objects needs ~16 312 text rows (map-wide 29 504, fits) and ≥ 19 areas
  (slots 48 vs a 40 ceiling, does not fit).~~ **Superseded — priced off a baseline that was 61 % too high.**
  Area folding stays closed as a route.
- **2026-08-08, our layer re-measured** (`procobj-layer-census.ts`, both identities check): **15 286 placed
  objects**, 6 487 permanent rows in 8 slots, 24 552 stream records, 43 species. Plus 816 stock hand-placed
  instances of the same species outside the layer.
- **2026-08-08, target re-costed:** 3.77× → 24 437 text rows (map-wide **38 096**, over the int16 ceiling by
  5 329) and 29 areas (slots **59** vs 40). Walls on the way: slots at ~18 000 objects (1.18×), the build
  guard at ~38 500 (2.52×), int16 at ~45 000 (2.95×).
- **2026-08-07, reference measured:** ProperFixes 2.2.1 places 57 583 rows in 6 slots, 46 models, every row
  `lod = -1`, and requires OLA. 8.3× our row cost per object.
- **2026-08-07, FIELD:** ProperFixes 2.2.1 + vegetation optional (70 212 map-wide rows, 2.14× the int16
  ceiling) on the real game, **OLA loaded in both arms**. `ProperFixes.asi` removed → ghost barriers
  reproduced. `perfect-map.asi` in its place → **barriers gone AND the new-game 2dfx crash gone.** One
  variable, so: OLA does not lift int16; our patch does, on a foreign map. Slots untouched (6 in use).
- _(FLA slot-lift verification — pending)_
- _(folding hygiene win — pending)_
