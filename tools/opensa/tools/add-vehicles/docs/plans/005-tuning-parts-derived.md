# 005 — Tuning parts, derived (no table)

**Status: BUILT 2026-08-19.** It refused the full fleet by one link pair until `asi/perfect-vehicle` 002
shipped the same day; with the plugin in the tree all 115 cars and 46 parts install. An added car ships its base's tuning parts re-modelled to fit it, under the
STOCK part names (`wg_r_lr_rem1.dff` in `059veh (remingtn)`). Those names must NOT reach the archive — they
would overwrite the stock part for the base car — so each gets a new unique name, and everything the game
knows about the stock part is cloned under it. The old tool did this with a hand-written table per car
(recon §"Tuning parts"); this plan derives every value from the built `data/` and from the name itself.

## The derivation, per part dff whose base name is a stock part of the car's first `(base)`

| output | derived from |
| --- | --- |
| new name | the stock name's PREFIX (everything up to and including the component token the game reads in `SetupVehicleUpgradeFlags`: `wg_l_lr_`, `exh_lr_`, `spl_b_lr_`, …) + a slot token + the stock suffix digit: `wg_l_lr_` + `v059` + `1` → `wg_l_lr_v0591`. Prefix kept = behaviour kept; **≤ 19 chars or refuse**; unique by construction (the slot is unique) |
| `veh_mods.ide` row | the stock row's trailing columns (`drawDist, flags`), `txd` = the ADDED car's slot (the part textures live in the car's TXD — the old tool did this and it is how the stock rows work: `exh_lr_rem1, remingtn`), a new id from the allocator (002) |
| `shopping.dat` | the stock part's `item` in its section + its `prices` line, cloned under the new name after the stock one (012/009's insert-after-anchor) |
| `carmods.dat` `link` | if the stock name is one side of a stock `link` pair and the OTHER side is also shipped → `link <newLeft>, <newRight>`; if only one side is shipped → warning, no link (a wing without its partner is the author's gap) |
| the car's `mods` line | the base's carmods line with: stock parts shipped → their new names; base-specific parts NOT shipped → dropped (they fit the stock body, not this one); generic parts (nitro, and anything the base line names that is not a base-specific part — decided by "does the base's carmods line own it and does no other car's") → kept as-is |
| `tuning_new_parts.txt` | as 009, with `<:id>` allowed on the rows (002's allocator) |

## The guards (this is the plan that must refuse, see `docs/restrictions/sa-target.md`)

- **`link` pairs game-wide ≤ 30** (stock 23; each shipped wing pair costs 1): counted on the built
  `carmods.dat` AFTER this car; over → REFUSE naming `asi/perfect-vehicle` plan 002 and the count. The
  refusal is the in-reserve trigger — when the plugin ships and is detected in the tree (its `.asi` beside
  `perfect-map.asi`), the guard reads the lifted number instead.
- **Parts on the car's `mods` line ≤ 16** — same refusal shape. The guard lives in `vehicle-installer`
  (`carmods-guard.ts`) so a REPLACEMENT car's line is counted too (silent today).
- **Name ≤ 19 chars, prefix recognised** — a stock name whose prefix the derivation does not know is refused
  (better than a guessed prefix that drops the part's behaviour).
- `assertCarmodsModels` (009) stays the acceptance test: every token resolves.

## Steps

1. Prefix table = the list `SetupVehicleUpgradeFlags` switches on (from gta-reversed, cited in
   `docs/gta-sa-original/carmods-upgrade-ceilings.md`), as DATA with its source; a test pins it.
2. The derivation above as pure functions over (base carmods line, stock veh_mods rows, stock shopping,
   stock links, shipped part names, slot) → (rows, items, prices, links, line, renames); tests per output,
   negative first (unknown prefix, > 19, one-sided link, over-16, over-30).
3. Rename at IMG stage: the dff ships under the NEW name; the stock name never enters the archive.
4. Verification on `059veh (remingtn)`: 10 parts → 10 new rows, 10 shop clones, 2 links, a 13-part line;
   `assertCarmodsModels` green; counts 23 + 2 = 25 links.
5. Field: the car in the mod shop shows its parts with the base's names and they fit.

## Measured

**Built 2026-08-19.** The derivation lives in `vehicle-installer/src/tuning-derive.ts` (moved there by
[014](../../../vehicle-installer/docs/plans/014-borrowed-tuning-parts.md) step 1, when a replacement car
turned out to need the same operation with `base = slot`); `vehicle-installer` gained the writing halves —
`stageVehicleImg`'s rename map, `ApplyVehicleOptions.partRenames` (applied to the SETTINGS text, whole-word,
so `spl_a_l` never rewrites part of `spl_a_l_b`), `mergeCarmodsLink`, and `carmods-guard.ts`.

**The naming scheme changed, and for a reason worth keeping.** The plan wanted prefix + slot token + the
stock suffix digit (`wg_l_lr_` + `v059` + `1`), which needs a table of the prefixes
`SetupVehicleUpgradeFlags` switches on — and that list is documented here with a trailing "…", i.e. not
exhaustively known. **The derived name is the whole stock name plus `_<slot>`** instead: every prefix rule
keeps matching whatever the set really is, and nothing is guessed. The fleet's longest lands on exactly the
19-character ceiling (`wg_l_lr_rem1_059veh`), which the guard checks rather than truncates.

**The `mods` line is the AUTHOR's, not the base's.** The plan derived it from the base's line; the data says
every part-shipping car already authors its own (`118veh, exh_a_l, …` under the STOCK names, expecting the
rename). So the settings line is used and the renames are substituted into it — and what the derivation adds
is a WARNING for the base's own parts a car names without re-modelling them (`072veh` names three of the
tornado's): they exist, the shop sells them, and they were modelled for another body.

**What is derived, all of it out of the built `data/`:** a part is base-specific when its `veh_mods.ide` TXD
column names a car and generic when it names `vehicle` (48 stock rows); the cloned IDE row keeps the stock
trailing columns and takes the ADDED car's TXD; the shop item is cloned into the section the stock item is
sold in and the price row keeps the stock GXT key (it is the same part re-modelled); a `link` is written only
when BOTH sides are shipped, and one side alone is a warning.

**Measured on an APFS clone of `build/original/sa`:** 5 cars ship 46 part dffs (059veh 10, 072veh 5, 118veh
14, 121veh 5, 124veh 12). The four that fit installed together: **34 parts, 46 rows/shop clones over the
fleet, 29 link pairs, worst `mods` line 15 of 16**, the renamed dffs in `vehicles2.img` with the STOCK
`wg_l_lr_rem1.dff` untouched in `vehicles.img`, and a second run byte-identical across `carmods.dat`,
`shopping.dat`, `veh_mods.ide` and the ledger.

## The ceiling the fleet actually hits

**8 wing pairs + stock 23 = 31, and the array is 30.** The guard refuses, naming the plugin and the pair
that would be the 31st:

```
carmods.dat holds 31 'link' pairs and the game's array is 30 (CLinkedUpgradeList, stock uses 23).
The 31st pair writes past it — static corruption, no message. Ship perfect-vehicle.asi
(asi/perfect-vehicle plan 002) to lift it, or drop 1 pair(s): wg_l_c_f_124veh/wg_r_c_f_124veh
```

So the full fleet needs **`asi/perfect-vehicle` 002**, or one pair dropped — the user's call, and the pair
the guard names is the Miata's second wing set. The guard steps aside on its own when `perfect-vehicle.asi`
is in the tree.

**A failed run is safe to retry.** The ceilings are checked after every row is merged, so a refusal leaves
the ide rows in place and no ledger — and reading only the ledger, the NEXT run would see those ids as
taken by strangers and renumber the whole fleet. `promisedIds` reads the tree as the ledger's fallback:
verified by re-running over the half-written tree, where `001veh` kept 19001.

Tests: 12 in `tuning.test.ts`; add-vehicles 46, vehicle-installer 185, the whole set 646 green.

**One thing left alone**: `121veh`'s authored line names `nto_b_s` twice. It costs an upgrade slot and the
game will take it as it is; the file is the author's.
