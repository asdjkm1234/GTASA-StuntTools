# 015 — A PNG that REPLACES a texture is encoded like the raster it replaces

**Status: ✅ Implemented 2026-08-20** (the fix for `docs/open-issues/fixed/png-folder-merge-imposes-dxt.md`).
Field-found the same day: number plates rendered as green blocky garbage with `9. Car Plates HD [vehicle]`
installed.

## Why

`pngToTextureNative` had ONE policy for every image a texture folder ships — DXT5 with real alpha, DXT1
without, plus a full mip chain. That is right for a PNG that ADDS a texture, and wrong for one that takes an
existing texture's place, because the format a dictionary already carries can be load-bearing:

**A number plate is composed at RUNTIME.** `CCustomCarPlateMgr` locks `platecharset`'s raster and copies
glyph PIXELS into a per-car 64×16 plate texture (`packages/game/src/vehicle/plate-raster.ts`, recovered in
[plan 082/01](../../../../docs/plans/082-vehicle-plates/01-plate-raster.md)). Hand that path DXT blocks and
it copies compressed data as though it were colour — which is exactly what the screenshot showed. R\*
shipping all six plate rasters uncompressed and mip-less is the same statement from the other side.

The general form: **the original's own encoding is evidence about the texture, and we were overwriting it.**
Measured across `game-src/original`'s archives — 30 000+ rasters — stock ships **867 uncompressed textures,
every one of them single-level with filter `0x1101`**, and both dictionaries our mods patch by PNG folder
(`models/generic/vehicle.txd`, `models/particle.txd`) are uncompressed end to end.

## What ships

- `@opensa/rw-codec/texture-native`: **`encodeUncompressedStruct(name, levels, hasAlpha)`** — the sibling of
  `encodeDxtStruct`, writing a 32-bit raster from scratch: opaque → `X8R8G8B8` / `C888`, alpha →
  `A8R8G8B8` / `C8888` (stock's own pairing), pixels stored BGRA. Plus **`isCompressedRaster(struct)`**,
  which reads `d3dFormat` — a `DXT…` FourCC when compressed — and answers `true` for a Struct too short to
  hold a header, because a header we cannot read is not evidence of an uncompressed raster.
- `tools/mod-installer/src/png-texture.ts`: `pngToTextureNative` takes the **replaced texture's Struct** and
  encodes uncompressed when that raster is. `txd-folder.ts` looks the existing texture up before encoding
  instead of after, and passes it. Every merge path inherits this: loose `.txd` overlays (plan 003) and
  archive entries (plan 009) both go through `mergeTxdBytes`.
- A PNG that adds a NEW texture, or replaces a DXT one, is encoded exactly as before.

**Mips are OURS, not stock's** (the user's call). Stock has no example of an uncompressed raster with a mip
chain, so there is nothing to copy; the mods that replace these rasters upscale them 4–16× and a 512² texture
with no mips shimmers at distance. So the chain stays, and the header follows it: more than one level
declares the mipmap bit and the trilinear filter `0x1106`, because a level nothing is allowed to sample is
only dead weight — and keeping stock's `0x1101` would have made these textures point-sampled, a downgrade
against the DXT path we are replacing.

## Measured

The whole mod set, `mods-src/original` (`scripts/debug/png-folder-census.ts`): **80 PNGs in 33 folders — 56
ADD a texture, 24 replace one, and 18 of those 24 replace an uncompressed raster.** Every one of the 18 is in
`models/generic/vehicle.txd` or `models/particle.txd`; the map dictionaries a texture folder patches are
DXT in stock and are untouched by this change.

| | today (DXT + mips) | as it now ships (32-bit + mips) |
| --- | --- | --- |
| the 18 replaced rasters | 2 673 KB | **18 264 KB** (+15.2 MB) |
| `9. Car Plates HD` alone, merged into the stock `vehicle.txd` | 1 328 KB → 2 006 KB | 1 328 KB → **3 364 KB** |

Biggest single items: `coronamoon` 683 → 5 461 KB, `vehicletyres128` 341 → 2 731 KB, `plateback1..3` 85 →
683 KB each. The mod's pixels now reach the game **byte for byte** — worst channel difference against the
source PNG is **0** on `platecharset`, `plateback1` and `carplate`, where DXT1 was quantising them.

`scripts/debug/plate-render.ts` over the two dictionaries shows it: the built tree's DXT charset composes
plates with a mottled ground and block artefacts around every glyph; the same mod through this change
composes a clean one. **That is our decoder, not the game's** — which is why the verdict that counts is the
field one: **confirmed 2026-08-20** on the rebuilt tree delivered to the reference install, the plates
reading correctly in the game. The failure mode was the game reading blocks as colour without ever decoding
them, and nothing offline could reproduce it.

## What this deliberately costs, and the alternative

+15.2 MB, resident, in two dictionaries the game never streams out. The narrow alternative — compress
everything except the rasters the engine reads back on the CPU — costs ~27 KB and needs a name-keyed list of
the original's CPU-read rasters, which we can only write for the textures somebody has already recovered.
Recorded with its price in
[`docs/performance/deferred-optimizations/compress-sampled-png-replacements.md`](../../../../docs/performance/deferred-optimizations/compress-sampled-png-replacements.md).

## Side effects worth knowing

- **The plan 014 alignment warning no longer fires for these.** A PNG whose side is not a multiple of 4 was a
  DXT raster the real game refuses; replacing an uncompressed texture it is now an uncompressed raster, which
  has no such constraint. The warning is correct to stay quiet — `unalignedDxtTextures` only judges `dxt*`.
- **`scripts/debug/txd-from-pngs.ts` is unchanged**: it merges into an EMPTY seed, so every texture is an
  addition and there is nothing to follow.
