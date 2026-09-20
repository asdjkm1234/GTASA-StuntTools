# A raster the original ships uncompressed may not be block-compressed by us

**The rule:** when our toolchain rewrites a texture that already exists in the original game's data, it
keeps that raster's **compression class**. Uncompressed stays uncompressed. Adding a texture is free; taking
an existing one's place is not.

**Why it is structural:** an uncompressed raster in stock may be one the engine READS BACK rather than
samples, and nothing in the file says which. The recovered case is `platecharset`: `CCustomCarPlateMgr` locks
it and copies glyph pixels into the plate texture it composes per car, so DXT blocks are copied into the
plate as colour. The measurement — 867 uncompressed rasters, all single-level, and the two always-resident
generic dictionaries that are uncompressed end to end — is in
[`gta-sa-original/uncompressed-rasters.md`](../gta-sa-original/uncompressed-rasters.md).

**What breaks when it is violated:** the texture renders as blocky garbage in the real game — green 4×4
blocks on every number plate, in the case that found this. **Not a crash, not a log line, and invisible in
OpenSA**: our own decoder decompresses DXT properly before composing, so an engine-side test and a viewer
both show a perfectly readable plate. The only instrument that sees it is the field.

**Is a violation caught?** Partly.

- **Caught** on the path that had the defect: `mod-installer`'s PNG texture-folder merge follows the replaced
  raster ([plan 015](../../tools/mod-installer/docs/plans/015-replacement-png-follows-its-raster.md)),
  covered by tests in `txd-folder.test.ts`.
- **SILENT everywhere else.** Any future tool that re-encodes an existing dictionary — a resizer, a repacker,
  an optimizer pass — can re-take this decision without anything failing. `map-optimizer` gets it right today
  (`encodeRgba8888Struct` keeps the format when it adds mips) and `scripts/debug/txd-retune.ts` keeps the
  author's format, but neither is guarded by a rule; they simply happen to preserve it.

**The cost of obeying it** is memory: +15.2 MB across today's mod set, all of it in two dictionaries the game
never streams out. The narrow alternative and its price are in
[`performance/deferred-optimizations/compress-sampled-png-replacements.md`](../performance/deferred-optimizations/compress-sampled-png-replacements.md).

Neighbour: [`dxt-raster-dimensions.md`](dxt-raster-dimensions.md) — the other rule about a DXT raster the
real game refuses. Going uncompressed lifts that constraint for the texture it applies to, since only DXT
needs its sides to be multiples of 4.
