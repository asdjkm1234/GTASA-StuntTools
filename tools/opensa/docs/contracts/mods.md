# Mod folder name contracts

What `mod-installer` looks for when it layers `mods-src/<game>/mods/*` onto a base game. Every name here
decides behaviour, and a name spelled otherwise is not an error — the file is simply copied somewhere the
game never reads, and **the mod does nothing, silently**. That has already cost one whole install
(`models/gta3img/` instead of `gta3_img/`).

Vehicle mods have their own folder shape: [vehicles.md](./vehicles.md).

---

**A folder's NUMBER is install ORDER, not an identity.** Inserting a mod shifts every folder after it
(2026-08-18: two map mods went in at `5.`/`6.` of `common` and 63 folders moved up by two), so **a record must
name the mod, not its number** — a benchmark row or an issue that says "mod 64" points at a different mod after
the next insert. Numbers in this repo's docs carry the date they were true where it matters.

## 1. The `--in` tree

One folder per mod, each an immediate subfolder of `--in`. The folder NAME is free text with one job:
**ordering**. Mods apply in numeric-aware alphabetical order (`1. Foo` < `2. Bar` < `10. Baz`), and **later
mods win** — the last one to write a file owns it.

A mod is applied in one of two shapes, decided by its contents, not by its name:

| Shape | Decided by | What happens |
| --- | --- | --- |
| **Path overlay** (default) | anything else | The mod mirrors the game tree from its own root; files overwrite by path. |
| **Modloader-style bake** | it carries a **loader `.txt`** — any `.txt` whose contents declare `IDE` / `IPL` / `COLFILE` paths | The folder LAYOUT is ignored entirely and every file is bucketed by its BARE NAME (below). |

### `common/`, `sa/`, `opensa/` — three RESERVED names at the top of `--in`

The mods folder has two shapes, and which one it is comes from the names of its immediate subfolders:

| Shape | `--in` holds | What applies |
| --- | --- | --- |
| **Flat** (the default) | mod folders | all of them, in numeric-aware order |
| **Layered** | `common/` and/or `sa/` and/or `opensa/`, each holding mod folders | `common` first, then the folder named after the **target being built** (`--target sa` / `--target opensa`). The other target's layer is not applied. **The same three layers, planner and refusals apply to `mods-src/<game>/vehicles` (each layer flat or `models/`+`new/`, the target layer wins the SLOT — [vehicles.md](vehicles.md) §1) and to `mods-src/<game>/peds` (the target layer's ped is the last writer of its model)** — `@opensa/tool-kit/layers`, one planner for all three (2026-08-17). |

Every layer is optional, and a game keeps the flat shape until someone splits it. Inside a layer nothing
changes — same mod folders, same numbering, same two shapes above.

**The layer order dominates the numbering**: `common/50. Foo` applies before `sa/0. Bar`, because the
target layer has to be the last writer for the split to mean anything. Numbers restart in each layer, and
`renumber-mods` compacts each layer independently. To override a `common` mod for one target, ship the
files again in that target's layer — a folder NAME never matches anything across layers.

The three names are matched **case-folded** (`SA/` is the `sa` layer), because they are one folder on
Windows and macOS.

Misspell one — `commons/`, `open-sa/`, `SA mods/` — and it is not a layer: it is a mod folder sitting
beside layers, which is refused (§5) rather than silently applied to both targets. The same guard is what
makes a mod that happens to be CALLED `sa` impossible: at the top level of `--in` that name belongs to the
layer, so such a mod has to be renamed.

A layered `--in` with no target is refused too — there is no layer to pick. In a build that is not
possible: `perfect-map-builder` always resolves a target and passes it, and it refuses a run that would
build BOTH targets out of a layered folder, because the `mods` stage is shared by both
([restrictions/architecture.md](../restrictions/architecture.md)). Build them one at a time.

---

## 2. Path-overlay conventions

### `gta3_img/`, `gta_int_img/`, `cutscene_img/`

A binary archive cannot be patched file-by-file, so a mod ships a folder instead: these merge into
`models/gta3.img`, `models/gta_int.img` and `models/cutscene.img`.

