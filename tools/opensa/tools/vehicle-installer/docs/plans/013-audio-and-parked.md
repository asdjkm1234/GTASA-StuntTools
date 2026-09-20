# 013 — `audio.txt` and `parked.txt` for a replacement car

**Status: BUILT 2026-08-19** (field verdict pending —
[the round](../../../add-vehicles/docs/plans/102-add-vehicles/field-checks.md)). Part of [central plan 102](../../../add-vehicles/docs/plans/102-add-vehicles/readme.md).
Neither file exists in `mods-src/original/vehicles` today; both exist in `add-vehicles` (4 `audio.txt`,
1 `parked.txt`) and the merges they need are the same for a replacement car that wants its own engine sound
or a parked spot. Built here so the new tool imports them — and so a replacement car can use them.

## The two files

- **`audio.txt`** — one line of FLA's `data/gtasa_vehicleAudioSettings.cfg` (`Enable vehicle audio loader = 1`
  is ON in the reference install): `<model> <engine-on> <engine-off> … <horn> <door> <radio> …` — the columns
  of the stock file; the first token is the model NAME. Merge: replace the line whose first token is the
  slot, append if absent; CRLF and the header block preserved. FLA's loader is keyed by name, so a
  replacement car keeps its stock line unless it ships this file — nothing is inherited here (the
  `(base)` inheritance is add-vehicles 003's business).
- **`parked.txt`** — one or more Parked Maker lines WITHOUT the id: `<x> <y> <z> <angle> [colour1 colour2
  …]` as the mod writes them (`35 35 2495.98 -1673.15 13.25 0.00` in the only instance: the two leading
  numbers are the mod's own colour/flag columns — read its readme before fixing the column list). Merge
  into `cleo/Parked Car Maker.ini` `[Cars]`: `N=<id> <line>`, N continuing from the highest present,
  idempotent by (id, line). Requires mod 47 and FLA `Accept any ID for car generator = 1` (on) — absent →
  warning, nothing written. The FLA `Car generators` budget (`#Car generators = 500`, commented = default
  500) is COUNTED: the built ini's `[Cars]` rows + stock car generators must stay under it, or the run
  warns with the number to raise.

## Steps

1. **`audio.ts`** — parse/replace/append by first token; a malformed column count (against the stock file's
   own header) → warning, line dropped. Called from `applyVehicle`.
2. **`parked.ts`** — `[Cars]` merge as above + the budget count. Called from `applyVehicle` with the car's id
   (a replacement car's id is its stock row's).
3. **Contract** — `docs/contracts/vehicles.md` §1: both names, the id-less line shape, the two mods they
   need, what a misspelling does.
4. **Fixtures + tests** — the `audio.txt` of `106veh` and the `parked.txt` of `001veh` from `add-vehicles`
   (manifest lines by name); tests: replace vs append, header preserved, malformed line warned, `[Cars]`
   numbering continues, idempotence, the budget warning.
5. **Field** — a replacement car with an `audio.txt` (author one from its stock line for the test) sounds
   different; a `parked.txt` car stands where it says after a NEW GAME.

## Measured

**Built 2026-08-19.** `audio.ts` (replace the row by its first token, else insert into the block the file
itself sets aside — above `;the end`; column count taken from the table's OWN first data row, a mismatch
drops the row with the two counts named) and `parked.ts` (`[Cars]` rows `N=<id> <line>`, numbering from the
highest key present, idempotent by the whole value; the id looked up through `ideModelNames`). Both are
`sa`-only, like the ModelVariations merge — FLA's loader and mod 47 are the real game's.

**The column shape came out of the script, not a readme** — Parked Maker ships none, but its own
`%i %i %i %f %f %f %f` (in the compiled `.cs`) says a row is `<id> <colour> <colour> <x> <y> <z> <angle>`,
so a `parked.txt` line is six columns and a different count is refused.

**The budget turned into a measurement** (`docs/gta-sa-original/car-generators-500-and-the-map-1045.md`):
the map ships **1045** car-generator records (125 binary IPL streams; identical in `game-src/original` and
`build/original/sa`, so the mod set adds none) against an array FLA's log says it applies at **500**. Not a
contradiction — the map's are streamed with their IPL section, while a `[Cars]` row is created through CLEO
and holds its slot for the session. The resident peak has never been measured here, so the installer
REPORTS the count with the limit beside it and refuses only our own rows reaching it; a percentage gate
would have been a fitted constant standing in for that measurement. Row in `docs/restrictions/sa-target.md`.

Tests: 23 new (`audio.test.ts` 10, `parked.test.ts` 13), tool suite 18 files / **183** green. Two fixtures,
one manifest line each, out of the ADDED-cars root (`vehicles/` ships neither file today):
`vehicles/106veh-audio.txt`, `vehicles/001veh-parked.txt`; regeneration 132/132.

**Against the real files** (a scratch tree holding the built `gtasa_vehicleAudioSettings.cfg`,
`Parked Car Maker.ini`, `vehicles.ide` and the FLA ini): the audio table went 46 721 → 46 920 B with CRLF
kept, the row landed between the file's `; you will add entries of new vehicles probably here` block and
`;the end`, and a second run was byte-identical. The parked ini came out
`0=410 35 35 2495.98 -1673.15 13.25 0.00` — the same shape as the user's old tool's own output
(`0=19773 35 35 2495.98 …`, differing only in the id, which is `add-vehicles`' to allocate).
