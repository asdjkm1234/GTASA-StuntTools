# 002 — map-placement: the layer must fit SA's 40 inst-bearing IPL slots

**Status: ⚰️ SUPERSEDED 2026-08-10 by
[`sa-procobj-placement/014`](../../../sa-procobj-placement/docs/plans/014-permanent-rows-no-lod-twins.md).** It
never shipped a booting build: its own per-area cap crashed the game, and the arithmetic then showed the shape it
was packing could not fit at all. **What survives is `checkInstBearingIplSlots`** — the gate — and the reasoning
below, which is why the redesign took the form it did. Read it for that, not as a design to follow.

The problem it was written for: the `sa` build at the shipped density did not boot — the game died loading
`plobj10.ipl`, the **40th** inst-bearing text IPL, against SA's 40-slot `IplEntityIndexArrays`, and the layer
shipped **47** inst-bearing areas on its own.

## What is measured, and what has already been ruled out

| | value | source |
| --- | --- | --- |
| inst-bearing text IPLs in the built `sa/` | **75** (28 stock + 47 ours) | counted over `gta.dat` |
| the crashing file | `plobj10.IPL` = **slot 40** | counted in `gta.dat` order |
| our layer | 91 092 objects · 182 184 placements | build log |
| permanent text rows (the linked LOD rows) | **25 560** of 91 092 pairs (28 %) | build log |
| binary stream files | 522 (FLA IPL pool 522/1024) | build log |
| largest per-area total proven in the field | **9 627** rows, text-only | ProperFixes, [reference-install-config](../../../../docs/gta-sa-original/reference-install-config.md) |

**`EntityIpl = unlimited` does not lift this array.** OLA documents the setting as *"Maximum number of IPL files
that creates entities"* and it is set in the install, yet the game dies at slot 40. Measured **twice** on
2026-08-10: with the shipping `perfect-map.asi` (crash `0x00405D1F`, read of NULL) and with an
`-DPM_FIX_INT16=0` probe build of the same asi (crash `0x008214E4` from caller `0x00405C56`, `EDX = 0x27` = 39).
Same function, same slot, both runs ending at `plobj10.ipl` in modloader's log. **So our own asi is not the
cause** — that was the cheap hypothesis and it is dead, for one launch.

Not the answer either, and recorded so nobody re-walks them: the FLA pools (522/1024, 264/400, 4999/6000 after
the 08-10 ini raise), and lowering density (the standing rule forbids shipping less content for a ceiling — and
the density is what the field has just validated everywhere except this crash).

## Why we spend 47 slots for 25 560 rows

`linkedHeight` is **4** (`sa-procobj-placement/config.ts`), so a species taller than 4 m gets the vanilla
treatment: its LOD becomes a PERMANENT text row and the HD's binary `lod` field indexes that row, which is what
makes SA hide the LOD while the HD is streamed in. Short species are emitted unlinked — both rows in the stream
at `lod = -1`, no text row at all.

**The link is decided per PAIR; a slot is spent per AREA.** `buildLinkedAreas` splits on position alone, so the
25 560 linked pairs are spread across every one of the 47 areas, and each area's text IPL therefore carries
`inst` rows and takes a slot. 28 % of the pairs are costing 100 % of the slots.

Raising `linkedHeight` above the tallest species would zero the rows, but that is the wrong trade: linking exists
precisely so a tall model's LOD does not poke out of its HD, and the tall species are the visible ones (procobj
trees 9 565, cacti 6 807).

## The design: two area families, split by LINK rather than by position alone

- **Linked family** — only the pairs that need a text row. Few areas, each as full as the per-area boot buffer
  allows. An area holding only linked pairs carries `L` text rows + `L` stream records, so `2L` must stay under
  what the lifted buffer is proven to hold: `L ≤ 4 800` keeps the pair total ≤ 9 600, at or under ProperFixes'
  measured 9 627. 25 560 rows → **6 areas → 6 slots.**
- **Unlinked family** — everything else, `lod = -1`, both rows in the streams, its text IPL emitted with an EMPTY
  `inst` section (the file and its `gta.dat` line must exist: `CIplStore::SetupRelatedIpls` finds
  `<area>_stream<N>.ipl` through it). As many areas as spatial tiling wants, at **0 slots** — see the claim below.
- **Budget:** 28 stock + 6 = **34 of 40**, six slots of headroom.

This is ProperFixes' shape — few files, many rows each — applied only to the rows that have to be permanent, and
it keeps every visual property the current output has. It does NOT adopt PF's other two choices: we keep the
binary streams (dropping them would move all 91 092 objects into permanent rows, taking the map from 44 523 to
~110 000 against `Buildings = 100000`, and would trade streaming away for a pool that is half empty), and we keep
our tree LODs, exactly as PF keeps its own in a separate layer.

## The load-bearing claim, and it is UNVERIFIED

