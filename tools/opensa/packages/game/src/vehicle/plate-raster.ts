/**
 * License plates — the pure half (plan 082/01): mask → text, text → the 64×16 raster a plate's
 * `carplate` quad wears. No renderware and no engine import; the decoded rasters arrive from
 * `adapters/plate-sources.ts`.
 *
 * Every constant here was measured off the real rasters and independently confirmed against the
 * reversed `CCustomCarPlateMgr` (see the plan's phase 0). Two facts drive the whole design:
 *
 * 1. A plate is TWO quads. `carpback` wears one of three static city backgrounds; `carplate` wears
 *    the generated text. This module makes only the second one.
 * 2. The text raster is OPAQUE. `RenderLicenseplateTextToRaster` memcpys all four channels of an
 *    8×16 charset cell into a destination created `rwRASTERFORMAT888` — no clear, no colour key, no
 *    blending. The charset's own light ground IS the plate's blank field, which is how one charset
 *    serves all three backgrounds.
 */

/** The decoded `platecharset` atlas plus the cell grid derived from its size. */
export interface PlateCharset {
  readonly cellHeight: number;
  readonly cellWidth: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  readonly width: number;
}

/** Which city's background a plate wears. Ordered by the game's `eCarPlateType`, not alphabetically. */
export type PlateCity = 'LA' | 'SF' | 'VEGAS';

/** A decoded RGBA8 image — a plate background, or the composed text raster. */
export interface PlateRaster {
  readonly height: number;
  readonly rgba: Uint8Array;
  readonly width: number;
}

/** Everything `models/generic/vehicle.txd` contributes to plates. */
export interface PlateSources {
  /** Indexed by `eCarPlateType`: 0 = SF, 1 = LV, 2 = LS — the order of `plateback1..3`. */
  readonly backgrounds: readonly PlateRaster[];
  readonly charset: PlateCharset;
}

/** The game's own plate shape: two letters, two digits, then repeating ` DLL` groups. */
export const DEFAULT_PLATE_MASK = 'LLDD DLL';

/** What `CreatePlateTexture` allocates: `RwRasterCreate(64, 16, 32)`. */
export const PLATE_TEXT_HEIGHT = 16;

/** `MAX_TEXT_LENGTH` — a plate is always this many cells wide, short text included. */
export const PLATE_TEXT_LENGTH = 8;

export const PLATE_TEXT_WIDTH = 64;

const DIGITS = '0123456789';
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
/** Row-major over 4 columns: A–Z fills rows 0–5 and spills into row 6, then 0–9. */
const GLYPH_ORDER = LETTERS + DIGITS;
const GLYPH_COLUMNS = 4;
/** Index 36 → (column 0, row 9), the first all-ground row — the game's fallback for unmapped chars. */
const BLANK_GLYPH_INDEX = GLYPH_ORDER.length;

/** The charset the constants were read from: 32×256, cells of 8×16. A modded atlas scales off this. */
const CHARSET_REFERENCE_WIDTH = 32;
const CHARSET_CHAR_HEIGHT = 16;
const CHARSET_CHAR_WIDTH = 8;

/** `eCarPlateType`: SF = 0, LV = 1, LA = 2. Measured: plateback1 is SAN FIERRO, 3 is LOS SANTOS. */
const CITY_BACKGROUND: Record<PlateCity, number> = { LA: 2, SF: 0, VEGAS: 1 };

/**
 * Wrap a decoded charset raster with its cell grid. The grid is derived from the atlas SIZE rather
 * than hardcoded 8×16: a mod may ship the charset at any resolution, and the 4-column,
 * A–Z-then-0–9 layout is the part that is fixed. At the stock 32 px width this reduces exactly to
 * the game's `CHARSET_CHAR_WIDTH` / `CHARSET_CHAR_HEIGHT`.
 */
export function charsetFromRaster(raster: PlateRaster): PlateCharset {
  const scale = raster.width / CHARSET_REFERENCE_WIDTH;

  return {
    cellHeight: Math.max(1, Math.round(CHARSET_CHAR_HEIGHT * scale)),
    cellWidth: Math.max(1, Math.round(CHARSET_CHAR_WIDTH * scale)),
    height: raster.height,
    rgba: raster.rgba,
    width: raster.width,
  };
}

