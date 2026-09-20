# Mod Loader and data files: what it MERGES, what it REPLACES, and the name that decides which

**Learned the hard way on 2026-08-19** — seven field launches of central plan 102 went into this, and every
one of them failed for a reason that is one line of Mod Loader's own documentation. Written down so the next
person spends none.

Mod Loader (`modloader.asi`, 0.3.9) is a third-party plugin the reference install runs, and its
`gta3.std.data` plugin is what a mod's data files go through. Its shipped documentation
(`modloader/.data/plugins/gta3/std.data.md`) has the whole table; these are the parts that bite.

## The three behaviours

| | what it means |
| --- | --- |
| **Override** | a file in a mod folder REPLACES the game's file of that name |
| **Merge** | its lines are merged into the game's file |
| **Readme** | data lines are matched **by their SHAPE** out of any text file, whatever it is called |

`*.ide`, `handling.cfg`, `carcols.dat`, `carmods.dat`, `shopping.dat`, `gta.dat`, `cargrp.dat`,
`object.dat`, `weapon.dat` and many more support Override AND Merge. A subset also supports Readme:
`gta.dat`, `carcols.dat`, `carmods.dat`, `handling.cfg`, `weapon.dat`, and — by the documentation's own
footnote — **ide lines for `cars`, `peds` and tuning parts in the `objs` section** (i.e. `vehicles.ide`,
`peds.ide`, `veh_mods.ide`).

## The rule that costs launches

**The FILE NAME decides.** A file named after a stock data file is taken as that file — and for an
incomplete one that means the stock content is REPLACED, not extended:

- `modloader/<mod>/vehicles.ide` holding 115 added cars **deleted the stock 212**. The symptom was a crash
  deep in `carmods.dat` loading, on a null model info for `admiral` — a stock car that no longer existed.
- `modloader/<mod>/handling.cfg` holding 115 added lines **deleted every stock handling line**. The symptom
  was FLA's message box: `Handling.cfg identifier name LANDSTAL is assigned to vehicle, but cannot be found`.

**A `.txt` extension is not the answer either.** `veh_mods.txt` works for the Epoxi Wheel Pack because
`veh_mods.txt` is a name Mod Loader KNOWS; an arbitrary `vehicles.txt` is logged as
`Found file "vehicles.txt" with handler "<none>"` and then `Parsing readme file` — it is scanned for data
lines, not read as a data file.

**What works is the readme road**: put the rows in a text file named after nothing in particular
(`<slot>.settings.txt`), and Mod Loader matches them by shape and merges them. That is what
`tools/add-vehicles` writes, and it is what the field accepted.

## Why an added car's rows may not be baked into `data/` at all

`data/vehicles.ide` and `data/handling.cfg` are read from `default.dat` while the game boots. With 115 added
`cars` rows in them the real install **dies before a window appears** — and leaves no crash dump, because FLA
puts up a message box and exits rather than faulting. Through Mod Loader the same rows are merged later and
the fleet loads.

**The mechanism behind that difference is not yet known** — it is worth one RE session, because "do not put
new vehicles in `default.dat`'s files" is currently a field rule rather than an explained one. What IS known:
the boot-time failure is not a count ceiling that anyone has found (`VehicleStructs`/`VehicleModels` are
`unlimited` in the OLA ini, and raising FLA's `Vehicle Models` made things worse — see below).

## One adjuster setting that is NOT the answer — and one that is still LIVE

- **`Vehicle Models = 400`** (FLA), while OLA already has `VehicleModels = unlimited`. Two adjusters
  relocating one store: the game then read `ms_vehicleModelInfoStore` at its stock address `0xB1F654` with a
  zeroed vtable and died in `CModelInfo::AddVehicleModel` (`0x4C6770`). Tried, reverted. **Do not set both.**
- **`Vehicle colors = 256`** (FLA) — **this one turned out to be the cause of the crash the bisect above was
  chasing, and it is reverted now.** We had set it earlier the same day on an inference (the palette is 142
  `col` rows against FLA's annotated 128), then written it up as already reverted while it stayed live in
  all three trees. Crossing "over 255" applies a uint32 colour-id patch family (+122 memory changes,
  `3712` → `3834`) and this install dies at the end of loading with it. Commented back out, the full fleet
  and the full tuning load. Full write-up:
  [the issue](../open-issues/fixed/added-cars-crash-after-loading.md) ·
  [the measurement](vehicle-colour-table-128.md).

## Where this is used

- `tools/add-vehicles/src/loose-files.ts` — writes the models and the `<slot>.settings.txt`.
- `docs/contracts/vehicles.md` §1b — the contract a mod author reads.
- `tools/add-vehicles/docs/plans/102-add-vehicles/field-checks.md` — the field round.
