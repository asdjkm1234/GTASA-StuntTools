# A mod's file lands in one archive while its stock twin stays in another, and the stock one wins

**FIXED 2026-08-20, field-confirmed the same day** — the user played the delivered build and reported it
good, the slamvan included.
[Plan 103](../../../tools/img-splitter/docs/plans/002-one-owner-per-archive-entry.md) steps 1–3 and 6 shipped: the vehicle bucket
now takes everything `vehicles.ide` and `veh_mods.ide` name plus every `<car><n>.txd`, a build holding one
name in two of the archives the split owns is refused, and a car's files stop straddling siblings. On the
rebuilt tree the **39 duplicates of ours are 0**, `slamvan.txd` has one owner and it is the mod's 9 359 360 B
copy, and all 36 paintjob dictionaries are the mods'. Step 4 shipped with it — a replaced slot gives up its stock
`<slot>.txd` and `<slot><n>.txd`, which drops nothing on today's fleet and closes the door for the day a mod
ships fewer paintjobs than stock (which the user confirms is fine in the game anyway).

Field-found by the user: the **slamvan has no textures at all** — before tuning and
after, body flat in its paint colour, chrome and wheels white. Every other car he drove was fine.

## What is actually in the build

`slamvan.txd` exists **twice**:

| archive | size | whose |
| --- | ---: | --- |
| `models/gta3.img` | 14 336 B | the STOCK dictionary |
| `models/vehicles2.img` | 9 359 360 B | the mod's |

The game resolves a streaming entry by name across every registered archive; with two entries under one
name only one can win, and the field says the stock one does. The mod's model asks for `gmc68_chrmap`,
`gmc68_fabric`, `remap_gmc68` … — **none of which the stock 14 KB dictionary contains** — so every material
falls back to flat colour. That is the screenshot exactly.

Checked and NOT the cause: the archive entry is byte-identical to the mod's own file (padding aside), the
dictionary is structurally sound (23 textures, DXT1/DXT3, names matching the model's materials bar the three
shared ones from `vehicle.txd`), and `vehicles2.img` is registered in `gta.dat`.

## The scale: 39 names, and one of them is a car's whole body dictionary

Measured over the built `sa` tree — names held by more than one archive:

| what | count | example |
| --- | ---: | --- |
| paintjob dictionaries `<car>N.txd` | 34 | `blade1.txd`, `elegy2.txd`, `uranus3.txd` — stock 34 816 B vs the mod's 0.5–2.8 MB |
| a car's BASE dictionary | **1** | `slamvan.txd` — the visible one |
| tuning-part models | 3 | `bnt_lr_slv1.dff`, `bnt_lr_slv2.dff`, `coach.dff` |

So twelve cars are wearing stock paintjobs instead of their mods', silently, and one car has no textures at
all. Nothing in the build says a word about it.

## Why the names stay behind — and it is the SAME blind spot as the tuning clash

`tools/img-splitter` sorts every archive entry into a bucket from the IDE rows that claim it, and its two
documented resolutions both keep an entry in `map` (= `gta3.img`):

- **unclaimed** — no IDE row names it. A paintjob dictionary `slamvan1.txd` is named by no row anywhere, so
  all 34 of them stay behind.
- **contested** — claimed by two buckets. `slamvan.txd` is claimed by `vehicles.ide` (bucket `vehicles`) AND
  by `veh_mods.ide` rows whose TXD column is `slamvan` (bucket `map`, because the classifier only counts a
  part as a vehicle part when `carmods.dat`'s `mods` line names it — and `bnt_lr_slv1`/`2` are the two stock
  parts no shop offers, so they are on no line). Contested → `map`.

That last one is the **same false premise this session already disproved for the tuning derivation** —
"a car's parts are the parts `carmods.dat` names" — though the blind spot here is narrower than the
derivation's was, and worth stating exactly: `vehiclePartsFromCarmods` reads `link` pairs and `wheel` rows
as well as `mods` lines, so it DOES catch the mirrored right-hand parts. The models it misses are
`bnt_lr_slv1` and `bnt_lr_slv2` alone — the only two stock parts that appear in no section of `carmods.dat`
at all, because no shop offers them. Two rows were enough to contest a car's whole dictionary. The honest
source is the table the row sits in ([`docs/contracts/vehicles.md`](../../contracts/vehicles.md)).

The splitter's own comment says a duplicate is harmless because "the game resolves an entry by NAME across
every registered archive" — true when the entry exists once. It does not anticipate the vehicle installer
staging a second copy into a different archive of the same tree.

## The shapes a fix could take — 1 and 2 shipped, 3 was not needed

1. **Classify by the TXD column** (`vehiclePartsFromCarmods` → the same rule the derivation now uses), and
   claim `<car>N.txd` for the car's bucket. Cheap, fixes the 35 dictionary names at their root, and closes
   the `bnt_lr_slv*` pair too.
2. **A build guard that refuses a tree holding one name in two archives**, naming both and their sizes.
   Needed whatever else ships: the class is silent by nature, and shape 1 cannot cover a name no rule
   predicts.
3. **Stage into the archive that already owns the name** (or delete the loser). The most robust and the most
   expensive — it means rewriting `gta3.img` in the vehicles stage.

Shape 1 shipped as "the file a row sits in decides" — stronger than the TXD column and with nothing left to
contest — and shape 2 as `assertOneOwnerPerEntry`. Shape 3 (rewriting `gta3.img` to delete the loser) was
not needed once the names never landed there in the first place. The guard is what says the fix held,
exactly as the staged-clash guard does for [the part-name clash](vehicle-part-name-clash-between-mods.md).

## Not a regression from plan 014

The duplicate is created by the splitter/installer pair and predates this session: the mod's `slamvan.txd`
bytes in the archive are the mod's own, unchanged, and nothing in 014 touches a base dictionary. What 014
did was put the user in front of the slamvan for the first time.
