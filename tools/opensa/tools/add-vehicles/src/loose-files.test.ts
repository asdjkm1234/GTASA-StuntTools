import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ADDED_VEHICLES_DIR,
  clearLooseFiles,
  installLooseFiles,
  readInstalledIds,
  SETTINGS_SUFFIX,
  writeSettingsFile,
} from './loose-files';

let root: string;
let game: string;
let folder: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'added-loose-'));
  game = join(root, 'game');
  folder = join(root, '059veh - a car - someone (remingtn)');
  mkdirSync(game, { recursive: true });
  mkdirSync(folder, { recursive: true });
  for (const file of ['059veh.dff', '059veh.txd', '059veh1.txd', 'wg_l_lr_rem1.dff']) {
    writeFileSync(join(folder, file), file);
  }
  writeFileSync(join(folder, '059veh.settings.txt'), 'not a model');
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('installLooseFiles', () => {
  describe('negative cases', () => {
    it('copies only models — a settings file is not one', () => {
      const { names } = installLooseFiles(game, folder);

      expect(names).not.toContain('059veh.settings.txt');
      expect(existsSync(join(game, ADDED_VEHICLES_DIR, '059veh.settings.txt'))).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('writes the dff and every txd into modloader/added-vehicles', () => {
      const { names } = installLooseFiles(game, folder);

      expect([...names].sort()).toEqual(['059veh.dff', '059veh.txd', '059veh1.txd', 'wg_l_lr_rem1.dff']);
      expect(readFileSync(join(game, ADDED_VEHICLES_DIR, '059veh.dff'), 'latin1')).toBe('059veh.dff');
    });

    it('writes a re-modelled part under the name the install gave it, never the stock one', () => {
      const renames = new Map([['wg_l_lr_rem1.dff', 'wg_l_lr_rem1_059veh.dff']]);
      const { names } = installLooseFiles(game, folder, renames);

      expect(names).toContain('wg_l_lr_rem1_059veh.dff');
      expect(existsSync(join(game, ADDED_VEHICLES_DIR, 'wg_l_lr_rem1.dff'))).toBe(false);
    });

    it('is idempotent — a second run leaves the same files', () => {
      const first = installLooseFiles(game, folder).names;

      expect(installLooseFiles(game, folder).names).toEqual(first);
    });
  });
});

describe('clearLooseFiles', () => {
  describe('positive cases', () => {
    it('takes the folder away, so a car deleted from the source cannot survive in the tree', () => {
      installLooseFiles(game, folder);
      clearLooseFiles(game);

      expect(existsSync(join(game, ADDED_VEHICLES_DIR))).toBe(false);
    });

    it('does nothing when there is no folder yet', () => {
      expect(() => clearLooseFiles(game)).not.toThrow();
    });
  });
});

const IDE = '19001, 001veh, 001veh, car, 001VEH, 001VEH, null, poorfamily, 10, 0, 0, -1, 0.63, 0.63, 0';
const HANDLING = '001VEH 1200.0 2000.0 2.2 0.0 0.15 -0.1 70 0.70 0.86 0.5 4 160.0';

describe('writeSettingsFile', () => {
  describe('negative cases', () => {
    it('is never named after a stock data file — Mod Loader would take it as a REPLACEMENT', () => {
      writeSettingsFile(game, '001veh', { handling: HANDLING, ide: IDE });
      const written = readdirSync(join(game, ADDED_VEHICLES_DIR));

      expect(written).not.toContain('vehicles.ide');
      expect(written).not.toContain('handling.cfg');
      expect(written).toContain(`001veh${SETTINGS_SUFFIX}`);
    });
  });

  describe('positive cases', () => {
    it('writes the ide row and the handling line for Mod Loader to match', () => {
      const path = writeSettingsFile(game, '001veh', { handling: HANDLING, ide: IDE });
      const text = readFileSync(path, 'latin1');

      expect(text).toContain(IDE);
      expect(text).toContain(HANDLING);
      expect(text.split('\n')[0]).toMatch(/^;/); // a comment line, so the file reads as a readme
    });

    it('writes what it has when a car ships only one of the two', () => {
      const text = readFileSync(writeSettingsFile(game, '001veh', { ide: IDE }), 'latin1');

      expect(text).toContain(IDE);
      expect(text.trimEnd().split('\n')).toHaveLength(2);
    });
  });
});

describe('readInstalledIds', () => {
  describe('negative cases', () => {
    it('is empty when nothing has been installed', () => {
      expect(readInstalledIds(game).size).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('reads the ids back — nothing else in the tree can see them', () => {
      writeSettingsFile(game, '001veh', { handling: HANDLING, ide: IDE });

      expect([...readInstalledIds(game)]).toEqual([['001veh', 19_001]]);
    });

    it('survives a file with no ide row', () => {
      writeSettingsFile(game, '002veh', { handling: HANDLING });

      expect(readInstalledIds(game).has('002veh')).toBe(false);
    });
  });
});
