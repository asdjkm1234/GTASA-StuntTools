# Vehicle name contracts

Every NAME on this page carries behaviour. A file called something else is not read, a frame called
something else is not animated, a texture called something else is not recognised — and in almost every
case **nothing reports it**, because a mod that contributes nothing looks exactly like a mod that ships
nothing. This page is the one place to check before inventing a name, and the place to add one.

Two rules run through all of it:

1. **Derive from the asset before you reach for a name.** A tyre is found by its geometry (the material's
   mean radius), a pop-up headlight pod by the lamp faces inside it, chrome by bare grey + an env map — not
   by what any of them are called. A name contract is what is left when the asset cannot say it itself.
2. **Names are matched lowercased and trimmed.** Case and stray whitespace never decide anything.

To see what a given car actually gives the builder — frames, parts, hinges, the pop-up pod, and the two
traps below flagged by name — run `npx tsx scripts/debug/dump-vehicle-rig.ts <model|path/to.dff>`.

---

## 1. A vehicle mod folder (read by `vehicle-installer` at build time)

One folder = one vehicle. `<model>` is the game's model slot (`previon`, `zr350`, …) and everything else in
the build keys off it.

**The folder NAME is three fields**, `<slot> - <what the car really is> - <author>`:

```
admiral - 1976 Mercedes-Benz 230 - k1real24
```

The first field, everything before the first ` - `, is the **slot** — case-folded, and the only field any
tool reads (`parseVehicleSlot`). It exists because a folder can ship several `.dff`s (a bodykit: 13 of the
original's 212 do) and the file names cannot then say which one is the car. The other two fields are free
text. A folder with no ` - ` is read as slot-only.

**Where the slot is read**: matching `models/` against `new/` (below), and deciding **which model the
install records** — the mod-car ledger `data/vehicle-mods.txt`, the `features.txt` key, what `--strip` keeps,
and the `<model>.osm` a `--rebake` converts. The folder must ship a `<slot>.dff`; when it does not, the first
`.dff` is used (the pre-2026-08-15 rule, so a mis-named folder installs as it always did) **with a warning
naming both** — nothing downstream can tell the two apart, and this is what a misspelled slot looks like.

**A car must BE a folder.** The tree is resolved from its subdirectories (`subdirectories()` inside
`resolveVehicleSources`), so a `.dff` and `.txd` dropped straight into the `--in` tree belong to no source
and are read by nothing. The tools do not fail on it: an installer run reports the cars it installed, which
is none, and the cutscene census reports 0 of 23 slots covered — both exit 0. **The one place that now says
it out loud is `apps/cutscene-converter`** ("The cars are loose files, not one folder per car"), because
that is where the mistake is actually made, by someone who has just unpacked a mod archive.

Getting it from the folder rather than from "the first `.dff`" is not tidiness: on the original's fleet the
old rule mis-recorded **10 of 212 cars** as a bodykit part (`flash` → `exh_a_f`, `voodoo` → `bbb_lr_slv1`),
so video mode never saw those slots as modded, `--strip` would have dropped the car it was told to keep, and
a rebake converted the exhaust while the car kept its old model.

| Name | What it is |
| --- | --- |
| `<model>.dff` | The model, where `<model>` is the folder's slot. A folder may ship MORE dffs (a bodykit — `exh_a_l.dff`, `bbb_lr_slv1.dff`); they all reach the archive, and none of them is the car. |
| `<model>.txd` | Its dictionary. |
| `<model><N>.txd` | Extra numbered dictionaries (`previon1.txd`); they ship into `gta3.img` alongside. |
| `<model>.settings.txt` | **Settings** — the car's data lines (below). |
| `features.txt` | **Features** — what the model can DO (below). Folder-scoped, not `<model>.features.txt`. |
| `tuning_new_parts.txt` | **New tuning parts** — the IDE rows (`1194, spl_b_lr_bl, blade, 100, 0`) and shop entries of parts the game never had; read by the installer since plan 009 (below). **Absent when the carmods line names a new part: the build FAILS** (`assertCarmodsModels`) — the real game would crash loading `carmods.dat`. Misspelled: not read, same failure, same message naming the token. |
| `model-variations-extra.txt` | **Traffic behaviour** — an ini section for **ModelVariations 10.7** (mod `11`, `sa` layer), merged into the built `modloader/Model_Variations/ModelVariations_Vehicles.ini` by section name (below). Read by the installer since plan 012; eight of the original's folders ship one. Misspelled (`model-variation-extra.txt`): **not read, and nothing says so** — the trailers simply never spawn. |
| `text.txt` | **GXT lines** — `KEY text` per line, the names the mod's own tuning parts show in the shop (the key is the second column of its `tuning_new_parts.txt` price row). Written as **`cleo/cleo_text/<model>.fxt`** — CLEO reads FXT from `CLEO/CLEO_TEXT/` and from nowhere else, so the subfolder is part of the contract, not tidiness. Read by the installer since plan 012. Misspelled, or written one folder up in `cleo/`: **not read** — the part is in the shop with an empty name, which is exactly what a part with no GXT entry looks like, and nothing logs the difference (field-found 2026-08-19, and it had been landing in `cleo/` since plan 012). |
| `audio.txt` | **Engine sound** — one row of FLA's `data/gtasa_vehicleAudioSettings.cfg` (15 columns, the first being the model name), merged by that name; read by the installer since plan 013. `sa` only. The loader is keyed by NAME, so a replacement car that ships none simply keeps its stock row — nothing is inherited here. Misspelled: **not read**, and the car keeps the stock sound, which is exactly what shipping no file looks like. |
| `parked.txt` | **A parked spot** — Parked Maker 3.0.2's `[Cars]` row WITHOUT the id: `<colour> <colour> <x> <y> <z> <angle>` (the script reads `%i %i %i %f %f %f %f`; the id is the installer's to fill in). Merged into `cleo/Parked Car Maker.ini`, read since plan 013, `sa` only. A row with a different column count is **refused with both counts named**. Needs mod 47 and FLA `Accept any ID for car generator = 1`. Misspelled: **not read** — the car is parked nowhere and nothing says so. |
| `cleo/` (or `CLEO/`) | The mod's compiled CLEO scripts + sidecars (`.cs`, `.ini`, `.fxt`) — copied to the built game's `cleo/` (canonical lowercase, author-relative structure preserved), where the runtime discovers them at boot (plan 097/06); a `--rebake` re-copies them. **Misspelled (`celo/`, loose `.cs` beside the dff): not carried at all** — the vehicle installs fine, its script never runs, and the boot census line (`[cleo] N script(s)`) is the only place the absence shows. |

- The settings file is found by its **`.settings.txt` suffix**, never by "the first `.txt` in the folder" —
  `features.txt` sorts before it and used to swallow it whole (the previon lost its entire data row that way).
  A folder with **no** `.settings.txt` still falls back to "the first other `.txt`" for the pre-suffix mods, and
  that fallback now excludes **every name on this page** (`features.txt`, `tuning_new_parts.txt`,
  `model-variations-extra.txt`, `text.txt`, and `audio.txt`/`parked.txt`). Without the exclusion a car shipping
  one of them and no settings file had it parsed AS settings and warned "nothing recognised — STOCK".
  A MISSPELLED name is not on that list, so it is picked up by the fallback and read as settings instead — the
  same warning, and the reason a misspelling of one of these names is worth checking for when it appears.

