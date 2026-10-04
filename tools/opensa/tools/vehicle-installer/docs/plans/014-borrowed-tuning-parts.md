# 014 — a replacement car's BORROWED tuning parts, derived

**Status: BUILT 2026-08-20**, all five steps, measured below. Planned 2026-08-19 and field-found the same
evening: the blade's rear bumper is modelled for a 1960 Impala. Grew out of central
[plan 102](../../../add-vehicles/docs/plans/102-add-vehicles/readme.md)'s field round; the issue it closes is
[`docs/open-issues/fixed/vehicle-part-name-clash-between-mods.md`](../../../../docs/open-issues/fixed/vehicle-part-name-clash-between-mods.md).

## What is broken

A vehicle mod for a STOCK slot may ship tuning parts under names that belong to a DIFFERENT car
(`voodoo - 1960 Chevrolet Impala - chezy` ships `rbmp_lr_bl1.dff`, the blade's rear bumper, and eight of the
slamvan's). An archive entry name is global — one model per name — so the installer stages both and **the
last one silently wins**. Measured on the built tree: **9 clashes, all `.dff`**, and the voodoo mod wins every
one. Blade loses its rear bumper, slamvan loses eight parts, and the symptom is geometric — the part loads,
mounts and renders in the wrong place.

The stock game has no such problem because it ships one model per name. **The mod author is not doing
anything unusual**: a car with no tuning of its own borrows a neighbour's part names to have any, and that
works right up until a second mod does it.

## The rule, and it is DERIVED — no table, no new file kind

The plan was written with the `carmods.dat` `mods` line as the source of truth. **Measured on the stock
tables before it was coded, that line is wrong in 22 places, and the column beside it is right in all of
them** — so the rule as BUILT is:

> A part `.dff` in a vehicle folder whose stock `veh_mods.ide` row is **textured by another car** (its TXD
> column) is a NEW part of the car shipping it, not a replacement of the stock one.

Why not the line the plan named: a right-hand part is bought through its left partner's `link` and so is on
**no `mods` line at all** — 22 of them (`wg_r_*` for elegy, flash, jester, remingtn, savanna, slamvan,
stratum, sultan, tornado, uranus, blade), plus `bnt_lr_slv1`/`2`, the only two stock parts no shop offers.
Renaming those would have broken a stock `link` pair and left the car buying a left skirt with no right side.
The TXD column never disagrees with the line where the line can speak: **0 of the stock `mods` rows name a
part whose txd is another car's.**

Checked against the three folders that clash, the rule lands exactly:

| folder | own (replacements, keep the name) | BORROWED (new parts) |
| --- | --- | --- |
| `blade - … - gross` | 7, plus 2 the game never had | **0** (the plan expected 3) |
| `slamvan - … - alfamodding` | 13 | **0** (the plan expected 4) |
| `voodoo - … - chezy` | 0 | **11** — exactly the eleven of the user's earlier hand-written map |

That last row is the acceptance test for the derivation: his old tool carried the map by hand, and the rule
reproduces it from `game-src/original/data/maps/veh_mods/veh_mods.ide` plus the folder listing, with nothing
authored. And it is one rule for both callers with nothing to switch on: every stock part an ADDED car ships
belongs to its base, so the added fleet derives exactly as it did (46 parts, unchanged).

## What already exists

`tools/add-vehicles/src/tuning.ts` (plan 005) does this for an ADDED car: `deriveTuning(gameDir, slot, base,
shipped)` clones the stock part's IDE row, shop item, price row, `link` to its mirror and its place on the
`carmods.dat` line, under a new name and a new id. Everything is read from the built `data/`; the module's
own header states the two rules it turns on — the TXD column decides base-specific vs generic, and the name
ceiling is **refused, not truncated**.

**A replacement car is the same operation with `base = slot`.** The work is to lift that module to serve
both callers, not to write it again.

## The one thing that must change: the derived NAME

Today's scheme is `<stock part>_<slot>`, and it **overflows on this very data**:

```
wg_r_lr_slv1_slamvan   20 chars   <-- over the 19-character ceiling, so today it REFUSES
wg_l_lr_slv1_voodoo    19 chars   <-- lands exactly on it
```

The ceiling is `docs/gta-sa-original/carmods-upgrade-ceilings.md` (an IMG entry name is 24 bytes including
`.dff`, so 19 characters is the last safe length) and it is now **field-confirmed at exactly 19**.

**New scheme: `<stock part>_<token>`, where the token is the shortest prefix of the slot name that is unique
across every slot in the built `vehicles.ide`, minimum 3 characters.** Derived, deterministic, no registry:
`wg_r_lr_slv1_sla` (16), `rbmp_lr_bl1_voo` (15). The suffix stays an APPEND for the reason plan 005 gives —
SA derives a component's flags from the name PREFIX, so nothing in the middle may move.

**Added cars keep working unchanged** (`_059veh` is already ≤ 19 for everything the fleet ships), but the
same token rule should serve them too so there is one scheme, not two — and it lifts a latent refusal: a
future added car whose base has a `misc_c_lr_rem1`-length part would be refused today at 21 characters.
Verified not currently hit: the `059veh` folder ships no `misc_c_*` part, so nothing has been dropped
silently.

## Steps

### 1 — Move the derivation into `vehicle-installer`, unchanged in behaviour — **DONE 2026-08-20**

`tuning.ts` → `tools/vehicle-installer/src/tuning-derive.ts`; `add-vehicles` imports it (it already imports
six modules from this tool). No behaviour change, no new name scheme yet. **Verify**: the add-vehicles suite
is green and `--rebake --kind sa --only 059veh` writes byte-identical `data/*` to the current build.

**Measured.** The move is byte-identical bar one line: the private `VEH_MODS_IDE` copy is gone and the
constant comes from `tuning-parts.ts`, which already exported the same value (`git show
HEAD:…/tuning.ts | diff` = those two hunks and nothing else). Both suites green, **25 files / 259 tests**,
`tsc --noEmit` and eslint clean.

The build check was done WITHOUT writing to the tree — an in-place rebake would edit the tree the bottle
matches. Instead the derivation was run from its new home over the real `build/original/sa` for all **115**
added slots (`slots=115 sha1=587bbaef34667a592396ddc70bf0358d02326f66` over renames+rows+links+shop, the
invariant step 2 will move), and `059veh`'s 10 derived rows were compared against what the tree actually
carries at ids 19051–19060: identical, columns and all.

### 2 — The token, and one scheme for both callers — **DONE 2026-08-20**

Derive the token (shortest unique prefix, min 3) from the slots in the built `vehicles.ide`; re-point both
callers at it. **Verify**: unit tests for the token — uniqueness across the full 212-slot table, the
minimum-3 floor, and the `copcarla`/`copcarsf`/`copcarvg` family, which needs more than three. Every derived
name of the current fleet ≤ 19, and the longest is reported.

**Measured.** `slotTokens` + `vehicleSlots` in `tuning-derive.ts`; `deriveTuning` now takes an options
object with the caller's `token`. Suites green, **25 files / 268 tests**.

| | |
| --- | --- |
| stock slots tokenised | **212, all distinct** — 142 at 3 characters, 33 at 4, 19 at 5, 2 at 6, 14 at 7, 2 at 8 |
| longest token | **8** (`monstera`/`monsterb`, which reach past `monster`) |
| longest derived name, stock `carmods.dat` | **≤ 19** where `_<slot>` overflowed |
| longest derived name, the added fleet | **16** (`fbmp_lr_rem1_059`), 46 parts, **0 over 19** |

**`vehicleSlots` reads the `cars` rows itself rather than through `parseVehicleDefs`**, which needs the
wheel columns and so drops the eleven boats (`predator` … `launch`). A slot missing from the table is a slot
two tokens can collide on, and nothing would say so.

**The cost the plan had not priced, and the user's call on it.** One scheme means the added fleet's 46
derived parts change name (`fbmp_lr_rem1_059veh` → `fbmp_lr_rem1_059`), and `data/vehicle-adds.txt` promises
ids BY NAME because a part id is in the player's save. So `renameAddsRows` moves the ledger row with the
name, keeping the id, instead of the part taking a fresh one and the old row reserving one forever.
Rehearsed against a copy of the real ledger: **161 rows in, 161 out, all 46 part rows moved, every id
identical, none left under an old name.**

### 3 — Replacement cars derive their borrowed parts — **DONE 2026-08-20**

`install` splits every folder's shipped parts into own and borrowed and runs the borrowed set through the
derivation: new name, new id, IDE row cloned from the stock part (**flags included** — see below), shop item
and price row anchored after the stock part, `link` pair kept whole, and the car's `carmods.dat` line
repointed. **Verify**: 9 clashes → 0; the archive holds each mod's own geometry under its own name; `blade`
keeps `rbmp_lr_bl1` and `voodoo` gets `rbmp_lr_bl1_voo`.

**Measured over the real `mods-src/original/vehicles` (212 folders) against `game-src/original`:**

| | before | after |
| --- | ---: | ---: |
| archive entry names two folders stage differently | **9** | **0** |
| entry names shared by two folders at all | 9 | **0** |
| entries staged | 747 | 756 |

**Not where the plan put it, and not the rule the plan named** — both corrected against the data, see the
box below. The derivation runs in `install()` before the first car is applied (the classification reads the
stock tables and the first install would already have rewritten one of them), ids for the whole fleet come
out of one `allocateIds` pass over `MOD_PART_ID_WINDOW` (19 800–19 999 — see the build note below), and
`installDerivedTuning` writes the rows. The
writing half moved out of `add-vehicles` to serve both callers, as did `ledger.ts`: a replacement car's
derived part is a promised id exactly like an added car's.

Suites: 219 files / 1 714 tests green across `tools/`. New coverage: the derivation's four classes, the
token, and two end-to-end cases on real stock fixtures — two mods shipping `rbmp_lr_bl1.dff` (blade keeps
it, voodoo gets `rbmp_lr_bl1_voo` with a cloned IDE row at 19 800+, its shop item, its price and a ledger
row), and the refusal below. `data/shopping.dat` and `data/maps/veh_mods/veh_mods.ide` are new fixture
manifest lines, regenerated from scratch (134/134).

### 4 — The guard that survives the fix — **DONE 2026-08-20**

Two vehicle folders shipping the same part file name with DIFFERENT content is refused, naming both mods and
both sizes. After step 3 it should be unreachable from `vehicles/`, which is exactly why it is worth having:
it is the check that says so, and it still fires for anything the derivation cannot classify.
**Verify**: it fires on the pre-fix tree (9) and is silent on the post-fix one.

**Measured.** `sharedVehicleFiles` now asks about the entry name a file is STAGED under, not the name on
disk, and carries each owner's size; `assertNoStagedClash` refuses when the sizes differ and warns when they
do not (one file shipped twice costs nothing). Silent on the real fleet — 0 shared names left — and the
e2e case that proves it still bites uses a part no IDE row defines, which is the only thing the derivation
cannot rename.

### 5 — every new part gets collision, or the build says so — **DONE 2026-08-20, field-confirmed**

**The step as planned was void, and the measurement said so before a line was written.** It read: remove the
blade's two hand-written rows from `tuning_new_parts.txt`, because "their names are borrowed, so they
derive". They are not borrowed — `spl_b_lr_bl` and `bnt_b_lr_bl` have **no stock `veh_mods.ide` row at all**,
so there is nothing to clone them from and the file is doing exactly the job it exists for. Its scope does
not narrow.

What was real in the step is the crash it pointed at. A part the stock game never had has no entry in
`gta3.img : veh_mods.col` (194 entries, ids 1000–1193), and anything that creates it as a standalone object
goes through the `CObject` constructor, which dereferences `m_pColModel` with no null check
([`veh-mods-col-and-the-upgrade-object.md`](../../../../docs/gta-sa-original/veh-mods-col-and-the-upgrade-object.md)).

**This step shipped the wrong fix first, and the field killed it within the hour.** The doc's reading was
that `0x200000` in the IDE flags excuses a missing collision model, so both writers forced it in. The user
spawned `1194` and then `19051` — both carrying the flag — and both died at `0x0059F8B4` with `EDI = 0`. The
46 derived parts that "proved" the flag had simply never been spawned: the mod shop MOUNTS a part and never
reads `m_pColModel`. A control group never exposed to the treatment.
[Retired hack](../../../../docs/hacks/retired/upgrade-part-no-collision-flag.md).

**What shipped instead** (the user's suggestion, and it is the honest thing): a **bounds-only COL3 model per
part**, written into `models/coll/opensa-parts.col` and registered with one `COLFILE` line in `default.dat`
— a file of ours rather than an append into `veh_mods.col`, which lives inside a 1.6 GB archive.
`assertUpgradeCollision` then refuses a build naming a part with collision in neither place.

**Measured on the real install**: 253 `objs` rows — **194 with stock collision, 59 without** (11 voodoo's,
2 hand-written, 46 the added fleet's), all 59 now carrying one with the bounds of their own geometry.
**Field-confirmed the same day: `1194` and `19051` spawn.** Tested without a rebuild by generating the file
straight into the bottle, which is what made the round cost minutes instead of a build.

## Docs updated in the same change — all DONE

- `docs/contracts/vehicles.md` — the four classes a shipped part falls into, the derived name scheme, and
  what the TXD column decides. A name that carries behaviour and a mod author cannot guess it.
- `docs/open-issues/vehicle-part-name-clash-between-mods.md` → `fixed/`, with 9 → 0 and the corrected rule.
- `docs/gta-sa-original/carmods-upgrade-ceilings.md` — what the token scheme buys in margin (the fleet's
  longest derived name 19 → 16, the full token-length histogram over the 212 slots).
- `docs/gta-sa-original/veh-mods-col-and-the-upgrade-object.md` — the 7-row census the guard produced, where
  the write-up predicted 2, and what the tools now do about it.
- `docs/hacks/upgrade-part-no-collision-flag.md` + its README row — forcing a flag whose meaning is unknown.
- `tools/add-vehicles/docs/plans/002` and `005` — the two modules that moved out of that tool.
- `tools/vehicle-installer/docs/plans/009-tuning-new-parts.md` — its scope does NOT narrow (step 5): the two
  rows it carries are parts no stock row defines, which is precisely its job. Recorded there.

## Measured

| | before | after |
| --- | ---: | ---: |
| part-name clashes in the fleet | **9** | **0** |
| longest derived part name | **20** (refused) | **16** (`fbmp_lr_rem1_059`) |
| cars wearing another car's part | **2** (blade, slamvan) | **0** |
