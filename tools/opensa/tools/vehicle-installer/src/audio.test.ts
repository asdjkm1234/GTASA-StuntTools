import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyVehicleAudio, AUDIO_CFG, AUDIO_FILE, mergeAudioRow } from './audio';

/** The stock table's shape: a comment header, data rows, the "added vehicles" block, `;the end`. */
const STOCK_CFG = [
  '; Author: fastman92',
  '; name          VehicleType   enginesounds',
  '; A             B             C',
  'landstal        0             99',
  'bravura         0             8',
  '; ----------------------------------- added vehicles -----------------------------------',
  '; you will add entries of new vehicles probably here',
  ';',
  ';the end',
  '',
].join('\r\n');

/** A replacement car's own line, same column count as the table. */
const BRAVURA = 'bravura         9             42';

let root: string;
let folder: string;
let out: string;

const cfgLines = (): string[] => readFileSync(join(out, AUDIO_CFG), 'latin1').split('\r\n');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vehicle-installer-audio-'));
  folder = join(root, 'bravura - a test car - nobody');
  out = join(root, 'out');
  mkdirSync(folder, { recursive: true });
  mkdirSync(join(out, 'data'), { recursive: true });
  writeFileSync(join(out, AUDIO_CFG), STOCK_CFG, 'latin1');
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('mergeAudioRow', () => {
  describe('positive cases', () => {
    it('replaces the row of a model already in the table', () => {
      const lines = STOCK_CFG.split('\r\n');
      mergeAudioRow(lines, BRAVURA);

      expect(lines.filter((line) => line.startsWith('bravura'))).toEqual([BRAVURA]);
      expect(lines).toHaveLength(STOCK_CFG.split('\r\n').length);
    });

    it("puts a model the table does not have into the file's own added-vehicles block", () => {
      const lines = STOCK_CFG.split('\r\n');
      mergeAudioRow(lines, '106veh          9             -1');

      expect(lines[lines.indexOf(';the end') - 1]).toBe('106veh          9             -1');
    });

    it('matches the model case-insensitively', () => {
      const lines = STOCK_CFG.split('\r\n');
      mergeAudioRow(lines, 'BRAVURA         9             42');

      expect(lines.filter((line) => line.toLowerCase().startsWith('bravura'))).toHaveLength(1);
    });
  });
});

describe('applyVehicleAudio', () => {
  describe('negative cases', () => {
    it('warns and writes nothing when the audio loader table is not in the tree', () => {
      rmSync(join(out, AUDIO_CFG));
      writeFileSync(join(folder, AUDIO_FILE), BRAVURA);

      const warnings = applyVehicleAudio(folder, [AUDIO_FILE], out);

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/vehicle audio loader is not in this build/);
      expect(existsSync(join(out, AUDIO_CFG))).toBe(false);
    });

    it("drops a row whose column count is not the table's", () => {
      writeFileSync(join(folder, AUDIO_FILE), 'bravura 9');

      const warnings = applyVehicleAudio(folder, [AUDIO_FILE], out);

      expect(warnings[0]).toMatch(/has 2 columns, the table has 3 — row dropped/);
      expect(cfgLines()).toContain('bravura         0             8');
    });

    it('warns when the file holds no row at all', () => {
      writeFileSync(join(folder, AUDIO_FILE), '; only a comment\n');

      expect(applyVehicleAudio(folder, [AUDIO_FILE], out)[0]).toMatch(/no rows/);
    });
  });

  describe('positive cases', () => {
    it('does nothing at all when the folder ships no such file', () => {
      expect(applyVehicleAudio(folder, ['bravura.dff'], out)).toEqual([]);
      expect(readFileSync(join(out, AUDIO_CFG), 'latin1')).toBe(STOCK_CFG);
    });

    it("replaces the car's line and keeps the file CRLF and its header", () => {
      writeFileSync(join(folder, AUDIO_FILE), BRAVURA);

      expect(applyVehicleAudio(folder, [AUDIO_FILE], out)).toEqual([]);
      expect(cfgLines()).toContain(BRAVURA);
      expect(cfgLines()[0]).toBe('; Author: fastman92');
      expect(readFileSync(join(out, AUDIO_CFG), 'latin1')).toContain('\r\n');
    });

    it('is idempotent — a rebake over the same mod changes nothing', () => {
      writeFileSync(join(folder, AUDIO_FILE), BRAVURA);
      applyVehicleAudio(folder, [AUDIO_FILE], out);
      const once = readFileSync(join(out, AUDIO_CFG), 'latin1');
      applyVehicleAudio(folder, [AUDIO_FILE], out);

      expect(readFileSync(join(out, AUDIO_CFG), 'latin1')).toBe(once);
    });
  });
});

/** The mod's own file, straight out of `mods-src` (`npm run test:fixtures`). */
const REAL_AUDIO = join(process.cwd(), 'fixtures', 'original', 'vehicles', '106veh-audio.txt');

describe.skipIf(!existsSync(REAL_AUDIO))('audio.txt (the real trailer file)', () => {
  describe('positive cases', () => {
    it('is one 15-column row keyed by the slot name', () => {
      const row = readFileSync(REAL_AUDIO, 'latin1').trim();

      expect(row.split(/\s+/)).toHaveLength(15);
      expect(row.split(/\s+/)[0]).toBe('106veh');
      expect(row.split(/\s+/)[1]).toBe('9'); // VehicleType 9 = trailer
    });
  });
});
