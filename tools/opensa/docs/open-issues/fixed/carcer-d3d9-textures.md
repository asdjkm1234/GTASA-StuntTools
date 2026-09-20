# Carcer City D3D9 texture formats — rainbow & invisible models

**Status: ✅ FIXED 2026-07-24.** Carcer City (a 2026 total conversion) ships TXDs from a **D3D9-platform**
exporter that uses two texture formats stock San Andreas never does. Our TXD decoder mis-read both, so
whole models rendered as rainbow noise or as invisible black. Root-caused to the shared decoder
(`packages/renderware/src/parsers/binary/txd.ts`) — one fix per format — and covered by synthetic tests
plus **committed real-asset fixtures** carved from the mod.

## Symptom

Field report on the freshly rebuilt Carcer map (all at noon, prelight fine):

- **`ccmail` / `lacw_telewire05`** — building facades and the telephone-wire spans rendered as bands of
  **rainbow static** (and broken alpha: the wire quads smeared colour across the whole scene).
- **`apolicest` (police station) / `sewertop` (sewer pit)** — whole models rendered **solid black /
  invisible**, as if the walls weren't there.

Prod (three.js) had *more* texture bugs here, so this was a net improvement already — but these four were
still broken.

## Root cause (verified)

Both textures classify through `classifyFormat` → the mip reader. The mod's exporter writes **platformId 9
(D3D9)** rasters, which stock SA (D3D8) does not.

### 1. DXT4 → rainbow

`ccmail` / wires textures carry `d3dFormat = 0x34545844` = the FourCC **"DXT4"** — the premultiplied-alpha
variant of DXT5 (identical 16-byte block layout). `classifyFormat` only knew DXT1/DXT3/DXT5, so DXT4 fell
through to the raster-format branch and was mis-classified as an **uncompressed 16-bit** raster. The mip
reader then ran `expand16` over the DXT-compressed blocks — reading compressed block bytes as 16-bit pixels
→ garbage, i.e. the rainbow. (The declared mip size gave it away: 65 536 B for a 256×256 texture is exactly
the DXT5 size, half of the 131 072 B a 16-bit raster would need — so it also only filled the top half.)

### 2. X8R8G8B8 → invisible

`apolicest` / `sewer` textures are genuine **uncompressed 32-bit `D3DFMT_X8R8G8B8`** (`d3dFormat = 22`,
rasterFormat C888, `hasAlpha=false`). In X8R8G8B8 the fourth byte is **`X` — unused padding**, not alpha,
and the mod stores it as `0`. `swizzleBgraToRgba` copied that byte straight into the output **alpha**, so
every texel came out `alpha = 0` → fully transparent → the model rendered black/invisible. (`classifyAlpha`
correctly returned `opaque` from the `hasAlpha=false` flag, but the transparent RGBA had already been baked
by the decoder, upstream of the pack.)

## Fix

`packages/renderware/src/parsers/binary/{constants,txd}.ts`:

1. **DXT2/DXT4 recognised** — added the FourCCs to `D3dCompression` and mapped `DXT2 → dxt3`, `DXT4 → dxt5`
   in `classifyFormat` (premultiplied variants decode identically to their base format).
2. **X8R8G8B8 forced opaque** — `swizzleBgraToRgba` now takes the texture's `hasAlpha` flag and writes
   `alpha = 255` when it is false (the `X` byte is padding). Real A8R8G8B8 alpha textures (`hasAlpha=true`)
   keep their alpha unchanged.

Both are general: any mod (any TC) shipping DXT2/DXT4 or X8R8G8B8 now decodes correctly. The fix is at
**decode time**, so a Carcer **pak rebuild** is required for the already-baked (broken) pak to pick it up.

## Verification

- Software render of the source textures to PNG (`dump-texture.ts`): `dt_ammu_wall1` went from rainbow to a
  concrete wall; `Est_ManLwrWall` from a fully-transparent (white) sheet to a stone wall.
- Tests in `packages/renderware/src/parsers/binary/txd.test.ts`:
  - synthetic: DXT2/DXT4 classify as dxt3/dxt5; X8R8G8B8 decodes opaque (alpha 255).
  - **real-asset fixtures** (committed under `fixtures/custom/txd/`): `carcer-wires-dxt4.txd` (the mod's whole
    5-texture DXT4 wires TXD) and `carcer-x8r8g8b8.txd` (one real 32×32 X8R8G8B8 texture wrapped in a fresh
    TexDictionary — the source TXDs are 16–39 MB uncompressed, too large to commit whole).
- 645 renderware + opensa-pack tests green; no regression.

See also [`docs/edge-cases/sa-formats.md`](../../edge-cases/sa-formats.md) (TXD reading is broad: DXT1/2/3/4/5
+ uncompressed 32/16-bit) and [locked-dff.md](locked-dff.md) (the other TXD-decode saga — anti-rip locks).
