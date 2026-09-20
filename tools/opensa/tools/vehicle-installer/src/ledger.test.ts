import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LedgerRow } from './ledger';

import { ADDS_LEDGER, readAddsLedger, readAddsRows, renameAddsRows, writeAddsLedger } from './ledger';

const VEGA: LedgerRow = {
  bases: ['manana'],
  folder: '001veh - vega - alfamodding (manana)',
  id: 19_001,
  kind: 'car',
  slot: '001veh',
};
const EXHAUST: LedgerRow = {
  bases: ['exh_a_l'],
  folder: '118veh - m3 - funky (elegy)',
  id: 19_114,
  kind: 'part',
  slot: 'exh_a_l_118veh',
};
const VOLARE: LedgerRow = {
  bases: ['solair'],
  folder: '002veh - volare - viter (solair)',
  id: 19_002,
  kind: 'car',
  slot: '002veh',
};

let game: string;

const ledgerText = (): string => readFileSync(join(game, ADDS_LEDGER), 'latin1');

beforeEach(() => {
  game = mkdtempSync(join(tmpdir(), 'adds-ledger-'));
  mkdirSync(join(game, 'data'), { recursive: true });
});

afterEach(() => {
  rmSync(game, { force: true, recursive: true });
});

describe('readAddsLedger', () => {
  describe('negative cases', () => {
    it('is empty when nothing has been promised yet', () => {
      expect(readAddsLedger(game).size).toBe(0);
    });

    it('ignores comments and rows with no numeric id', () => {
      writeFileSync(join(game, ADDS_LEDGER), '# a comment\n001veh\tnot-a-number\tmanana\tx\n', 'latin1');

      expect(readAddsLedger(game).size).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('reads back what a run wrote', () => {
      writeAddsLedger(game, [VEGA, VOLARE]);

      expect([...readAddsLedger(game)]).toEqual([
        ['001veh', 19_001],
        ['002veh', 19_002],
      ]);
    });
  });
});

describe('writeAddsLedger', () => {
  describe('positive cases', () => {
    it('keeps the rows of cars this run did not touch — an --only run speaks for its own', () => {
      writeAddsLedger(game, [VEGA, VOLARE]);
      writeAddsLedger(game, [{ ...VEGA, folder: '001veh - vega v2 - alfamodding (manana)' }]);

      expect(readAddsLedger(game).get('002veh')).toBe(19_002);
      expect(ledgerText()).toContain('vega v2');
    });

    it('sorts by slot, so a rebuild writes the same bytes', () => {
      writeAddsLedger(game, [VOLARE, VEGA]);
      const once = ledgerText();
      writeAddsLedger(game, [VEGA, VOLARE]);

      expect(ledgerText()).toBe(once);
      expect(once.trimEnd().split('\n').slice(-2)).toEqual([
        '001veh\t19001\tcar\tmanana\t001veh - vega - alfamodding (manana)',
        '002veh\t19002\tcar\tsolair\t002veh - volare - viter (solair)',
      ]);
    });
  });
});

describe('renameAddsRows', () => {
  describe('negative cases', () => {
    it('moves nothing when the ledger does not exist yet', () => {
      expect(renameAddsRows(game, new Map([['exh_a_l_118veh', 'exh_a_l_118']]))).toEqual([]);
    });

    it('leaves the row alone when the new name is already recorded — that row is the newer statement', () => {
      writeAddsLedger(game, [EXHAUST, { ...EXHAUST, id: 19_200, slot: 'exh_a_l_118' }]);

      expect(renameAddsRows(game, new Map([['exh_a_l_118veh', 'exh_a_l_118']]))).toEqual([]);
      expect(readAddsLedger(game).get('exh_a_l_118')).toBe(19_200);
    });
  });

  describe('positive cases', () => {
    it('carries the id, the kind and the source folder to the new name', () => {
      writeAddsLedger(game, [VEGA, EXHAUST]);

      const moved = renameAddsRows(game, new Map([['exh_a_l_118veh', 'exh_a_l_118']]));
      const row = readAddsRows(game).find(({ slot }) => slot === 'exh_a_l_118');

      expect(moved).toHaveLength(1);
      expect(row).toEqual({ ...EXHAUST, slot: 'exh_a_l_118' });
      expect(ledgerText()).not.toContain('exh_a_l_118veh');
      expect(readAddsLedger(game).get('001veh')).toBe(19_001);
    });

    it('is idempotent — a second run finds nothing to move', () => {
      writeAddsLedger(game, [EXHAUST]);
      const renames = new Map([['exh_a_l_118veh', 'exh_a_l_118']]);
      renameAddsRows(game, renames);

      expect(renameAddsRows(game, renames)).toEqual([]);
    });
  });
});
