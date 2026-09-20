# 082/01 — Plate raster generation (pure) + sources from the VFS

The pure half, carried over from the idea nearly intact — only the output type changed (raw RGBA
bytes for a texture-array slot upload, not a three `DataTexture`).

**Amended 2026-07-28 by the readme's phase 0.** `composePlate` no longer composes a background: the
plate's background is a SEPARATE quad (`carpback`) wearing one of three static rasters, so this
module renders **text only**, onto a transparent 64×16 raster — the size the game itself uses. Every
constant below is measured or taken from the reversed source, and cross-checked against the other.

## Design

Two modules, split by the layer boundary the linter enforces (`packages/game/**` may reach renderware
only from `adapters/`):

```ts
// packages/game/src/vehicle/plate-raster.ts — pure, no renderware and no engine import.
// The city tokens are the GAME's own (`zones/city.ts` City, and the reversed eCarPlateType names LA
// too); a second vocabulary would only invite a mismatch at the one place they meet.
export type PlateCity = 'LA' | 'SF' | 'VEGAS';

/** Deterministically expand a mask (`L`/`D`/`*` + literals) into plate text. */
export function generatePlateText(mask: string, seed: number): string;

/** charset glyphs → one OPAQUE RGBA8 text raster (64×16) for the plate atlas slot. */
export function composePlateText(text: string, charset: PlateCharset): Uint8Array;

/** Wrap a decoded charset raster with the cell grid derived from its size. */
export function charsetFromRaster(raster: PlateRaster): PlateCharset;

/** Which `plateback` a city wears — an index into `PlateSources.backgrounds`. */
export function plateBackgroundIndex(city: PlateCity): number;

// packages/game/src/adapters/plate-sources.ts — the half that may parse a TXD.
export function extractPlateSources(txd: RWTextureDictionary): null | PlateSources;
```

- **Mask DSL** (from the idea, unchanged): `L` → A–Z, `D` → 0–9, `*` → either, anything else
  passes through. Empty mask → default **`LLDD DLL`** — the game's own `GeneratePlateText` shape
  (two letters, two digits, then repeating ` DLL` groups up to `MAX_TEXT_LENGTH = 8`), not the
  idea's guessed `LLLD DDL`.
- **Seeded PRNG** (mulberry32-style), seed injected — determinism is the caller's contract.
- **Charset grid** — measured off the raster's ink profile AND confirmed against the reversed
  source, which agrees on every value:

  | Constant                   | Value | How it was established                                            |
  | -------------------------- | ----- | ----------------------------------------------------------------- |
  | atlas size                 | 32×256 | measured (stock `rgba8888`, modded `dxt1` — same size)            |
  | cell                       | 8×16  | ink profile: 4 columns over 32 px, 9 rows over the top 144 px      |
  | columns                    | 4     | `CHARSET_COL_WIDTH 32` / `CHARSET_CHAR_WIDTH 8`                    |
  | glyph order                | `A..Z` then `0..9`, row-major | read off the raster; `'0'` = (col 2, row 6) both ways |
  | blank / unmapped glyph     | (col 0, row 9) | the first all-background row — the reversed default        |

  Rows 9..15 of the atlas are empty on purpose: row 9 IS the space glyph, which is why the texture
  is 256 tall for 144 px of ink. Derive the row count from the raster height, never hardcode 9 —
  a modded charset may pack more.
- **Sources**: `platecharset` (+ `plateback1..3`, which this module only PASSES THROUGH to plan 03
  — it does not draw them), decoded to RGBA once at boot via the existing TXD parse path.
  Measured sizes differ stock vs installed mod — `plateback` is 64×32 stock and **512×256 in the
  built pak**. Sizes therefore derive from the decoded raster (asset-driven-sizes rule), never from
  a constant; only the TEXT raster is fixed-size, because it is generated, not read.
