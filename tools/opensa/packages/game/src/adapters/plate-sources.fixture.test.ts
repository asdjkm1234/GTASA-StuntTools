import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { composePlateText, PLATE_TEXT_HEIGHT, PLATE_TEXT_WIDTH } from '../vehicle/plate-raster';
import { extractPlateSources } from './plate-sources';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

function toArrayBuffer(file: Buffer): ArrayBuffer {
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
}

// The real stock dictionary the plate sources come from at boot. A synthetic charset can prove the
// grid arithmetic but not that the grid MATCHES the shipped atlas — only these bytes can.
const txdPath = join(process.cwd(), 'fixtures', 'original', 'models', 'generic', 'vehicle.txd');
const fixtureExists = existsSync(txdPath);
const sources = fixtureExists ? extractPlateSources(parseTxd(toArrayBuffer(readFileSync(txdPath)))) : null;

/** The first character cell of a composed raster, as a comparable string. */
function firstCell(text: string): string {
  const rgba = composePlateText(text, sources!.charset);
  const cell: number[] = [];
  for (let y = 0; y < PLATE_TEXT_HEIGHT; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      cell.push(rgba[(y * PLATE_TEXT_WIDTH + x) * 4]);
    }
  }

  return cell.join(',');
}

describe.skipIf(!fixtureExists)('plate sources from the stock generic/vehicle.txd', () => {
  describe('negative cases', () => {
    it('renders no glyph as blank — every character has ink', () => {
      const blank = firstCell('#');
      for (const character of ALPHABET) {
        expect(firstCell(character), character).not.toBe(blank);
      }
    });
  });

  describe('positive cases', () => {
    it('finds the charset and all three backgrounds', () => {
      expect(sources).not.toBeNull();
      expect(sources!.backgrounds).toHaveLength(3);
    });

    it('derives the game grid from the shipped atlas: 32x256, cells of 8x16', () => {
      expect(sources!.charset).toMatchObject({ cellHeight: 16, cellWidth: 8, height: 256, width: 32 });
    });

    it('decodes each background to a full RGBA image', () => {
      for (const background of sources!.backgrounds) {
        expect(background.rgba).toHaveLength(background.width * background.height * 4);
      }
    });

    it("renders every glyph as its own bitmap, bar the font's own O/0 twins", () => {
      const seen = new Map<string, string>();
      const collisions: string[] = [];
      for (const character of ALPHABET) {
        const cell = firstCell(character);
        const previous = seen.get(cell);
        if (previous) {
          collisions.push(`${previous}${character}`);
        }
        seen.set(cell, character);
      }
      // The stock plate font draws the letter O and the digit 0 with identical pixels — a property of
      // the shipped atlas, not of the grid. Any OTHER pair sharing a bitmap means cells are being
      // sampled off the wrong rows, so pin the collision set exactly rather than loosening the test.
      expect(collisions).toEqual(['O0']);
      expect(seen.size).toBe(ALPHABET.length - 1);
    });

    it('composes an opaque plate raster carrying ink over the charset ground', () => {
      const rgba = composePlateText('AB12 3CD', sources!.charset);
      expect(rgba).toHaveLength(PLATE_TEXT_WIDTH * PLATE_TEXT_HEIGHT * 4);
      const ground = sources!.charset.rgba[0];
      let ink = 0;
      for (let at = 0; at < rgba.length; at += 4) {
        expect(rgba[at + 3]).toBe(255);
        if (rgba[at] !== ground) {
          ink += 1;
        }
      }
      expect(ink).toBeGreaterThan(0);
    });
  });
});
