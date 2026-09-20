# @opensa/vehicle-installer

Install GTA-SA **vehicle mod folders** onto a base game into a single drop-in `--out`. Each vehicle's `dff`/`txd`
go into `gta3.img` (replace by name), and its `*.settings.txt` lines are merged into the four data files.

```sh
tsx tools/vehicle-installer/src/cli.ts --game ./game-src/original --in ./1 --out ./build
```

- `--game` — base game tree (`gta.dat` + `data/` + `models/gta3.img` …)
- `--in` — folder of vehicles; each immediate subfolder is one vehicle, named `<slot> - <car> - <author>`:
  ```
  1/
    alpha - 1994 Dodge Stealth RT - mad_driver/   alpha.dff  alpha.txd  alpha1.txd … alpha4.txd  alpha.settings.txt
    ambulan - 1982 Ford E-350 - 533/              ambulan.dff  ambulan.txd  ambulan.settings.txt
  ```
  It may also be **structured**, and then a candidate in `new/` replaces the `models/` car holding the same
  slot — an A/B that renames nothing ([plan 007](./docs/plans/007-models-and-new.md), contract
  `docs/contracts/vehicles.md` §1):
  ```
  mods-src/original/vehicles/
    models/       admiral - 1976 Mercedes-Benz 230 - k1real24/     ← the fleet
    new/          admiral - 1994 Dodge Stealth RT 1.1 - mad_driver/ ← installed instead
    screenshots/  admiral - 1976 Mercedes-Benz 230 - k1real24.png   ← never installed
  ```
- `--out` — output install dir (**wiped + rebuilt** each run)
- `--strip` — _(optional, off by default)_ reduce the output to **only** the installed vehicles (see below)

## Rebake — the same cars against a game that is already built

```sh
tsx tools/vehicle-installer/src/cli.ts --rebake gostown --only previon              # build/gostown/opensa
tsx tools/vehicle-installer/src/cli.ts --rebake original --kind sa --only cabbie    # build/original/sa
```

Re-merges each mod's settings into the BUILT `data/*`, **in place**, and — `--kind opensa` (the default) —
re-converts its model into the archive's `<model>.osm` (one car ≈ 3.6 s), or — `--kind sa` — replaces its raw
`.dff`/`.txd`s by name in the vehicles archive FAMILY (`vehicles.img` + the `vehicles2.img` the install spilled
into, opened as one; one car ≈ 4 s, [plan 008](./docs/plans/008-rebake-sa.md)). The vehicle half of the
pipeline without the pipeline. Defaults `--target build/<game>/<kind>` and `--in mods-src/<game>/vehicles`;
`--only a,b` narrows it. Each kind refuses the other's tree by what the archive holds (`.osm` vs `.dff`).
It can also **add** a car the built game never had, when the mod ships its own `vehicles.ide` row — the tool
never invents an id and refuses one another model owns. An added car has no traffic/parked presence until a
full build writes the placements. See [plan 006](./docs/plans/006-rebake.md).

## New tuning parts, and what the carmods line may name

A folder may ship `tuning_new_parts.txt` — the IDE rows (`veh_mods.ide` shape) and `shopping.dat` entries of
parts the game never had; the installer applies it before the settings merge (plan 009). After every install
and rebake **every `carmods.dat` token must resolve to an IDE row in the tree**, or the run FAILS naming the
line: the real game crashes at boot on one that does not. Two folders shipping the same part file name are
warned about (the later wins the archive). A part's SHOP NAME comes from the folder's `text.txt`
(plan 012) — the price row's second column is a GXT key, and without it the part is nameless in the shop.
Contract: `docs/contracts/vehicles.md`.

## How it applies

1. `--out` is wiped, then the `--game` tree is copied in (the base). A guard refuses a dangerous `--out` (root, or
   a path that is/contains `--game`/`--in`).
