import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ADDED_ID_WINDOW, allocateIds, MOD_PART_ID_WINDOW, usedModelIds } from './free-ids';

const WINDOW = { first: 100, last: 104 };

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'free-ids-'));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('allocateIds', () => {
  describe('negative cases', () => {
    it('refuses a window with fewer free ids than slots', () => {
      expect(() =>
        allocateIds({ slots: ['a', 'b', 'c'], used: new Set([100, 101, 102, 103]), window: WINDOW }),
      ).toThrow(/window is exhausted/);
    });

    it('refuses a ledger id outside the window — nothing here can honour it', () => {
      expect(() =>
        allocateIds({ ledger: new Map([['a', 42]]), slots: ['a'], used: new Set(), window: WINDOW }),
      ).toThrow(/outside the 100–104 window/);
    });
  });

  describe('positive cases', () => {
    it('numbers from the window start, in the order given', () => {
      const ids = allocateIds({ slots: ['b', 'a'], used: new Set(), window: WINDOW });

      expect([...ids]).toEqual([
        ['b', 100],
        ['a', 101],
      ]);
    });

    it('skips ids the tree already uses', () => {
      const ids = allocateIds({ slots: ['a', 'b'], used: new Set([100, 102]), window: WINDOW });

      expect([...ids.values()]).toEqual([101, 103]);
    });

    it('keeps a ledger id whatever the order became, and gives it to nobody else', () => {
      const ids = allocateIds({
        ledger: new Map([['b', 100]]),
        slots: ['a', 'b', 'c'],
        used: new Set([100]),
        window: WINDOW,
      });

      expect(ids.get('b')).toBe(100);
      expect(ids.get('a')).toBe(101);
      expect(ids.get('c')).toBe(102);
    });

    it('is the added-content window by default', () => {
      expect(allocateIds({ slots: ['a'], used: new Set() }).get('a')).toBe(ADDED_ID_WINDOW.first);
    });
  });
});

describe('usedModelIds', () => {
  describe('negative cases', () => {
    it('is empty for a tree with no IDE anywhere', () => {
      expect(usedModelIds(root).size).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('reads every id of every IDE under data/ and modloader/', () => {
      mkdirSync(join(root, 'data', 'maps'), { recursive: true });
      mkdirSync(join(root, 'modloader', 'a mod'), { recursive: true });
      writeFileSync(join(root, 'data', 'vehicles.ide'), 'cars\n410, manana, manana, car\nend\n');
      writeFileSync(join(root, 'data', 'maps', 'x.ide'), 'objs\n1700, chair, chairs, 100, 0\nend\n');
      writeFileSync(join(root, 'modloader', 'a mod', 'y.ide'), 'objs\n19500, thing, thing, 100, 0\nend\n');

      expect([...usedModelIds(root)].sort((a, b) => a - b)).toEqual([410, 1700, 19500]);
    });
  });
});

describe('the two windows', () => {
  describe('positive cases', () => {
    it("do not overlap, and a replacement car's parts sit ABOVE the added fleet", () => {
      expect(ADDED_ID_WINDOW.last).toBeLessThan(MOD_PART_ID_WINDOW.first);
      // The reason they are split: a fleet allocated from the bottom must not move when the number of parts
      // a mod borrows changes, and vehicle-installer runs several stages before add-vehicles.
      expect(allocateIds({ slots: ['part'], used: new Set(), window: MOD_PART_ID_WINDOW }).get('part')).toBe(19_800);
      expect(allocateIds({ slots: ['001veh'], used: new Set([19_800]) }).get('001veh')).toBe(19_001);
    });
  });
});
