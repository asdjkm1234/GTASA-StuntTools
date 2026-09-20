import { describe, expect, it } from 'vitest';

import type { RWRoadsign } from '../parsers/binary/types';

import { ROADSIGN_PALETTE, roadsignGlyphIndex, roadsignGlyphQuads } from './glyph-quads';

/**
 * Defends against roadsign text rendering wrong on the map: glyphs pointing at the wrong atlas cell,
 * quads laid out off-centre / at the wrong scale, and rotated plates whose letters stop being rigid or
 * stop hugging the board face. Both the three renderer and the opensa-pack converter consume this
 * builder, so a regression here silently diverges the two pipelines.
 */

const TEXT_INSET = 0.85;
const FACE_OFFSET = 0.05;
/** Floats per glyph: 2 faces × 4 corners × 3 position components. */
const FLOATS_PER_GLYPH = 24;
/** UV floats per glyph: 2 faces × 4 corners × 2 components. */
const UVS_PER_GLYPH = 16;

type SignPatch = Partial<RWRoadsign>;

function corner(quads: { positions: number[] }, index: number): [number, number, number] {
  return [quads.positions[index * 3], quads.positions[index * 3 + 1], quads.positions[index * 3 + 2]];
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function makeSign(patch: SignPatch = {}): RWRoadsign {
  return {
    charsPerLine: 16,
    colour: 0,
    lines: ['A'],
    plateSize: [8, 4],
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    ...patch,
  };
}

describe('roadsignGlyphIndex', () => {
  describe('negative cases', () => {
    it('draws nothing for the space characters used as padding in the raw 16-char fields', () => {
      expect(roadsignGlyphIndex('_')).toBeNull();
      expect(roadsignGlyphIndex(' ')).toBeNull();
    });

    it('returns null for Object.prototype keys — the lookup must not reach the prototype', () => {
      // Regression (plan 077): COMMAND_GLYPHS was an object literal, so `glyphIndex('toString')` returned
      // a Function and broke this function's `null | number` contract. It is a Map now.
      for (const key of ['toString', 'constructor', 'hasOwnProperty', '__proto__']) {
        expect(roadsignGlyphIndex(key)).toBeNull();
      }
    });

    it('draws nothing for characters absent from the roadsignfont atlas', () => {
      expect(roadsignGlyphIndex('$')).toBeNull();
      expect(roadsignGlyphIndex('*')).toBeNull();
      expect(roadsignGlyphIndex('é')).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('maps ASCII characters to their reading-order atlas cell', () => {
      expect(roadsignGlyphIndex('!')).toBe(0);
      expect(roadsignGlyphIndex('0')).toBe(11);
      expect(roadsignGlyphIndex('A')).toBe(24);
      expect(roadsignGlyphIndex('Z')).toBe(49);
    });

    it('keeps every mapped cell inside the 4x32 atlas', () => {
      const chars = '!"&\'()+,-./0123456789:;?ABCZ[\\]abz{|}<>^~#%';
      for (const char of chars) {
        const cell = roadsignGlyphIndex(char);
        expect(cell).not.toBeNull();
        expect(cell as number).toBeGreaterThanOrEqual(0);
        expect(cell as number).toBeLessThan(4 * 32);
      }
    });

    it('documents that a non-character lookup falls through to cell 0 (String.indexOf("") === 0)', () => {
      // Not reachable from roadsignGlyphQuads (it only ever indexes real characters of a line), but pinned
      // so the quirk cannot start producing stray '!' glyphs unnoticed if callers widen.
      expect(roadsignGlyphIndex('')).toBe(0);
    });

    it('resolves command characters to the appended icon cells, overriding any ASCII cell', () => {
      expect(roadsignGlyphIndex('<')).toBe(82);
      expect(roadsignGlyphIndex('>')).toBe(83);
      expect(roadsignGlyphIndex('^')).toBe(84);
      expect(roadsignGlyphIndex('~')).toBe(85);
      expect(roadsignGlyphIndex('%')).toBe(86);
      expect(roadsignGlyphIndex('#')).toBe(87);
      // '}' also sits in the ASCII atlas run, but the command table must win (airplane on AIRPORT boards).
      expect(roadsignGlyphIndex('}')).toBe(94);
      expect(roadsignGlyphIndex('{')).toBe(79);
    });
  });
});

describe('roadsignGlyphQuads', () => {
  describe('negative cases', () => {
    it('returns null for a sign with no lines', () => {
      expect(roadsignGlyphQuads(makeSign({ lines: [] }))).toBeNull();
    });

    it('returns null when every line is blank padding', () => {
      expect(roadsignGlyphQuads(makeSign({ lines: ['________________', '    '] }))).toBeNull();
    });

    it('returns null when the whole text is unknown characters', () => {
      expect(roadsignGlyphQuads(makeSign({ lines: ['$$$'] }))).toBeNull();
    });

    it('returns null when the sign declares no characters per line', () => {
      expect(roadsignGlyphQuads(makeSign({ charsPerLine: 0, lines: ['ABC'] }))).toBeNull();
    });

    it('drops characters past the declared charsPerLine instead of overflowing the plate', () => {
      const quads = roadsignGlyphQuads(makeSign({ charsPerLine: 2, lines: ['ABCD'] }));

      expect(quads?.positions).toHaveLength(2 * FLOATS_PER_GLYPH);
    });
  });

  describe('positive cases', () => {
    it('emits one quad pair per drawable character and skips blanks inline', () => {
      const quads = roadsignGlyphQuads(makeSign({ lines: ['A_B', 'C'] }));

      expect(quads).not.toBeNull();
      expect(quads?.positions).toHaveLength(3 * FLOATS_PER_GLYPH);
      expect(quads?.uvs).toHaveLength(3 * UVS_PER_GLYPH);
    });

    it('carries the sign palette index through to the quads', () => {
      const quads = roadsignGlyphQuads(makeSign({ colour: 3 }));

      expect(quads?.colour).toBe(3);
      expect(ROADSIGN_PALETTE[3]).toEqual([0.69, 0.063, 0.063]);
      expect(ROADSIGN_PALETTE).toHaveLength(4);
    });

    it('places an unrotated glyph at the inset top-left of the plate, one cell wide and tall', () => {
      const plateWidth = 8;
      const plateHeight = 4;
      const charsPerLine = 16;
      const quads = roadsignGlyphQuads(makeSign({ charsPerLine, plateSize: [plateWidth, plateHeight] }));
      const charWidth = (plateWidth * TEXT_INSET) / charsPerLine;
      const charHeight = (plateHeight * TEXT_INSET) / 4;
      const left = (-plateWidth * TEXT_INSET) / 2;
      const top = charHeight / 2;

      expect(corner(quads!, 0)).toEqual([left, top, -FACE_OFFSET]);
      expect(corner(quads!, 1)).toEqual([left, top - charHeight, -FACE_OFFSET]);
      expect(corner(quads!, 2)).toEqual([left + charWidth, top - charHeight, -FACE_OFFSET]);
      expect(corner(quads!, 3)).toEqual([left + charWidth, top, -FACE_OFFSET]);
    });

    it('mirrors each quad to the far side of the board face with identical UVs', () => {
      const quads = roadsignGlyphQuads(makeSign())!;

      for (let index = 0; index < 4; index += 1) {
        const front = corner(quads, index);
        const back = corner(quads, index + 4);

        expect(back[0]).toBeCloseTo(front[0], 6);
        expect(back[1]).toBeCloseTo(front[1], 6);
        expect(back[2] - front[2]).toBeCloseTo(2 * FACE_OFFSET, 6);
      }
      expect(quads.uvs.slice(0, 8)).toEqual(quads.uvs.slice(8, 16));
    });

    it('offsets every glyph by the sign world position', () => {
      const at = roadsignGlyphQuads(makeSign({ position: [1000, -250, 30] }))!;
      const origin = roadsignGlyphQuads(makeSign())!;

      for (let index = 0; index < origin.positions.length; index += 3) {
        expect(at.positions[index] - origin.positions[index]).toBeCloseTo(1000, 4);
        expect(at.positions[index + 1] - origin.positions[index + 1]).toBeCloseTo(-250, 4);
        expect(at.positions[index + 2] - origin.positions[index + 2]).toBeCloseTo(30, 4);
      }
    });

    it('advances columns along local X and lines downward by one cell', () => {
      const quads = roadsignGlyphQuads(makeSign({ charsPerLine: 4, lines: ['AB', 'CD'] }))!;
      const charWidth = (8 * TEXT_INSET) / 4;
      const charHeight = (4 * TEXT_INSET) / 4;
      const glyphA = corner(quads, 0);
      const glyphB = corner(quads, 8);
      const glyphC = corner(quads, 16);

      expect(glyphB[0] - glyphA[0]).toBeCloseTo(charWidth, 6);
      expect(glyphB[1]).toBeCloseTo(glyphA[1], 6);
      expect(glyphC[0]).toBeCloseTo(glyphA[0], 6);
      expect(glyphC[1] - glyphA[1]).toBeCloseTo(-charHeight, 6);
    });

    it('keeps glyph height fixed at a quarter plate regardless of line count', () => {
      const oneLine = roadsignGlyphQuads(makeSign({ lines: ['A'] }))!;
      const fourLines = roadsignGlyphQuads(makeSign({ lines: ['A', 'A', 'A', 'A'] }))!;
      const heightOf = (quads: { positions: number[] }): number => corner(quads, 0)[1] - corner(quads, 1)[1];

      expect(heightOf(oneLine)).toBeCloseTo((4 * TEXT_INSET) / 4, 6);
      expect(heightOf(fourLines)).toBeCloseTo((4 * TEXT_INSET) / 4, 6);
    });

    it('centres the text block vertically on the plate centre', () => {
      const quads = roadsignGlyphQuads(makeSign({ lines: ['A', 'A', 'A', 'A'] }))!;
      const top = corner(quads, 0)[1];
      const lastGlyphBottom = corner(quads, 3 * 8 + 1)[1];

      expect(top + lastGlyphBottom).toBeCloseTo(0, 6);
    });

    it('maps a glyph cell to its atlas rectangle with v-down UVs', () => {
      const quads = roadsignGlyphQuads(makeSign({ lines: ['A'] }))!;
      // 'A' is cell 24 → column 0, row 6 of the 4x32 atlas.
      const u = 0;
      const v = 6 / 32;

      expect(quads.uvs.slice(0, 8)).toEqual([u, v, u, v + 1 / 32, u + 1 / 4, v + 1 / 32, u + 1 / 4, v]);
    });

    it('rotates the plate rigidly, preserving cell dimensions', () => {
      const rotated = roadsignGlyphQuads(makeSign({ rotation: [17, -40, 125] }))!;
      const charWidth = (8 * TEXT_INSET) / 16;
      const charHeight = (4 * TEXT_INSET) / 4;

      expect(distance(corner(rotated, 0), corner(rotated, 3))).toBeCloseTo(charWidth, 5);
      expect(distance(corner(rotated, 0), corner(rotated, 1))).toBeCloseTo(charHeight, 5);
      // The two faces stay one face-offset apart on either side of the board.
      expect(distance(corner(rotated, 0), corner(rotated, 4))).toBeCloseTo(2 * FACE_OFFSET, 5);
    });

    it('turns a plate yawed 90 degrees about Z so its width runs along world Y', () => {
      const quads = roadsignGlyphQuads(makeSign({ rotation: [0, 0, 90] }))!;
      const [x0, y0] = corner(quads, 0);
      const [x3, y3] = corner(quads, 3);
      const charWidth = (8 * TEXT_INSET) / 16;

      expect(x3 - x0).toBeCloseTo(0, 5);
      expect(y3 - y0).toBeCloseTo(charWidth, 5);
    });

    it('leaves an unrotated plate untouched (identity rotation is a no-op)', () => {
      const spun = roadsignGlyphQuads(makeSign({ rotation: [0, 0, 360] }))!;
      const plain = roadsignGlyphQuads(makeSign())!;

      for (let index = 0; index < plain.positions.length; index += 1) {
        expect(spun.positions[index]).toBeCloseTo(plain.positions[index], 5);
      }
    });

    it('still emits quads for a degenerate zero-size plate rather than throwing', () => {
      const quads = roadsignGlyphQuads(makeSign({ plateSize: [0, 0] }))!;

      expect(quads.positions).toHaveLength(FLOATS_PER_GLYPH);
      expect(quads.positions.every((value) => Number.isFinite(value))).toBe(true);
      expect(corner(quads, 0)).toEqual([0, 0, -FACE_OFFSET]);
    });
  });
});
