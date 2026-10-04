# 001 — Source root and resolver

**Status: BUILT 2026-08-19.** Where added cars live, how every tool finds them, and the one new name in the
folder convention.

## The source (already authored by the user)

`mods-src/original/add-vehicles/` — `models/` (115 folders) + `screenshots/` (115 pictures); a `reserved/`
folder is temporary and is NOT read (it is a stray by the resolver's rules — see below). Each car folder is
`vehicle-installer`'s shape plus up to six optional files:

```
001veh - 1971 Chevrolet Vega - alfamodding (manana)
  001veh.dff  001veh.txd  [001veh1..4.txd]
  001veh.settings.txt            ← ide line with `<:id>`, handling, carcols, carmods blocks
  [features.txt] [audio.txt] [parked.txt] [text.txt] [model-variations-extra.txt] [tuning_new_parts.txt]
  [<stock part name>.dff …]      ← the BASE slot's tuning parts, re-modelled (005)
```

The folder name is `<slot> - <what it is> - <author> (<base>[, <base2>…])`: the FIRST field is the new
slot (`001veh`, ≤ 7 chars so it can also be the GXT key `001VEH`), the LAST field ends in a parenthesised
list of STOCK slots — the base the car is a variation of. Every `(base)` in the 115 is a stock slot; the
first is "the" base (audio inheritance, tuning parts), the rest are additional traffic parents (004).

## Steps

1. **`resolveVehicleSources` takes a ROOT, not a folder name.** Today it reads `mods-src/<game>/vehicles`;
   it gains an `add-vehicles` root with the SAME grammar (flat / `models/`+`new/` / layered `common|sa|opensa`,
   the same refusals for stray and mis-cased folders, `screenshots/` per layer). One rule differs and is
   stated in code: a layered `add-vehicles` tree refuses `common/` and `opensa/` (SA-only feature) — the
   target is `sa` or nothing. `reserved/` is refused as a stray until the user removes it; the refusal
   message says which folder.
2. **`parseVehicleSlot` learns the `(base)` suffix** — returns `{ slot, bases }`; absent = `bases: []`,
   which is today's behaviour for `vehicles/` (harmless there). A `(base)` naming a slot the built tree's
   `vehicles.ide` does not have → refused, naming both (a mistyped base is a car that never enters traffic,
   silently, otherwise).
3. **`tools/add-vehicles` skeleton** — package, `cli.ts` (`add-vehicles --game <built sa tree> --in
   <root> --out <tree> [--only <slot>…] [--target sa]`), `install.ts` Node API the pipeline calls, the
   ledger name `data/vehicle-adds.txt`; depends on `@opensa/vehicle-installer` + `@opensa/tool-kit`; no
   merge code of its own.
4. **Contract** — `docs/contracts/vehicles.md`: a new §1b "an ADDED vehicle folder": the root, the slot
   rules, the `(base)` suffix, the optional files (each pointing at the plan that reads it), and for each
   name what a misspelling does. `docs/restrictions/architecture.md` "one source folder, one reader" gains
   the second root in its sentence.
5. **Tests** — resolver: the new root, the SA-only layer refusal, `(base)` parse + unknown-base refusal,
   `reserved/` as a stray; all negative first.

## Measured

**Built 2026-08-19.** The resolver did NOT need a new root parameter — `resolveVehicleSources` already takes
a path, so the second root is a second CALL. What it did need was three things, and two of them are the
tree the user actually authored:

- **`reserved/` is a reserved NAME**, beside `screenshots/`, rather than a stray. The plan said refuse it;
  the folder turned out to hold a car he set aside on purpose (a `cabbie` replacement + its screenshot), and
  a refusal there stops every tool that reads the root until he deletes something. Reserved-and-never-scanned
  is the honest reading of "temporary and unread", and it is now a contract row rather than a guess.
- **`parseVehicleBases`** beside `parseVehicleSlot` (not a changed return type — `parseVehicleSlot` has
  callers in four tools), and `VehicleSource.bases`. Census of the 115: **every folder has exactly one
  base**, none has a list, and the eight `freibox`/`freight`/`freiflat` trailers are the only repeats.
- **`tools/add-vehicles`** — `sources.ts` (the resolver call, the SA-only layer refusal, the base
  validation against the built `vehicles.ide` through `parseVehicleDefs`), `cli.ts`, the readme.

**Against the real tree**: `--game build/original/sa` resolves **115 of 115**, every `(base)` is a slot the
built `vehicles.ide` defines, every slot is ≤ 7 characters (it is also the GXT key), and `reserved/` is
skipped silently-by-contract rather than refused. Tests: 10 in `sources.test.ts` (incl. a real-tree case
that pins 115 = the folder count) + 7 in tool-kit's `vehicles-dir.test.ts`; tool-kit 121 green.

The tool is registered in `vitest.config.ts` and in eslint's node/console block — a new tool that is in
neither is a tool whose tests never run and whose CLI cannot print.