2. Each vehicle folder (alphabetical) → **`applyVehicle`**:
   - **Models** — `set` every `.dff` + `.txd` (incl. extra numbered `<model>N.txd`) into `out/models/gta3.img`,
     replacing by name; rebuild the archive.
   - **CLEO** — carry the mod's `cleo/`/`CLEO/` subfolder (scripts + `.ini`/`.fxt` sidecars) to `out/cleo/`
     (canonical lowercase, structure preserved; one log line per file — plan 097/06). `--rebake` re-copies it.
   - **Traffic** — merge `model-variations-extra.txt`'s ini section into
     `modloader/Model_Variations/ModelVariations_Vehicles.ini` by section name (`sa` target only — the plugin
     is the real game's). `{{name}}` resolves to that model's id in the tree's IDEs; an unknown one is
     reported and the line ships as authored. `[Settings]` is the plugin's and is never written from a mod.
   - **Text** — `text.txt`'s `KEY text` lines → `out/cleo/cleo_text/<model>.fxt`, the channel CLEO's FXT loader reads:
     the shop shows a new part's name from there rather than from a rebuilt `american.gxt`.
   - **Sound and parking** (`sa` only) — `audio.txt`'s row into FLA's `data/gtasa_vehicleAudioSettings.cfg`
     (replaced by model name, else inserted into the block that file sets aside), and `parked.txt`'s id-less
     line into Parked Maker's `cleo/Parked Car Maker.ini` `[Cars]`. The parked rows are counted against
     FLA's car-generator limit and printed; a tree whose rows alone reach it is refused (plan 013).
   - **Settings** — parse `*.settings.txt` (blank-line-separated blocks, each classified + validated by the real
     engine parser) and merge into:

| Block                              | Goes to                      | Rule                                                |
| ---------------------------------- | ---------------------------- | --------------------------------------------------- |
| `id, model, txd, …`                | `vehicles.ide` `cars`        | replace by model, else append before `end`          |
| `MODEL mass …`                     | `handling.cfg`               | replace by id, else append                          |
| `model, p,s, …` (numeric / `newN`) | `carcols.dat` `car` / `car4` | replace/insert; **may move** car↔car4; alpha-sorted |
| `model, part, … ` (part ids)       | `carmods.dat` `mods`         | replace/insert; section kept **alpha-sorted**       |
| `R,G,B  # newN …` (multi-line)     | `carcols.dat` `col`          | **custom colours** appended; see below              |

**`car` vs `car4`** is read from the vehicle's **own** carcols line — the colour count per combo (combos split on
`comma+space`, values within a combo on a bare comma): **2 values → `car`**, **4 values → `car4`**. The model is
removed from **both** sections and inserted into the target, so a vehicle whose mod changed its colour count
**moves** (a now-4-colour car leaves `car` for `car4`; a now-2-colour car leaves `car4` for `car`).

**Custom colours.** A vehicle can define new paint colours its carcols line references by name (`new1`, `new2`):

```
233,199,40   # new1 yellow taxi cab   yellow
186,208,125  # new2 light green cab   green

cabbie, 6,0,6,0, new2,0,new2,0, new1,0,new1,0
```

On install each `newN` is assigned the next free colour id — its position in the `col` palette (the stock palette
has 127 entries, ids 0–126, so `new1 → 127`, `new2 → 128`). The colours are appended to the `col` section (with the
id written into the `# 127` comment) and the carcols line's refs are resolved to those ids. **Many vehicles
accumulate**: ids continue from the current palette size, so the next vehicle's `new1` becomes 129, and so on.

## `--strip`

With `--strip`, after installing, the output is reduced to **only** the vehicles passed in `--in`:

- **`gta3.img`** — keeps only the installed vehicles' `dff`/`txd` entries (every other model dropped).
- **`vehicles.ide`** / **`handling.cfg`** / **`carcols.dat`** / **`carmods.dat`** — keep only the installed
  vehicles' lines (by model name; handling by id). Shared/structural sections are preserved: the carcols `col`
  palette (the cars reference it), carmods `link`/`wheel`, handling sub-tables (`!`/`$`/`%`), and comments.
- **`data/cargrp.dat`** — each population group line keeps only its installed models; the group **lines** stay
  (their order is the ped-type index), so a group with no installed car is left emptied.
- **`parked.json`** — keeps only the installed models' parked-vehicle entries.

The result is a minimal, self-contained pack of just the installed cars. Off by default (the full game is kept).

## Deferred (later iterations)

- **Extra numbered txds** (`<model>1.txd`, …) ship in `gta3.img`, but **using** them in-game (alternate
  paintjob/variant dictionaries) is out of scope.
- **carmods in-game.** The `parseCarmods` parser is added to the engine (`@opensa/renderware`) so the tool can
  merge the `mods` line, but wiring the in-game vehicle **component/upgrade** system onto it is a later iteration —
  no engine/adapter usage yet.
- **TODO — cargrp proper handling.** Today `cargrp.dat` is only **stripped** (filter to installed) and **parsed**
  (`parseCarGroups`, deferred in the engine). Still to do later: (1) let a vehicle's settings declare which
  **population group(s)** it joins, so installs _add_ the car to `cargrp.dat` (and it spawns in traffic), not just
  trim it; (2) wire the engine population/traffic system to read `cargrp.dat`. Needs a separate plan when picked up.

See [docs/plans/](./docs/plans/) (`001` architecture · `002` install + settings · `003` custom palette · `004`
strip · `005` node API · `006` rebake · `007` `models/` + `new/` · `008` rebake for `sa` · `009` new tuning parts + the carmods guard · `010` layered `common/sa/opensa` · `011` `model_special_features.dat` for `sa` — PLANNED).

A car whose settings declare **no `carmods` line** has the stock one for its slot **removed** rather than
inherited (plan 015): that line describes the model that used to hold the slot, and a universal Transfender
part hangs on a `ug_*` dummy inside the car — `ug_bonnet`, `ug_spoiler`, `ug_roof`, `ug_wing_left/right`,
`ug_lights`, `ug_nitro` — which most replacement models do not carry over. Installing one whose dummy is
absent crashes the real game at `0x007F0BF7` ("frame did not find the child"); it took two field crashes in a
helicopter to find, because `ModelVariations` spawns traffic already tuned. Stock SA never does this (0 of
77 cars); our fleet did it on 30 of 154.
