# 009 — New tuning parts, the carmods guard, and shared part names

**Status: ✅ Implemented 2026-08-17.** Opened by a boot crash of the reference bottle after the session's
first FULL delivery of a built `data/` (plan 008's field note): `0x4C4576`, `CAtomicModelInfo::
SetupVehicleUpgradeFlags` on a NULL model info — `carmods.dat` named a part no IDE row defined
(`docs/gta-sa-original/carmods-unknown-part-crash.md`).

## What was wrong

`blade - 1964 Ford Thunderbird - gross` ships two parts the game never had (`spl_b_lr_bl.dff`,
`bnt_b_lr_bl.dff`), names them on its carmods line, and carries their IDE rows + shop entries in a
`tuning_new_parts.txt` the installer did not read. The line merged, the rows did not, and the real game
dereferences the lookup without a check. OpenSA never noticed (it does not execute carmods yet), and the
bottle's `data/` had not been re-delivered since 10 Aug, so the built line had never been booted.

## What ships

1. **`tuning_new_parts.txt` is read** (`tuning-parts.ts`, called from `applyVehicle` BEFORE the settings
   merge): bare IDE rows → `data/maps/veh_mods/veh_mods.ide` `objs` (replace by NAME, an id another model owns
   is refused with a warning naming the owner); `shops.<section>|<anchor>` and `prices.<section>|<anchor>`
   blocks → `data/shopping.dat`, inserted after the anchor line inside the nested section (depth-tracked, so
   the same anchor in another section is not taken; missing anchor → appended at the section end + warning;
   missing section → warning, nothing written). Idempotent by name. Format in `docs/contracts/vehicles.md`.
2. **`assertCarmodsModels`** — after every install and both rebake kinds: every `link`/`mods`/`wheel` token
   must resolve to an IDE row somewhere under `data/` (the game's own lookup is by name across every loaded
   IDE); a miss FAILS the run naming the line and the token. Skipped on a tree without `veh_mods.ide` (a
   data fixture, not a bootable game — every token would fail for the wrong reason).
3. **Shared part names are warned about** (`sharedVehicleFiles`, install + both rebakes). Found while
   verifying: the voodoo ships its own `rbmp_lr_bl1.dff` in the blade's part slot; the archive holds one
   entry per name, the folder later in install order wins, and a `--rebake --only blade` had silently put
   the blade's bumper on the voodoo (the family shrank 595 968 B — that is how it was noticed). Install
   warns per shared name with every owner; a rebake of either car warns that it is overriding, and which
   folder a full install would let win. Not refused — the mod set has always shipped this way.

## Measured

- `build/original/sa` before: `carmods.dat` line 39 (`blade`) → 2 tokens with no IDE row of 15 172 names.
  After `--rebake original --kind sa --only blade`: `veh_mods.ide` +2 rows (1194, 1195), `shopping.dat`
  +2 items in `shops/carmod2` after `exh_lr_bl2`, +2 prices in `prices/CarMods` after `exh_lr_bl2`, guard
  green (15 174 names, 0 misses). Same census on the bottle after the sync: 0 misses.
- Suite: vehicle-installer 106/106 (`tuning-parts.test.ts` 11, `img-merge.test.ts` +3), tsc + eslint clean.
- Field verdict, 2026-08-17: the bottle boots, the `new/` cabbie (Checker Taxicab) is the one on the road — plan 007's `new/` layer confirmed in a REAL run for the first time, and plan 008's rebake path with it.

## What it does not do

- It does not invent an IDE id for a part (a mod that names a new part without its row still fails — that
  is the point).
- It does not resolve the shared-part conflict; it names it. Two cars that genuinely need different geometry
  under one part name need one of them renamed by its author, and its carmods line with it.


## 2026-08-20 — 014 asked whether this file still has a job, and it does

[014](014-borrowed-tuning-parts.md) step 5 was written to take the blade's two rows away from this file, on
the reading that their names are borrowed from another car and would therefore derive. Measured before it was
coded: `spl_b_lr_bl` and `bnt_b_lr_bl` have **no stock `veh_mods.ide` row at all**, so there is nothing to
clone them from — they are exactly what this file is for, and its scope is unchanged.

What did change is what happens to the rows it writes: `withNoColFlag` forces `0x200000` into any row outside
the stock 1000–1193 block, because a part with no `veh_mods.col` entry crashes the mod-shop preview without
it, and `assertUpgradeCollision` refuses a built tree that still carries one.