**A text IPL with no `inst` rows takes no `IplEntityIndexArrays` slot.** `docs/restrictions/sa-target.md` states
it; nothing has exercised it, and today's build cannot test it because all 47 of our areas carry rows. This plan
is the experiment: if the claim is false, the unlinked family costs slots too, the budget becomes
28 + 6 + (unlinked areas) and the fallback is to fold the unlinked instances into few areas as well — which the
same splitter change already allows, at a coarser streaming granularity.

**A ceiling nobody has crossed is not a ceiling anyone has lifted** (2026-08-10, twice in one day). So step 1
reports the slot count off the built artifact, and the field run is what closes it.

## Steps

1. **Split the two families in `buildLinkedAreas`** (this tool) — linked pairs area-split under a pair cap that
   respects the per-area boot buffer; unlinked pairs area-split independently, their text IPL emitted with an
   empty `inst` section. Deterministic, and the RNG-fed scatter upstream must be untouched (the placements
   themselves may not move — only their file assignment).
2. **A slot budget guard, where the decision is made.** The emitter knows how many inst-bearing files it is
   about to write; it reports that number and fails when the layer's own share exceeds its budget. Plan 007
   wrote *"stock 30 + 8 = 38 ≤ the 40-slot array"* into prose at 15 283 objects and nothing re-read it when the
   density fix took areas 8 → 46. A number in a comment is not a guard.
3. **Build `sa`, count slots on the artifact**, then the field run. Record the numbers here.
4. **Price the streaming granularity change** with the `hitch` columns (P1's instrument, already shipped) — the
   linked family's areas get much bigger, and "bigger areas stream more coarsely" is a claim, not a measurement.

## Measured numbers

**Steps 1–3 (build half) done 2026-08-10.** The two-family split, on the same corpus and density:

| | before | after |
| --- | --- | --- |
| the layer's inst-bearing areas | 47 | **6** |
| map-wide inst-bearing IPLs | **75** — the game crashed on slot 40 | **35 of 40** |
| permanent text rows (layer / map) | 25 560 / 44 523 | unchanged — the same rows in fewer files |
| binary IPL files | 522 | 511 |
| text IPLs listed in `gta.dat` | 97 | 71 |
| build wall clock | 9 m 58 s | 9 m 53 s |

The gate passes with **five slots of headroom**, and the layer now reports its own share in the cost line
(`6 inst-bearing area IPL(s) of SA's 40 slots`). The artifact half of the load-bearing claim holds: the 13
unlinked areas are registered in `gta.dat` and counted in the census's 71, and none of them counts as
inst-bearing. **Whether SA agrees is still a field question** — the build exists and one launch answers it.

## What the reversed source then said, and why this plan is likely to be SUPERSEDED

`CIplStore` loads an IPL slot only while the player is inside its bounding box grown by **190 units**
(`if (!def->bb.IsPointInside(posn, -190.f) || CStreaming::IsModelLoaded(...)) continue;`,
`gta-reversed-modern/source/game_sa/IplStore.cpp`). Our stream tiles hold 512 instances each, so their boxes are
small and that gate binds long before any draw distance does: **the layer's clutter cannot draw past ~190 m no
matter what the IDE says.** A permanent row has no such gate, which is exactly why ProperFixes puts its whole
57 583-row vegetation layer in text IPLs at `lod = -1` and gets the IDE's 299 m.

That reframes the problem the user then named directly (2026-08-10): the HD+LOD twin per clutter object was the
wrong shape from the start — SA draws procobj at ~50 m, PF's answer is one entity at 299 m, and a generated LOD
for a hand-modelled bush recovers ~0.2 % of its geometry while costing a whole entity. Dropping the twins removes
the permanent rows and therefore the slot pressure **at its cause**, where this plan packs around it.

**And then the split's own cap crashed the game, which closed the question for good.** Raising
`AREA_MAX_PAIRS` 2000 → 4800 was argued from ProperFixes' 9 627 rows — but that number is rows in a text IPL
with **zero streams**, while a linked area passes text rows AND its stream records through the same
`gpLoadedBuildings` boot buffer. The build put 4 260 rows + 9 tiles (~8 520 entries) into `plobj0` and the game
died on it, having loaded `plotr0` (467 rows + 1 tile) first. Two numbers that look alike, one category error —
the same shape of mistake as `EntityIpl`, made twice in one day.

With the per-area cap back under 4 096 the arithmetic closes: 25 560 linked pairs at 2 entries each need **13**
areas and only **12** slots exist. **The twin design does not fit at this density, at all.**

**So this plan is superseded, and it was a stopgap that never shipped a working build.** The redesign is
[`sa-procobj-placement/014`](../../../sa-procobj-placement/docs/plans/014-permanent-rows-no-lod-twins.md):
one permanent row per object at `lod = -1`, no twin and no stream, which makes the entries-per-area 1:1 and puts
the layer on the exact path PF proves. What survives from here is `checkInstBearingIplSlots` — the gate, and the
reason plan 007's written-down budget went stale in silence.
