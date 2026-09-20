# 102 — Added vehicles for the `sa` target: `tools/add-vehicles`, what `vehicle-installer` gains, and `asi/perfect-vehicle`

**Status: BUILT 2026-08-19 — every chain, in one session. The FIELD ROUND is what remains** (see below).
**Original SA only** — the OpenSA engine is not in scope (its own vehicle
system has no ModelVariations/FLA/CLEO to drive, and the user parked it). The research is
[recon.md](recon.md) (graduated from `docs/ideas/add-new-vehicle` the same day); the decisions in it are the
user's and are not re-argued here.

An ADDED car is a replacement car plus a new model id and everything a stock slot otherwise gets for
free: a name, a sound, a place in traffic, a parking spot, its own tuning set. Each of those is a data file
a mod the install already ships reads — ModelVariations 10.7 (mod 11), FLA's vehicle audio loader, Parked
Maker 3.0.2 (mod 47), CLEO's FXT loader — so the work is merges into the built tree, keyed and idempotent,
the way every `vehicle-installer` step already works. Source: `mods-src/original/add-vehicles/` (`models/`
115 cars, `screenshots/`), the same shape as `vehicles/`.

## Why this is an umbrella, and why it lives HERE

It spans four homes and the pipeline, and each piece is shippable alone. It sat in `docs/plans/` for that
reason until 2026-08-20, when the user's rule made the central folder engine-only: a toolchain plan lives in
the chain of the tool whose rule it is — `add-vehicles`, here — and names its reach rather than sitting apart
from all of it.

