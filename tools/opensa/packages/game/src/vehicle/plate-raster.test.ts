import { describe, expect, it } from 'vitest';

import type { PlateCharset } from './plate-raster';

import {
  charsetFromRaster,
  composePlateText,
  DEFAULT_PLATE_MASK,
  generatePlateText,
  PLATE_TEXT_HEIGHT,
  PLATE_TEXT_LENGTH,
  PLATE_TEXT_WIDTH,
  plateBackgroundIndex,
} from './plate-raster';

const BLANK_GLYPH = 36;

/** The glyph index composed into cell `cell` — read from the red channel the charset encoded. */
function glyphAt(rgba: Uint8Array, cell: number): number {
  return rgba[((PLATE_TEXT_HEIGHT / 2) * PLATE_TEXT_WIDTH + cell * 8 + 4) * 4];
}

/** A charset whose every pixel carries its own glyph index in the red channel — so a composed raster
 *  can be read back as "which cell landed in which column". */
function indexedCharset(width = 32, height = 256): PlateCharset {
  const cellWidth = width / 4;
  const cellHeight = cellWidth * 2;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = Math.floor(y / cellHeight) * 4 + Math.floor(x / cellWidth);
      const at = (y * width + x) * 4;
      rgba[at] = index;
      rgba[at + 3] = 255;
    }
  }

  return { cellHeight, cellWidth, height, rgba, width };
}

describe('generatePlateText', () => {
  describe('negative cases', () => {
    it('falls back to the default mask when the mask is empty', () => {
      expect(generatePlateText('', 1)).toHaveLength(DEFAULT_PLATE_MASK.length);
      expect(generatePlateText('', 1)[4]).toBe(' '); // the default mask's literal space
    });

    it('cuts a mask longer than the eight cells a plate has', () => {
      expect(generatePlateText('LLLLLLLLLLLL', 7)).toHaveLength(PLATE_TEXT_LENGTH);
    });
  });

  describe('positive cases', () => {
    it('is deterministic for one seed and differs across seeds', () => {
      expect(generatePlateText(DEFAULT_PLATE_MASK, 42)).toBe(generatePlateText(DEFAULT_PLATE_MASK, 42));
      expect(generatePlateText('LLLLLLLL', 1)).not.toBe(generatePlateText('LLLLLLLL', 2));
    });

    it('expands L to a letter, D to a digit and passes literals through', () => {
      expect(generatePlateText('LLDD-DLL', 99)).toMatch(/^[A-Z]{2}\d{2}-\d[A-Z]{2}$/);
    });

    it('expands * to either a letter or a digit', () => {
      expect(generatePlateText('********', 5)).toMatch(/^[A-Z0-9]{8}$/);
    });

    it('produces the game shape for the default mask', () => {
      expect(generatePlateText(DEFAULT_PLATE_MASK, 3)).toMatch(/^[A-Z]{2}\d{2} \d[A-Z]{2}$/);
    });
  });
});

describe('composePlateText', () => {
  describe('negative cases', () => {
    it('renders the blank glyph for a character outside A-Z0-9', () => {
      expect(glyphAt(composePlateText('#', indexedCharset()), 0)).toBe(BLANK_GLYPH);
    });

    it('pads short text with the blank glyph instead of leaving cells uninitialised', () => {
      const rgba = composePlateText('AB', indexedCharset());
      expect(glyphAt(rgba, 2)).toBe(BLANK_GLYPH);
      expect(glyphAt(rgba, PLATE_TEXT_LENGTH - 1)).toBe(BLANK_GLYPH);
    });

    it('falls back to the ground colour when the charset is too short to hold the blank row', () => {
      const short = indexedCharset(32, 32); // two rows only — the blank cell is off the atlas
      expect(glyphAt(composePlateText('#', short), 0)).toBe(short.rgba[0]);
    });

    it('ignores text past the eighth cell', () => {
      const rgba = composePlateText('AAAAAAAAZ', indexedCharset());
      expect(rgba).toHaveLength(PLATE_TEXT_WIDTH * PLATE_TEXT_HEIGHT * 4);
      expect(glyphAt(rgba, PLATE_TEXT_LENGTH - 1)).toBe(0); // still 'A', not 'Z'
    });
  });

  describe('positive cases', () => {
    it('returns a fully opaque 64x16 RGBA raster', () => {
      const rgba = composePlateText('AB12 3CD', indexedCharset());
      expect(rgba).toHaveLength(PLATE_TEXT_WIDTH * PLATE_TEXT_HEIGHT * 4);
      for (let at = 3; at < rgba.length; at += 4) {
        expect(rgba[at]).toBe(255);
      }
    });

    it('places A-Z at indices 0-25 and 0-9 at 26-35, four glyphs per row', () => {
      const rgba = composePlateText('AZ09', indexedCharset());
      expect(glyphAt(rgba, 0)).toBe(0); // A → column 0, row 0
      expect(glyphAt(rgba, 1)).toBe(25); // Z → column 1, row 6
      expect(glyphAt(rgba, 2)).toBe(26); // 0 → column 2, row 6
      expect(glyphAt(rgba, 3)).toBe(35); // 9 → column 3, row 8
    });

    it('lays each character in its own eight-pixel column', () => {
      const rgba = composePlateText('ABCDEFGH', indexedCharset());
      for (let cell = 0; cell < PLATE_TEXT_LENGTH; cell += 1) {
        expect(glyphAt(rgba, cell)).toBe(cell);
      }
    });

    it('scales the copy when a mod ships the charset at a bigger resolution', () => {
      const rgba = composePlateText('AZ09', indexedCharset(64, 512));
      expect(glyphAt(rgba, 1)).toBe(25);
      expect(glyphAt(rgba, 3)).toBe(35);
    });

    it('is case-insensitive', () => {
      expect(composePlateText('az', indexedCharset())).toEqual(composePlateText('AZ', indexedCharset()));
    });
  });
});

describe('charsetFromRaster', () => {
  describe('positive cases', () => {
    it('reduces to the game grid at the stock atlas size', () => {
      const grid = charsetFromRaster({ height: 256, rgba: new Uint8Array(32 * 256 * 4), width: 32 });
      expect(grid).toMatchObject({ cellHeight: 16, cellWidth: 8 });
    });

    it('scales the cell with a modded atlas instead of assuming 8x16', () => {
      const grid = charsetFromRaster({ height: 512, rgba: new Uint8Array(64 * 512 * 4), width: 64 });
      expect(grid).toMatchObject({ cellHeight: 32, cellWidth: 16 });
    });
  });
});

describe('plateBackgroundIndex', () => {
  describe('positive cases', () => {
    it('maps each city to its plateback, in eCarPlateType order', () => {
      expect(plateBackgroundIndex('SF')).toBe(0);
      expect(plateBackgroundIndex('VEGAS')).toBe(1);
      expect(plateBackgroundIndex('LA')).toBe(2);
    });
  });
});
