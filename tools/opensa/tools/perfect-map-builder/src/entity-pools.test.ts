import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkEntityPoolBudgets, countEntityPoolSpend, olaEntityPools } from './entity-pools';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'entity-pools-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** The install's OLA ini declares Buildings/Dummys in THREE sections, and ships with CRLF endings. */
function ola(salimits: string, others = true): void {
  const blocks = [
    '; See explanation of limits at the end of the file',
    '',
    '[SALIMITS]',
    salimits,
    ...(others ? ['', '[VCLIMITS]', 'Buildings = 300000', 'Dummys = 30000'] : []),
    ...(others ? ['', '[GTA3LIMITS]', 'Buildings = 100000', 'Dummys = 30000'] : []),
    '',
    '[OPTIONS]',
    'DebugTextKey = 0x74',
  ];
  writeFileSync(join(dir, 'III.VC.SA.LimitAdjuster.ini'), blocks.join('\r\n'));
}

/** A tree with one text IPL: `props` rows name a model that `object.dat` tunes, `walls` rows do not. */
function tree(props: number, walls: number): void {
  mkdirSync(join(dir, 'data', 'maps'), { recursive: true });
  writeFileSync(join(dir, 'data', 'gta.dat'), 'IPL DATA\\MAPS\\one.ipl\n');
  const rows = [
    ...Array.from({ length: props }, (_, i) => `1, lamppost3, 0, ${i}.0, 0.0, 0.0, 0, 0, 0, 1, -1`),
    ...Array.from({ length: walls }, (_, i) => `2, wall01, 0, ${i}.0, 0.0, 0.0, 0, 0, 0, 1, -1`),
  ];
  writeFileSync(join(dir, 'data', 'maps', 'one.ipl'), ['inst', ...rows, 'end'].join('\n'));
  // The name carries a trailing comma in the real file, which is exactly how a hand-rolled reader loses it.
  writeFileSync(
    join(dir, 'data', 'object.dat'),
    'lamppost3,\t700.0,\t6000.0\t0.99,\t0.05,\t50.0,\t240.0,\t1.0,\t200,\t1,\t0,\t0,\t0,\t0.0, 0.0, 0.0,\tnone\n',
  );
}

describe('olaEntityPools', () => {
  describe('negative cases', () => {
    it('falls back to the stock pools when the tree ships no adjuster ini, and says so', () => {
      expect(olaEntityPools(dir)).toEqual({
        // `configured` false is what keeps the first-entry floor off a tree that ships no adjuster at all.
        configured: false,
        pools: { Buildings: 13_000, Dummys: 2_500 },
        source: 'no III.VC.SA.LimitAdjuster*.ini in the tree, so OLA defaults',
      });
    });

    it('falls back when the ini has no [SALIMITS] section', () => {
      writeFileSync(join(dir, 'III.VC.SA.LimitAdjuster.ini'), '[VCLIMITS]\r\nBuildings = 300000\r\n');

      expect(olaEntityPools(dir).pools).toEqual({ Buildings: 13_000, Dummys: 2_500 });
    });

    it('reads the SA block, never the Vice City one that declares the same keys larger', () => {
      ola('Buildings = 150000\r\nDummys = 50000');

      // [VCLIMITS] says 300000/30000 — reading those would report headroom the install does not have.
      expect(olaEntityPools(dir).pools).toEqual({ Buildings: 150_000, Dummys: 50_000 });
    });
  });

  describe('positive cases', () => {
    it('reads the raised pools out of the ini the build ships', () => {
      ola('Buildings = 150000\r\nDummys = 100000');

      expect(olaEntityPools(dir)).toEqual({
        configured: true,
        pools: { Buildings: 150_000, Dummys: 100_000 },
        source: 'III.VC.SA.LimitAdjuster.ini [SALIMITS]',
      });
    });

    it('takes `unlimited` for what it says', () => {
      ola('Buildings = unlimited\r\nDummys = 50000');

      expect(olaEntityPools(dir).pools.Buildings).toBe(Infinity);
    });
  });
});

describe('countEntityPoolSpend', () => {
  describe('negative cases', () => {
    it('counts nothing for a tree with no gta.dat', () => {
      expect(countEntityPoolSpend(dir)).toEqual({
        binary: { buildings: 0, dummies: 0 },
        permanent: { buildings: 0, dummies: 0 },
      });
    });
  });

  describe('positive cases', () => {
    it('splits rows the way the game does — an object.dat model is a dummy, everything else a building', () => {
      tree(7, 11);

      expect(countEntityPoolSpend(dir).permanent).toEqual({ buildings: 11, dummies: 7 });
    });
  });
});

describe('checkEntityPoolBudgets', () => {
  describe('negative cases', () => {
    it('fails the build when the PERMANENT rows alone outgrow the pool the install will run', () => {
      tree(3, 40);
      ola('Buildings = 20\r\nDummys = 50000');

      expect(() => checkEntityPoolBudgets(dir)).toThrow(/CPool<CBuilding>: 40 PERMANENT rows against 20/);
    });

    it('names the ini it read the ceiling from, so a stale one is visible', () => {
      tree(3, 40);
      ola('Buildings = 20\r\nDummys = 50000');

      expect(() => checkEntityPoolBudgets(dir)).toThrow(/III\.VC\.SA\.LimitAdjuster\.ini \[SALIMITS\]/);
    });
  });

  describe('positive cases', () => {
    it('passes when the permanent rows fit, whatever the streamed peak would be', () => {
      tree(3, 40);
      ola('Buildings = 150000\r\nDummys = 50000');

      expect(checkEntityPoolBudgets(dir).permanent).toEqual({ buildings: 40, dummies: 3 });
    });
  });
});

describe('the dummy pool floor', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pmb-dummy-floor-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  const ship = (dummys: string): void => {
    writeFileSync(join(dir, 'III.VC.SA.LimitAdjuster.ini'), `[SALIMITS]\r\nBuildings = 150000\r\n${dummys}\r\n`);
  };

  describe('negative cases', () => {
    it("refuses a pool under the FIRST entry's measured peak — no row count can see that one", () => {
      ship('Dummys = 40000');

      expect(() => checkEntityPoolBudgets(dir)).toThrow(/Dummys = 40000 against a measured peak of 49151/);
    });
  });

  describe('positive cases', () => {
    it('passes the recorded 100 000, and passes a tree that ships no adjuster at all', () => {
      ship('Dummys = 100000');
      expect(() => checkEntityPoolBudgets(dir)).not.toThrow();

      rmSync(join(dir, 'III.VC.SA.LimitAdjuster.ini'));
      expect(() => checkEntityPoolBudgets(dir)).not.toThrow();
    });
  });
});
