# Session 30 — four defects, and only one of them was where we were looking

**2026-08-19, closing the field round of central [plan 102](../../tools/add-vehicles/docs/plans/102-add-vehicles/readme.md).**
11 commits on `main` after `da42d358`, tree clean, NOT pushed. No code was written except two small fixes;
the session's product is diagnosis, and its cost is measured in field launches.

## What it cost, and what it bought

| | |
| --- | --- |
| field launches | **7** (runs 3–5 of the loading-crash bisect, plus the shop rounds) |
| defects found | **4** — two fixed, two open with plans |
| defects that were where we were looking | **1** |
| docs written/corrected | 12 files, 4 of them corrections of this repo's own earlier claims |
| tests | +4, both changed modules covered; 25 files / 259 green across the two tools |
| benchmark | **none, deliberately** — nothing this session touches a frame or a build stage |

## 1. The loading crash was ours, and the notes said it was gone

**Fixed, field-confirmed.** The added fleet's tuning was never the cause. FLA's `Vehicle colors = 256`,
which we had set the same day on an inference (the palette is 142 `col` rows against the 128 of FLA's own ini
annotation), pulls in a uint32 colour-id patch family and kills this install at the end of loading. Commented
back out → the game loads with the full tuning on. Write-up:
[`fixed/added-cars-crash-after-loading.md`](../open-issues/fixed/added-cars-crash-after-loading.md).

**Four launches were spent bisecting the tuning data first**, because three separate docs recorded the
setting as "tried and reverted" while it was live in `mods-src`, `build/original/sa` and the bottle. The
revert had been written down and never performed.

Two lessons, both now in the issue and in memory:

- **A bisect whose dump never moves is telling you the variable is not in the data.** Runs 3 and 4 were
  byte-identical down to the heap addresses. That invariance was the answer and was read as "keep splitting".
- **A revert is done when the FILE changes, not when the doc says so.** Writing it down without performing it
  promotes a live variable to an excluded one, which is worse than never having tried it.

A third, found while closing: **when a bisect ends, restore every arm it ever stripped and diff the bottle
against the tree.** Run 5 was written up as carrying the full tuning; `ModelVariations_Vehicles.ini` was
still run 2's stripped 1 097-byte file. The user found it from the game — the HUD names were there and the
traffic tuning was not.

## 2. Every `.fxt` we generate was landing in a folder CLEO does not read

**Fixed.** CLEO loads FXT from `CLEO/CLEO_TEXT/` and nowhere else; we wrote `cleo/<model>.fxt` from plan 012
onward. So no added car had a name in the HUD and no generated part name showed in the shop — and the failure
is silent, because an unread `.fxt` looks exactly like a missing GXT key. The field-check row that offered
`cleo/ResprayPrice.fxt` as proof the channel works was wrong and is corrected: that file sits in `cleo/`
because its own mod put it there. 107 already-generated files moved in the tree and the bottle, so the fix
needed no rebuild. Contract updated — the subfolder is part of the contract, not tidiness.

## 3. An unresolvable `{{name}}` shipped as a literal

**Fixed, the user's call on the shape.** Four `{{205veh}}`-style placeholders survived every build and always
would: they name trailers of the train set that arrives with `add-vehicles` 008+. The plugin refuses the key,
the truck tows nothing, and only its own log says so. Now dropped at the smallest unit that keeps the
author's meaning — an item of a list, a bracket group whole (it is one trailer CHAIN), an emptied key, and
any `Global=` reference to a key that went.

## 4. Two open defects, both with the same root cause under them

- **An added car in traffic wears its BASE car's paintjob and parts**
  ([issue](../open-issues/fixed/added-car-inherits-its-base-tuning.md)) — one ModelVariations section describes one
  model, and `add-vehicles` 004 injects the added id into its base's section to reach traffic, so one token
  list dresses two bodies. 40 sections affected. The plugin's own `ExcludeModelsFromInheritance` is the lever
  to try first.
