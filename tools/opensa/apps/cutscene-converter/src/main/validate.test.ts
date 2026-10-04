import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { validateCars, validateGame, validateOut } from './validate';

const GAME_FILES = [
  'anim/cuts.img',
  'data/carcols.dat',
  'data/txdcut.ide',
  'data/vehicles.ide',
  'models/cutscene.img',
  'models/generic/vehicle.txd',
  'models/gta3.img',
];

let dir = '';

function makeGame(at: string): void {
  for (const file of GAME_FILES) {
    const path = join(at, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '');
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cutscene-converter-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('the three folder validations', () => {
  describe('negative cases', () => {
    it('blocks a folder that is not a game, naming the files it wanted', () => {
      const report = validateGame(dir);

      expect(report.level).toBe('error');
      expect(report.verdicts.some((verdict) => verdict.message.includes('models/gta3.img'))).toBe(true);
    });

    // The exe check is skipped when the file list already failed — an exe verdict on a folder that is
    // plainly not a game is noise stacked on the answer.
    it('does not also report the exe when the folder is not a game at all', () => {
      const report = validateGame(dir);

      expect(report.verdicts.some((verdict) => verdict.code.startsWith('file.'))).toBe(false);
    });

    it('blocks an unsupported exe on an otherwise complete game', () => {
      makeGame(dir);
      writeFileSync(join(dir, 'gta_sa.exe'), 'not the accepted build');

      const report = validateGame(dir);

      expect(report.level).toBe('error');
      expect(report.verdicts[report.verdicts.length - 1].code).toBe('file.size-mismatch');
    });

    it('refuses an output folder that IS the game folder', () => {
      const report = validateOut(dir, dir);

      expect(report.level).toBe('error');
      expect(report.verdicts[0].code).toBe('out.is-game');
    });

    it('refuses an output folder that does not exist', () => {
      expect(validateOut(dir, join(dir, 'nope')).verdicts[0].code).toBe('path.missing');
    });

    it('blocks a cars folder that does not exist', () => {
      expect(validateCars(dir, join(dir, 'nope')).verdicts[0].code).toBe('path.missing');
    });

    // The shape mistake anyone makes once: unpack the mods and drop the models straight into the folder.
    // Matching then finds nothing and the honest-looking answer, "0 of 23 slots covered", sends the user
    // hunting file names instead of the folder shape.
    it('names the loose-file shape instead of reporting empty coverage', () => {
      const cars = join(dir, 'cars');
      mkdirSync(cars);
      writeFileSync(join(cars, 'bobcat.dff'), '');
      writeFileSync(join(cars, 'bobcat.txd'), '');

      const report = validateCars(dir, cars);

      expect(report.level).toBe('error');
      expect(report.verdicts[report.verdicts.length - 1].code).toBe('cars.loose-files');
    });

    // The census is the TOOL's answer; when it cannot be read at all that is an error here, not a
    // half-empty coverage warning that reads as "your mods are fine, there is just nothing to do".
    it('blocks when the census cannot be read, carrying the tool own words in the detail', () => {
      const cars = join(dir, 'cars');
      mkdirSync(cars);

      const report = validateCars(join(dir, 'not-a-game'), cars);

      expect(report.level).toBe('error');
      expect(report.verdicts[report.verdicts.length - 1].code).toBe('cars.unreadable');
      expect(report.verdicts[report.verdicts.length - 1].detail?.length).toBeGreaterThan(0);
    });
  });

  describe('positive cases', () => {
    it('accepts a writable output folder beside the game', () => {
      const out = join(dir, 'out');
      mkdirSync(out);

      expect(validateOut(dir, out).level).toBe('ok');
    });
  });
});
