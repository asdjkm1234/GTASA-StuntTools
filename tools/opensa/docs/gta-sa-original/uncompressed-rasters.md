# What the original ships UNCOMPRESSED, and why it matters

**Measured 2026-08-20** over `game-src/original`'s `models/gta3.img` + `gta_int.img` (every `.txd` entry,
`scripts/debug/.tmp` census reproduced by `scripts/debug/png-folder-census.ts`'s per-texture readout).

## The census

| rasters | levels | filter | count |
| --- | --- | --- | --- |
| DXT | 1 | `0x1106` (trilinear) | 19 134 |
| DXT | >1 | `0x1106` | 5 932 |
| DXT | 1 | `0x1102` | 3 334 |
| DXT | >1 | `0x1102` | 1 074 |
| DXT | 1 | `0x1101` | 783 |
| **uncompressed 32-bit** | **1** | **`0x1101`** | **867** |
| DXT | mixed | `0x1206` / `0x2106` | 9 |

**Every uncompressed raster in the game is single-level**, and every one carries the plain linear filter.
There is no stock example of an uncompressed texture with a mip chain — which is why our own encoder had to
decide that question for itself rather than copy one
([mod-installer plan 015](../../tools/mod-installer/docs/plans/015-replacement-png-follows-its-raster.md)).

## The two dictionaries that are uncompressed end to end

`models/generic/vehicle.txd` (19 textures) and `models/particle.txd` are 32-bit throughout: envmaps,
`vehiclescratch64`, `vehicleshatter128`, `vehiclegrunge256`, the coronas, and the six plate rasters. These
are the always-resident generic dictionaries — few textures, heavily blended or read back, and never
streamed out. **They are also exactly the dictionaries mods patch through PNG texture folders**, which is how
a single encoding policy in our installer reached them all.

The 32-bit rasters come in two shapes, and stock pairs them consistently: **opaque → `d3dFormat` 22
(`X8R8G8B8`) with rasterFormat `C888` (`0x0600`)**, **alpha → 21 (`A8R8G8B8`) with `C8888` (`0x0500`)**.

## The one we know the game READS BACK

`platecharset` (32×256, cells of 8×16). `CCustomCarPlateMgr` locks its raster and `memcpy`s glyph pixels into
the 64×16 plate texture it creates per car — all four channels, no clear, no colour key
(`packages/game/src/vehicle/plate-raster.ts`, recovered in
[plan 082/01](../plans/082-vehicle-plates/01-plate-raster.md)). A compressed charset reaches the plate as
BLOCKS interpreted as colour: green 4×4 garbage on every car, which is how the defect was found in the field.

`plateback1..3` and the `carplate` / `carpback` placeholders are ordinary material textures — the plate is
two quads, and only the text strip is composed. They are uncompressed in stock for the same reason the rest
of that dictionary is, not because anything locks them.

**What we do NOT know is the full list.** `platecharset` is the CPU-read raster somebody has recovered; there
is no way to tell from a texture's name whether the engine samples it or reads it. That is why the installer
rule is "follow what the original ships" rather than "special-case the plates" — see
[`docs/restrictions/uncompressed-rasters-stay-uncompressed.md`](../restrictions/uncompressed-rasters-stay-uncompressed.md).
