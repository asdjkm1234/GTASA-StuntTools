# Recon — ADDED cars (new model ids) that drive in traffic, park, tune and sound

> The research record of plan [102](readme.md); it graduated from `docs/ideas/add-new-vehicle` on 2026-08-19
> the same day it was written. Kept verbatim — the plan chains below it cite its sections.

**Original SA only** (2026-08-19, the user's call). Recon of the user's earlier implementation (a private
build tool, read once from `NO_COMMIT/1/src` and its output `NO_COMMIT/1/build`; **not reused — we write our
own**).

> **`NO_COMMIT/1/build` IS NOT A WORKING BUILD, and reading it as one cost this chain a whole field evening**
> (2026-08-19). It has **no `modloader.log`**, so it was never launched; its `data/vehicles.ide` and
> `data/handling.cfg` carry **zero** added-car rows, and no second copy of either exists anywhere in it. The
> added cars in that tree could not have loaded: a model id with no IDE row does not exist to the game.
> What IS real in it: the regenerated `carmods.dat`, `veh_mods.ide`, `shopping.dat`, the ModelVariations ini,
> the audio cfg and the Parked Maker ini — those are genuine outputs and were compared against ours
> byte-for-byte. What is NOT evidence: anything about how the ide/handling rows reached the game. Treat the
> `*.settings.txt` files in `modloader/Vehicles Added/` as the tool's staging copies, not as a proven road —
> the road that works was found from Mod Loader's own documentation
> ([modloader-data-files.md](../../../../../docs/gta-sa-original/modloader-data-files.md)).

It is also the recon of the DATA that tool was built for — the mod folder `9. Added Vehicles` (115 cars),
which we WILL use. This doc answers three questions asked before any plan is written: which plans the new
tool needs, which plans the existing `vehicle-installer` needs, and what the two share.

## What "added" means, against what we have

`vehicle-installer` REPLACES a stock slot: the car keeps the slot's id, its GXT name, its audio, its place in
traffic (`cargrp`, car generators) and its tuning set. An ADDED car is a new model id: nothing in the game
references it, so everything a stock slot gets for free has to be produced — and each of those productions
is a data file the install we ship to already reads:

| what an added car needs | who reads it in the reference install | file |
| --- | --- | --- |
| a model id nobody uses | the game; FLA's `FILE_TYPE_DFF` range 0–19999 (`docs/edge-cases/sa-formats.md`: map allocators stop at 19 000; the old tool started at 19 701 because "below 19 700 collides with Urbanize / HD Objects" in THAT build — in ours the free set must be READ off the built tree) | `vehicles.ide` (id) |
| its data rows | the game | `vehicles.ide`, `handling.cfg`, `carcols.dat`, `carmods.dat` — the SAME four merges `vehicle-installer` already does |
| a display name | CLEO's FXT loader (`build/original/sa/cleo/*.fxt` already in use) | `<gameName> <name>` in a `.fxt` |
| to appear in traffic | **ModelVariations 10.7** (mod `11`, sa layer) | `modloader/Model_Variations/ModelVariations_Vehicles.ini`: `[<baseId>] Global=<baseId>,<newId>,…` — the added car is a VARIATION of a stock slot |
| a sound | **FLA vehicle audio loader** (`Enable vehicle audio loader = 1`, on) | `data/gtasa_vehicleAudioSettings.cfg` line — shipped as `audio.txt`, or INHERITED from the base slot |
| to be parked somewhere | **Parked Maker 3.0.2** (mod `47`, common layer; FLA `Accept any ID for car generator = 1`, on) | `cleo/Parked Car Maker.ini` `[Cars] N=<id> x y z angle …` — shipped as `parked.txt` |
| special features | our `model_special_features.dat` path (vehicle-installer plan 011) | `features.txt` |
| its own tuning parts | the game + shop | the base slot's parts COPIED under new names: `veh_mods.ide` rows, `shopping.dat` items/prices, a `carmods.dat` line, `link` pairs |
| trailers / siblings | ModelVariations | `model-variations-extra.txt` (`Trailers1={{name}},…`, names resolved to ids) |
| a picture | `cars-server` | `screenshots/<folder>.png` |

## The data, as the user already authored it (115 folders, `9. Added Vehicles/vehicles/`)

```
001veh - 1971 Chevrolet Vega - alfamodding (manana)      ← slot - what it is - author (BASE SLOT[, more])
  001veh.dff  001veh.txd  [001veh1..4.txd]               ← exactly vehicle-installer's shape
  001veh.settings.txt                                    ← ide/handling/carcols/carmods blocks, id = `<:id>`
  [features.txt] [audio.txt] [parked.txt] [text.txt] [model-variations-extra.txt] [tuning_new_parts.txt]
  [wg_r_lr_rem1.dff …]                                   ← the BASE slot's tuning parts, re-modelled, under stock names
```

Census of the 574 files: 115 × (`dff`, `txd`, `settings.txt`), 45 extra `<slot><N>.txd`, 14 `features.txt`,
4 `audio.txt`, 1 `parked.txt`, ~40 part dffs under stock part names (`wg_*`, `spl_*`, `rf_*`, `exh_*`,
`bbb_*`, `fbb_*`, `bnt_*`, `fbmp_*`, `rbmp_*`). Plus `screenshots/` (one per folder), a `readme.txt` (FLA
needs `Car generators` raised and `Accept any ID for car generator = 1`) and `Free IDs on unmodified GTA
SA.txt` (the stock free-id list — superseded by reading the built tree).

**The conventions the data already carries, which a rewrite must honour** (a mod author's data keeps
working): the `(base)` suffix on the author field names the stock slot the car is a variation of (audio is
inherited from it when `audio.txt` is absent; its tuning parts are the ones being re-modelled; trains
variate on `freibox`/`freight`); `<:id>` in the ide line is the allocation placeholder; `{{name}}` inside
`model-variations-extra.txt` means "the id of that folder's slot"; `text.txt` is GXT lines; `parked.txt` is
Parked Maker's line without the id.

## What the old tool did that we do NOT want to carry

- **A hardcoded per-car tuning rename table** (`tuning.mapping.ts`: `remington_059veh`, `tornado_072veh`,
  `elegy_118veh`, …). The rewrite DERIVES it: a part dff in an added folder whose name is one of the base
  slot's `carmods` parts is a re-modelled copy → new unique name, a `veh_mods.ide` row cloned from the
  stock one, the stock `shopping.dat` item + price cloned under the new name, the base slot's carmods line
  with names substituted, and `link` pairs cloned. All of it is in the built `data/` — no table.
- **A hardcoded id start** (`19700`). Ids come from the free set of the BUILT tree (every IDE the tree
  loads, after mod-installer and the map allocators), inside FLA's range, with the guard that already counts
  DFF ids (`checkImgIdBudgets`).
- **Whole-file regeneration** of `carmods.dat`, `shopping.dat`, `veh_mods.ide`, the ModelVariations ini,
  the audio cfg — every one rewritten from a parsed "original" copy the tool carried. Ours MERGES by key
  into the built tree, as every vehicle-installer step does, and is idempotent on re-run.
- **"Tuned traffic" for every stock car** — it also emitted `[<slot>] Global=<id>,paintjob1,…,<parts>;
  TuningFullBodykit=1; TuningChance=75` for all ~200 stock slots (ModelVariations then tunes traffic
  randomly). A separate feature, optional, and a decision for the user — not part of "add a vehicle".

## The plans — proposed split

### New tool `tools/add-new-vehicle` (numbered chain beside its code)

1. **001 — Source shape and the resolver.** Where added cars live and how a tool finds them: the
   recommendation is a third reserved folder in the vehicles tree — `vehicles/added/` (flat) or
   `vehicles/sa/added/` (layered; `common/added/` is refused because the feature is SA-only) — read through
   the ONE resolver (`@opensa/tool-kit/vehicles-dir`), so the layer planner, the stray-folder refusals, the
   slot parsing and `screenshots/` rules are inherited rather than re-invented. Alternative the user may
   prefer: keep `9. Added Vehicles` as a MOD folder (its current shape, `vehicles/` + `screenshots/`
   inside) detected by a marker — then mod-installer must learn to skip it. Contract: `docs/contracts/
   vehicles.md` (the `(base)` suffix, `<:id>`, the five new file names, what a misspelling does).
2. **002 — Ids and the four rows.** The free-id allocator over the built tree (FLA range, map window
   respected, deterministic order so a rebuild gives the same ids — ids leak into saves via parked cars and
   ModelVariations), `<:id>` substitution, then the existing ide/handling/carcols/carmods merges and the
   IMG stage — i.e. `applyVehicle` with an id. Guard: `checkImgIdBudgets` + an id-collision refusal.
3. **003 — Name, sound, parking.** `.fxt` from the folder's real name (+ `text.txt` lines), audio line
   (`audio.txt`, or inherit the base slot's — a rule, logged), `parked.txt` → Parked Maker ini `[Cars]`
   (+ the FLA `Car generators` budget check).
4. **004 — Traffic: ModelVariations.** `[<baseId>] Global=…` merge by section, `model-variations-extra.txt`
   with `{{name}}` → id, the tuning-block siblings; refuses when mod `11` is not in the build. Field: the
   car appears in traffic, the trailer spawns.
5. **005 — Tuning parts, derived.** The clone-by-derivation above; `tuning_new_parts.txt` with allocated
   ids; the carmods guard from vehicle-installer plan 009 stays the acceptance test; the derived name scheme
   (prefix kept, ≤ 19 chars) and the two count guards (30 links / 16 parts) until `perfect-vehicle.asi` lifts them.
6. **006 — Pipeline + field.** The pmb `sa` stage slot (after mod-installer and vehicle-installer, before
   the guards), the ledger (`data/vehicle-adds.txt`?), cars-server shows added cars, one field round on the
   full 115.

Candidates the user decides on, not in the chain until he says so: **"tuned traffic" for stock cars**;
**trains** (FLA `gtasa_trainTypeCarriages.dat` — the old `trains-extender`; the deliberately kept
`NO_COMMIT/removed-mods/35.` (the "new train algorithm 5.1" mod, kept deliberately) says "we will write our own").

### Existing `vehicle-installer` — plans it needs regardless

- **012 — the two unread file kinds** (found 2026-08-19 by the 212-folder census): `model-variations-extra.txt`
  (8 cars ship trailer variations that the build drops — the built `ModelVariations_Vehicles.ini` is
  byte-identical to the mod's) and `text.txt` (slamvan's two part names missing from the built GXT; the
  channel is a `.fxt` in `cleo/`). Plus the settings-fallback trap (a car without `.settings.txt` but with
  either file would have it read AS settings) and the contract rows.
- **013 — `audio.txt` and `parked.txt` for REPLACEMENT cars** — the same two merges; a replacement car that
  wants its own engine sound or a parked spot is the same data as an added one.

### Shared — extracted once, used by both (tool-kit or a vehicle-common package)

| piece | today | who needs it |
| --- | --- | --- |
| `applyVehicle` (img stage + the four merges + features + tuning_new_parts + cleo carry) | vehicle-installer | both — the added car is a replacement car plus an id |
| `.fxt` writer (GXT lines → `cleo/cleo_text/<slot>.fxt`) | nobody | 012 (text.txt), new 003 |
| ModelVariations ini section merge (+ `{{name}}` → id) | nobody | 012, new 004 |
| FLA audio cfg line merge | nobody | 013, new 003 |
| Parked Maker ini `[Cars]` merge | nobody | 013, new 003 |
| free model-id allocator over a built tree | `findFreeBlock` (map-placement, ≤ 19 000) | new 002, tuning_new_parts ids (009 today demands literal ids — `<:id>` would serve both) |
| `(base)` suffix + `<:id>` in the settings parser | `parseVehicleSlot`, `settings.ts` | new 001/002; harmless for replacements |
| `vehicles-dir` resolver: `added/` reserved | tool-kit | new 001; cars-server, cutscene census (must IGNORE added cars) |

The rule for the split: a merge that writes a file the install reads lives ONCE, keyed, idempotent; the
new tool owns only what is specific to a NEW id — allocation, the `(base)` inheritance, the derived tuning
clone, the traffic entry. Everything else is vehicle-installer's, called with an id.

## Restrictions checked

`docs/restrictions/sa-target.md`: model id ≤ 19 000 is the MAP window, FLA's DFF range reaches 19 999 — the
allocator must state which window it uses and why; FLA pools (TXD 6000 — 115 cars × up to 5 txds is 575
more dictionaries, price it against `checkImgIdBudgets` BEFORE the first build); `Car generators` is an FLA
number (`#Car generators = 500`, commented = default) that Parked Maker spends — budget it. `docs/gta-sa-
original/fla-id-limits-are-part-of-the-savefile.md`: DFF ids do not change the save schema, but parked
cars and variations DO land in saves, so ids must be stable across rebuilds.

## Tuning parts: what the old code used the ORIGINAL name for, and the ceilings it sat on

Read off `tuning.manager.ts`: a part dff shipped under a STOCK name is a re-modelled copy, and the stock
name is used ONLY to look things up — (1) the `veh_mods.ide` row's trailing columns (draw distance, flags),
re-emitted as `<newId>, <newName>, <ADDED car's txd>, <columns>`; (2) the `shopping.dat` item + price,
cloned under the new name; (3) the `carmods.dat` `link` pair (a right wing has no shop entry; its left
partner is found and `link newLeft, newRight` is written); (4) the car's carmods line = nitro + the new
names that have a shop entry. Nothing else. The new name was `exh_lr_rem1` → `exh_lr_<n>1` with `n` the
car's ordinal in the hardcoded table, always ≤ 12 chars.

**The prefix is behaviour**: `CAtomicModelInfo::SetupVehicleUpgradeFlags(name)` derives the component's
flags FROM THE NAME (`exh_`, `wg_l_`, `spl_`, `rf_`, `fbmp_`, `bnt_`, …). So the derived scheme keeps the
prefix and replaces the tail with a token from the car's slot: `wg_l_lr_` + `v059` + index → `wg_l_lr_v0591`
(13 chars), deterministic, no table.

**Length**: the carmods parser has no explicit limit (`strtok` over a 1 024-byte line, lookup by hash), but
the IDE loader reads a model name with `sscanf %s` into `char[24]` (> 23 chars smashes the stack) and an IMG
entry name is 24 bytes INCLUDING `.dff` → base name ≤ 19. The old scheme's ≤ 12 was inside both. Guard: ≤ 19.

**Two count ceilings the old code did not know and its build sat on** (gta-reversed `Models/
VehicleModelInfo.{h,cpp}`, `LoadVehicleUpgrades` 0x5B65A0 region):

| ceiling | stock | our build | old build | past it |
| --- | --- | --- | --- | --- |
| `CLinkedUpgradeList` (`0xB4E6D8`): `m_anUpgrade1/2[30]` — `link` pairs in the WHOLE `carmods.dat` | 23 | 23 | **30 — exactly full** (23 + 7 added wing pairs) | the 31st pair writes past the arrays — silent static corruption. `add-vehicles` ships 8 wing pairs → 31. FLA does not lift it |
| `CVehicleModelInfo::m_anUpgrades[18]` — parts on ONE car's carmods line, +`hydralics`+`stereo` appended unconditionally → ≤ 16 listed | `jester` 16 (full) | 15 max | 16 | the 17th listed part overruns the array |

**Decision (the user, 2026-08-19): these are lifted by a SEPARATE asi, `perfect-vehicle.asi`** (the name
over `perfect-tuning.asi` because the same plugin is the home for every vehicle-side ceiling that comes
later — car generators, train carriages), on `asi/sdk` like perfect-map / perfect-cutscene: relocate +
enlarge the 30-pair list and the per-car 18-slot array (004-style relocation with every access site
catalogued and byte-verified), each behind its own flag, FLA coexistence probed with the SDK's live-byte
verify. Until it ships, the tool GUARDS at 30 / 16 and refuses, naming the plugin — the in-reserve rule.
RE is that plugin's plan 001 (sites, original bytes, gta-reversed refs); the two numbers above are the
acceptance test (31 links, 17 parts, game boots and the shop works).

## Decisions (the user, 2026-08-19) and the id budget, measured

- **Source**: `mods-src/original/add-vehicles/` — its own root beside `vehicles/`, the SAME shape
  (`models/` 115 folders, `screenshots/` 115 pictures; a `reserved/` folder is temporary and is not read).
  So plan 001 is "the vehicles-tree resolver serves a second root", not a new resolver.
- **Trains**: later, in this same tool (not now).
- **"Tuned traffic"**: YES — a plan of its own in the chain.
- **Id window 19 001–19 999: FITS.** Measured on the built tree (`build/original/sa`, every `.ide` the tree
  carries incl. `modloader/`, sections objs/tobj/anim/weap/peds/cars/hier): 15 091 ids in use, highest
  18 656, **0 used in 19 001–19 999 (999 free, one run)**, 26 used in 18 631–19 000 (the map window).
  Demand today: 115 cars + 46 re-modelled part dffs = **161 ids**, headroom 838 for trains and later cars.
  The allocator therefore takes 19 001 upward, deterministic (folder order), and refuses past 19 999 — the
  map allocators stop at 19 000, so the two windows never meet. Re-measure before every build: a mod that
  starts using the window shows up here first.

## Open questions — answered above; what remains is the tool's name (`tools/add-vehicles`, matching the
source root) and the order of the chain, which the plans fix.
