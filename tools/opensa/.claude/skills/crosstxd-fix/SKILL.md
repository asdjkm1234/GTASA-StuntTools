---
name: crosstxd-fix
description: Turn the pak build's textures.crossTxd ledger (textures rescued from donor TXDs) into reviewable PNG fixes for the owning mods, so the data becomes self-contained. Use after a pmb rebuild when report.json still lists crossTxd entries.
---

# crossTxd → mod texture fixes

A `textures.crossTxd` ledger entry means a model's own TXD lacks a texture the model references — the
pack rescued it from a DONOR TXD at build time. The permanent fix: ship the texture INTO the model's TXD
via the mod-installer's PNG texture-folder convention (plan 009 — a PNG subfolder inside `gta3_img/`
merges into the IMG entry `<folder>.txd`).

## Steps

1. Run the collector against the CURRENT build (defaults: canonical build paths):

   ```bash
   npx tsx scripts/crosstxd-fix.ts
   # [reportPath] [buildGameDir] [modsDir] [outDir] override the defaults when needed
   ```

   It reads `build/original/opensa/pak/report.json` (086 phase 8; older pak homes are probed
   automatically), exports every rescued texture as an RGBA PNG from
   the build's archives (gta3 + gta_int + cutscene overlay), and lays them out under
   `NO_COMMIT/crossTxdFix/<mod>/gta3_img/<txd>/<texture>.png`.

2. The attribution is automatic but REVIEW it in the printed report:
   - `<mod>` = the LAST mod (install order) shipping any of the entry's model DFFs, bumped to at least
     the last mod shipping `<txd>.txd` wholesale (a later whole-txd copy would erase the merge);
   - no shipper at all → the `Fixes` folder (sorts after every numbered mod → installs last);
   - textures present in generic `vehicle.txd` are SKIPPED — SA resolves them via the vehicle-generic
     parent, they are not missing data.

3. Review the PNGs (open a few — a wrong donor is visible instantly), then move each mod's `gta3_img/`
   content into `mods-src/original/mods/<mod>/gta3_img/` (create the `Fixes` mod folder on first use). The PNG
   folders coexist with the mod's other files; modloader-based original-GTA installs ignore them.

4. After the next pmb rebuild, verify `textures.crossTxd` in the new `report.json` shrank to only the
   vehicle-generic class (which needs no fix). Any survivor = attribution or donor worth a second look.

## Gotchas

- PNG file name = TEXTURE name, folder name = TXD name (`gta3_img/philss/cap_up.png`), never the model.
- A mod may ship BOTH `<txd>.txd` and the `<txd>/` PNG folder: the installer lands the mod's txd first
  and merges the PNGs into THAT dictionary — so attributing a fix to a mod that ships the txd itself is
  always safe.
- The installer re-encodes PNG → DXT5 (alpha) / DXT1 (opaque) with full mips — a DXT→PNG→DXT roundtrip
  is lossy but visually negligible; the donor texel data was already DXT.
- The `.txd` entry must exist in the archive — the installer patches dictionaries, never creates them.
- `mods-src/` is not under git; `NO_COMMIT/` is gitignored — nothing here needs a commit except code or
  doc changes made along the way.