- **Top level of the mod only, and the name must match exactly.** `models/gta3img/` or a nested
  `models/gta3_img/` is copied verbatim as loose files the game never reads.
- **Place an asset in the archive its STOCK copy lives in.** An interior model belongs in `gta_int_img/`; put
  it in `gta3_img/` and it shadows nothing.
- Loose files inside become entries by name — added if new, replacing an existing entry otherwise.
- **A `.col` is a LIBRARY, and replacing it DELETES every model it does not carry.** `laxref.col` holds 148
  named collision models; a mod shipping its own copy to change one bench replaces the entry whole, and the
  other 147 lose their collision. The objects still exist — they are simply placed with nothing to stand on,
  which shows in-game as walking through a bench, never as an error. **Ship the whole library, not your
  edit of it**, and if you started from another mod's copy check that it was whole first. Same shape as
  `Remove original/`, except nothing declared the intent.
  *What catches you:* since 2026-08-10 the installer prints
  `mod-installer: <name>.col replaced — N collision model(s) LOST: …` naming the models, so the loss is at
  least loud at build time. It is still a WARNING — the replacement wins, per this contract. Nothing catches
  it at runtime unless FLA's optional error reporting is on, which is how the first case was found: mod 60
  had dropped `ferseat01_LAx`, and the real game said "model ID 3752 does not have loaded collision" months
  after the install.
  **The quieter half of the same rule: a whole library cut from STOCK reverts every fix an EARLIER mod's copy
  of that library carried, and nothing warns** — the model count matches, nothing is lost, and the warning
  above stays silent. `Watts towers GTA V to SA` (`67.` since 2026-08-18) shipped `lae2_5.col` (68 of 68) cut from stock to change
  `wattspark1_LAe2`, and being installed after `0. Map Fixes Pack` (which ships the same library) it put
  `furniture_lae`, `ground2_alpha` and `ebeachalpha5b` back to their stock collision (2026-08-17). Base your
  copy on the previous layer's file, and when you cannot, splice: `scripts/debug/col-splice.ts --base
  <prev.col> --donor <yours.col> --models <a,b> --out <merged.col>` keeps every block of the base and swaps only
  the named ones, byte for byte. *What catches you:* nothing — compare the libraries by hand (`col-splice.ts
  --list`) or wait for the field.
- **`Remove original/` carries NO special meaning — it is an ordinary organisational subfolder, and its files
  are REPLACEMENTS.** The name reads as an instruction ("remove the original") and we implemented it as one
  until 2026-08-10; it actually names *the files that remove the original*, i.e. empty RW clumps a mod ships to
  make stock geometry invisible while its script draws its own. Three things settle it: Modloader has no delete
  mechanism at all (it never touches an original file, it shadows one at runtime), the folder sits INSIDE
  `gta3_img/` where everything is injected by bare name at any depth, and the payloads are valid empty clumps
  (653 B each in the field case) rather than copies of the 4-66 KB originals.
  *What happens if a tool reads it as a delete list:* the entry vanishes while the stock `.ide` row and its
  inst rows survive, so the map places a model the streamer can never load. That is not a missing object —
  the whole world renders as LODs with permanent hitching. Caught since 2026-08-10 by the gate below.
- A subfolder holding PNGs is a **texture folder for an archive-internal `<folder>.txd`** (below).
- Any other subfolder is organisational and is recursed — real packs ship `gta3_img/LV/…` layouts.
- `<name>.ipl.merge` inside an IMG folder EDITS the named binary stream entry instead of replacing it; those
  run last, after every data merge has rebased the streams.

### Texture folders: a folder named like a `.txd`, holding PNGs

**A directory whose sibling `<dir>.txd` exists in the install is a texture folder**: its PNGs merge INTO that
dictionary instead of being copied as files.

```
models/generic/vehicle/carplate.png     →  merges into models/generic/vehicle.txd
models/particle.txd/particleskid.png    →  the same file — the extension on the FOLDER is accepted too
gta3_img/previon/remap.png              →  merges into the previon.txd ENTRY inside gta3.img
```

- The texture NAME is the PNG's basename, matched case-insensitively: an existing texture of that name is
  **replaced**, a new one is **added**. Every other texture in the dictionary is left untouched — this is a
  merge, never a rewrite.
- Format for a PNG that ADDS a texture is chosen from the image: **DXT5 when it carries real alpha, DXT1 when
  it does not**. PNGs must be 8-bit RGB/RGBA and non-interlaced. **A PNG whose side is not a multiple of 4
  becomes a DXT raster the real game refuses** — with its whole dictionary (`docs/restrictions/dxt-raster-dimensions.md`); the installer
  WARNS naming the mod, folder, texture and size (plan 014) and keeps the bytes as they are — map-optimizer
  resamples them later in the pipeline. The same warning fires for any `.txd` a mod ships (archive entry,
  Modloader-collected asset or loose overlay) that carries one.
- **A PNG that REPLACES a texture inherits that texture's compression class instead**: what the original
  ships uncompressed stays uncompressed, whatever the image's alpha says (mip chain and size still come from
  the PNG). This is not cosmetic — the game READS some of those rasters back rather than sampling them
  (`CCustomCarPlateMgr` copies glyph pixels out of `platecharset`), and a compressed one arrives as blocky
  garbage on every car with nothing in any log. You cannot tell which from a name, so the rule follows the
  data: `docs/restrictions/uncompressed-rasters-stay-uncompressed.md`. A texture folder's PNGs therefore
  cost more than DXT would when they land in `models/generic/vehicle.txd` or `models/particle.txd`, the two
  dictionaries stock keeps uncompressed end to end.
- Within a mod, files are copied BEFORE subfolders, so a `.txd` the same mod also ships is in place first and
  gets patched rather than lost.
- **Both spellings of the folder name work** — `vehicle/` and `vehicle.txd/` target `vehicle.txd`. Authors
  write both, and until 2026-07-29 the second one was not a wrong-target bug but a BUILD KILLER: the folder
  missed the `<dir>.txd` test (it looked for `particle.txd.txd`), fell through to `mkdir`, and hit the stock
  file with a bare `EEXIST: file already exists, mkdir …/models/particle.txd` that named neither the mod nor
  the rule.
- The texture NAME stored is the PNG's own spelling; the MATCH against the dictionary is case-insensitive.
- Inside an IMG folder, a texture folder whose `.txd` entry is missing is a **loud warning**, not a silent
  skip. **The dictionary is never CREATED from the PNGs** — the folder patches what is already there, so a
  mod that ships the PNGs of a WHOLE dictionary must ship the `.txd` too or lose every one of its textures.
  When that happens, build the file from the folder with `scripts/debug/txd-from-pngs.ts` (see
  [`docs/debug/README.md`](../debug/README.md)) — that is what the warning is telling you to do. It is a real
  shape: "52. Abandoned Cars" shipped `gta3_img/philss/` as 22 loose PNGs while "0. Map Fixes Pack" repointed
  `cuntwjunk04` at a `philss` dictionary nobody shipped, and those 22 PNGs were exactly that model's 22
  textures.
- On the LOOSE side the folder is **warned about and still copied** as a directory, PNGs and all: nothing
  there can create the dictionary, the stray files are harmless (the game ignores them), and a later rule may
  well make the folder itself valid. The warning is the part that matters — it names the missing `.txd`.

### A shared `.txd` is REPLACED whole, so a later mod must carry a SUPERSET

An archive holds one entry per name: a mod shipping `alleyprop.txd` replaces every texture in it, including
ones an EARLIER mod added or resized. Measured while installing `HD Aircon` (2026-08-18): its own dictionary
carried the two new `aal_aircon1*` textures plus `hoteldetails2` at the stock 128², while `3. Global Textures
Fixes` ships that texture at 256² — installing after it would have silently reverted the upscale, and installing
before it would have lost the aircon's own textures. **The fix is a superset, not an order**: take the winning
dictionary and splice the new textures in chunk-for-chunk (`readRw`/`writeRw` keep every texel byte-exact — a
decode/re-encode round costs a DXT generation), and note in the mod which dictionary it was derived from, because
the superset has to be rebuilt when that mod ships more. `scripts/debug/txd-retune.ts --add <txd>#<name>` does the
same thing when a re-encode is acceptable, and the pak build reports what a replacement dropped
(`report.json` → `textures.missing`).

