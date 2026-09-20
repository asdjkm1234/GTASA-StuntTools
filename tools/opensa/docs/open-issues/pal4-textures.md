# PAL4 (4-bit palettized) TXD textures — rejected, not decoded

**Status: 🟡 guarded, not decoded (2026-07-24).** No shipped asset uses PAL4, so the decoder now REJECTS it
cleanly instead of emitting a corrupt image. If a future mod/TC ships PAL4 textures, this is what to implement.

## Symptom (what would happen if decoded with the old path)

A 4-bit palettized raster (`RasterFormat.PAL4 = 0x4000`) packs **two indices per byte** against a **16-entry**
colour table. The decoder's `expandPalette` (`packages/renderware/src/parsers/binary/txd.ts`) assumes **one
8-bit index per byte** against a 256-entry table. Feeding it PAL4 data would:

- emit **half the declared pixels** (each byte is two 4-bit indices, not one), so a 64×64 image yields a
  2048-pixel buffer against a 4096-pixel width×height claim → mis-upload downstream;
- read indices 16–255 **past the 16-entry palette** → mostly black.

## What we did instead

`classifyFormat` returns `null` for `rasterFormat & PAL4`, so the texture is **skipped** like any other
unsupported format (a visible missing texture, never silent corruption). PAL8 is unaffected and still decodes.

## Evidence it is unused

Scanned every `.txd` in `original`, `carcer`, and `gostown` (proper RW chunk walk reading each
`TextureNative` struct's `rasterFormat`): **0 PAL4** textures across all three (carcer has 1 PAL8, which
decodes correctly). So rejecting PAL4 costs nothing today.

## To implement later (if an asset needs it)

In `readMipmaps`/`expandPalette`: read `⌈width/2⌉·height` bytes per level, unpack the low then high nibble of
each byte to two indices (mind row padding if any), and index the 16-entry (16×4-byte BGRA) table. Add a real
PAL4 fixture (or a synthetic one via `buildSyntheticTxd`) and a byte-exact test. Then remove the reject in
`classifyFormat` and this file.
