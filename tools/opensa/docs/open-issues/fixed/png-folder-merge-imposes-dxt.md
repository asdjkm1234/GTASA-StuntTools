# A mod that ships a folder of PNGs gets DXT and a mip chain, whatever it is replacing

**FIXED 2026-08-20** by [`mod-installer/015`](../../../tools/mod-installer/docs/plans/015-replacement-png-follows-its-raster.md)
— a PNG that REPLACES a texture is now encoded in the compression class of the raster it replaces, so the six
plate rasters come out 32-bit again and the mod's pixels reach the game byte for byte (worst channel
difference 0, where DXT1 was quantising them). The mip chain STAYS, which is where the fix departs from the
rule proposed below: stock ships every uncompressed raster single-level, but these mods upscale them 4–16×
and a 512² texture with no mips shimmers — so the header declares the chain and the trilinear filter that
lets it be sampled. Cost, measured over the whole mod set: **18 replaced rasters, 2 673 → 18 264 KB**.
**Field-confirmed the same day** on the delivered `sa` build — the plates read correctly in the game. Which
is the only instrument that could say so: OpenSA decodes DXT properly, so neither the suite nor a viewer ever
showed this defect at all.

**Found open, 2026-08-20**, field-found by the user: **the number plates render as green blocky garbage**
(screenshot, `9. Car Plates HD [vehicle]` installed). The plate's character area is the worst of it — that is
where the game writes glyphs pixel by pixel.

## What the mod ships, and what we make of it

`mods-src/original/mods/common/9. Car Plates HD [vehicle]/models/generic/vehicle/` — **six PNGs and no
`.txd`**. `mergeTxdFolder`/`mergeTxdBytes` merges them into the stock `models/generic/vehicle.txd` by name,
through `pngToTextureNative`, which has one policy for every image: **DXT5 when the PNG has real alpha, DXT1
otherwise, plus a full mip chain**.

Measured on the two dictionaries — stock, then the built `sa` tree:

| texture | stock `vehicle.txd` | our build |
| --- | --- | --- |
| `platecharset` | 32×256 **rgba8888, 1 level** | 32×256 **dxt1, 9 levels** |
| `plateback1`/`2`/`3` | 64×32 rgba8888, 1 level | 512×256 **dxt1**, 10 levels |
| `carplate`, `carpback` | 16×16 rgba8888, 1 level | 16×16 **dxt1**, 5 levels |

## Why DXT breaks these six and not the rest of a mod's textures

A number plate is **composed at runtime**: `CCustomCarPlateMgr` locks the charset raster and copies glyph
pixels into a per-car plate texture. That path reads the surface as pixels — hand it DXT blocks and it copies
compressed data as though it were colour, which is exactly what a field screenshot of green 4×4 blocks looks
like. R\* shipping all six as uncompressed single-level rasters is the same statement from the other side:
**these are CPU-read textures, not sampled ones**, which is also why none of them has a mip chain.

Nothing else in this mod set is read that way, which is why one mod broke and the rest did not.

## The rule the fix should take (not a name list)

**A PNG that REPLACES an existing texture should follow what it replaces** — raster format and mip policy
both. `mergeTxdBytes` already finds the existing `TextureNative` by name (it has to, to replace it), so the
information is in hand at exactly the right moment; only `pngToTextureNative` never asks for it. A PNG that
adds a NEW texture keeps today's policy, because there is nothing to follow.

That derives the answer from the data the game itself ships, and it generalises past plates: any texture the
original keeps uncompressed is one something reads on the CPU, and we cannot know which from a name.

**Open question for the fix**: the mod's `plateback*` are 512×256 against stock's 64×32. Following the format
does not mean following the SIZE — the point of an HD plate mod is the size — but an uncompressed 512×256
rgba8888 is 512 KB against 8 KB, ×3, and the plate compositor may or may not care about the dimensions. Worth
one measurement before choosing.

## Not to be confused with

[`mod-inst-rows-folded-before-their-ide.md`](./mod-inst-rows-folded-before-their-ide.md) — the other open
`mod-installer` defect, about `gta.dat` ORDER. Different subject, same tool.