- **Output**: RGBA8 **64×16** — 8 characters × the 8 px cell, the size `CreatePlateTexture` itself
  allocates. **OPAQUE, not alpha-keyed**: `RenderLicenseplateTextToRaster` `memcpy`s all four
  channels of each 8×16 cell into a destination created `rwRASTERFORMAT888`, with no clear, no
  colour key and no blending. The charset's own light ground colour IS the plate's blank field
  (stock `rgb(173, 181, 181)`, the installed mod's `rgb(255, 255, 247)` — each matches its own
  plate design), which is why one charset can serve all three backgrounds. The `carplate` quad
  therefore needs no alpha blending at all.
- Text shorter than 8 characters is padded with the **blank glyph at (0, 9)**, not left
  uninitialised — the game omits the clear and copies only as many cells as it has characters, so
  a short plate reads whatever was in the freshly created raster. Padding is the same pixels the
  game produces for a full-length plate and costs nothing.
- A charset whose cell is not 8 px wide scales the copy to fit the 8-char raster rather than
  throwing.
- **No cache here** — plan 03's atlas slot allocator IS the cache (`text` → slot; the city no
  longer participates, it is a separate static background index).

## Subtasks

- [x] Derive `platecharset` grid constants (phase 0 — the table above).
- [x] `generatePlateText` + tests (determinism, each token class, empty→default `LLDD DLL`).
- [x] `extractPlateSources` + graceful `null` when textures are missing (modded TXD) — plates
      then stay stock, never crash. Real fixture TXD was already shipped
      (`fixtures/original/models/generic/vehicle.txd`, manifest line existed).
- [x] `composePlateText` + tests on a synthetic charset (glyph placement, opacity, non-8px cell scale).
- [x] Measure: compose time per plate, bytes per slot (ledger).

## Acceptance

Pure suite green; compose ≤ 0.5 ms per plate (it runs at spawn, off the hot loop); the real fixture
TXD decodes and the derived grid renders every A–Z/0–9 glyph correctly on a test raster.

## Ledger

- Charset grid: **cell 8×16, 4 columns, 9 used rows of 16, order A–Z then 0–9, blank at (0, 9)** —
  measured from the ink profile, independently confirmed by the reversed source's
  `CHARSET_CHAR_WIDTH 8` / `CHARSET_CHAR_HEIGHT 16` / `CHARSET_COL_WIDTH 32` / `CHARSET_ROW_HEIGHT 16`.
- Text raster: **64×16 RGBA8 = 4 096 B per plate**, matching `CreatePlateTexture`'s
  `RwRasterCreate(64, 16, 32)`.
- Source raster sizes: `platecharset` 32×256 (stock `rgba8888`, built `dxt1`); `plateback1..3`
  64×32 stock → **512×256 in the built pak** (mod-replaced, 8× linear).
- **`composePlateText`: 0.0043 ms per plate** (stock charset) / **0.0044 ms** (the built pak's modded
  DXT1 charset), 10 000 runs each — 116× under the 0.5 ms acceptance budget. `generatePlateText`
  measures 0.0002–0.0005 ms. Both run once at spawn, so this channel is a non-issue; the cost that
  will matter is plan 03's upload, not this compose.
- Rendered proof (`plate-render.ts`, both the stock and the built dictionary): all 36 glyphs legible
  in the derived grid, the space and unmapped characters landing on the blank cell.
- **The stock plate font draws `O` and `0` with identical pixels.** Pinned as the ONLY permitted
  bitmap collision in the fixture test — a second collision would mean cells are being sampled off
  the wrong rows.

### Where the code landed

The layer boundary moved one function. `packages/game/**` may reach `@opensa/renderware` only from
`adapters/` (eslint `no-restricted-imports`), so the TXD decode is **`adapters/plate-sources.ts`**
(`extractPlateSources`) and the pure module **`vehicle/plate-raster.ts`** keeps only plain rasters —
which is what this plan's own "consumes parsed TXD rasters via the adapter" asked for. Tests split
the same way; the real-fixture test is `adapters/plate-sources.fixture.test.ts`.

Suite: **31 tests across the three files, green**; `tsc --noEmit` and `eslint` clean.
