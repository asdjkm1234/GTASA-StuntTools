import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AddedVehicle } from './sources';

import { describe as describeFolder, resolveAddedCarText, vehicleGameName } from './name';

const IDE = '19001, 001veh, 001veh, car, 001VEH, 001VEH, null, poorfamily, 10, 0, 0, -1, 0.63, 0.63, 0';
/** The audio table's shape: a comment header, one row per model, the added-vehicles block, `;the end`. */
const AUDIO_CFG = ['; Author: fastman92', 'manana   0   95   94   0', ';the end', ''].join('\r\n');

let root: string;
let game: string;

function car(name: string, base: string): AddedVehicle {
  const folder = join(root, 'src', name);
  mkdirSync(folder, { recursive: true });

  return { base, bases: [base], folder, name, origin: 'models', slot: name.split(' - ')[0] };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'added-name-'));
  game = join(root, 'game');
  mkdirSync(join(game, 'data'), { recursive: true });
  writeFileSync(join(game, 'data', 'gtasa_vehicleAudioSettings.cfg'), AUDIO_CFG, 'latin1');
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('describe (the folder field)', () => {
  describe('negative cases', () => {
    it('falls back to the whole name when there is no second field', () => {
      expect(describeFolder('001veh')).toBe('001veh');
    });
  });

  describe('positive cases', () => {
    it('is what the car really is, between the first and second separator', () => {
      expect(describeFolder('001veh - 1971 Chevrolet Vega - alfamodding (manana)')).toBe('1971 Chevrolet Vega');
    });
  });
});

describe('vehicleGameName', () => {
  describe('negative cases', () => {
    it('is undefined for a line that is not a cars row', () => {
      expect(vehicleGameName('not a row')).toBeUndefined();
    });
  });

  describe('positive cases', () => {
    it('is column 5 of the ide row', () => {
      expect(vehicleGameName(IDE)).toBe('001VEH');
    });
  });
});

describe('resolveAddedCarText', () => {
  describe('negative cases', () => {
    it('warns and names nothing when the ide line is missing', () => {
      const text = resolveAddedCarText(car('001veh - vega - x (manana)', 'manana'), game, '');

      expect(text.name).toBeNull();
      expect(text.warnings[0]).toMatch(/no gameName column/);
    });

    it('warns when neither an audio.txt nor the base has a row — the car would be silent', () => {
      const text = resolveAddedCarText(car('001veh - vega - x (nosuch)', 'nosuch'), game, IDE);

      expect(text.audio).toBeNull();
      expect(text.warnings.some((warning) => /will be silent/.test(warning))).toBe(true);
    });

    it('warns about a gameName wider than a GXT key', () => {
      const line = IDE.replace('001VEH, 001VEH', '001VEH, TOOLONGNAME');
      const text = resolveAddedCarText(car('001veh - vega - x (manana)', 'manana'), game, line);

      expect(text.warnings.some((warning) => /is 11 characters/.test(warning))).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('names the car after its folder, under its own gameName', () => {
      const text = resolveAddedCarText(car('001veh - 1971 Chevrolet Vega - x (manana)', 'manana'), game, IDE);

      expect(text.name).toEqual({ key: '001VEH', text: '1971 Chevrolet Vega' });
    });

    it("inherits the base's audio row under its own model name", () => {
      const text = resolveAddedCarText(car('001veh - vega - x (manana)', 'manana'), game, IDE);

      expect(text.audio).toBe('001veh   0   95   94   0');
    });

    it('inherits nothing when the folder ships its own audio.txt', () => {
      const source = car('001veh - vega - x (manana)', 'manana');
      writeFileSync(join(source.folder, 'audio.txt'), '001veh 0 1 1 0');

      expect(resolveAddedCarText(source, game, IDE).audio).toBeNull();
    });
  });
});
