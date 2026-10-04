import type { LedgerRow } from '@opensa/vehicle-installer/ledger';

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { extendGlobal, registerTraffic, variationsByBase } from './traffic';

const INI = join('modloader', 'Model_Variations', 'ModelVariations_Vehicles.ini');
const STOCK_INI = '[Settings]\nChangeCarGenerators=0\n';
const STOCK_IDS = new Map([
  ['freibox', 590],
  ['manana', 410],
  ['petro', 514],
]);

const row = (slot: string, id: number, bases: string[]): LedgerRow => ({ bases, folder: slot, id, kind: 'car', slot });

let game: string;

const iniText = (): string => readFileSync(join(game, INI), 'latin1');

beforeEach(() => {
  game = mkdtempSync(join(tmpdir(), 'added-traffic-'));
  mkdirSync(join(game, 'modloader', 'Model_Variations'), { recursive: true });
  writeFileSync(join(game, INI), STOCK_INI, 'latin1');
});

afterEach(() => {
  rmSync(game, { force: true, recursive: true });
});

describe('extendGlobal', () => {
  describe('negative cases', () => {
    it('adds no id twice', () => {
      expect(extendGlobal('410,19001', 410, [19_001, 19_002])).toBe('410,19001,19002');
    });
  });

  describe('positive cases', () => {
    it('is the base then the added ids when the section had none', () => {
      expect(extendGlobal(undefined, 410, [19_002, 19_001])).toBe('410,19002,19001');
    });

    it("keeps what the section already listed — a mod's `Global=Trailers1` reference included", () => {
      expect(extendGlobal('Trailers1', 514, [19_055])).toBe('Trailers1,514,19055');
    });
  });
});

describe('variationsByBase', () => {
  describe('negative cases', () => {
    it('reports a car that names no base at all', () => {
      const warnings: string[] = [];
      variationsByBase([row('001veh', 19_001, [])], warnings);

      expect(warnings[0]).toMatch(/names no base/);
    });
  });

  describe('positive cases', () => {
    it('lists a car under every base it names, ids ascending', () => {
      const byBase = variationsByBase(
        [row('002veh', 19_002, ['manana']), row('001veh', 19_001, ['manana', 'petro'])],
        [],
      );

      expect(byBase.get('manana')).toEqual([19_001, 19_002]);
      expect(byBase.get('petro')).toEqual([19_001]);
    });
  });
});

describe('registerTraffic', () => {
  describe('negative cases', () => {
    it('refuses when ModelVariations is not in the build — the cars would never be seen', () => {
      rmSync(join(game, 'modloader'), { recursive: true });

      expect(() => registerTraffic(game, [row('001veh', 19_001, ['manana'])], STOCK_IDS)).toThrow(
        /ModelVariations 10\.7/,
      );
    });

    it('warns about a base the built vehicles.ide does not define', () => {
      const warnings = registerTraffic(game, [row('001veh', 19_001, ['nosuch'])], STOCK_IDS);

      expect(warnings[0]).toMatch(/no vehicles\.ide row for base 'nosuch'/);
    });
  });

  describe('positive cases', () => {
    it("writes the variation list in a section keyed by the base's ID, captioned with its name", () => {
      registerTraffic(game, [row('001veh', 19_001, ['manana'])], STOCK_IDS);

      expect(iniText()).toContain('### manana\n[410]\nGlobal=410,19001');
      expect(iniText()).toContain('ChangeCarGenerators=0');
    });

    it("leaves the base's own NAME section alone — that is where its appearance lives", () => {
      // The whole point of the id-keyed section: `[petro]` describes the petrol tanker, and an added id in
      // there would have it wearing the tanker's parts. Its `Global=Trailers1` reference is untouched too.
      writeFileSync(join(game, INI), `${STOCK_INI}\n[petro]\nTrailers1=584\nGlobal=Trailers1\n`, 'latin1');
      registerTraffic(game, [row('055veh', 19_055, ['petro'])], STOCK_IDS);

      expect(iniText()).toContain('[petro]\nTrailers1=584\nGlobal=Trailers1');
      expect(iniText()).toContain('### petro\n[514]\nGlobal=514,19055');
    });

    it('is idempotent', () => {
      registerTraffic(game, [row('001veh', 19_001, ['manana'])], STOCK_IDS);
      const once = iniText();
      registerTraffic(game, [row('001veh', 19_001, ['manana'])], STOCK_IDS);

      expect(iniText()).toBe(once);
    });
  });
});
