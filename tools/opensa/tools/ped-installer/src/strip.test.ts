import { parsePedDefs } from '@opensa/renderware/parsers/text/ped-defs.parser';
import { createImg, openImg } from '@opensa/tool-kit/archive/img';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { stripGta3Img, stripPeds } from './strip';

const PEDS = [
  '# stock peds',
  'peds',
  '7, male01, male01, CIVMALE',
  '9, bfori, bfori, CIVFEMALE',
  '14, bmori, bmori, CIVMALE',
  'end',
  'objs',
  '1, prop, proptxd, 100, 0',
  'end',
].join('\n');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ped-strip-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('stripPeds', () => {
  describe('positive cases', () => {
    it('keeps only the kept models in the peds section', () => {
      const out = stripPeds(PEDS, new Set(['bfori']));
      const defs = parsePedDefs(out);

      expect([...defs.keys()]).toEqual(['bfori']);
    });

    it('preserves comments, section markers, and unrelated sections', () => {
      const out = stripPeds(PEDS, new Set(['bfori'])).split('\n');

      expect(out).toContain('# stock peds');
      expect(out).toContain('peds');
      expect(out).toContain('end');
      expect(out).toContain('objs');
      expect(out).toContain('1, prop, proptxd, 100, 0'); // a comma line outside `peds` is untouched
    });

    it('preserves CRLF line endings', () => {
      const out = stripPeds(PEDS.replace(/\n/g, '\r\n'), new Set(['bfori']));

      expect(out.includes('\r\n')).toBe(true);
      expect(out.includes('\n\n')).toBe(false);
    });
  });
});

describe('stripGta3Img', () => {
  describe('negative cases', () => {
    it('does nothing when the img file does not exist', () => {
      expect(() => stripGta3Img(join(dir, 'missing.img'), new Set(['x.dff']))).not.toThrow();
    });
  });

  describe('positive cases', () => {
    it('deletes every entry that is not in the keep-set', () => {
      const imgPath = join(dir, 'gta3.img');
      const img = createImg();
      img.set('bfori.dff', Uint8Array.of(1));
      img.set('bfori.txd', Uint8Array.of(2));
      img.set('other.dff', Uint8Array.of(3));
      writeFileSync(imgPath, img.build());

      stripGta3Img(imgPath, new Set(['bfori.dff', 'bfori.txd']));

      const result = openImg(new Uint8Array(readFileSync(imgPath)));
      expect(
        result
          .names()
          .map((n) => n.toLowerCase())
          .sort(),
      ).toEqual(['bfori.dff', 'bfori.txd']);
    });
  });
});

// Real stock peds.ide: the rows have 11+ columns (stat, anim group, driving-mask, radio stations, voices…),
// not the 4 the synthetic sample above uses — and the file the installer strips is always this one.
const STOCK_PEDS = 'fixtures/original/data/peds.ide';

describe.skipIf(!existsSync(STOCK_PEDS))('stripPeds (real stock peds.ide)', () => {
  describe('positive cases', () => {
    it('keeps one real ped row intact — full column count and all — and drops the other ~270', () => {
      const stock = readFileSync(STOCK_PEDS, 'utf8');

      const out = stripPeds(stock, new Set(['bfori']));

      expect(parsePedDefs(stock).size).toBeGreaterThan(100);
      expect([...parsePedDefs(out).keys()]).toEqual(['bfori']);
      const row = out.split('\n').find((line) => line.toLowerCase().includes('bfori'));
      expect(row!.split(',').length).toBeGreaterThan(4); // the row survives whole, not truncated
    });

    it('leaves every line OUTSIDE the peds section byte-for-byte', () => {
      const stock = readFileSync(STOCK_PEDS, 'utf8');
      const outside = (text: string): string[] => {
        const lines = text.split('\n');
        const start = lines.findIndex((line) => line.trim().toLowerCase() === 'peds');
        const end = lines.findIndex((line, at) => at > start && line.trim().toLowerCase() === 'end');

        return [...lines.slice(0, start), ...lines.slice(end)];
      };

      expect(outside(stripPeds(stock, new Set(['bfori'])))).toEqual(outside(stock));
    });
  });
});