- **Two car mods ship a tuning part under the same stock name**
  ([issue](../open-issues/fixed/vehicle-part-name-clash-between-mods.md)) — an archive entry name is global, the
  last install wins, and the blade wears a rear bumper modelled for a 1960 Impala. 9 clashes measured.
  Answered by [vehicle-installer plan 014](../../tools/vehicle-installer/docs/plans/014-borrowed-tuning-parts.md),
  written this session: the borrowed set DERIVES from the slot's stock `carmods.dat` line, and for the voodoo
  folder it reproduces the user's earlier hand-written map exactly — eleven entries, from data.

Both are the same shape: **a name or a slot that belongs to one car is being handed to another.**

## What the field also settled

- **The 19-character part-name ceiling is field-confirmed at exactly 19** — the fleet's derived names land on
  it and work, so no shortening map is needed. It also has NO margin, which is why plan 014 changes the
  suffix scheme (`wg_r_lr_slv1_slamvan` is 20 and is refused today).
- **A tuning part is previewed as an ordinary `CObject`, and that dereferences `m_pColModel`**
  ([the RE](../gta-sa-original/veh-mods-col-and-the-upgrade-object.md)). Stock parts get collision from
  `gta3.img : veh_mods.col` — 194 entries, ids 1000–1193 — and an ADDED part gets none. The id is not the
  cause: both parts were moved to 19701/19702 in the field and the crash moved with them. What appears to
  excuse our derived parts is the IDE flags column they inherit (`0x200000`). **Outstanding control**: parts
  `19077`/`19078` carry `0` and by this reading must crash the same way. Plan 014 step 5 removes the class
  either way, because a derived row inherits the stock part's flags.
- **The `sa` target converts no vehicle model** — checked byte for byte, not taken from the comment that says
  so. The only file the pipeline has ever rewritten is `wg_r_lr_bl1.dff` (frame order), and that repair
  matches its untouched mirror frame for frame.

## Documentation — is it enough?

Judged file by file against what a reader would need next session:

| area | state |
| --- | --- |
| the loading crash | **complete** — issue in `fixed/` with all five runs, both lessons, and the three docs it corrected |
| the colour setting | **complete** — the measurement doc's two open questions now have field answers; the restriction row says "leave the adjuster alone" and why |
| the `.fxt` folder | **complete** — contract, both plan docs, the tool readme, the architecture doc and the field-check row all name `cleo/cleo_text` |
| placeholders | **complete** — contract carries the drop rule and the three units it applies at |
| the two open defects | **complete as issues**, and one has its plan; the inheritance one has no plan yet, deliberately — its first step is a field test, not code |
| `veh_mods.col` | **recorded with its uncertainty stated** — the flag reading is labelled a consistent reading, not a rule, with the control named |
| **gap** | `scripts/debug/carmods-check.ts` reports 65 failures on a healthy tree (the added cars' IDE rows moved to modloader and it only reads `data/*.ide`). Recorded in the fixed issue; it has no doc of its own and no owner yet |

## Tests — what is covered and what is not

- **`fxt.ts`** — path change covered in `fxt.test.ts` and `apply-vehicle.test.ts`.
- **`model-variations.ts`** — the drop rule has three new tests (item dropped and the rest kept, a bracket
  chain dropped whole, a `Global` reference cleaned up and dropped) plus one added during this audit for the
  behaviour that has no warning: **a line that resolves whole is written back as authored, spacing included.**
  That one was a real gap — the change was made and nothing asserted it.
- **Not covered, because no code exists yet**: plan 014's derivation and guard, and the collision-flag rule.
  Both are step-1 work next session, and both are testable statically without the game.
- **`carmods-check.ts`** has no test and is currently wrong; whoever fixes it should bring one.

Suites run: `tools/vehicle-installer` + `tools/add-vehicles`, **25 files / 259 tests green**. The rest of the
repo was untouched and not re-run (cost rule).

## State at close

- **Tree** `build/original/sa` — the full fleet, `#Vehicle colors = 256` commented out, `.fxt` in
  `cleo/cleo_text/`, ModelVariations placeholder-free.
- **Bottle** — restored to match the tree exactly; the three experiments armed during the evening
  (`ExcludeModelsFromInheritance` with all 115 ids, the two parts' flags at `0x200000`, the plugin's
  `EnableLog=1`) were reverted rather than left standing. Re-arming any of them is one command, and the
  reasons are in the two issues.
- Nothing is pushed. Push is the user's call, as always.