### `<target>.merge` — edit a data file instead of replacing it

A mod ships `multiobj.ide.merge` next to the game path it wants to change. Directives apply to the CURRENT
state of the target, so merge-mods stack with each other and with earlier whole-file replacements:

```
remove from "objs":
1682, ap_radar1_01, ap_misc1bit, 100, 2097152

add to "anim":
1682, ap_radar1_01, ap_misc1bit, radar, 600, 0

replace in "inst":
- 710, vgs_palm01, 0, 2110.67, -977.73, 66.13, 0, 0, 0, 1, -1
+ 710, vgs_palm01, 0, 2110.67, -977.73, -300.0, 0, 0, 0, 1, -1
```

- `.ide` targets: `remove` deletes by ID, `add` appends (creating the section when absent) and replaces a
  same-ID entry.
- `.ipl` targets: index-safe only, because row ORDER is data (binary streams and `lod` columns address rows
  by index). `add` appends before the section's `end`, `replace` swaps in place, `remove` matches the whole
  whitespace-normalised line and — for `inst` — rebases every surviving `lod` link and reports the removed
  indexes so the area's binary streams are patched the same way.
- A `.merge` whose target does not exist in the install is a hard error, not a skip.
- **Every `lod` cell a `.merge` writes — text or stream — is in the index space of the file the INSTALL will
  have, never the author's.** The two differ whenever the mod adds an inst row: the author puts it where they
  authored it, `add` appends it at the end, and every link past that point shifts by one. A merge carrying the
  author's number silently re-points that link at a different, perfectly valid row, and for a stream merge it
  also overwrites the rebase the installer just did (stream merges run last). **Nothing about the file looks
  wrong afterwards** — the field just loses a LOD, which is how `0. Map Fixes Pack` shipped 11 broken links
  for a month ([mod-installer/012](../../tools/mod-installer/docs/plans/012-stream-merge-lod-space.md)).
  Generate a pack's merges with `merge-gen-mod --mod <folder>`, which converts the text and its streams in one
  pass and gates every link; the single-file CLI refuses a `*_streamN.ipl` target for this reason.
