import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyVehicleParked,
  assertCarGeneratorBudget,
  countParkedRows,
  mergeParkedRow,
  PARKED_FILE,
  PARKED_INI,
} from './parked';

/** Parked Maker's ini as mod 47 ships it — `[Cars]` present and empty. */
const STOCK_INI = '[Settings]\r\nEnable_Mod=1\r\nActive_Cheat=MKPK\r\n[Cars]';

/** The only `parked.txt` the fleet authors (001veh): colour, colour, x, y, z, angle — no id. */
const VEGA = '35 35 2495.98 -1673.15 13.25 0.00';

/** A tree with a manana row, so a replacement car's id resolves. */
const VEHICLES_IDE =
  'cars\n410, manana, manana, car, MANANA, MANANA, null, poorfamily, 4, 0, 0, -1, 0.7, 0.7, 0\nend\n';

let root: string;
let folder: string;
let out: string;

const iniText = (): string => readFileSync(join(out, PARKED_INI), 'latin1');

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vehicle-installer-parked-'));
  folder = join(root, 'manana - 1971 Chevrolet Vega - alfamodding');
  out = join(root, 'out');
  mkdirSync(folder, { recursive: true });
  mkdirSync(join(out, 'data'), { recursive: true });
  mkdirSync(join(out, 'cleo'), { recursive: true });
  writeFileSync(join(out, 'data', 'vehicles.ide'), VEHICLES_IDE);
  writeFileSync(join(out, PARKED_INI), STOCK_INI, 'latin1');
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('mergeParkedRow', () => {
  describe('positive cases', () => {
    it('numbers the first row 0 and continues from the highest key present', () => {
      const lines = STOCK_INI.split('\r\n');
      mergeParkedRow(lines, `410 ${VEGA}`);
      mergeParkedRow(lines, `410 1 1 0.0 0.0 0.0 0.0`);

      expect(lines.slice(-2)).toEqual([`0=410 ${VEGA}`, '1=410 1 1 0.0 0.0 0.0 0.0']);
    });

    it('is idempotent by the whole value — the same spot is not written twice', () => {
      const lines = STOCK_INI.split('\r\n');
      mergeParkedRow(lines, `410 ${VEGA}`);
      mergeParkedRow(lines, `410 ${VEGA}`);

      expect(countParkedRows(lines)).toBe(1);
    });

    it('continues the numbering of an ini that already holds rows', () => {
      const lines = [...STOCK_INI.split('\r\n'), '0=400 1 1 0.0 0.0 0.0 0.0', '7=401 1 1 0.0 0.0 0.0 0.0'];
      mergeParkedRow(lines, `410 ${VEGA}`);

      expect(lines[lines.length - 1]).toBe(`8=410 ${VEGA}`);
    });
  });
});

describe('assertCarGeneratorBudget', () => {
  describe('negative cases', () => {
    it("refuses when the rows alone reach FLA's limit", () => {
      writeFileSync(join(out, 'fastman92limitAdjuster_GTASA.ini'), 'Car generators = 12\r\n', 'latin1');

      expect(() => assertCarGeneratorBudget(out, 12)).toThrow(/car-generator limit of 12/);
    });
  });

  describe('positive cases', () => {
    it('reads the limit FLA is configured with, not the default', () => {
      writeFileSync(join(out, 'fastman92limitAdjuster_GTASA.ini'), 'Car generators = 2000\r\n', 'latin1');

      expect(() => assertCarGeneratorBudget(out, 600)).not.toThrow();
    });

    it('falls back to 500 when the setting is commented out, as the reference install has it', () => {
      writeFileSync(join(out, 'fastman92limitAdjuster_GTASA.ini'), '#Car generators = 9000\r\n', 'latin1');

      expect(() => assertCarGeneratorBudget(out, 499)).not.toThrow();
      expect(() => assertCarGeneratorBudget(out, 500)).toThrow(/limit of 500/);
    });
  });
});

describe('applyVehicleParked', () => {
  describe('negative cases', () => {
    it("parks a car whose ide row is not in data/ — an added car's row is beside its models", () => {
      // Session 29 moved an added car's `cars` row into `modloader/added-vehicles/<slot>.settings.txt`, so
      // the id lookup here finds nothing and the car is parked NOWHERE. The caller knows the id: it passes it.
      writeFileSync(join(folder, PARKED_FILE), '35 35 2495.98 -1673.15 13.25 0.00\n');

      expect(applyVehicleParked(folder, readdirSync(folder), out, '001veh')).toEqual([
        expect.stringContaining("no IDE row in the tree defines '001veh'") as string,
      ]);
      expect(applyVehicleParked(folder, readdirSync(folder), out, '001veh', 19_001)).toEqual([]);
      expect(iniText()).toContain('=19001 35 35 2495.98');
    });

    it('warns and writes nothing when Parked Maker is not in the build', () => {
      rmSync(join(out, PARKED_INI));
      writeFileSync(join(folder, PARKED_FILE), VEGA);

      const warnings = applyVehicleParked(folder, [PARKED_FILE], out, 'manana');

      expect(warnings[0]).toMatch(/Parked Maker 3\.0\.2 is not in this build/);
      expect(existsSync(join(out, PARKED_INI))).toBe(false);
    });

    it('warns when no IDE row in the tree defines the model', () => {
      writeFileSync(join(folder, PARKED_FILE), VEGA);

      const warnings = applyVehicleParked(folder, [PARKED_FILE], out, 'nosuchcar');

      expect(warnings[0]).toMatch(/no IDE row in the tree defines 'nosuchcar'/);
      expect(iniText()).toBe(STOCK_INI);
    });

    it('drops a row whose column count is not the six the script reads after the id', () => {
      writeFileSync(join(folder, PARKED_FILE), '2495.98 -1673.15 13.25');

      const warnings = applyVehicleParked(folder, [PARKED_FILE], out, 'manana');

      expect(warnings[0]).toMatch(/has 3 columns, Parked Maker reads 6 after the id/);
      expect(iniText()).toBe(STOCK_INI);
    });
  });

  describe('positive cases', () => {
    it('does nothing at all when the folder ships no such file', () => {
      expect(applyVehicleParked(folder, ['manana.dff'], out, 'manana')).toEqual([]);
      expect(iniText()).toBe(STOCK_INI);
    });

    it("writes the row under the model's own id", () => {
      writeFileSync(join(folder, PARKED_FILE), VEGA);

      expect(applyVehicleParked(folder, [PARKED_FILE], out, 'manana')).toEqual([]);
      expect(iniText()).toContain(`0=410 ${VEGA}`);
      expect(iniText()).toContain('Active_Cheat=MKPK');
    });

    it('is idempotent — a rebake over the same mod changes nothing', () => {
      writeFileSync(join(folder, PARKED_FILE), VEGA);
      applyVehicleParked(folder, [PARKED_FILE], out, 'manana');
      const once = iniText();
      applyVehicleParked(folder, [PARKED_FILE], out, 'manana');

      expect(iniText()).toBe(once);
    });
  });
});

/** The mod's own file, straight out of `mods-src` (`npm run test:fixtures`). */
const REAL_PARKED = join(process.cwd(), 'fixtures', 'original', 'vehicles', '001veh-parked.txt');

describe.skipIf(!existsSync(REAL_PARKED))('parked.txt (the real 001veh file)', () => {
  describe('positive cases', () => {
    it('is one id-less row of the six columns the script reads after the id', () => {
      const rows = readFileSync(REAL_PARKED, 'latin1')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '');

      expect(rows).toHaveLength(1);
      expect(rows[0].split(/\s+/)).toHaveLength(6);
    });
  });
});
