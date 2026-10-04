# The density target — what a shipping mod actually places

> **Research record, moved here 2026-08-09** from the dissolved roadmap chain
> `07-lod-generators-extended`. It is the input to [010](plans/010-density-model.md) /
> [013](plans/013-density-budgets-per-target.md), not a plan of its own.

The procobj chain says "more procobj" without ever naming a NUMBER,
so every plan under it has been tuned against a feeling. This file fixes the target against a real, shipping
reference and costs it in the two currencies that decide whether it can ship: **permanent text-IPL rows** and
**gta.dat IPL slots**.

Everything below was read off a run — the reference off `NO_COMMIT/ProperFixes 2.2.1` on **2026-08-07**, our
side re-measured off `build/original/opensa` on **2026-08-08** by
[`scripts/debug/procobj-layer-census.ts`](../../../scripts/debug/procobj-layer-census.ts). Nothing here
is derived from a diff or from an older doc.

> **Our half of this file was wrong until 2026-08-08, and the correction inverts its conclusion.** The
> first pass quoted **24 552** as "objects placed"; that is the total RECORD count of the generated binary
> streams — HD plus the LOD of every short placement plus 467 tree impostors sharing the areas. The layer
> places **15 286** objects. Every ratio below was re-derived from the measured number, and the target that
> "fits in rows and misses by ~10 slots" in fact **misses both**. The census is a script now, and it checks
> itself, because this number decides the whole chain.

## The reference: ProperFixes 2.2.1, "(optional) increase vegetation distance"

Junior_Djjr / MixMods. It solves exactly our problem — far more ground clutter than vanilla — and it solves
it the opposite way, which is what makes it useful.

| What | Value |
| --- | --- |
| Static instances placed | **57 583** |
| Files / gta.dat IPL slots | 6 (`procobj1..6.ipl`, 9 520–9 627 rows each) |
| Distinct model ids | 46 |
| Rows carrying a LOD link | **0** — every row is `lod = -1` |
| `procobj.dat` shipped alongside | a REPLACEMENT with 14 rules left, all `P_UNDERWATERBARREN` |

The last row is the mechanism: the mod **deletes the land scatter from `procobj.dat` and re-ships it as
static IPL rows**, keeping only the underwater rules procedural. That is the same trade our
`sa-procobj-placement` makes (`procobj-strip.ts` / `--modloader` disable rows) — placement moves from
runtime to build time. The difference is entirely in the LAYOUT of what comes out.

Its own header states the price: _"Requires increased game limits (included in Proper Fixes and Urbanize)
otherwise will lag and crash"_, and the suite's readme: _"REQUIRES Open Limit Adjuster (or well configured
f92la)"_.

The distribution is heavily skewed — ids 865 and 866 alone are **22 863 rows, 40 % of the whole set**, and the
tail runs down to a couple of hundred. Worth carrying into
[01 — species representation](plans/012-species-representation-floor.md): a hand-tuned
reference set is this lopsided on purpose, so "every species survives" is a floor argument, never an
equal-share one.

## Our side, same day

| What | Value |
| --- | --- |
| Procobj objects placed (HD) | **15 286** |
| Records in the 51 binary stream tiles | **24 552** = 15 286 HD + 8 799 unlinked LOD + 467 tree impostor |
| Permanent text LOD rows | **6 487**, across 8 text IPLs (`plobj0..7`) |
| **Objects per permanent text row** | **2.36** |
| Species converted | **43** (48 LOD defs in `lod_procobj.ide`) |
| Map-wide permanent text `inst` rows | **20 146** / 32 767 ceiling (pmb guard 30 000) |
| gta.dat IPL slots carrying `inst` | **38** / 40 ceiling (pmb guard 39) — 8 of them procobj |

Three of those rows were quoted wrong before the census existed, and each error pushed the same way — the
layer looked cheaper per object than it is:

- **24 552 is a record count, not an object count.** A TALL placement spends one binary HD record plus one
  permanent text row; a SHORT one spends two binary records and no text row (`linkedHeight = 4`,
  `buildStreamedIpl`). Linked 6 487 + unlinked 8 799 = 15 286 objects, and the census asserts both identities.
- **`plotr0` is the TREES' overflow area, not ours.** Its 467 rows are impostors from `lodtrees.ide`; folding
  them in inflated the layer's text cost by 7 % and its slot count by one.
- **43 species, not 63 models.** The 48 defs in `lod_procobj.ide` are LOD stand-ins, not placed species.

The census also turned up a number no plan had: **816 instances of the converted species are hand-placed by
the stock map, outside the generated areas.** No density knob moves them, and counting the layer by MODEL ID
instead of by file silently adopts them — which is exactly what the first version of the script did.

