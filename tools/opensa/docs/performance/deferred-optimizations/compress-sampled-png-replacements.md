# Compress the PNG replacements the game never reads back (+15.2 MB on the table)

**Status:** in reserve — the alternative NOT taken by
[mod-installer plan 015](../../../tools/mod-installer/docs/plans/015-replacement-png-follows-its-raster.md)
(2026-08-20).

**Impact: NONE on frame time, LOW-to-MEDIUM on memory — 15.2 MB, resident, on the `sa` target only.** Nothing
here is per-frame work; it is 15.2 MB held for the whole session in two dictionaries the game never streams
out. Do not reach for this when a frame is slow. Reach for it if the real-SA process is running out of
address space.

**Effort: low to write, high to keep honest.** The code change is one condition. What it costs is a list of
the original's CPU-read rasters that somebody has to keep correct, and a wrong entry is silent.

## What we do today

A PNG in a mod's texture folder that REPLACES an existing texture is encoded in the compression class of the
raster it replaces: uncompressed stays uncompressed. That is what fixed the green number plates —
`CCustomCarPlateMgr` locks `platecharset` and copies its pixels, so DXT blocks reach the plate as colour
([`restrictions/uncompressed-rasters-stay-uncompressed.md`](../../restrictions/uncompressed-rasters-stay-uncompressed.md)).

Because the rule follows the DATA rather than a list of names, it also catches 17 rasters nobody has shown to
be read back: envmaps, `vehiclescratch64`, `vehicleshatter128`, the coronas, `vehicletyres128`, the plate
backgrounds. Measured on `mods-src/original`: those 18 replacements are **2 673 KB compressed and 18 264 KB
as they now ship**.

## The lever

Compress everything except the rasters the original engine reads back on the CPU — a documented, name-keyed
set that today has exactly one member (`platecharset`). Everything else returns to DXT1/DXT5 with mips.

## What it would win

**+15.2 MB of resident memory back**, minus ~27 KB for the charset. Concentrated in
`models/generic/vehicle.txd` and `models/particle.txd`, both permanent. On disk the built tree shrinks by the
same amount.

## What it would cost

- **A name list against an unknown set.** We can name the rasters somebody has recovered, not the ones the
  engine locks that nobody has looked at. A texture missing from the list fails the way the plates did: green
  blocks in the field, nothing in a log, and every engine-side test still green because OpenSA decodes DXT
  properly.
- **Quality on 17 textures.** The mod authors ship PNGs; today their pixels arrive byte for byte (measured
  worst channel difference 0). Re-compressing them puts DXT block artefacts back on exactly the surfaces R\*
  chose to keep uncompressed — coronas, envmaps, scratches, shatter — where gradients show it.
- **A rule that stops being derivable.** The current one is a statement about the data ("follow what the
  original ships"); this one is a statement about a specific engine's specific code paths, which is a debt
  somebody re-pays every time a new class of texture is modded.

## What would have to be true to pull it

The real-SA process running short of address space with these dictionaries measurably part of it — or a
recovered, reasonably complete map of which rasters SA locks, at which point the list stops being a guess.
