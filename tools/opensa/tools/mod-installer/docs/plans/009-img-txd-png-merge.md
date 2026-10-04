# 009 — mod-installer: PNG folders for IMG-internal `.txd` + organisational subfolders

> **Superseded in part by [015](015-replacement-png-follows-its-raster.md) (2026-08-20):** the DXT5/DXT1-by-alpha choice below is still the rule for a PNG that ADDS a texture. One that REPLACES an existing texture now inherits that raster's compression class — the game reads some of them back on the CPU.


**SHIPPED 2026-07-23.** Extends the `*_img/` folder convention (plans 001/003) in two ways `mergeImgDir`
previously ignored — both driven by real cases found in the field.

## 1. Texture folders inside `*_img/` (the crossTxd-fix enabler)

Plan 003's PNG-folder merge only reached **loose** `.txd` files on disk. But most map/vehicle TXDs live
INSIDE `gta3.img`, and the 085-round build ledger (`textures.crossTxd`, 83 entries) proved mods routinely
ship DFFs referencing textures their target TXD never carried (e.g. mod "52. Abandoned Cars" ships
`cuntwjunk04.dff` needing `cap_up` in `philss.txd` — stock `philss` has no such texture; the pak build
rescued it from a donor TXD at pack time).

**The rule:** inside a `gta3_img/`/`gta_int_img/`/`cutscene_img/` folder, a SUBFOLDER that contains PNGs
is a **texture folder**: its `<name>.png` files merge into the IMG entry `<folder>.txd` (replace same-named
texture / add new — the plan-003 semantics via the shared `mergeTxdBytes` core). Applied AFTER the mod's
file entries — so when the SAME mod ships both `<txd>.txd` and a `<txd>/` PNG folder, the merge base is
the mod's OWN txd (its file replaces the entry first, then the PNGs patch that dictionary; the stock
entry's textures are fully superseded). A texture folder with no matching `.txd` entry is a **loud
warning** (never silent).

Encoding is plan 003's: DXT5 when the PNG has real alpha, else DXT1, full mip chain. The `.txd` entry must
already exist (stock or shipped earlier) — the installer patches dictionaries, it doesn't create them.

```
52. Abandoned Cars/gta3_img/philss/cap_up.png   → merges texture `cap_up` into gta3.img : philss.txd
```

Install-order invariant for authors: put the PNG fix in a mod NOT EARLIER than the last mod that ships
`<txd>.txd` wholesale, or a later whole-file copy erases the merge. (The `crosstxd-fix` skill checks this.)

## 2. Organisational subfolders collect recursively (the mod-22 bug)

`mergeImgDir` used to read only TOP-LEVEL files; the only recognised subfolder was `Remove original/`.
Field find (2026-07-23): mod "22. Neon Objects" ships `gta3_img/LV|SF|LS/*.dff` — every file in those
subfolders was **silently ignored** (verified by bytes: the mod's `casinoblock3.dff`, 176 960 B, never
reached the build's img). Now any subfolder that is neither `Remove original/` nor a texture folder is
organisational: recurse and collect its files by bare name, exactly like the Modloader baker already did.

Disambiguation: a subfolder is a texture folder **iff it directly contains at least one `*.png`** —
IMG-bound assets (`.dff`/`.txd`/`.col`/`.ifp`) are never PNGs, so real packs cannot collide.

## As built

- `txd-folder.ts`: `mergeTxdBytes(folderPath, txdBytes, label)` extracted as the in-memory core;
  `mergeTxdFolder` (loose files, plan 003) wraps it unchanged.
- `img-merge.ts` `mergeImgDir`: recursive collect (files / `Remove original/` / texture folders /
  organisational), then one img open → removals → entries → texture-folder merges → write.
  `injectImgEntries` (the Modloader-bake path) is untouched.
- Tests: organisational-subfolder collection (nested two deep); PNG-subfolder merge into an entry with a
  missing-entry warning case.
