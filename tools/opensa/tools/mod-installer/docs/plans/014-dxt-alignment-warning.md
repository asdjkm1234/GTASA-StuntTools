# 014 — Name the mod that ships a DXT raster the real game refuses

**Status: ✅ Implemented 2026-08-17** (his ask at session 18's close). No byte changes — the installer stays
byte-faithful; this is a WARNING at install time.

## Why

`docs/restrictions/dxt-raster-dimensions.md`: a DXT texture whose side is not a multiple of 4 never loads in
the real game and takes its whole dictionary down — every model on it is never drawn, silently. Session 18's
field round found five clone dictionaries and one mod's own 932×358 sign (`57. …`) that way. map-optimizer
now resamples any such raster (pow2 up) later in the pipeline, so the BUILD is fine — but the mod that brings
one was only ever discovered by a census on the built tree, long after the install line scrolled by.

## What ships

`src/txd-alignment.ts`: `unalignedDxtTextures(bytes)` (`parseTxd`, every `dxt*` texture with `width % 4 ||
height % 4`, the exact test `scripts/debug/txd-dimension-census.ts` runs) and `warnUnalignedDxt(entry, bytes,
origin)`. Called on every path a `.txd` takes into the tree, each with the mod folder's name as `origin`:

- `mergeImgDir` — a `gta3_img/` / `gta_int_img/` entry, and the result of a PNG **texture folder** merge
  (OUR encoder, the mod's PNG: a 250×250 PNG becomes a 250×250 DXT — the same dead dictionary, labelled
  `<mod> (texture folder <name>)`);
- `injectImgEntries` — the Modloader baker's scattered `.txd`s (`bakeMod` passes the mod name);
- `applyEntry` — a loose `.txd` overlay (`models/generic/vehicle.txd` …), which reaches the game as-is.

Line: `mod-installer: <mod> ships <txd>: <texture> WxH <fmt> — not a multiple of 4, the real game refuses the
whole dictionary (map-optimizer will resample it)`. One line per raster; a dictionary the parser cannot read
is not judged (that is not this check's job to refuse). Tests: `txd-alignment.test.ts` (5 — the 932×358 sign,
8×5, an NPOT-but-aligned 12×4 and 700×52 that must NOT fire, unparsable bytes, non-`.txd` names).

## Not done, on purpose

Resampling in the installer. It would make the installer's output differ from the mod's bytes for one class
of texture, and the honest home for a byte change is the optimizer that already does it for the whole tree.
If the PNG texture-folder path is ever wanted to be right on its own (a real-SA build without map-optimizer),
that is the place to add pow2 resampling — one function, `png-texture.ts`.