Note the two numbers that moved since [00's](plans/008-limit-route-review-closed.md) 2026-07-28
baseline (which measured `build/original/sa`, a different tree): rows are **down** 25 461 → 20 146, slots are
**up** 37 → 38. Headroom is now **12 621 rows and TWO slots** — one, against the build guard.

## The comparison that matters

| | ProperFixes | ours | ratio |
| --- | --- | --- | --- |
| Objects placed | 57 583 | 15 286 | **3.77× more** |
| Permanent text rows spent on them | 57 583 | 6 487 | **8.9× more** |
| Permanent rows PER OBJECT | 1.000 | 0.424 | theirs costs **2.36×** ours |
| IPL slots spent | 6 | 8 | 0.75× |

**Their density is 3.77× ours; their row cost per object is 2.36× ours.** The `linkedHeight` binary-stream
economy is doing what it was built for — at an equal row budget our layout places 2.36× what theirs does —
but the earlier "8.3×" read the ratio of TOTALS as a ratio of costs, and the real edge is less than half
that. It is still the [directive-3](../../../docs/project-goals.md) case where we are already ahead, and the
plans below must not trade it away to buy density; it is a thinner lead than the chain was told.

### Costing the target: 57 583 objects, our layout

> **This section prices the target against STOCK ceilings, and stock is NOT a target of this project**
> (settled 2026-08-08: the declared configuration is OLA + FLA plus our own `perfect-map.asi` —
> [reference-install.md](../../../docs/gta-sa-original/reference-install.md)). Kept as the record of what those
> ceilings cost, and because the build guards still enforce some of them until
> [04](plans/013-density-budgets-per-target.md) splits them by target. **Do not plan against
> the slot and per-area numbers below** — they are `unlimited` where we ship.

Scale our current mix by **3.77×** and it costs **90 728 binary stream records + 24 437 permanent text LOD
rows**, in **29 areas** (`AREA_MAX_PAIRS = 2000` pairs per area).

- **Rows: it does NOT fit.** Map-wide permanent text becomes `20 146 − 6 487 + 24 437 = ` **38 096** —
  **5 329 over the 32 767 int16 ceiling** and 8 096 over the build guard. The int16 lift is back **on** the
  critical path for this target, and it is the one ceiling [00](plans/008-limit-route-review-closed.md)
  proved no adjuster provides.
- **Slots: it does not fit either, and by more than was thought.** 29 areas against the 8 the layer ships
  takes slots 38 → **59**, against a ceiling of 40.

Two intermediate numbers the chain never had, and they are what 02/03 should actually be tuned against:

| Wall | Binds at | Density |
| --- | --- | --- |
| **Slots** (guard 39 → 9 procobj areas) | **~18 000 objects** | **1.18×** — all a STOCK target can grow |
| Permanent rows, build guard 30 000 | ~38 500 objects | 2.52× |
| Permanent rows, int16 ceiling 32 767 | ~45 000 objects | 2.95× |
| The target | 57 583 objects | 3.77× |

So on stock the layer is within 18 % of its ceiling today — which is the same answer
[00](plans/008-limit-route-review-closed.md) reached (slots bind first), reached at a much lower
density than the old arithmetic implied. And past the slot wall the NEXT wall is int16, not perf.

That still closes [00's](plans/008-limit-route-review-closed.md) open option 3 ("fold the generated
areas into fewer, larger files") **with a number rather than a hope: folding cannot buy this target.** The
area count is set by the ~4 000-row per-area `LoadScene` budget
([sa-runtime-limits](../../../docs/edge-cases/sa-runtime-limits.md)), not by how the files are grouped, so
fewer files means areas that breach it.

### What ProperFixes is actually paying

Its 57 583 rows land on top of stock's 12 629 permanent rows, i.e. **70 212 map-wide — 2.14× the int16
ceiling** — and its 9 597-row files are **2.4× the per-area `LoadScene` budget**. Both are ceilings our own
[ghost-barriers record](../../../docs/open-issues/fixed/ghost-barriers.md) says are structural.

**Field-tested 2026-08-07, and the answer is its own `.asi`.** With OLA loaded throughout — it has to be,
since the int16 bug cannot manifest without a pool-raiser — removing `ProperFixes.asi` makes the ghost
barriers appear on its data, and putting **`perfect-map.asi`** in its place removes them again, along with the
new-game 2dfx crash. One variable across the two arms, so: **OLA does not lift the int16 ceiling**, and our
own patch carries a foreign 70k-row map where everything it had been proven on before was ours. The shipping
configuration is therefore BOTH — an adjuster for the pools and slots, our ASI for int16. Details in
[00](plans/008-limit-route-review-closed.md).

**And their 9 627-row IPL files are explained too, which retires the SLOT half of the arithmetic above.** OLA
sets **`EntitiesPerIpl = unlimited`** on that install — it grows exactly the `gpLoadedBuildings` per-file
buffer our `AREA_MAX_PAIRS = 2000` guards — and **`EntityIpl = unlimited`**, which removes the 40-slot
ceiling. So the "29 areas, 59 slots" cost priced earlier is the **stock** cost; on the install we ship to
there is no per-file ceiling and no slot ceiling to pay it against. Our cap was never wrong, it is just inert
here. Capture:
[`gta-sa-original/reference-install-config.md`](../../../docs/gta-sa-original/reference-install-config.md).

### Could a STOCK build do what ProperFixes does? No — and not because of our layout

Re-checked against the mod on 2026-08-08, because "they ship 3.77× of what we do, so why are we capped at
1.18×?" is the obvious question and it deserves an arithmetic answer rather than a doc reference.

- **Their six files are 9 520–9 627 rows each — 2.4× SA's 4 096-slot `LoadScene` buffer.** On a stock install
  those files are the ghost-barrier corruption, not a density. They fit because OLA sets
  `EntitiesPerIpl = unlimited`, which is why the suite's readme REQUIRES it. So their 6 slots are not a
  layout we could copy; they are a ceiling we would have to remove first.
- **Priced legally, their own layout does not reach the target on stock either.** At the 4 096 budget a
  LOD-less text layout holds ~4 096 objects per file, so 57 583 objects need **15 slots**. Stock has
  **one** free. The wall is not our efficiency — it is that the base map plus our other generators already
  spend 38 of the 39, and procobj holds 8 of them.
- **Our objects cost two rows each against that same buffer, theirs cost one.** A linked pair spends a
  permanent text LOD row plus a binary HD row; an unlinked pair spends two binary rows — and the buffer takes
  an area's text rows *and* its streams together
  ([sa-runtime-limits](../../../docs/edge-cases/sa-runtime-limits.md)). So an area carries ~2 000 of our
  objects where it would carry ~4 096 of theirs. **That is the same 2.36× rows/object advantage read from the
  other side**: we win on the map-wide permanent-row budget and pay for it in per-area capacity, because our
  objects carry LODs and theirs carry none (`lod = -1` throughout).

So on stock the 1.18× is real and it is not a consequence of how we split areas. It follows from one free
slot and ~2 000 objects per area, and no layout available to us moves it: fewer, larger files breach the
per-file buffer; more files breach the slot array. **The lever that exists on stock is elsewhere — the ~30
slots the base map itself spends** (mod-installer already compacts `int_cont` + `gen_int1` down to 28). That
has never been costed, and it is the only thing that would make stock a density target at all.

**What that leaves as the real constraint on this target: int16, then memory and frame time.** This is where
the corrected baseline changes the answer. At 38 096 map-wide permanent rows the target clears the int16
ceiling by 5 329, and int16 is the one thing OLA demonstrably does NOT lift — so the target is reachable
**only with `perfect-map.asi` present**, exactly as ProperFixes is only shippable with its own. Our ASI is
load-bearing for this target rather than optional, which is the opposite of what this file said for a day.
[04](plans/013-density-budgets-per-target.md) is therefore a perf-budget plan **above** an
int16-gated target, not a perf-budget plan instead of a ceiling story.

## RE-DERIVED 2026-08-11 — the target is behind us, and the file below is history

**This is the re-derivation the 2026-08-09 note above asks for, off the rebuilt layer's own counts.** Read
this section first; everything after it is the record of how the aiming point was arrived at, stated against
the 15 286-object defect, and **no ratio below this line is current**.

| What | ProperFixes 2.2.1 | ours, cutoff 1.0 | |
| --- | --- | --- | --- |
| Static objects placed | 57 583 | **91 379** | **1.58× the reference** |
| Permanent rows per object | 1.000 | **1.000** | identical since plan 014 dropped the LOD twin |
| Rows in the largest area file | 9 520–9 627 | **9 109–9 110** | the same file shape, reached independently |
| Area IPL slots the layer spends | 6 | **10** | of SA's 40; the whole map spends **39** |
| Map-wide permanent `inst` rows | ~70 212 | **110 055** | both far past int16 — `perfect-map.asi` is load-bearing for either |
| Top-2 species' share | **40 %** of 46 | **42.0 %** of 56 | the hand-authored skew, unaided |

**Three things this settles.**

1. **The 57 583 aiming point is met and passed at the AUTHORED density**, so it is no longer a target — it is
   a sanity check that we are in the right range, and we are 1.58× above it. Nothing in the chain should
   quote a multiplier against it again.
2. **"Distribution beats total" is satisfied without a profile.** The qualification this file put on the
   target — that the reference's 40 %-in-two skew is a hand-authored look our profiles would have to *earn*
   — turns out to be earned by `procobj.dat`'s own spacing column against the map's own surface mix. That is
   what closed [02](plans/010-density-model.md)'s shipped-profile task at `base: 1` on 2026-08-11.
3. **Our per-object efficiency edge is GONE, and that is fine.** This file's headline advantage was 2.36×
   rows per object, bought by the binary-stream LOD economy. Plan 014 deleted that economy on purpose
   (a stream's IPL slot is not resident past ~190 m, so it could never carry the range), and both layouts now
   cost exactly one permanent row per object. We are ahead on COUNT and level on cost.

**What is NOT re-derived here:** the per-area/`LoadScene` and slot arithmetic further down still prices the
target against STOCK ceilings, and stock is not a target of this project — those numbers stay as the record
of what stock would have cost. And the layer's own counts above come from `game-src/original` plus the built
`sa/` tree of 2026-08-10, which predates the species-roster floor by 312 objects (+0.34 %).

## The target this plan adopts

> **2026-08-09: the aiming point is now known to sit BELOW vanilla, and the ratios below are ratios against
> a defect.** The `procobj.dat` reverse
> ([`gta-sa-original/procedural-objects.md`](../../../docs/gta-sa-original/procedural-objects.md)) recovered
> the authored density as `area / spacing²`: **90 906** objects for the 43 species this layer converts. Our
> 15 286 is **16.8 %** of that, and ProperFixes' 57 583 is **0.63×** of it. So "3.77× ours" is not an
> ambitious multiplier — it is most of the way back to what the data already says, and the mod is a
> conservative reading of it rather than a stretch. **What stays valid:** every row/slot/area cost per
> object, the int16 arithmetic, and the reference's 40 %-in-two-species skew. **What does not:** treating
> 57 583 as a ceiling to aim at, and any multiplier quoted against 15 286 as if that baseline were vanilla.
> The correction is [02](plans/010-density-model.md)'s first step; this file is re-derived
> after it lands and the layer has a real count again.
>
> **It landed the same day.** The scatter reads `area / spacing²` and the MINDIST cull is gone, so the layer
> emits **91 067** objects at vanilla density (+0.18 % on the predicted 90 906) and `procObjMax` went
> 20 000 → 100 000 to stop the cap being what a measurement measures. Every ratio in the sections below is
> still stated against 15 286 and is therefore a ratio against the defect — **read them as history until this
> file is re-derived**, which needs the rebuilt layer's own row/slot/area counts, not an estimate.

**57 583 placed objects, map-wide, as the aiming point — not as a promise.** It is a demonstrated,
field-accepted density from a mod people actually run, which is the bar
[project-goals directive 4](../../../docs/project-goals.md) asks for; it is not a number we invented. Three
qualifications go with it:

1. **Distribution beats total.** Their 40 %-in-two-species skew is a hand-authored look, not a scatter model.
   [02](plans/010-density-model.md) and [03](plans/011-biome-zone-density.md)
   have to earn the same look from `procobj.dat` rules plus biome, and the target is the ceiling those
   profiles are allowed to reach — reaching it with the wrong species is a failure, not a pass.
2. **Perf is part of the specification.** 3.77× the clutter has never been measured in either host. The
   target is provisional until [04](plans/013-density-budgets-per-target.md) has the frame and
   streaming numbers; if the engine says 1.6× is the honest ceiling, the target moves and this file records
   why.
3. **Our objects are not their objects.** Ours carry generated LODs and colliders; theirs carry neither
   (`lod = -1` throughout). Object-for-object parity therefore costs us more memory and more draw setup than
   it costs them, and buys visibly more at range. Compare counts, never costs.
4. **The stock target cannot go there and should stop pretending to.** 1.18× is its whole headroom. Every
   plan below has to be written per target, not per multiplier — see
   [04](plans/013-density-budgets-per-target.md).

## Re-deriving this file

`npx tsx scripts/debug/procobj-layer-census.ts [<game-dir>]` (default `build/original/opensa`) prints every
"our side" number above and checks its two identities; `scripts/debug/ipl-row-census.ts` prints the map-wide
rows and slots. **Do not hand-count either again** — the first hand count of this layer was wrong in three
places at once, and all three errors made the layer look cheaper than it is.
