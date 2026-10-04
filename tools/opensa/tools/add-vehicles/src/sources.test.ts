import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveAddedVehicles, stockSlots } from './sources';

/** A built tree's `vehicles.ide`, cut to the rows these tests key on. */
const VEHICLES_IDE = `cars
410, manana, manana, car, MANANA, MANANA, null, poorfamily, 4, 0, 0, -1, 0.7, 0.7, 0
439, stalion, stalion, car, STALION, STALION, null, richfamily, 4, 0, 0, -1, 0.7, 0.7, 0
end
`;

let root: string;
let game: string;
let source: string;

/** Create the added-cars folders under `<source>/models`. */
function models(...folders: string[]): void {
  for (const folder of folders) {
    mkdirSync(join(source, 'models', folder), { recursive: true });
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'add-vehicles-'));
  game = join(root, 'game');
  source = join(root, 'add-vehicles');
  mkdirSync(join(game, 'data'), { recursive: true });
  mkdirSync(join(source, 'models'), { recursive: true });
  writeFileSync(join(game, 'data', 'vehicles.ide'), VEHICLES_IDE);
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('resolveAddedVehicles', () => {
  describe('negative cases', () => {
    it("refuses any target but sa — the added-car plugins are the real game's", () => {
      models('001veh - vega - alfamodding (manana)');

      expect(() => resolveAddedVehicles(source, game, 'opensa')).toThrow(/'sa' target only/);
    });

    it('refuses a common/ or opensa/ layer in the added root', () => {
      rmSync(join(source, 'models'), { recursive: true });
      mkdirSync(join(source, 'common', 'models', '001veh - vega - alfamodding (manana)'), { recursive: true });
      mkdirSync(join(source, 'sa', 'models'), { recursive: true });

      expect(() => resolveAddedVehicles(source, game)).toThrow(/SA-only feature/);
    });

    it('refuses a folder with no (base) suffix', () => {
      models('001veh - vega - alfamodding');

      expect(() => resolveAddedVehicles(source, game)).toThrow(/no '\(base\)' suffix/);
    });

    it('refuses a base no vehicles.ide row defines, naming the car and the base', () => {
      models('001veh - vega - alfamodding (mananna)');

      expect(() => resolveAddedVehicles(source, game)).toThrow(/001veh - vega - alfamodding.*'mananna'/s);
    });

    it('refuses a stray folder beside the reserved ones, as the fleet resolver does', () => {
      mkdirSync(join(source, 'modelz'), { recursive: true }); // what a misspelled layer looks like

      expect(() => resolveAddedVehicles(source, game)).toThrow(/mixes the reserved vehicle folders/);
    });
  });

  describe('positive cases', () => {
    it('resolves every car with the base it varies', () => {
      models('001veh - vega - alfamodding (manana)', '002veh - volare - viter (stalion)');

      const { sources } = resolveAddedVehicles(source, game);

      expect(sources.map(({ base, slot }) => `${slot}:${base}`)).toEqual(['001veh:manana', '002veh:stalion']);
    });

    it('never scans reserved/ or screenshots/', () => {
      models('001veh - vega - alfamodding (manana)');
      mkdirSync(join(source, 'reserved', 'cabbie - taxi - 533'), { recursive: true });
      mkdirSync(join(source, 'screenshots'), { recursive: true });
      writeFileSync(join(source, 'screenshots', '001veh - vega - alfamodding (manana).jpg'), '');

      expect(resolveAddedVehicles(source, game).sources.map(({ slot }) => slot)).toEqual(['001veh']);
    });

    it('takes a car in new/ over the models/ car of the same slot', () => {
      models('001veh - vega - alfamodding (manana)');
      mkdirSync(join(source, 'new', '001veh - vega v2 - alfamodding (stalion)'), { recursive: true });

      const { plan, sources } = resolveAddedVehicles(source, game);

      expect(sources.map(({ base }) => base)).toEqual(['stalion']);
      expect(plan.overrides).toHaveLength(1);
    });
  });
});

describe('stockSlots', () => {
  describe('positive cases', () => {
    it('is every model the cars section names, lowercased', () => {
      expect([...stockSlots(game)].sort()).toEqual(['manana', 'stalion']);
    });
  });
});

/** The user's real root and the built tree — the only place the 115-folder convention is actually proved. */
const REAL_SOURCE = join(process.cwd(), 'mods-src', 'original', 'add-vehicles');
const REAL_GAME = join(process.cwd(), 'build', 'original', 'sa');
const hasReal = existsSync(join(REAL_SOURCE, 'models')) && existsSync(join(REAL_GAME, 'data', 'vehicles.ide'));

describe.skipIf(!hasReal)('the real added-vehicles root', () => {
  describe('positive cases', () => {
    it('resolves every folder, and every base is a slot the built game defines', () => {
      const { sources } = resolveAddedVehicles(REAL_SOURCE, REAL_GAME);
      const stock = stockSlots(REAL_GAME);

      expect(sources.length).toBeGreaterThan(0);
      expect(sources.filter(({ base }) => !stock.has(base))).toEqual([]);
      expect(sources.filter(({ slot }) => slot.length > 7)).toEqual([]); // a slot is also a GXT key
      expect(sources).toHaveLength(readdirSync(join(REAL_SOURCE, 'models')).length);
    });
  });
});