- `#` and `//` comments are ignored.

### The timecyc: THREE names, one order, and a silent fall-through

A world may carry the per-weather colour table under any of three names, and every reader in the project
resolves them in this order (`TIMECYC_SOURCES`, `packages/renderware/src/parsers/text/timecyc-source.ts`):

| # | File | What it is |
| --- | --- | --- |
| 1 | `data/timecyc_24h.dat` | a hand-authored 24h table, read as authored |
| 2 | `data/timecyc24h.dat` | the same thing under the name the `timecyc24h.asi` plugin (Dante) reads |
| 3 | `data/timecyc.dat` | the stock 8-keyframe table, expanded to 24h on load |

**A mod shipping `data/timecyc24h.dat` in the `opensa` layer is the supported way to ship a 24h table.**
The first two names are the SAME FORMAT — 23 weathers × 24 hours × 52 numbers, the 27 field groups in file
order — so a file authored for either plugin loads here. The two plugins differ only in the name each one
hardcodes, which is also why swapping their files in the REAL game does nothing (the plugin never finds its
name and the stock table stays live). Our loader accepts a table of 504 rows (the 21 time weathers) or 552
(plus the 2 extracolour weathers); `ensure24h` decides by row count, and `buildTimecyc` keeps the first 21
either way, so the extracolours are parsed and not used.

**When a name is misspelled, nothing happens** — the resolver simply falls through to the next one, no error,
no warning. The same silence covers the case that actually bites: a world carrying two of the three names
uses the higher one and the other is never read. The ONE tell is the boot line every reader prints:

```
[timecyc] data/timecyc24h.dat (dante-24h, 552 rows)
```

Read it before concluding a timecyc mod "did nothing". If none of the three is present the world refuses to
load and the error names all three.

---

## 3. Modloader-style bake

Triggered by a loader `.txt` (a `Loader.txt`-style file declaring `IDE`/`IPL`/`COLFILE` paths). The mod's own
folder layout stops mattering; every file is bucketed by bare name:

