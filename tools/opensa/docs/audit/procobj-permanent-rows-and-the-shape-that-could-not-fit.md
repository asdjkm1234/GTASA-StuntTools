# Audit — the clutter layer's shape, and the two ceilings that proved it could not fit (2026-08-10)

Commits `504f3d95..719e63c2`. The day started with a build that would not boot and ended with one the user played, whose clutter reaches the
range the redesign was for — both confirmed by him in the real game. Between those two facts the clutter layer changed shape entirely,
and both of the field crashes on the way were **mine**.

## What was asked, and what it turned into

The session was asked to restore memory and then to look at a defect: installing our `sa` build made the real game
render the world as LODs only. That was one mod (see the
[first audit of the day](./sa-build-verified-and-the-guards-that-lied.md#the-close-same-day-symptom-4-solved-and-the-answer-had-been-on-this-page-all-along)).
Fixing it revealed the next crash, and chasing that one ended in a redesign of how the layer exists at all.

## The chain

**Crash A — the 40-slot array is real.** The build shipped **75** inst-bearing text IPLs and the game died
loading the 40th (`plobj10.ipl`). OLA's `EntityIpl = unlimited` is set in the install and documents itself as
*"Maximum number of IPL files that creates entities"*. It does not work. Measured twice: with our shipping
`perfect-map.asi` and again with an `-DPM_FIX_INT16=0` probe of the same asi, both ending at the same file —
**so our own asi was not the cause**, which was the cheap hypothesis and cost one launch to kill.

**A stopgap that also crashed, for a reason worth keeping.** Linking is decided per PAIR; a slot is spent per
AREA. `buildLinkedAreas` split on position alone, so 25 560 linked pairs were spread across all 47 areas and
**28 % of the pairs were costing 100 % of the slots**. Grouping them took the layer 47 → 6 areas and the map
75 → 35 of 40. Then the game died on `plobj0`, because raising the per-area cap from 2 000 to 4 800 pairs was
argued from ProperFixes' measured 9 627 rows — **and that number is rows in a text IPL with zero streams**, while
a linked area passes text rows AND its stream records through the same `gpLoadedBuildings` buffer. 4 260 rows + 9
tiles ≈ 8 520 entries, dead on the first area.

**With the cap back under 4 096 the arithmetic closes and says no.** 25 560 linked pairs at 2 entries each need
**13** areas; **12** exist. The twinned shape does not fit at this density — not "packs badly", does not fit.

**Why streams could not save it either.** `CIplStore` loads a stream's IPL slot only while the player is inside
its bounding box grown by **190 units**
(`gta-reversed-modern/source/game_sa/IplStore.cpp`). Our tiles hold 512 instances, so their boxes are small and
that gate binds before any draw distance: **the layer was capped at ~190 m while declared at 290, and had been for
months.** Recorded as a restriction — streams buy streaming, never range.

**The user's call, and it was the right one.** The HD+LOD twin per clutter object was the wrong shape from the
start: SA draws runtime procobj at **59** (its stock `procobj.ide`, all 107 species), ProperFixes' answer is one
permanent row at `lod = -1` with the IDE raised to **299**, and a generated LOD recovers ~0.2 % of a
hand-modelled bush's geometry for the price of a whole entity.

## What shipped

| # | Change | Where |
| --- | --- | --- |
| 1 | `Remove original/` reads as REPLACEMENTS, and a placed model must be loadable (gate) | `mod-installer` |
| 2 | `checkInstBearingIplSlots` — the 40-slot array becomes a build gate | `perfect-map-builder` |
| 3 | The tool renamed `lod-procobj-generator` → `sa-procobj-placement`, then stripped of LOD generation | 61 files |
| 4 | One permanent row per object at `lod = -1`; range from the stock IDE at 299 | `map-placement`, the tool |
| 5 | The bake moves into the `sa` branch, in place, after its LOD build | `perfect-map-builder` |
| 6 | `removeStaleAreas` + `removeRetiredOutputs` — the in-place bake cleans up after itself | the tool |

## The numbers

| | before | after |
| --- | --- | --- |
| objects | 91 092 | 91 092 — the shape changed, not the content |
| entities for them | 182 184 | **91 092** |
| permanent rows, layer / map | 25 560 / 44 523 | **91 092 / 110 055** |
| inst-bearing IPLs, map-wide | 75 → crash | **39 of 40** |
| binary IPL files | 522 | **191** |
| FLA TXD / COL slots | 4999 / 264 | 4998 / 263 |
| `procobj.dat` rules reaching OpenSA | **9 of 96** | **95** |
| procobj stage / build | 5.7 s / 9 m 53 s | **3.2 s / 9 m 49 s** |
| declared draw distance | 290 (effective ~190) | **299** |

`Buildings` raised 100 000 → 150 000 for the 110 055 rows, verified in the live install.

## What this audit has to admit

**Both field crashes after the mod fix were caused by changes made in this session**, and one of them by exactly
the reasoning that had already burned the project twice the same day: reading a number measured on one path as a
budget for another. `EntityIpl = unlimited` was believed because it was in an ini; PF's 9 627 was believed because
it was measured — but measured on a text-only file. **The question that catches both is the same: what was the
number measured ON, and does my case match it?**

**A leftover found by the artifact, not by a test.** The in-place bake writes into a tree nobody wipes, so the
first build left 10 registered areas among 46 files, and a census over the directory read **95 584 rows for a
91 092-row run**. That is a publishable-looking number produced by dead files. Cleanup now runs and reports its
count; a second leftover (`lod_procobj.ide`, 48 declarations with zero DFFs) was found the same way after the
user asked a question that made me look.

**Two things were retired on purpose, and neither was quietly deleted.** The test asserting "one scatter handed to
both targets" is replaced by its opposite, because density stops being a single profile for both hosts. The
scoped-texture integration test went with the shared LOD txd it covered; its regression class is still covered in
`lod-common` and still lives in `opensa-lod-generator`.

## Still open

- ~~Does the clutter reach 299 m?~~ **CONFIRMED in the field** the same day — he checked the real game
  separately: the range works. That was the number the whole mechanism was changed for.
- ~~The OpenSA half.~~ **MEASURED, and it wins**: his own `bench=all` sweep shows no frame cost anywhere and
  `country-dusk` 18.434 → 16.091 ms (54.2 → 62.1 fps, faster than even the 15 286-object baseline), while the pak
  drops **24.7 %** and its AO bake **32 %**. Caveat recorded rather than smoothed: country-dusk also drew 15.5 %
  fewer triangles, so it is "less drawn AND faster", not proven cheaper at equal content —
  [`benchmarks/index.md`](../benchmarks/index.md).
- **What the two hosts now show at different ranges.** The real game draws this clutter at 299; our engine at
  50–150 per category, values defaulted when the runtime scatter was drawing almost nothing. Judging them is a
  look decision, and `country-dusk`'s highest-pass/fewest-draws signature is where their cost will appear.
- **Baked AO on OpenSA clutter** is gone by construction — the runtime path is instanced and has nowhere to keep
  a per-vertex value. Prelight is unaffected.
- **The cross-target placement parity check** still assumes both targets carry the same clutter.
- ~~Breakable clutter after the move~~ **CONFIRMED breaking in the field 2026-08-10** — the 6 species carrying a
  DFF Breakable mesh left the pak for the runtime path, and plan 074/20's `breakClutterInstance` handles them
  there. Nothing was lost with the bake.

Plan and full record: [`sa-procobj-placement/014`](../../tools/sa-procobj-placement/docs/plans/014-permanent-rows-no-lod-twins.md);
the stopgap that failed is [`map-placement/002`](../../tools/map-placement/docs/plans/002-ipl-slot-budget.md).
