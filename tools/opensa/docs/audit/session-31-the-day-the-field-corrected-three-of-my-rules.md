# Session 31 — the day the field corrected three of my rules

**2026-08-20.** 29 commits on `main` after `5e765cd6`, 92 files, +2 966 / −398. Two plan chains built end to
end, five field rounds through the bottle, and **three rules I had written down were wrong in a way only the
game could show**. The suite went 4 810 → 4 839 green; five builds were spent, four of them because a fix
uncovered the next defect.

## What it cost, and what it bought

| | |
| --- | --- |
| plans BUILT | **2** — `vehicle-installer` 014 (5 steps) and `img-splitter` 002 (6 steps, the ex-central 103) |
| `sa` builds | **5** (11 m 09 s – 11 m 59 s each) |
| field rounds | **5**, all through the delivered bottle |
| defects closed | **6** — 3 field-found today, 2 open from session 30, 1 found by a guard I added |
| defects I INTRODUCED and caught the same day | **2** (the id-window shift, the `0x200000` hack) |
| rules of mine the field disproved | **3** |
| open issues | 5 → **2** |
| tests | 4 810 → **4 839** |

## The two chains

**`vehicle-installer` 014 — a replacement car's borrowed tuning parts.** A part `.dff` whose stock
`veh_mods.ide` row is textured by ANOTHER car is a new part of the car shipping it: new name
(`<stock>_<token>`, the token being the shortest prefix telling the slot apart, floor 3), new id, the stock
row / shop item / price / `link` cloned under it. **9 archive-name clashes → 0**; the blade keeps its rear
bumper, the slamvan its eight parts, the voodoo wears its own eleven. The derivation reproduces the user's
hand-written voodoo map exactly, from stock data plus a folder listing.

**`img-splitter` 002 — one owner per archive entry.** Everything `vehicles.ide` and `veh_mods.ide` name goes
to the vehicle bucket, whatever section it sits in, plus every `<car><n>.txd` paintjob; a built tree holding
one name in two of the archives the split owns is refused; a car's files stop straddling siblings.
**39 duplicates of ours → 0, 12 cars stop wearing stock paintjobs, 148 of 201 split cars → 0.**

## The three rules the field corrected

**1. "A car's parts are the parts on its `carmods.dat` line."** Measured before coding: wrong in 22 places —
a right-hand part is bought through its left partner's `link` and is on no line at all. The honest source is
the part row's own TXD column. Under the plan's rule the blade and the slamvan would have had their own
parts renamed and a stock `link` pair broken.

**2. "`0x200000` in the IDE flags excuses a part with no collision."** Written into the code in the morning
on a reading of 46 parts that "did not crash"; the user spawned `1194` and `19051` — both carrying the flag —
and both died at `0x0059F8B4` with a null `m_pColModel`. **Those 46 had never been spawned at all**: the mod
shop mounts a part onto a car and never reaches the `CObject` constructor. A control group never exposed to
the treatment. Worse, the bit's meaning was not unrecovered — plan 039 has it as DISABLE BACKFACE CULLING,
1 586 stock defs, implemented in our engine. The hack was retired the day it was taken, replaced by the
user's own suggestion: a bounds-only COL3 per part in `models/coll/opensa-parts.col`, registered with one
`COLFILE` line. **59 parts covered; both ids spawn.**

**3. "One ModelVariations section per model, keyed by NAME."** Plan 004 chose it over the user's earlier
shape on an argument nobody tested. It gave a 1958 Pontiac the blade's continental-kit spare wheel, and then
— after the lists were split apart — left added cars untuned in traffic while Transfender tuned them
perfectly, because the plugin resolves a header to a model and an added car's NAME does not exist yet.
**Two section kinds, two subjects**: `[536]` carries the ids that may spawn in a blade's place, `[19110]`
carries what that car IS. `ExcludeModelsFromInheritance` was armed for one round and reverted unused.

## What the guards found, and what they now prevent

| guard | what it caught |
| --- | --- |
| `assertOneOwnerPerEntry` | the 39 duplicates, and it is silent on the fixed tree |
| `assertUpgradeCollision` | 7 parts with no collision where the write-up predicted 2 |
| `assertNoStagedClash` | the 9 part-name clashes; unreachable now, which is why it is worth keeping |
| `assertDummyPoolCoversFirstEntry` | the class that bit us mid-session: a delivery put `Dummys = 50000` back over a bottle raised to 100 000 by hand |
| `readDefs` (hole-fill) | nothing yet — it exists because the added fleet moved 35 ids when the LOD allocator followed our parts into the added window |

## Two defects I introduced, both caught before the user saw them

**The added fleet moved 35 ids** in the first build carrying 014: `fill-holes` numbers from `maxId + 1` over
every IDE in the tree, and our derived parts raised that maximum into the 19 001–19 999 window. Fixed by
excluding the window from that maximum, then a second build showed the remaining +11 — `vehicle-installer`
allocating before `add-vehicles` out of one pool — fixed by splitting the range (19 001–19 799 for the fleet,
19 800–19 999 for a replacement car's parts). **Third build: 115 of 115 cars on their original ids, 46 parts
renamed but on the same ids.**

**The `0x200000` hack**, above. Both are the same failure shape: a rule inferred from data that had never
been through the code path it claims to describe.

## Also fixed, on the way

- **`parked` had stopped applying** since session 29 moved an added car's ide row to modloader — the id
  lookup read `data/**.ide` and found nothing, behind one warning in a 12-minute log. The caller knows the
  id; it passes it now.
- **19 of the fleet's 46 paintjob dictionaries were never offered** (four cars losing all of theirs), because
  the count was taken from the archives and an added car's ship loose in `modloader/added-vehicles/`.
- **A replaced slot gives up its stock texture bundle** — `<slot>.txd` and every `<slot><n>.txd` the mod does
  not ship. Drops nothing on today's fleet: a closed door, with the log line for the day someone walks
  through it.

## Housekeeping the user called for

`docs/plans/` is the **engine's** now; every toolchain plan lives beside its tool, spanning one tool or four
(102 → `tools/add-vehicles`, 103 → `tools/img-splitter` as 002). Recorded in `CLAUDE.md`, `docs/README.md`
and both indexes; every inbound link repointed and checked — **0 broken markdown links repo-wide**, including
four that had been broken before.

## What is NOT done

- **The tree is one edit behind the bottle**: an added car's id-keyed tuning section is a hand edit there,
  and the next `sa` build writes it. No rebuild was run after it, at the user's word.
- **No benchmark**, deliberately: nothing this session touches a frame. Build wall-clock stayed in its usual
  band (11 m 09 s – 11 m 59 s), and `build-timings.json` carries the per-stage numbers.
- Two open issues remain untouched (`road_lawn` collision, SCRASH2's missing location model), plus the
  previon cabin lighting and the folded-`inst`-row order defect — the last is next session's work.