| Bare name | Where it goes |
| --- | --- |
| `.dff` `.txd` `.col` `.ifp`, `*_stream<N>.ipl` | Injected into `models/gta3.img` **only** — an asset whose stock home is `gta_int.img` lands in the wrong archive and shadows nothing. |
| `object.dat`, `procobj.dat` | Merged ADDITIVELY, row by row (keyed by model / by surface+model). |
| `.ide`, text `.ipl`, other `.dat` | Written to disk: over the stock file with that bare name, else to the path the loader declared. |
| the loader `.txt` itself | Its `IDE`/`IPL` lines are appended to `data/gta.dat` (canonicalised to the stock `DATA\MAPS\…` spelling); `COLFILE` is dropped — col rides in the archive. |
| `Remove original/` (any depth) | Nothing special — organisational, its files are injected as REPLACEMENTS by bare name (see §2). |
| a `cleo/`/`CLEO/` dir (any depth, any extension inside), loose `.cs`/`.ini`/`.fxt` | Copied to `<out>/cleo/…` — the dir's author-relative structure preserved, loose files by bare name — with a log line per file. A misspelled dir (`cleo2/`) is NOT a cleo dir: its `.cs`/`.ini`/`.fxt` still land via the loose-extension rule, other extensions are dropped as before. |
| `*.settings.txt`, prose `.txt` | Ignored by the map baker. Vehicle settings belong to a vehicle mod — see [vehicles.md](./vehicles.md). |

Loader and data files are read **BOM-aware** (UTF-16 is what Notepad writes); the `.merge` and IPL/IDE
readers on the overlay path still assume UTF-8.

---

## 4. CLEO scripts (`cleo/` — plan 097; the runtime reads these, not the baker)

The RUNTIME discovers compiled scripts at boot from the VFS key prefix **`cleo/` + `.cs`** (keys are
lowercased by every loader). The installers place them there (plan 097/06): mod-installer's bake
buckets CLEO content to `<out>/cleo/` (overlay mods normalise a top-level `CLEO/` → `cleo/`), and
vehicle-installer carries a vehicle mod's `cleo/` subfolder — see section 3 and
[vehicles.md](./vehicles.md).

| Name | Meaning | Misspelled → |
| --- | --- | --- |
| `cleo/<name>.cs` | Decoded and run as a script thread at boot (capped by `config.cleo.maxScripts`; census line `[cleo] N script(s)`). The local/http-dir partition ALSO pre-decodes these to select script-referenced models into the VFS (`cleoModelRefs`). | **Silently not discovered** — wrong folder or extension means no census entry and no model selection. The census line is the check: count your scripts. |
| a broken/foreign `.cs` | Skipped WITH a console line (`[cleo] … failed to decode`); the other scripts still run. | reports itself |
| the mod's `.ide` | Must ALSO be LISTED in `data/gta.dat` (`IDE DATA\MAPS\….ide`) — the runtime id→name resolver follows gta.dat, while the partition scans every `data/**/*.ide`. | Models reach the VFS but ids resolve to nothing: `[cleo] model id N resolves to nothing` (the 04 field lesson — reports itself) |
| `<name>.opensa-only.cs` (SDK-authored artifacts, `cleo/sdk` plan 003) | The `@opensa/cleo-sdk` build embeds the script's declared target in the filename: a plain `<name>.cs` passed the dual-target whitelist (runs under plain real CLEO 4 on SA 1.0 US AND our VM); `<name>.opensa-only.cs` uses opcodes only our VM serves. Our runtime treats both as ordinary scripts. | Dropping the suffix by renaming does NOT make the script portable: on real SA it faults at the first unknown opcode (real CLEO's failure, loud). The suffix is information, not a switch. |
| `<name>.sa-only.cs` (SDK-authored, cleo/scripts plan 003) | The mirror of `opensa-only`: the script drives real-SA systems our engine does not have (cutscenes), so it passed only the real-CLEO half of the gate — the reference install's CLEO 4.4 surface (game opcodes + classic CLEO 4 core + the IniFiles module the install measurably loads). A debug/field artifact for the bottle; never part of a game build. | Dropped into an OpenSA `cleo/`, the VM cannot execute its opcodes — it dies at the first unserved one, not silently but not usefully either. The suffix is the warning: it does not belong in an OpenSA tree. |