/**
 * Render `text` into the opaque 64×16 raster the `carplate` quad samples over its full 0..1 UV.
 * Always writes all {@link PLATE_TEXT_LENGTH} cells — short text is padded with the blank glyph
 * rather than left uninitialised, which is what the game's missing clear would otherwise expose.
 */
export function composePlateText(text: string, charset: PlateCharset): Uint8Array {
  const rgba = new Uint8Array(PLATE_TEXT_WIDTH * PLATE_TEXT_HEIGHT * 4);
  for (let cell = 0; cell < PLATE_TEXT_LENGTH; cell += 1) {
    blitGlyph(rgba, charset, glyphIndexOf(text[cell] ?? ' '), cell * CHARSET_CHAR_WIDTH);
  }

  return rgba;
}

/**
 * Expand a mask into plate text. `L` → a letter, `D` → a digit, `*` → either; every other character
 * passes through (the space in the default mask is one). An empty mask falls back to
 * {@link DEFAULT_PLATE_MASK}; a longer one is cut to the eight cells a plate has.
 */
export function generatePlateText(mask: string, seed: number): string {
  const random = mulberry32(seed);
  const source = (mask.length > 0 ? mask : DEFAULT_PLATE_MASK).slice(0, PLATE_TEXT_LENGTH);
  let text = '';
  for (const token of source) {
    text += expandToken(token, random);
  }

  return text;
}

/** Which `plateback` a city wears, as an index into {@link PlateSources.backgrounds}. */
export function plateBackgroundIndex(city: PlateCity): number {
  return CITY_BACKGROUND[city];
}

/** Copy one glyph cell into the destination column, scaling if a modded charset has bigger cells. */
function blitGlyph(rgba: Uint8Array, charset: PlateCharset, glyph: number, destX: number): void {
  const { cellHeight, cellWidth, height, width } = charset;
  const srcX = (glyph % GLYPH_COLUMNS) * cellWidth;
  const srcY = Math.floor(glyph / GLYPH_COLUMNS) * cellHeight;
  const ground = groundColour(charset);
  for (let y = 0; y < PLATE_TEXT_HEIGHT; y += 1) {
    for (let x = 0; x < CHARSET_CHAR_WIDTH; x += 1) {
      const sx = srcX + Math.floor((x * cellWidth) / CHARSET_CHAR_WIDTH);
      const sy = srcY + Math.floor((y * cellHeight) / PLATE_TEXT_HEIGHT);
      const dst = (y * PLATE_TEXT_WIDTH + destX + x) * 4;
      // A charset too small to hold the blank row reads as plain plate field rather than garbage.
      if (sx >= width || sy >= height) {
        rgba[dst] = ground[0];
        rgba[dst + 1] = ground[1];
        rgba[dst + 2] = ground[2];
        rgba[dst + 3] = 255;
        continue;
      }
      const src = (sy * width + sx) * 4;
      rgba[dst] = charset.rgba[src];
      rgba[dst + 1] = charset.rgba[src + 1];
      rgba[dst + 2] = charset.rgba[src + 2];
      rgba[dst + 3] = 255; // the destination is a 888 raster — a plate face is never see-through
    }
  }
}

function expandToken(token: string, random: () => number): string {
  switch (token) {
    case '*':
      return GLYPH_ORDER[Math.floor(random() * GLYPH_ORDER.length)];
    case 'D':
      return DIGITS[Math.floor(random() * DIGITS.length)];
    case 'L':
      return LETTERS[Math.floor(random() * LETTERS.length)];
    default:
      return token;
  }
}

/** Where a character sits in the atlas: A–Z then 0–9, anything else the blank cell. */
function glyphIndexOf(character: string): number {
  const index = GLYPH_ORDER.indexOf(character.toUpperCase());

  return index >= 0 ? index : BLANK_GLYPH_INDEX;
}

/** The charset's ground colour, read from its top-left pixel — the plate's blank field. */
function groundColour(charset: PlateCharset): readonly [number, number, number] {
  return [charset.rgba[0], charset.rgba[1], charset.rgba[2]];
}

/** A small deterministic PRNG (mulberry32) → a function yielding floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