**`model-variations-extra.txt`, in detail.** Ini sections, one per model the mod speaks for; every key is
ModelVariations' own (`Trailers1`, `Global`, `TrailersSpawnChance`, `TrailersMatchColors`, `TrailersHealth`).
A value names models as **`{{name}}`** — resolved to the id that name holds in the built tree's IDEs, because
the plugin reads ids, not names, in a value (`Trailers1=[{{205veh}}-{{206veh}}]` → `Trailers1=[19205-19206]`).
**A name no IDE in the tree defines is DROPPED** (the user's call, 2026-08-19), at the smallest unit that
keeps the author's meaning:

- one item of a list goes, the rest stay — `Trailers1=584,{{211veh}}` → `Trailers1=584`;
- a bracket group is one trailer CHAIN and goes WHOLE — half a road train is a different vehicle;
- a key left with nothing goes, and so does every `Global=` reference to it: a dangling `Global=Trailers1`
  is the same refused key by another route.

Each drop is one warning naming the section, the key and the names. Shipping the literal `{{…}}` was the
earlier behaviour and it was worse: the plugin refuses the key, the truck tows nothing, and the only record
is a line in the plugin's own log. Some of these never resolve by design — `{{205veh}}`–`{{216veh}}` are
trailers of the train set that arrives with `add-vehicles` 008+, not something plan 102 was ever going to
allocate. `[Settings]` is the plugin's own block and is **refused** from a mod folder. The merge is by SECTION
NAME — replaced when present, appended when not — so a rebake writes the same bytes twice. The whole thing is
`sa`-only: our own engine has no `modloader/`.

**A parked spot is not free.** Every `[Cars]` row is created through CLEO and holds one of FLA's
car-generator slots for the whole session (the array is 500; the map's own 1045 records stream in and out
with their IPL section and share it) — so the installer prints the row count with the limit beside it and
REFUSES a tree whose rows alone reach it. The measurement, and the field test that would let anyone put a
real budget on it, is `docs/gta-sa-original/car-generators-500-and-the-map-1045.md`.
- Both files are decoded by the encoding they were **saved** in: a BOM decides, and with no BOM the parity of
  the NUL bytes does (UTF-16 is what most Windows-authored mods ship). Read as UTF-8 a UTF-16 file parses to
  nothing at all, silently.

### The `vehicles` folder itself — `models/` + `new/`, and the `common/sa/opensa` layers

`mods-src/<game>/vehicles` has three legal shapes, and `resolveVehicleSources` (`@opensa/tool-kit/vehicles-dir`)
decides which one it is looking at. Every tool that reads this folder goes through it, so the driving fleet
and the cutscene fleet cannot disagree about what is in the build.

**Layered** (plan 010, 2026-08-17): the top level is `common/` + `sa/` + `opensa/` (all optional) — the SAME
layers, the same planner (`@opensa/tool-kit/layers`) and the same refusals as a mods folder
([mods.md](mods.md) §1). Each layer is itself flat or `models/`+`new/`. `common` resolves first, then the
layer of the target being built, and **the target layer's car takes the SLOT** from the `common` car — logged
as `sa/models/<car> replaces common/models/<car>`. Reading a layered tree needs the target: the pipeline
passes its own, `vehicle-installer --target`, `--rebake --kind` (the kind IS the target), `vehicle-cutscene
--target`, `cars-server --target` (default `sa`). Without one it is refused, not guessed. A layered vehicles
folder makes the `vehicles` stage target-dependent, so a run building BOTH targets over it is refused at
config time, like mods. Misspell a layer (`open-sa/`) and it is a car folder beside layers → refused (below).

| Folder | What it is |
| --- | --- |
| _(any other name)_ | **Flat tree** — one car, exactly as before. Present in a flat tree, this is a car; present beside `models/`, it is an ERROR (see below). |
| `models/` | The installed fleet. One folder per slot. |
| `new/` | Candidates. A car here **replaces** the `models/` car holding the same slot — trying a replacement costs no rename, move or deletion. A slot `models/` does not have simply installs. |
| `screenshots/` | Pictures (`.png`, `.jpg`/`.jpeg`, `.webp`), one per SLOT, named like the car folder. Never installed, never scanned for a car. **In a layered tree it lives INSIDE each layer** (`common/screenshots/`, `sa/screenshots/`, `opensa/screenshots/`) and a car's picture is read from ITS OWN layer only — a `sa/models/x` car looks in `sa/screenshots/`, never in `common/screenshots/` (the picture there under its slot is of the `common` car it displaced); without one it is reported missing. A `screenshots/` at the ROOT of a layered tree is a stray folder beside the layers → refused, like a misspelled layer. |

Three things are refused rather than guessed, each because guessing installs a fleet nobody asked for:
a **stray folder** beside the reserved ones (which is what a misspelled `New/`, `model/` or `Screenshots` is,
and also a car folder left at the top level), **two reserved folders differing only in case** (one folder on
macOS and Windows), and **two folders in one layer claiming one slot** (the loser would install and then be
overwritten by whoever came last alphabetically). Every override is logged — `new/<candidate> replaces
models/<incumbent>` — because a fleet that changed silently is the failure this shape exists to prevent.

### `<model>.settings.txt` — the data lines

Blank-line-separated blocks, each classified by its **structure** and then validated with the real engine
parser, so order does not matter and an unrecognised block is dropped **with a warning naming the block**.

| Block | Merges into | Keyed by |
| --- | --- | --- |
| `id, model, txd, type, HANDLINGID, gameName, …` | `data/vehicles.ide` | model |
| `HANDLINGID  mass  turnMass  …` (~33 columns) | `data/handling.cfg` | the handling id, **not** the model |
| `model, p,s[, p,s …]` (numeric or `newN` refs) | `data/carcols.dat` | model |
| `R,G,B  # newN <name>` lines | `data/carcols.dat` `col` section | appended, `newN` resolved |
| `model, part, part, …` (word-only ids) | `data/carmods.dat` | model |

The handling id is the ide line's 5th column — a car may name a handling row that is not its own model name,
and the installer's `--strip` follows the same link.

**A part name is shared fleet-wide, not per car** — so a part you ship under a name that is not yours is
RENAMED on the way in (014). Every `.dff`/`.txd` a folder ships lands in ONE archive under its file name and
`carmods.dat` resolves parts by name, so two folders shipping `rbmp_lr_bl1.dff` used to hold one entry
between them: the later folder in install order won and the other car wore its bumper. What decides whose
part it is: **the stock `veh_mods.ide` row's TXD column**, which names the car the part is textured by.

| what the folder ships | what happens |
| --- | --- |
| a part whose stock row is textured by THIS slot | kept under its own name — a replacement mod re-modelling its own car's part is the normal case |
| a part textured by ANOTHER car | installed as `<stock name>_<token>` with the stock part's IDE row, shop item, price and `link` cloned under it, and the car's `carmods.dat` line repointed. The other car keeps its own |
| a part whose row's txd is `vehicle` (nitro, hydraulics, stereo) | kept under its own name and WARNED — that part is worn by every car in the game, so this version replaces all of them |
| a part no IDE row defines at all | kept under its own name; nothing exists to clone, which is what [`tuning_new_parts.txt`](#tuning_new_partstxt--parts-the-game-never-had) is for |

The `mods` line is NOT what decides it: a right-hand part is bought through its left partner's `link` and
appears on no line at all (22 of them, plus slamvan's `bnt_lr_slv1`/`2`, the only two stock parts no shop
offers), and renaming one of those would break a stock `link` pair — a car buying a left skirt with no right
side. Measured on the stock tables: no car's `mods` line names a part whose txd is another car's, so the
column never contradicts the line, it only sees what the line cannot show.

**A car's dictionary and its PAINTJOB dictionaries are one bundle, and the mod owns it.** A paintjob is a
whole texture dictionary named by convention off the car — `blade1.txd`, `blade2.txd` beside `blade.txd` —
and no row of any data file names it ([`gta-sa-original/vehicle-paintjobs.md`](../gta-sa-original/vehicle-paintjobs.md)).
So when a folder replaces a slot AND ships a dictionary for it, every stock `<slot>.txd` / `<slot><n>.txd`
it does NOT ship is dropped from the archive: a stock paintjob left beside a modded body is artwork drawn
for other UVs. Ship fewer than the stock car had and the shop simply offers fewer — that is fine. A folder
that ships no dictionary at all does not own the slot's textures and the stock ones are left alone.

**A part the stock game never had gets COLLISION of its own, in a file the build writes.** Anything that
creates a tuning part as a standalone object — a trainer, a debug tool — goes through the ordinary `CObject`
constructor, which dereferences `m_pColModel` with no null check. Stock parts are covered by
`gta3.img : veh_mods.col` (exactly the 194 of ids 1000–1193); everything we add is not, so the installer
writes a bounds-only COL3 model per part into **`models/coll/opensa-parts.col`** and registers it with one
line in `data/default.dat`:

```
COLFILE 0 MODELS\COLL\OPENSA-PARTS.COL
```

The model is named after the part as INSTALLED (the derived name, when it was renamed) — SA binds collision
by name. Both files are build OUTPUTS: a delivery carries them, and a build whose `veh_mods.ide` names a part
with collision in neither place is refused. Field-proven 2026-08-20 on ids `1194` and `19051`, which crashed
without it and spawn with it. The IDE flags column has nothing to do with this
([the retired reading](../hacks/retired/upgrade-part-no-collision-flag.md)).

**Two folders still staging different files under one entry name is REFUSED**, naming both mods and both
sizes — after the rename that can only happen for a name the derivation cannot classify. Same name and the
same size is the same file shipped twice and is left alone with a warning. A `--rebake --only <car>` warns
that it is putting ITS version in the archive where a full install would let the later folder win.

### A car's tuning line is a claim about its MODEL

Two rules, both silent when broken and both learned from a field crash (2026-08-22, `vehicle-installer`
[plan 015](../../tools/vehicle-installer/docs/plans/015-a-replaced-car-does-not-inherit-tuning.md)):

1. **A folder that declares no `carmods` line gets the stock line for its slot REMOVED, not inherited.** The
   stock line describes the model that used to hold the slot. Say nothing about tuning and the car is not
   tunable — which is what a replacement that was never adapted actually is.
2. **A line may only name a part the car's own model can MOUNT.** A universal (`*_b_*`) Transfender part hangs
   on a `ug_*` dummy inside the model: `ug_bonnet` (+`_dam`) for `bnt_b_*`, `ug_bonnet_left/right` for
   `bntl_b_*`, `ug_spoiler` for `spl_b_*`, `ug_roof` for `rf_b_*`, `ug_wing_left`/`ug_wing_right` for
   `wg_l_b_*`/`wg_r_b_*`, `ug_lights` for `lgt_b_*`, `ug_nitro` for `nto_b_*`. The table is not invented — it
   is what every stock car offered that family carries, without exception, and **stock SA has 0 of 77 cars
   naming a part it cannot mount**. Car-specific families (`_lr_`, `_a_`, `_c_`) replace a standard component
   (bumper, exhaust) that every model has, and are not affected.

   Break it and the real game dies where the part is installed — `0x007F0BF7`, *"frame did not find the
   child"*, reading `+0x98` off a null frame. It needs nobody to visit a mod shop: `ModelVariations` spawns
   traffic already tuned, which is how it was found (two crashes in a helicopter). **Nothing in the build
   checks this yet** — rule 2 was applied to the fleet's own settings files by hand, so a NEW mod carrying a
   line its model cannot mount reintroduces the crash silently.

### `tuning_new_parts.txt` — parts the game never had

`carmods.dat`'s `mods` line can only name a part; the part must also EXIST (an IDE row in
`data/maps/veh_mods/veh_mods.ide`) and, to be bought, be listed in `data/shopping.dat` (a shop's `item`,
a `CarMods` price). The real game does not check: `CVehicleModelInfo::LoadVehicleUpgrades` looks every
token up by name and dereferences the result — a token with no IDE row is a crash at boot
(`0x4C4576`, [gta-sa-original/carmods-unknown-part-crash.md](../gta-sa-original/carmods-unknown-part-crash.md)).
This file carries what the line cannot:

```
1194, spl_b_lr_bl, blade, 100, 0        # bare IDE rows (veh_mods.ide shape) — appended to objs, replaced by NAME
1195, bnt_b_lr_bl, blade, 100, 0

shops.carmod2|exh_lr_bl2                # "<top>.<section>|<anchor>" — lines inserted AFTER the anchor line
item spl_b_lr_bl
item bnt_b_lr_bl
end

prices.CarMods|exh_lr_bl2
spl_b_lr_bl   SAVST   respect 0   sexy 0   1000
end
```

Rules: `#` comments; blocks end with `end`; sections match case-insensitively; a row/item/price already
present under its name is left alone (idempotent, so a rebake changes nothing the install did not); an IDE
id another model owns is REFUSED with a warning naming the owner; a missing anchor appends at the section's
end with a warning; a missing section warns and writes nothing. Not a stock format — a mod author's
convention (two of the original's 212 folders ship one) that the installer now honours.

### `features.txt` — what the model can do

One token per feature, whitespace/comma separated, `#` and `//` start a comment. Tokens are upper-cased.

The vocabulary is the Modloader/IVF one, so mods already in the wild declare themselves correctly — and it
lives in ONE place, `VEHICLE_FEATURE_TOKENS` (`@opensa/renderware`'s `vehicle-features.parser`), because both
targets stand on it. **The two targets honour a declaration by completely different means:** OpenSA detects
the ability from the asset and drives it itself, while in SA every ability is hardcoded to a MODEL ID, so the
`sa` build points the slot at the stock model that natively has it (`saCarrierFor` → §2's
`data/model_special_features.dat`). The `sa` column below is that stock carrier, and where several carry an
ability any one of them will do.

| Token | Meaning | `sa` build maps to | OpenSA |
| --- | --- | --- | --- |
| `ADV_HYDRALICs` | Lowrider hydraulics that lift and lean the whole body. | `hotknife`, `bandito` | not yet driven (098/06) |
| `BAGBOXA` | The airport baggage trailer's first box. | `bagboxa` | not yet driven (098/06) |
| `BAGBOXB` | Its second box. | `bagboxb` | not yet driven (098/06) |
| `BF_ENGINE&HYDRALICS` | The BF Injection's exposed engine, plus hydraulics. | `bfinject` | not yet driven (098/06) |
| `BUCKETs` | A raise/lower bucket or blade (dozer). | `dozer` | not yet driven (098/06) |
| `CISTERNs` | The cement mixer's rotating drum. | `cement` | not yet driven (098/06) |
| `PACKERs` | The car-transporter ramp platform. | `packer` | not yet driven (098/06) |
| `TRACTOR_HOOKs` | The farm tractor's trailer hook. | `tractor` | not yet driven (098/06) |
| `TRAILER_HOOKs` | An articulated truck's trailer hook. | `linerun`, `petro`, `rdtrain`, `artict3` | not yet driven (098/06) |
| `TRUCK_HOOKs` | The tow truck's crane and hook. | `towtruck` | not yet driven (098/06) |
| `TUGSTAIR` | The airport stair trailer. | `tugstair` | not yet driven (098/06) |
| `TURRETs_1` | A turret aimed by the driver/passenger (tank, SWAT). | `rhino`, `swatvan` | not yet driven (098/06) |
| `TURRETs_2` | The fire truck's water cannon turret. | `firetruk` | not yet driven (098/06) |
| `UP/DOWN_LIGHTS` | The car has retractable ("pop-up") headlights. | `zr350` | LIVE — detected geometrically, the token only relaxes the lamp-marker requirement |
| `WATER_JETs` | Water jets fired from the model. | `firetruk`, `swatvan` | not yet driven (098/06) |

Unknown tokens are carried through and ignored — adding a feature later means teaching the converter one
token, not re-authoring the mods. **A misspelled token is therefore silent in the game and visible only in
the install log**, where the `sa` writer names it ("no token of the feature vocabulary"). Two more things
only the log will tell you, because the real game cannot express them: a declaration of several abilities no
single stock model has at once is mapped to the best carrier and the REST IS DROPPED, and a slot that is
itself a stock carrier (a mod in `firetruk` declaring only `UP/DOWN_LIGHTS`) LOSES its native abilities when
it is remapped — declare those too.

---

## 1b. An ADDED vehicle folder (read by `tools/add-vehicles`, `sa` only)

`mods-src/<game>/add-vehicles` is a SECOND vehicles root with the same grammar as §1's — flat, or
`models/`+`new/`, or layered — read through the same one resolver. An added car is not a replacement: it
takes a model id the game never had, so everything a stock slot gets for free has to be produced for it
(central plan [102](../../tools/add-vehicles/docs/plans/102-add-vehicles/readme.md)).

**The folder name carries one field more**, a parenthesised suffix naming the STOCK slot the car is a
variation OF:

```
001veh - 1971 Chevrolet Vega - alfamodding (manana)
```

| Part | Contract |
| --- | --- |
| `<slot>` (first field) | The car's OWN new slot — `001veh`, not a stock name. **≤ 7 characters**, because the same string is also its GXT key (`001VEH`). |
| `(<base>[, <base2>…])` (end of the last field) | The stock slot(s) it varies. The FIRST is "the" base — the engine sound it inherits when it ships no `audio.txt`, and the car whose tuning parts it re-models; further entries are additional traffic parents. **A base no `vehicles.ide` row defines is REFUSED**, naming the folder and the base: a mistyped base is otherwise a car that silently never enters traffic. A folder with no suffix at all is refused the same way. |
| `reserved/` (beside `models/`) | The author's shelf — folders kept out of the fleet without being deleted. Reserved by NAME, never scanned, and NOT a stray (the alternative, a refusal, would stop every tool over a folder the author put there on purpose). |

**What an added car is CALLED and what it SOUNDS like are DERIVED, and both rules are readable off the
folder:**

| | |
| --- | --- |
| Display name | The GXT key is the ide row's `gameName` column; the text is the folder's SECOND field (`1971 Chevrolet Vega`). Written as a line in `cleo/cleo_text/<slot>.fxt` (the only folder CLEO reads FXT from — see the `text.txt` row); a `text.txt` line under the same key overrides it. **A gameName the built `american.gxt` already defines gets NO line** — 9 of the 115 are train carriages that reuse the stock `STREAK`/`FREIGHT`/`FRFLAT` key, and writing one would rename the stock train. Two added cars sharing a key is allowed and WARNED (the nine `FRBOX` boxcars): the last `.fxt` CLEO loads wins. |
| Engine sound | `audio.txt` if the folder ships one — its first token forced to this car's model. Otherwise the FIRST `(base)`'s own row from the built `gtasa_vehicleAudioSettings.cfg`, copied under this car's name. **This inheritance is why the base is in the folder name at all**: a new id has no row and is silent without one, and a base with no row of its own is warned about. |

**A shipped `<stock part>.dff` is a RE-MODELLED part, and it is renamed.** An added car that ships a dff
under one of its base's tuning-part names means "this is that part, re-modelled for my body": it is
installed as `<stock name>_<token>` (the whole stock name kept, so the prefix the game reads its component
flags from still matches), with the stock part's IDE row, shop item, price and `link` cloned under the new
name, and the car's own `carmods.dat` line rewritten to it. The stock part is never touched. A derived name
over **19 characters** is refused, and so is a tree over the two `carmods.dat` arrays (30 `link` pairs
game-wide, 16 parts on one car) — see `docs/gta-sa-original/carmods-upgrade-ceilings.md`.

**The token is the shortest prefix that tells the car's slot apart from every other slot, floor 3**
(`voodoo` → `voo`, `slamvan` → `sla`; `copcarla` → `copcarl`, because its family shares six characters; a
slot whose whole name is another slot's prefix keeps its full name, and the longer slot then reaches past
it). It is derived from the tree's `vehicles.ide` plus the slots of the run, never registered anywhere, so
the same table always yields the same name — and it exists because the slot name itself overflows the
19-character ceiling on real data (`wg_r_lr_slv1_slamvan` is 20). A part whose name changes because this
scheme changed keeps its model id: `data/vehicle-adds.txt` moves the row rather than the part taking a new
id, since a part id is in the player's save.

The optional per-car files are §1's, read by the same code: `features.txt`, `tuning_new_parts.txt`,
`model-variations-extra.txt`, `text.txt`, `audio.txt`, `parked.txt`. Two things are the added car's own and
belong to later plans of the chain: **`<:id>`** in the settings file's ide line (the allocation placeholder,
plan 002) and the derived names of its re-modelled tuning parts (plan 005).

**The car's `vehicles.ide` and `handling.cfg` rows go into `modloader/added-vehicles/<slot>.settings.txt`,
beside its models — NOT into `data/`.** Mod Loader's `std.data` matches data lines by SHAPE out of any text
file (its own documentation lists `cars`, `peds` and `objs` tuning parts as the sections it reads that way),
and merges them into the stock files after boot. Baked into `data/vehicles.ide` the same rows are read from
`default.dat` while the game starts, and the real install does not survive 115 of them — it dies before a
window appears (field, 2026-08-19).

**The file may never be named after a stock data file.** A `vehicles.ide` or `handling.cfg` inside a mod
folder is taken by Mod Loader as a REPLACEMENT: naming it that way silently deleted the stock 212 cars, and
then every stock handling line — the game came up complaining `Handling.cfg identifier name LANDSTAL is
assigned to vehicle, but cannot be found`. `<slot>.settings.txt` is the name that works, and `.txt` alone is
not enough: a name Mod Loader knows (`veh_mods.txt`) is a data file, anything else is a "readme" it scans.

**Everything else stays baked** in the built `data/`: `carcols.dat` (the palette is positional), `carmods.dat`,
`veh_mods.ide`, `shopping.dat`, the audio row, the parked spot, the ModelVariations sections and the `.fxt`.

**The models go LOOSE, not into an archive.** An added car's `.dff`/`.txd` (and its re-modelled tuning
parts, under their derived names) are written into **`modloader/added-vehicles/`**, where modloader imports
them by name. The reason is a ceiling: SA registers 8 IMG archives, the built tree already spends six, and
the fleet's 1.4 GB pushed the vehicles family to a third file — the build stopped at `assertArchiveSlots`
with 9 of 8 (`docs/in-reserve/img-archive-limit-lift.md`). A replacement car is unaffected: it still
replaces its slot's entry inside the archive, because it has a stock entry to replace.

**The root is `sa`-only.** Its whole machinery is the real game's plugins — ModelVariations for traffic,
FLA's audio loader for sound, Parked Maker for parking, CLEO's FXT loader for the name — and our own engine
has none of them. A layered root carrying `common/` or `opensa/` is refused rather than planned into a build
that cannot use it.

---

## 2. Built game data (written by the installer, read by the converter)

| Path | Contract |
| --- | --- |
| `data/vehicles.ide` | model, txd, type, handling id, wheel model id, **wheel scale [front, rear] = the wheel DIAMETER in metres** (not a multiplier). Rows are split the way the game's `LoadLine` reads them — commas AND whitespace are one separator class — so a `.settings.txt` row missing the model/txd comma (`593, dodo\t\tdodo, …`; dodo, emperor, wayfarer ship one) still keys on the model and REPLACES the stock row instead of appending a duplicate id (2026-08-17). |
| `data/handling.cfg` | Rows keyed by the handling id above. |
| `data/carcols.dat`, `data/carmods.dat` | Keyed by model. `carmods` is parsed but not yet wired into the engine. |
| `data/vehicle-features.txt` | **Ours, not SA's.** `<model> <FEATURE>…`, one line per model, written from each mod's `features.txt`. Read by `opensa-pack` while baking that car — **build time only**; nothing reads it at runtime, so a change here needs a rebuild (`vehicle-installer --rebake`). |
| `data/vehicle-mods.txt` | **Ours, not SA's.** The mod-car ledger: one lowercased vehicle SLOT per line (`#` starts a comment; several names on one line are read as several), written by `vehicle-installer` for every slot a mod took over, sorted so a rebuild is byte-identical. **The only vehicle data file read at RUNTIME**, by video mode's car pick (096 D10) — nothing else in the game reads it. **It is a SWITCH, not a preference** (D10 as revised 2026-08-03): if one line names a slot whose model the build actually carries, EVERY scene drives a mod car and no stock car appears; if no line does, every scene takes a stock car. Written on EVERY install run, including an install with no vehicle mods: present-and-empty says "this build looked and found none", absent says "this build predates the ledger", and downstream both mean the stock roster. A `--rebake` MERGES into it (`--only <car>` adds that slot, it never rewrites the file to its own selection). **Misspell the name and the file is simply never found**: video mode silently falls back to the stock roster — no warning, no other effect, because the fact it carries cannot be recovered any other way (mods are indistinguishable from stock once merged). The same silence covers a ledger whose every row names a slot this build has no `.osm` for, which is why video mode's boot line prints the count of DRIVABLE slots, not of ledger rows. |
| `data/model_special_features.dat` | **The adjuster's file, not ours** (`sa` target only) — fastman92's model special feature loader, `CustomModelName StandardModelName` per line, the custom model behaves like the standard one (`docs/gta-sa-original/vehicle-special-features.md`). The installer writes each declaring model's stock carrier (§1) into ONE marked block (`# --- vehicle-installer: …` to `# --- end vehicle-installer ---`), sorted by model so a rebuild is byte-identical; **every line outside the block is kept verbatim** and a `--rebake --only <car>` merges rather than rewriting the fleet's mappings. No line is written when the slot already carries what it declares (`hotknife` + `ADV_HYDRALICs`). A misspelled CARRIER cannot happen — the table owns them. **What is silent without the log**: the file is not written at all when the adjuster mod is not installed for this target (nothing would read it), and it IS written but ignored by the game when the adjuster's ini does not carry `[SPECIAL] Enable model special feature loader = 1` — both are warnings naming the mod and the ini. |
| `models/generic/vehicle.txd` | Shared dictionary merged into every car, and the home of the plate rasters. Never deleted by the pack. |
| `models/vehicles.img` (+ `vehicles2.img`, …) | **The name decides where a car lands.** `vehicle-installer` writes into `models/vehicles.img` **if that file exists** and into `gta3.img` if it does not — the tree tells the installer which shape it is, so one installer serves a split build and an unsplit one. A tree where the split ran but the archive is missing or misspelled therefore takes mod cars into `gta3.img` **silently**, beside the stock twins the split moved out, and nothing reports it. Siblings are numbered (`vehicles2.img`) and appear when the family crosses the 1.75 GiB cap; **whoever writes one registers it in `gta.dat`**, because an archive the game never registers loads nothing while the build still succeeds. Where any entry actually lives is answered by `openArchiveIndex` reading the tree, never by a hardcoded archive name — `vehicle-cutscene` learned that the hard way when the split moved its txdp parents into `vehicles2.img`. |
| `data/img-layout.json` | **Ours, not SA's, and a REPORT rather than a lookup** — which archives the tree has, how many entries and bytes each carries, plus the classifier's contested/unclaimed lists. Written by the split and restated on the finished `sa` tree, because the first pipeline build shipped one describing the tree as it had been six stages earlier. Anything inside the build resolves through `openArchiveIndex` instead; this file is for readers outside it. |

---

## 3. DFF frames (the model's own contract)

### Structure

| Name | Role |
| --- | --- |
| `chassis` | The body mesh. `chassis_dummy` is the root the components hang under. |
| `<anything>_vlo` | The low-detail mesh shown past the vehicle LOD swap (`chassis_vlo`). |
| `wheel` | A single wheel atomic, instanced at every `wheel_*_dummy` (mirrored on the right). **A FLAT mesh (no extent along the axle) is a MARKER meaning "this model draws no SA wheels"** — the builder leaves it unscaled instead of fitting it to the ide diameter, so it stays invisible the way SA leaves it. The GTA 5 Rhino does this (its running gear is `wheel_big_*`/`track_*`); fitting it instead scaled a 2 cm triangle by 23.5 and swept six half-metre shards around with the wheels. The physics radius still comes from the ide, never from the marker. |
| `wheel_{l\|r}{f\|m\|b}_dummy` | Wheel hubs. `m` is the middle axle of a 3-axle truck. |
| `wheel_{lf\|rf\|lm\|rm\|lb\|rb}` | Per-corner wheel atomics (different front/rear wheels). A LONE corner with real dummies is treated as a mis-named shared wheel — several mods ship only `wheel_rf`. |
| `f_wheel_<mask>` | A container frame whose child atomics are the wheel sub-model (the IVF/VehFuncs wheel-mod convention). **The wheel is the container's CHOSEN PATH, not its first atomic** (2026-08-17): `<name>:K` shows K of its children, a bare name shows one, `+` the whole subtree, and at every level the FIRST eligible child in frame order is the author's default (`_dam`/`_vlo` never count) — the same walk the cutscene tool applies (row below). The alfamodding cabbie ships `f_extras:2 → tire:1 → tire` + `rim:1 → hubcap`, the stretch `f_extras:1 → rim:1 → wire_spoke`; instancing the first atomic alone drew four bare tyres with no rim. Only the FIRST `f_wheel` container is read; the tyre band of every chosen mesh is judged against the WHOLE wheel's radius (a hub cap on its own would pass for rubber), and the fit uses the whole set's radius. A mesh below the root with its own frame offset is baked into wheel-local space. Spelled wrong (`fwheel`, `wheel_f`) the container is body geometry: it rides the chassis as one static wheel at one corner and the dummies get no wheel at all. |
| `extra1` … `extraN` | Mutually-exclusive optional parts; SA shows at most one, and the pick is per SPAWN. |
| `f_extras[:N|:0|:0+|:N+]` | **VehFuncs recursive extras** (2026-08-17; 59 of 213 original mod cars). The container's children are options; EVERY node is a selector over its own children — bare = one, `:N` = N, `:0` = none-or-one, `:0+` = any number, `:N+` = at least N — and the pick is per SPAWN, at random, like the plugin's on the SA target: the builder ships the whole tree in the `.osm` (`variants`) and tags each option's meshes (`submesh.variant`), the runtime walks it once per car (`pickVariants`). Meshes ON the container root always show. `_dam`/`_vlo` are never options — they ride their `_ok`/base twin. A container inside `f_wheel` belongs to the wheel (deterministic, row above). Spelled wrong (`fextras`, `f-extras`) the frame is body geometry and every child shows at once — the pre-2026-08-17 jumble. |
| `f_class[:N]` | Class tags: its chosen children (`ycc`, `1991`, `wbc`) become the spawn's TAGS; nested `f_class` under a tag = AND. Meshless. |
| `<option>[tag,tag]` | An option only ELIGIBLE when one of those tags was chosen this spawn (`none[ycc]`, `vegas[wbc]:1`, `5[lv]`); no eligible child → the group shows nothing. |
| `<node>?<condition>` | The plugin's spawn condition (`?c1` city, `?rain`, `?h6-18`, `?zGAN`) — carried verbatim in the tree, **treated as always true** today (`docs/hacks/vehfuncs-conditions-always-true.md`). |
| `!characteristics` (`_pj=`, `_cl=`, `drv=`) | The paint job / colours / driver a class implies — skipped (same hack card). |
| `misc_a` … `misc_h` | SA's generic moving components. A `misc_*` holding head-lamp faces is a **pop-up headlight pod**. |
| `ug_*` | Upgrade attachment points. Present in models, consumed by nothing yet. |

**The frame LIST's order is a contract too, and it is not about names.** A frame's `parentIndex` must
point at a frame declared BEFORE it. RenderWare parents each frame in the same pass that creates it, so a
forward reference reads an array slot it has not written yet: an access violation in `RwFrameAddChild`
(`0x007F0BF7`) or silent memory corruption, decided by whatever was in that slot — which is why the class
shows up as a crash that happens *sometimes*. Exporters normally emit parents first; a mirrored re-export
may not (the blade mod's right side skirt did, and its own left twin did not). **vehicle-installer reorders
it on the way into the archive and warns, naming the file** — a permutation, so the model is unchanged and
nothing is re-encoded. Nothing else catches it: staging is byte-faithful, and OpenSA's own reader resolves
parents by index, so a model that renders perfectly here still kills the real game
(`docs/gta-sa-original/rw-frame-list-parent-order.md`).

**CLEO scripts see these names too** (plan 097/05): `GetFrameFromName` resolves script part lookups
against the rig's part names verbatim (`misc_a`, `dvan_l`, `dmbus_r`…), and the CAutomobile carNode
reads (`CVehicle+0x648`) bind wheels to the **`wheel_*_dummy`** forms. A name the rig lacks yields a
null frame token — the script's own guard skips, SILENTLY by design (real CLEO would crash there);
the atlas-miss console lines report only UNKNOWN addresses, not missing frames. Two rig facts
currently limit this surface: the vehicle-optimizer DROPS empty parent frames (rhino's `misc_e`
track chain — `docs/hacks/cleo-frame-sibling-order.md`) and flattens parent links, so sibling walks
run in rig order. What that costs a script is measured in `docs/edge-cases/cleo-vm.md`: a script
anchored on a dummy does nothing at all, silently.

### Cutscene conversion (read by `vehicle-cutscene` at build time)

The converter (tool `vehicle-cutscene`, plan 002) rebuilds each `cs*` model from the mod's gameplay
DFF; these mod frame names decide what the CUTSCENE copy carries. Misspelling one is SILENT: the mesh
is still adopted (it rides the nearest carried ancestor un-animated) — what is lost is its animation
channel, exactly like the taxi's misnamed door (gate 7).

| Name | What the converter does |
| --- | --- |
| template part names (`chassis`, `door_lf_ok`…; bikes: `wheel_rear`, `chainset`, `pedal_l/r`, `handlebars`, `forks_front`, `wheel_front`; boats: `boat_hi`, `boat_rearflap_left/right`) | Matched by canonical name to the vanilla cutscene bone; the bone keeps the VANILLA local (the anims' bind pose) and an un-animated `_pv` shim absorbs the mod's placement delta. On bikes/boats the matched frame may be a meshless dummy — its subtree meshes ride the bone. **The shim (and every other un-animated frame — `_ad` included) carries TRANSLATION ONLY** (plan 004 round 15, the securica on its tail): the runtime rewrites every frame's rotation each tick — an animated frame gets the anim quaternion, an un-animated one gets IDENTITY (`FrameUpdateCallBackNonSkinned` sums bound nodes into a zero quat and `CQuaternion::Normalise` turns zero into identity; only `FramePos`, the position snapshot, survives — gta-reversed). A rotation stored in an un-animated frame is silently erased in game while every offline view still shows it; the rotation residual is baked into the part's VERTICES instead (`emitTargetedAtomic`). |
| `<anything>_dam`, `<anything>_vlo` | Never carried into the cutscene copy. |
| `_[<year>]…` subtrees (`_[1991]:2`) | Year-variant ALTERNATIVES to base parts — never adopted (the taxi stacked three door sets). |
| `f_wheel_<mask>` | Wheel sub-model container (cars): the chosen-path walk yields the wheel meshes; the container is never adopted as body parts. **Takes precedence over a mesh under the wheel dummies** (plan 004 round 13): when a mod ships both, the dummy child is the stock fallback wheel VehFuncs replaces in gameplay — the bravura's is a bare brake disc, and picking it also sank the whole body through the ground-shift radius. The displaced fallback (any mesh in a wheel dummy's subtree) is DROPPED, never adopted — adopted, it rides the chassis as a static wheel at one corner. |
| `f_extras:<n>`, `f_class:<n>` | Variant containers. CARS (plan 004 round 11, replacing the gate-4/7 one-mesh rule the burrito starved): the VehFuncs-style chosen path — `<name>:K` shows K of its children; at every level the FIRST eligible child in atomic order wins (`_dam`/`_vlo` children never count; a YEAR-bracketed child is an ordinary option UNLESS its subtree re-offers a part the rig already carries — the taxi's `_[1991]:2` door sets stay unadoptable alternatives, while the burrito's `version[1983]:1` tail-lamp/grille cluster is picked like any group, plan 004 round 12); a leading meshless `no*` child is the author's "off" default and selects nothing from its group. The same walk inside `f_wheel` yields the whole multi-mesh wheel (tire + cap + style — one mesh alone was a hollow tyre), where year brackets are wheel STYLE names and do not disqualify. BIKES/BOATS: the first child SUBTREE with a mesh is adopted whole (handlebar sets carry brake levers/grips as sub-meshes), later children dropped. |
| variants under a matched part's `<part>_dummy` | Adopted under the PART'S BONE, not the chassis (plan 004 round 10): the game keys components by dummy, so mods hang door-attached variants (the burrito's rear-door windows) beside the `_ok` mesh under the dummy — resolved to the chassis they stand still while the door swings. |
| `f_extras:<n>+` | Additive container (bikes/boats): every child kept — the MTB ships both wheel reflectors in one. |
| `<part>_ok`/`_dam` under its own `<part>_dummy` | The frame's transform is junk the game destroys — the dummy is the hinge; every OTHER mesh frame keeps its transform. |
| EVERY adopted mod mesh | Renamed with an `_ad` suffix (`door_lf_ok_ad`, `wheel_pj=0-2c_ad`): an adopted mesh is un-animated by definition and anim binding is by NAME against a per-scene channel table unknowable at convert time — scenes even drive names NO vanilla model has (`windscreen_ok` in DESERT9), and a duplicate of a bound name binds TOO and double-transforms (plan 004 rounds 1–2). The renamed mesh rides its parent bone; nothing is lost. |
| `extra1` … `extraN` (cutscene conversion) | NEVER template-matched — the '92 extras are hand-authored scene furniture the anims pose; a mod's spawn variants are semantically unrelated (DESERT9 swung a whole bed rack 50° midair). Adopted ONE per model (first in atomic order), mirroring SA's at-most-one-extra spawn rule; the rest are dropped + logged. |
| `carplate`, `carpback` (MATERIAL texture names) | A model wearing these placeholder quads gets a READABLE plate pair baked into its emitted `cs*.txd` (vehicle-cutscene plan 003) — own-TXD-first resolution overrides the placeholders the runtime never fills for cutscene objects. A mod shipping its OWN texture under these exact names gets ours instead (same look class); any other name is untouched. Models without the quads (the bike/boat mods) get no pair. |
| lamp ID marker colours (`(255,175,0)`/`(0,255,200)` head, `(185,255,0)`/`(255,60,0)` tail — see §4) | Baked to WHITE, alpha kept (plan 004, BCESAR4 round): the gameplay renderer swaps these per frame, the cutscene renderer swaps nothing, so left raw they render as green/amber lenses. Vanilla cs models ship them white the same way (measured fleet-wide; csbobcat92/cslegend566/cssabre92 kept raw markers — R* slips, visible in the vanilla scenes too). Carcols paint markers get the same in-place bake to the model's first combo (plan 002 step 5). |
| window-glass materials (classified by DATA, no names: translucent below alpha 200, off the `vehiclelights*` atlas, dark-tinted or alpha ≤ 128) | The classifier feeds the atomic-ORDER rule below; the pane's alpha itself is the mod's authored gameplay tint, carried verbatim (plan 004 round 7 — an earlier round clamped it to the vanilla twin's floor chasing stacked-window opacity, but the true mechanism was render order, and the clamp only erased the tint and sheen the mod wears in gameplay). |
| atomics carrying a window-pane material | Emitted LAST in the clump, stable relative order (plan 004 round 5) — vanilla's own layout (`windscreen_ok` is the final atomic of every vanilla car): the cutscene path renders atomics in FILE ORDER with z-write on, so a pane emitted before the interior erases everything behind it (the see-through-the-car windscreen). The atomic ORDER rule above is permanent. The slot-keyed window-class DROP that rode beside it (`PANE_SUPPRESSED_SLOTS`, round 17) is **retired as of 2026-08-14** — a rendered pane also z-writes over scene ACTORS drawn after the car, and with no control over entity draw order the only data-side answer was to ship the car unglazed; `asi/perfect-cutscene` now defers cutscene cars into the engine's sorted entity pass, so they are drawn after every actor and keep their glass (`docs/hacks/retired/cutscene-window-pane-suppression.md`). The list stays in the census as a seam, empty. |
| cutscene wheel channels driven to ~zero (`anim/cuts.img`) | A WHEEL STASH — R*'s repair-scene hide (synd_4a, the only site in 148 scenes): the wheel bones animate to the model origin while the `Axis_*` hubs stay on the corners, and the VANILLA body conceals the clump. The installer ships a patched `anim/cuts.img` sinking every such channel to z −0.6 (`stash-patch.ts`, plan 004 round 20) — fully underground for any mod wheel radius; a channel qualifies only when its frame-0 translation is ~zero AND the model's bind local is a real corner (>= 0.5 m), so driving scenes never match. |
| SA Pipeline Set plugin (`0x253f2f3` = `0x53F2009A`, vehicle pipeline) | Stamped into every emitted OPAQUE atomic's Extension when missing (plan 004 rounds 6+8) — every vanilla cs atomic carries it. A gameplay DFF gets the vehicle pipeline from its model-info type, so mods never ship the plugin; a cutscene object without it renders on the default pipeline where the mod's Reflection/Specular material plugins go unread (a different shine than the same car in gameplay). **WINDOW PANES are the exception and keep the default pipeline** — stamped panes vanished at any alpha (rounds 5–8), and that much still holds. Everything else translucent — lamp lenses, decals, badges — takes the vehicle pipe, which is how the same car renders in gameplay (plan 004 round 23). Round 9 had widened the exception to every translucent atomic after the burrito's 210-alpha tail lenses vanished; what it actually measured was OUR DFF PipelineSet stamp rather than the runtime `CustomCarPipeAtomicSetup` (the two are not the same thing — perfect-cutscene plan 001 step 4), and the price was the whole fleet's lamp shine until the field re-ran it on 14 scenes and saw the burrito's and the sabre's tail lamps repaired. Vanilla ships the plugin on its own translucents too. **A MIXED geometry (opaque paint + embedded panes/lenses in one mesh) is SPLIT before either rule applies** (plan 004 round 14, `rig/split.ts`): the opaque copy takes the pipeline and its normal draw slot, the translucent twin sits on the same frame with the default pipeline (pane ordering when it is a pane) — the sabre bakes door glass into its painted doors and lamp lenses into its chrome bumpers, and one embedded pane otherwise costs the whole painted part its shine. The split is byte-narrow: both copies keep the FULL vertex arrays, the BinMesh is filtered by whole per-material entries (never rebuilt — exporters ship Struct faces and BinMesh with opposite winding), and ADC-strip geometries never split. |

### Tracked vehicles (`track_*` — read by our shipped `rhino-tracks.cs`)

A model carrying these names gets its tread and road wheels animated by the script we ship
(`cleo/scripts/rhino-tracks/`), on **any slot** — the script tests for the names, never for a model
id, so the mod may be installed anywhere and a new tracked vehicle needs no code.

| Name | Role |
| --- | --- |
| `track_1` … `track_12` | The tread FLIPBOOK: twelve authored states of the same belt. Exactly one is shown at a time, advancing one link per 1.5 deg of wheel roll and repeating every 18 deg. **`track_1` is the capability test** — a model without it is left completely alone. |
| `wheel_big_0`, `wheel_big_1` | Drive sprockets. Rolled by the reference wheel's own angle. |
| `wheel_small_1` … `wheel_small_8` | Road wheels. Rolled at **2x** the sprocket angle (they are half the diameter). |
| `wheel_rb_dummy` | The reference wheel the roll angle is read from (`m_forward`, via `m_aCarNodes[CAR_WHEEL_RB]`) — a standard hub name, no extra authoring. |

Every one of these must be a frame **with a mesh**: a dummy is not an addressable part (above), and
the script skips what it cannot resolve. Gaps are tolerated but visible — `track_7` missing means
the tread simply vanishes for that 1.5 deg of the cycle rather than crashing. The count is fixed at
twelve today; the arc per link is `18 / <count>`, so a model with a different link count needs the
script's `TRACK_LINKS` changed, not just renamed frames.

### Damageable components

`bonnet`, `boot`, `bump_front`, `bump_rear`, `wing_lf`, `wing_rf`, `windscreen`, `door_{lf|rf|lr|rr}` —
each as a `<part>_dummy` frame carrying a `<part>_ok` mesh and its `<part>_dam` twin.

- **The mesh hangs on the `*_dummy`; the `_ok`/`_dam` frame's own transform is DISCARDED.** That is the
  original's rule (`CVehicleModelInfo::PreprocessHierarchy` → `CollapseFramesCB` destroys those frames), and
  ignoring it threw a mod's doors clear of the car. Stock SA authors that transform as identity, so nothing
  in the stock fleet ever showed the difference.
- A door swings about its `*_dummy` frame's **own local Z**. A mod that turns a hinge frame ABOVE the dummy
  gets a scissor door for free, with no special case anywhere.
- **A door is its whole hinge SUBTREE, not one named mesh.** SA rotates the dummy's frame, so every atomic
  a mod authors under `door_*_dummy` — separate glass (`glass_lf_ok`), trim, whatever the exporter split —
  travels with the door. The builder records the subtree as the door's part roster (`VehicleDoor.parts`) and
  the swing rotates each member about the hinge. Misspell the glass out of the subtree (parent it to the
  chassis) and it silently stays behind when the door opens — the comet mod's authoring is what surfaced
  this (2026-08-04). Stock cars author one atomic per door, so their doors carry no roster.
- The damage system names parts **without** the suffix: `door_lf`, `bonnet`.
- **Which FRONT doors exist decides how the player boards (2026-08-05).** Entry and the exit chain pick
  among the sides whose `door_{lf|rf}` part the model actually carries: a model authored with only
  `door_rf` (the coach — a real bus boards through its one front door) is entered from EITHER side via
  that door, with the approach routed around the bumper, then the seat shuffle. A model with NO front
  door parts keeps the near-side behaviour (the hinge fallback). Misspelling a door name is SILENT and
  now changes boarding: `door_If` (capital i) reads as "this side has no door" and the player walks
  around to the other one — `dump-vehicle-rig.ts`'s articulation list is the check.

### Dummies (frames with no mesh)

Every one is carried verbatim into the model. Consumed today:

| Name | Used for |
| --- | --- |
| `ped_frontseat` / `ped_backseat` | The seat positions — one per ROW; the opposite side is the x-mirror, which is how SA derives the driver from the passenger seat. Read by the gameplay code AND, since plan 005, by the cutscene converter — see below. |
| `headlights` / `taillights` | Lamp anchors (SA authors ONE per end and mirrors it). **At the model ORIGIN = this model has no lamp of that kind** — see below. |

**A seat dummy now decides where a CUTSCENE actor sits, too — and an absent one changes nothing.**
A cutscene actor's position is ABSOLUTE, out of the scene's own root channel in `anim/cuts.img`, and
R\* authored every scene at their own car's `ped_frontseat` (measured: x within 0.02 m, z within 0.03 m
across FINAL2B and SMOKE2B). So a donor whose cabin rides higher than the stock car's seats its
occupants BELOW their own seat — 0.281 m on the glendale — and no model data can correct it, because
the actor is not in the car's clump. `vehicle-cutscene` therefore lifts the actor's root channel onto
the donor's own seat (`seat-patch.ts`, z only: the pose is authored for R\*'s cabin, so moving him
sideways would take his hands off the wheel).

**What a mod author needs to know**: state `ped_frontseat` where a person actually sits and the
cutscenes follow it; state nothing and the scene's authored placement stands unchanged — that is the
fallback, not a failure. Three gates keep the patch surgical, and all three are silent when they skip:
an actor must be SKINNED (a prop riding a car is not one), he must actually ride the car (the lift ramps
to zero across the frames he spends getting in or out, so nobody floats on the way to the door), and the
correction must exceed 0.05 m (below R\*'s own authoring spread it is noise). Misplacing the dummy moves the cutscene
actor with it — the same lever, pointed the wrong way.

**A lamp dummy at (0,0,0) means "no lamp here", and it is the only way to say it.** That is SA's own
convention, not ours: a missing dummy reads back as (0,0,0) from `CVehicleModelInfo::m_avDummyPos` and
`CVehicle::DoHeadLightBeam` tests exactly that (`if (pointModelSpace.IsZero()) return;`). Since plan
098/11 OpenSA honours it at BOTH ends — an absent or origin dummy emits no beam, no pool light and no
corona there — and there is no fallback: what the model does not author, the game does not light.

For a mod author this is the whole lever. A race car with no lamps zeroes both dummies (the hotring mod's
own author had already done it for `taillights`); a truck with no rear lamps zeroes just the tail. It
needs no engine change, no config line and no per-model rule, and it is what
`scripts/debug/zero-vehicle-dummy.ts` writes — a 12-byte edit to that one frame's position.

**Spelled wrong / left out:** a dummy the model simply does not carry behaves identically to a zeroed
one (no lamp at that end), so a typo in the frame name silently costs the car its lights on that side
rather than erroring. `scripts/debug/lamp-census.ts` is where that shows up — it prints, per model,
whether each lamp dummy is real, at the origin, or absent.

**The lamp MATERIAL is a different thing and does not gate the light.** Whether the lens glows (the
lit-twin swap and the emissive) keys on the `vehiclelights*` marker material; whether there IS a light
keys on the dummy. The stock `coach` proves they are independent: it carries no head lamp material at
all and still has working headlights.

Carried but not consumed yet: `exhaust`, `petrolcap`, `engine`, `ped_arm`, the second lamp dummies some
models author (`taillights2`), and anything else the author left.

---

## 4. Material and texture names

| Name | Meaning |
| --- | --- |
| `vehiclelights*` | The lamp atlas. A material on it whose colour is a marker IS a lamp: `(255,175,0)` / `(0,255,200)` = head, `(185,255,0)` / `(255,60,0)` = tail. The colours are metadata and are never rendered — by a renderer that KNOWS them; the SA cutscene path does not, which is why `vehicle-cutscene` bakes them white (§3). |
| `carplate` | The plate's text strip — a generated 64×16 raster per car. |
| `carpback` | The plate's background quad — one of three static city designs. |
| `platecharset` | The glyph atlas, in `models/generic/vehicle.txd`. |
| `plateback1` / `2` / `3` | The city backgrounds: **SF / LV / LS**, in that order (measured; the reversed `eCarPlateType` agrees). |

Carcols paint markers are **colours, not names**: `(60,255,0)` primary, `(255,0,175)` secondary,
`(0,255,255)` tertiary, `(255,255,0)` quaternary.

**A material's UV-animation name must match a dict entry in the SAME DFF** (plan 099). The material's UV
Anim plugin names an entry of the clump's leading UVAnimDict (`f13d` on the ferris wheel's `Frames`
material); the converter binds the two by that name and the runtime plays the keyframes. Both names are
written by the exporter, so they normally agree — but a re-export that drops the dict, or a hand-edited
clump, leaves a reference to nothing. **When the name resolves to no entry, or to one with no keyframes,
the material renders STATIC and nothing is logged** — same fallback as the world lane, chosen because a
missing animation must not take a model out of the game. The symptom is a sign or a light strip frozen on
frame 0, which is exactly what the bug looks like before the animation ever worked, so check the dict
first: `npx tsx scripts/debug/dump-osm.ts <model>` prints the animations the built `.osm` actually carries
and the submesh each one drives. Only UV channel 0 is played; a mask naming more channels loses the rest.

**A translucent material needs `rpGEOMETRYMODULATEMATERIALCOLOR` on its geometry — and the cutscene
converter now SETS it for you.** Without that RW geometry flag the DEFAULT pipeline never reads the
material colour, so a window authored at alpha 115 renders as a solid sheet. Gameplay hides the mistake
completely: SA's vehicle pipe takes the material alpha itself and never consults the flag, so a mod can
ship windows without it and look perfect while driving. Cutscene window PANES ride the default pipe (they
are kept off the vehicle pipe on purpose, §3), which is where it shows — as a matte windscreen nobody can
see through, from any angle. Measured on `copcarla`, the only mod of the 23 whose `windscreen_ok` and
`body_windows` lack the flag (plan 004 round 21); `vehicle-cutscene` sets it on any geometry carrying a
translucent material and leaves opaque geometries exactly as authored.

**There is deliberately NO texture-name matching for the reflection class.** Chrome is decided by data (an
untextured neutral-grey material with an env map), glass by translucency, paint by a carcols marker. Mods
combine arbitrary texture names, so a name rule there produces false positives on whole fleets.

---

## 5. Converted output

| Name | What it is |
| --- | --- |
| `<model>.osm` | The converted model: a `DESC` fixture (JSON) + `GEOM` buffers + baked collision. Replaces `<model>.dff` in the archives. |
| `<model>.ostex` | Its baked dictionary — one texture array, carried as a section of the `.osm` (and a name the loader also accepts as a standalone asset). |

A field run reads the BUILT game dir and nothing else, so a name that only exists in `mods-src` or
`game-src` has no effect on what the game does.