---

## 5. What the install REFUSES

**A model an `.ide` declares and an `.ipl` places must have a `.dff` in some archive.** The installer ends with
`checkDanglingModels` over the built tree (`dangling-models.ts`) and THROWS, naming each model, its id, its
placement count and the IDE that declares it. Placed is part of the test, not decoration: stock itself declares
one model nothing places (`carupg_int_rays`), and that is harmless.

It is a gate rather than a warning because the failure is global and does not point at its cause — the request
can never complete, so the world renders as LODs everywhere with permanent hitching, which reads as a
performance problem or a map-layer bug. It cost a day of bisection on 2026-08-10 (5 models, 23 placements,
from one mod's `Remove original/` folder read as a delete list).

**A mod folder beside the layer folders** (§1). Once `--in` carries `common/`, `sa/` or `opensa/`, everything
else at that level is refused by name: a mod there has no honest position relative to the layers, and the
usual cause is a misspelled layer, which would otherwise apply to both targets without a word.

**A layered `--in` with no target**, and **two layer folders differing only in case** (`sa/` + `SA/`, which
only a case-sensitive filesystem can produce).

---

## 6. Two files a LATER build stage rewrites over your mod

Mods are not the last writer in the chain. Two data files are edited again after every mod has been applied, on
the `sa` target only, by the procobj bake
([`sa-procobj-placement/014`](../../tools/sa-procobj-placement/docs/plans/014-permanent-rows-no-lod-twins.md)):

- **`data/maps/generic/procobj.ide`** — the **draw distance** column of every species the bake places is set to
  the configured range (299). Your rows survive; that one cell does not, and only for placed species. A mod that
  ships this file to change a model or a TXD keeps those edits.
- **`data/procobj.dat`** — the placed species are STRIPPED out of it, because they are static instances now and
  the runtime scatterer would double them. A mod's added rules for species the bake does NOT place survive.

Neither happens on the `opensa` target: it runs no bake, so both files reach our engine exactly as the mods left
them. If you are debugging "my procobj edit did nothing in the real game", this is the reason, and the built
`sa/` copy is the one to read — not `game-src/` and not `.work/`.

## 7. Two files the `opensa` pack READS for the map's place names

Not rewritten — read, once, at pack time (201/5-03). If your mod replaces either, the districts a dispatch
map shows come from YOUR copy, and if it removes them the map has no place names at all.

- **`data/info.zon`** — the named boxes. The pack keeps each box's 2D extent and its **tenth column**, which
  is a GXT key rather than display text (`GANTON, …, GAN`). A row whose key is misspelled resolves to nothing
  and the district ships under the key itself, so the map reads `GAN` where it should read `Ganton` — no
  error, no warning, and it looks like a naming decision somebody made.
- **`text/american.gxt`** — where those keys resolve to text. A total conversion shipping its own GXT is
  read the same way; one shipping none leaves every district named by its key.

The result is baked into `districts.json` beside the pak, because a surface streaming a pak reaches neither
file ([build-vs-runtime](../restrictions/build-vs-runtime.md)). A game with no `info.zon` produces no table,
which is a supported state and not a build failure.

## 8. What is NOT a contract

- **The mod folder's name** — ordering only. Renaming a mod cannot change what it does. The exception is the
  three RESERVED names at the top level of `--in` (§1): there, `common` / `sa` / `opensa` name layers rather
  than mods.
- **The path a Modloader-style mod uses internally** — bare names decide everything there.
- **A texture's format in the PNG folder** — for a texture the folder ADDS it comes from the image's own
  alpha, and for one it REPLACES from the raster being replaced. Never from a naming scheme.
- **`Remove original/`** — the name looks like an instruction and is not one (§2).

---

## 9. Adding a convention

When a new folder/file name starts meaning something, it goes here in the same change, with what happens when
it is misspelled. That last part is the point: nearly every rule on this page exists because some spelling of
it once passed silently. Anything that reports itself needs a line here far less than something that does not.