| chain | what | status |
| --- | --- | --- |
| [`tools/vehicle-installer/docs/plans/012`](../../../../../tools/vehicle-installer/docs/plans/012-unread-file-kinds.md) | `model-variations-extra.txt` + `text.txt` read at last; the settings-fallback trap; `.fxt` + ModelVariations merges are born here | **BUILT** |
| [`tools/vehicle-installer/docs/plans/013`](../../../../../tools/vehicle-installer/docs/plans/013-audio-and-parked.md) | `audio.txt` + `parked.txt` for replacement cars; FLA audio cfg + Parked Maker merges are born here | **BUILT** |
| [`tools/add-vehicles/docs/plans/`](../../../../../tools/add-vehicles/docs/plans/readme.md) `001`–`007` | the new tool: resolver root, ids + rows + IMG, name/sound/parking, traffic, derived tuning, tuned traffic, pipeline + field | 001–007 **BUILT** (007's field round waits on the link ceiling) |
| [`asi/perfect-vehicle/docs/plans/`](../../../../../asi/perfect-vehicle/docs/plans/readme.md) `001`–`002` | the two `carmods.dat` ceilings (30 `link` pairs, 16 parts per car) — RE, then the patches | 001 **DONE**, 002 **BUILT** for the link half (256); the per-car half is researched and deliberately not built |
| `tool-kit` | the second vehicles ROOT through the one resolver; the free-id allocator over a built tree | inside add-vehicles 001/002 |
| `perfect-map-builder` | the `add-vehicles` stage after `vehicles`, before the guards; `checkImgIdBudgets` already counts the ids | inside add-vehicles 007 |

## The shared layer — decided here so no chain re-invents it

The rule: **a merge that writes a file the install reads lives ONCE, in `vehicle-installer`, keyed and
idempotent; `add-vehicles` imports it and owns only what is specific to a NEW id.** `add-vehicles` depends on
`@opensa/vehicle-installer` (its Node API, plan 005's shape, as the pipeline already does) and on
`@opensa/tool-kit`; nothing is copied.

| piece | home | born in | used by |
| --- | --- | --- | --- |
| `applyVehicle` (IMG stage, ide/handling/carcols/carmods merges, features, `tuning_new_parts`, `cleo/` carry) | vehicle-installer `apply-vehicle.ts` | exists | add-vehicles 002, with an `id` |
| `.fxt` writer — GXT lines → `cleo/cleo_text/<slot>.fxt` | vehicle-installer `fxt.ts` | 012 | 012 (`text.txt`), add-vehicles 003 |
| ModelVariations ini section merge, `{{name}}` → id | vehicle-installer `model-variations.ts` | 012 | 012, add-vehicles 004/006 |
| FLA audio cfg line merge | vehicle-installer `audio.ts` | 013 | 013, add-vehicles 003 |
| Parked Maker `[Cars]` merge | vehicle-installer `parked.ts` | 013 | 013, add-vehicles 003 |
| `(base)` suffix on the author field; `<:id>` in the ide line | tool-kit `vehicles-dir` (`parseVehicleSlot`), vehicle-installer `settings.ts` | add-vehicles 001/002 | replacements unaffected (absent = today's behaviour) |
| second vehicles ROOT (`add-vehicles/`) through `resolveVehicleSources` | tool-kit `vehicles-dir` | add-vehicles 001 | add-vehicles, cars-server; the cutscene census keeps reading `vehicles/` only |
| free model-id allocator over a built tree (every IDE, deterministic) | tool-kit `free-ids.ts` | add-vehicles 002 | add-vehicles; later `tuning_new_parts` rows without ids |
| carmods ceilings guard (30 links / 16 parts / name ≤ 19, prefix kept) | vehicle-installer `carmods-guard.ts` beside `assertCarmodsModels` | add-vehicles 005 | every install path — a replacement car's line above 16 is silent today |

## Order

012 → 013 (each closes a real gap on the shipped fleet and builds a merge the new tool needs) →
add-vehicles 001 → 002 → 003 → 004 → 005 → 006 → 007. `perfect-vehicle` 001 (RE) can start any time; 002
(patches) ships before add-vehicles 005 is allowed to exceed the guards, never before. Trains (FLA
`gtasa_trainTypeCarriages.dat`) come LATER in `add-vehicles` as 008+, not now (the user's call).

## Restrictions checked (`docs/restrictions/`)

- `sa-target.md`: model id window — the map allocators stop at 19 000, FLA's DFF range reaches 19 999;
  **measured 2026-08-19: 0 ids used in 19 001–19 999, demand 161** (recon). FLA pools: 115 cars × up to 5
  TXDs is ≤ 575 new dictionaries against `TXD 6000` — priced by `checkImgIdBudgets` on the built tree in 007
  BEFORE the first field run. The three new rows (link pairs, parts per car, part name) are this plan's.
- `architecture.md` "one SOURCE folder, one reader": the new root is read through `resolveVehicleSources`
  only; "a build asks for a target": the stage is `sa`-only and refused for `opensa`.
- `build-vs-runtime.md` "mods are installed, never overlaid": every output is a merge into the built tree.
- `docs/gta-sa-original/fla-id-limits-are-part-of-the-savefile.md`: DFF ids do not change the save schema,
  but parked cars and variations land in saves → ids are deterministic across rebuilds (002).

## The field round

Every step's field verdict is a row in [field-checks.md](field-checks.md) and they are collected in ONE
round at the end of the chain (the user's call, 2026-08-19) — a delivery, a boot and a drive per step is
not worth it when each verdict costs seconds of play. A step is DONE when its code, tests, numbers and
docs are in; its row stays open until the round is run.

## What the chain actually cost, and what it found

Nine plans in one session (`vehicle-installer` 012–013, `add-vehicles` 001–007, `perfect-vehicle` 001–002).
The full fleet — **115 cars and 46 re-modelled tuning parts** — installs into a built `sa` tree in **6.6 s**,
and a second run is byte-identical. Four defects nobody was looking for fell out of it, each of them silent:

1. **`handling.cfg` refused a digit-leading id.** An added car's handling id IS its slot (`001VEH`), and
   "a car row starts with a letter" dropped the whole block — the car would have run STOCK physics.
2. **The palette merge was not idempotent**, and it was walking a 128-row table the build had already
   passed (140 rows, three of them duplicates it had created itself). `Vehicle colors = 256` since.
3. **`petro` and `towtruck` lost their trailers** the first time traffic was written: they are each the base
   of an added car AND author `Global=Trailers1`, so writing the key outright left the trailer set
   referenced by nothing.
4. **A failed run renumbered the fleet on retry** — the ids are read back off the tree now when the ledger
   is missing.

## Acceptance for the whole plan

- The 115 cars install in one `pmb … --until sa` run; `checkImgIdBudgets` + `assertCarmodsModels` green.
- Field: an added car is met in traffic (ModelVariations), one is parked where `parked.txt` says, its
  name shows in the HUD, its engine sounds, its shop parts fit and the shop shows their names; the two
  `vehicles/` gaps (trailers on 8 trucks, the slamvan part names) are closed on the way.
- The ceilings are guarded (refusals name `perfect-vehicle`) until the plugin lifts them in the field.
