# TXD parser + textures

`packages/renderware/src/parsers/binary/txd.ts`, `packages/renderware/src/textures/dxt.ts` (CPU decode),
`packages/renderware/src/map/resolve-map.ts` (`resolveTxdChain` — txdp resolution).

## Implemented

- TXD texture-native parsing: name/mask, dimensions, mip levels, alpha flag.
- Pixel formats: **DXT1 / DXT3 / DXT5** (kept compressed — BC1/BC2/BC3), plus the premultiplied D3D9
  variants **DXT2 → dxt3 / DXT4 → dxt5** (same block layout — Carcer City, commit 6c5658b);
  **RGBA8888 / X8R8G8B8** (the X byte is padding, forced OPAQUE — else X8R8G8B8 models render invisible);
  **16-bit R5G6B5 / A1R5G5B5 / A4R4G4B4** (expanded to RGBA8888 at parse, plan 043); and **PAL8** palettized
  (expanded at parse). **PAL4** (4-bit) is **REJECTED** rather than decoded — `expandPalette` assumes
  8-bit/256-entry, and no shipped asset uses PAL4 (see docs/open-issues/pal4-textures.md).
- Consumers: the world path goes through the converter (`packages/cell-weld/src/textures.ts`), which
  keeps block-aligned power-of-two DXT untouched and buckets everything into `texture_2d_array`s by
  exact (format, W, H, mips), decoding the rest via `textures/dxt.ts`. Vehicles/peds build their
  arrays in the browser (`vehicle/textures.ts`, `ped/build-ped-model.ts`) off the same decoder.
  Names are matched lowercased; `hasAlpha` drives the alpha-test / blend class.
- **The passthrough is conditional on the build's TARGET** (`opensa-pack --textures astc|bc|rgba8`, plan
  200/2-02). `bc` is the default and is the passthrough described above. The other two refuse it — a mobile
  GPU has no BC at all — so every layer is decoded, runs the alpha pipeline and is written as RGBA8; `astc`
  then re-encodes the finished array to ASTC 4x4 (`tools/opensa-pack/src/astc-encode.ts`), one byte per texel
  against RGBA8's four. Which GPU families the result can be displayed on follows from that one choice and
  cannot be re-taken at runtime (`docs/restrictions/assets-and-data.md`).
- **txdp inheritance** (`parseTxdParents` + `resolveTxdChain`): a child TXD inherits textures it
  lacks from its parent chain (child wins), cycle-guarded, memoized per name. Required by the
  optimized/modded maps that hoist shared textures into regional `*_gene` parents.
- sRGB handling: world textures flow through the colour-managed pipeline; timecyc-driven
  uniforms decode 0–255 sRGB explicitly where needed (see world-lighting).

## Coverage (audit 2026-06-12, `scripts/debug/audit-rw-coverage.ts`)

22705 textures across the shipped TXDs parse successfully; **36 dropped (0.16%)** — the 16-bit
rasters below. Shipped format distribution: dxt1 20790, dxt5 1867, dxt3 44, rgba8888 4 (palettes
expand to rgba8888 at parse).

## Known gaps / candidates

- Luminance (LUM8) rasters unsupported (none confirmed in shipped data; the audit's residual
  drop count after the 16-bit fix tells the truth).
- Mipmaps beyond the base are uploaded for compressed textures but not validated individually.
- Per-texture/material `0x1F` = RW **Right To Render** (pipeline hint, ×56k) — identified via
  the gtamods section list; harmless skip, nothing to implement.

## Test coverage anchors

`parsers/binary/txd.test.ts` (formats, mips, alpha), texture resolution through archive tests; txdp
chain tests in `parsers/text/ide.parser.test.ts` (`parseTxdParents`) and `map/resolve-map.test.ts`.
