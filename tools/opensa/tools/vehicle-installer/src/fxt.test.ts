import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyVehicleText, formatFxt, parseTextEntries, TEXT_FILE } from './fxt';

/** The slamvan's file, as the mod ships it (2026-08-19) — the census subject. */
const SLAMVAN = 'SLASH Slamin Hood\r\nSLACH Chromer Hood';

/** A real `.fxt` the build already carries, in its own shape (key TAB text). */
const RESPRAY = 'GA_2\tNew engine and paint job: $5000~n~Cops wont recognize you!\r\n';

const noop = (): void => undefined;

let root: string;
let folder: string;
let out: string;

const fxtText = (model: string): string => readFileSync(join(out, 'cleo', 'cleo_text', `${model}.fxt`), 'latin1');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vehicle-installer-fxt-'));
  folder = join(root, 'slamvan - 1968 GMC Pickup Hammered - alfamodding');
  out = join(root, 'out');
  mkdirSync(folder, { recursive: true });
  mkdirSync(join(out, 'cleo'), { recursive: true });
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('parseTextEntries', () => {
  describe('negative cases', () => {
    it('reports a line that is a key with no text', () => {
      const warnings: string[] = [];

      expect(parseTextEntries('SLASH\n', (message) => warnings.push(message))).toEqual([]);
      expect(warnings[0]).toMatch(/key but no text/);
    });

    it('reports a key repeated in the same file and keeps the last text', () => {
      const warnings: string[] = [];
      const entries = parseTextEntries('SLASH First\nSLASH Second\n', (message) => warnings.push(message));

      expect(entries).toEqual([{ key: 'SLASH', text: 'Second' }]);
      expect(warnings[0]).toMatch(/appears twice/);
    });
  });

  describe('positive cases', () => {
    it("reads the slamvan's two entries, text kept verbatim", () => {
      expect(parseTextEntries(SLAMVAN, noop)).toEqual([
        { key: 'SLASH', text: 'Slamin Hood' },
        { key: 'SLACH', text: 'Chromer Hood' },
      ]);
    });

    it('skips blanks and comments', () => {
      expect(parseTextEntries('# a comment\n\n// another\nSLASH Slamin Hood\n', noop)).toEqual([
        { key: 'SLASH', text: 'Slamin Hood' },
      ]);
    });
  });
});

describe('formatFxt', () => {
  describe('positive cases', () => {
    it('writes KEY TAB text, CRLF, with a trailing newline', () => {
      expect(formatFxt([{ key: 'SLASH', text: 'Slamin Hood' }])).toBe('SLASH\tSlamin Hood\r\n');
    });
  });
});

describe('applyVehicleText', () => {
  describe('negative cases', () => {
    it('warns and writes nothing when the folder ships no model to name the file after', () => {
      writeFileSync(join(folder, TEXT_FILE), SLAMVAN);

      const warnings = applyVehicleText(folder, [TEXT_FILE], out, undefined);

      expect(warnings[0]).toMatch(/no model to name the \.fxt after/);
      expect(existsSync(join(out, 'cleo', 'cleo_text', 'undefined.fxt'))).toBe(false);
    });

    it('warns when a file with no recognisable entry would leave the parts nameless', () => {
      writeFileSync(join(folder, TEXT_FILE), '# nothing but a comment\n');

      const warnings = applyVehicleText(folder, [TEXT_FILE], out, 'slamvan');

      expect(warnings[0]).toMatch(/no entries recognised/);
      expect(existsSync(join(out, 'cleo', 'cleo_text', 'slamvan.fxt'))).toBe(false);
    });

    it('reports a key another .fxt in the build already defines', () => {
      writeFileSync(join(out, 'cleo', 'ResprayPrice.fxt'), RESPRAY);
      writeFileSync(join(folder, TEXT_FILE), 'GA_2 Cheaper now\n');

      const warnings = applyVehicleText(folder, [TEXT_FILE], out, 'slamvan');

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/'GA_2' is already defined by cleo\/ResprayPrice\.fxt/);
      expect(fxtText('slamvan')).toBe('GA_2\tCheaper now\r\n');
    });
  });

  describe('positive cases', () => {
    it('does nothing at all when the folder ships no such file', () => {
      expect(applyVehicleText(folder, ['slamvan.dff'], out, 'slamvan')).toEqual([]);
      expect(existsSync(join(out, 'cleo', 'cleo_text', 'slamvan.fxt'))).toBe(false);
    });

    it("writes the slamvan's two part names as cleo/cleo_text/<model>.fxt", () => {
      writeFileSync(join(folder, TEXT_FILE), SLAMVAN);

      expect(applyVehicleText(folder, [TEXT_FILE], out, 'slamvan')).toEqual([]);
      expect(fxtText('slamvan')).toBe('SLASH\tSlamin Hood\r\nSLACH\tChromer Hood\r\n');
    });

    it('does not report its OWN keys as a collision on a re-run', () => {
      writeFileSync(join(folder, TEXT_FILE), SLAMVAN);
      applyVehicleText(folder, [TEXT_FILE], out, 'slamvan');

      expect(applyVehicleText(folder, [TEXT_FILE], out, 'slamvan')).toEqual([]);
    });

    it('reads a file saved as UTF-16, like the settings files', () => {
      const utf16 = Buffer.concat([Buffer.of(0xff, 0xfe), Buffer.from('SLASH Slamin Hood\r\n', 'utf16le')]);
      writeFileSync(join(folder, TEXT_FILE), utf16);

      expect(applyVehicleText(folder, [TEXT_FILE], out, 'slamvan')).toEqual([]);
      expect(fxtText('slamvan')).toBe('SLASH\tSlamin Hood\r\n');
    });
  });
});

/** The mod's own file, straight out of `mods-src` (`npm run test:fixtures`) — the shape nothing else proves. */
const REAL_SLAMVAN = join(process.cwd(), 'fixtures', 'original', 'vehicles', 'slamvan-text.txt');

describe.skipIf(!existsSync(REAL_SLAMVAN))('text.txt (the real slamvan file)', () => {
  describe('positive cases', () => {
    it('is the two bonnet names its tuning_new_parts.txt price rows key on', () => {
      const entries = parseTextEntries(readFileSync(REAL_SLAMVAN, 'latin1'), noop);

      expect(entries.map(({ key }) => key)).toEqual(['SLASH', 'SLACH']);
      expect(entries.map(({ text }) => text)).toEqual(['Slamin Hood', 'Chromer Hood']);
    });
  });
});
