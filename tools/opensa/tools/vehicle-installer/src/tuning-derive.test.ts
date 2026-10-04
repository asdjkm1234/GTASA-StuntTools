import { parseCarmods } from '@opensa/renderware/parsers/text/carmods.parser';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DerivedTuning } from './tuning-derive';

import {
  deriveTuning,
  MAX_PART_NAME,
  MIN_SLOT_TOKEN,
  readStockParts,
  shippedParts,
  slotTokens,
  vehicleSlots,
} from './tuning-derive';

/** `veh_mods.ide` cut to the rows these tests key on: two mirrored wings, an exhaust, and a generic nitro. */
const VEH_MODS = `objs
1008, nto_b_l, vehicle, 70, 0
1101, wg_r_lr_rem1, remingtn, 100, 2097152
1122, wg_l_lr_rem1, remingtn, 100, 2097152
1126, exh_lr_rem1, remingtn, 100, 2097152
1100, misc_c_lr_rem1, remingtn, 100, 2097152
1130, exh_lr_bl1, blade, 100, 2097152
end
`;

const CARMODS = `link
wg_l_lr_rem1, wg_r_lr_rem1
end

mods
remingtn, exh_lr_rem1, misc_c_lr_rem1, nto_b_l, wg_l_lr_rem1
059veh, exh_lr_rem1, misc_c_lr_rem1, nto_b_l, wg_l_lr_rem1
end
`;

const SHOPPING = `section prices
\tsection CarMods
\t\texh_lr_rem1\t\tREME1\t\trespect 0 \tsexy 0\t\t3340
\tend
end
section shops
\tsection carmod2
\t\titem exh_lr_rem1
\tend
end
`;

/** The stock roster, from the fixture manifest — 212 slots, the table both callers really tokenise. */
const STOCK_IDE = 'fixtures/original/data/vehicles.ide';
const STOCK_CARMODS = 'fixtures/original/data/carmods.dat';

let root: string;
let game: string;
/** Trees the stock-fixture cases make, removed together after them. */
const trees: string[] = [];

const derive = (slot: string, shipped: string[]): DerivedTuning =>
  deriveTuning({ base: 'remingtn', gameDir: game, shipped, slot, token: slot });

/** A REPLACEMENT car: it IS the slot it varies, which is what 014 added to this module. */
const replace = (slot: string, shipped: string[]): DerivedTuning =>
  deriveTuning({ base: slot, gameDir: game, shipped, slot, token: 'tok' });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'added-tuning-'));
  game = join(root, 'game');
  mkdirSync(join(game, 'data', 'maps', 'veh_mods'), { recursive: true });
  writeFileSync(join(game, 'data', 'maps', 'veh_mods', 'veh_mods.ide'), VEH_MODS);
  writeFileSync(join(game, 'data', 'carmods.dat'), CARMODS);
  writeFileSync(join(game, 'data', 'shopping.dat'), SHOPPING);
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
  trees.splice(0).forEach((tree) => rmSync(tree, { force: true, recursive: true }));
});

describe('readStockParts', () => {
  describe('positive cases', () => {
    it('keeps the txd column, which is what says whether a part belongs to one car', () => {
      const parts = readStockParts(game);

      expect(parts.get('nto_b_l')?.txd).toBe('vehicle');
      expect(parts.get('exh_lr_rem1')?.txd).toBe('remingtn');
      expect(parts.get('exh_lr_rem1')?.columns).toBe('100, 2097152');
    });
  });
});

describe('shippedParts', () => {
  describe('positive cases', () => {
    it('is every dff that is not the car itself', () => {
      const folder = join(root, 'car');
      mkdirSync(folder);
      for (const file of ['059veh.dff', '059veh.txd', 'exh_lr_rem1.dff']) {
        writeFileSync(join(folder, file), '');
      }

      expect(shippedParts(folder, '059veh')).toEqual(['exh_lr_rem1.dff']);
    });
  });
});

describe('deriveTuning', () => {
  describe('negative cases', () => {
    it('refuses a derived name past the part-name ceiling, and does not install it', () => {
      const long = 'a'.repeat(MAX_PART_NAME);
      writeFileSync(
        join(game, 'data', 'maps', 'veh_mods', 'veh_mods.ide'),
        `objs\n1200, ${long}, remingtn, 100, 0\nend\n`,
      );
      const derived = derive('059veh', [`${long}.dff`]);

      expect(derived.rows).toEqual([]);
      expect(derived.renames.size).toBe(0);
      expect(derived.warnings[0]).toMatch(/characters and a part name may be 19/);
    });

    it('reports a part no veh_mods row defines and leaves it under its own name', () => {
      const derived = derive('059veh', ['whatever.dff']);

      expect(derived.renames.size).toBe(0);
      expect(derived.warnings[0]).toMatch(/is not a part any veh_mods\.ide row defines/);
    });

    it('reports one side of a mirrored pair shipped without the other', () => {
      const derived = derive('059veh', ['wg_l_lr_rem1.dff']);

      expect(derived.links).toEqual([]);
      expect(derived.warnings.some((warning) => /has no mirror/.test(warning))).toBe(true);
    });

    it('reports a generic part and does not rename it — every car in the game wears that one', () => {
      const derived = replace('remingtn', ['nto_b_l.dff']);

      expect(derived.renames.size).toBe(0);
      expect(derived.warnings[0]).toMatch(/every car wears/);
    });

    it("reports the base's own parts the car names but does not re-model", () => {
      const derived = derive('059veh', ['exh_lr_rem1.dff']);

      expect(derived.warnings.some((warning) => /does not re-model \(misc_c_lr_rem1/.test(warning))).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('leaves a replacement car its OWN parts under their own names — that is what replacing means', () => {
      const derived = replace('remingtn', ['exh_lr_rem1.dff', 'wg_r_lr_rem1.dff']);

      expect(derived.renames.size).toBe(0);
      expect(derived.rows).toEqual([]);
      expect(derived.warnings).toEqual([]);
    });

    it("derives the part that belongs to ANOTHER car, whatever the shipping car's own line says", () => {
      const derived = replace('remingtn', ['exh_lr_bl1.dff']);

      expect([...derived.renames]).toEqual([['exh_lr_bl1.dff', 'exh_lr_bl1_tok.dff']]);
      // Cloned from blade's row, but textured by the car that ships it.
      expect(derived.rows).toEqual([
        { from: 'exh_lr_bl1', name: 'exh_lr_bl1_tok', row: '<:id>, exh_lr_bl1_tok, remingtn, 100, 2097152' },
      ]);
    });

    it('renames each part to the stock name plus its slot, keeping the whole prefix', () => {
      const derived = derive('059veh', ['exh_lr_rem1.dff']);

      expect([...derived.renames]).toEqual([['exh_lr_rem1.dff', 'exh_lr_rem1_059veh.dff']]);
    });

    it("clones the IDE row with the ADDED car's txd and the stock trailing columns", () => {
      const derived = derive('059veh', ['exh_lr_rem1.dff']);

      expect(derived.rows).toEqual([
        { from: 'exh_lr_rem1', name: 'exh_lr_rem1_059veh', row: '<:id>, exh_lr_rem1_059veh, 059veh, 100, 2097152' },
      ]);
    });

    it('clones the shop item and the price, in the section the stock part is sold in', () => {
      const [shop] = derive('059veh', ['exh_lr_rem1.dff']).shop;

      expect(shop.section).toBe('carmod2');
      expect(shop.item).toBe('exh_lr_rem1_059veh');
      expect(shop.price).toContain('exh_lr_rem1_059veh');
      expect(shop.price).toContain('REME1'); // the stock part's own GXT key: it is the same part re-modelled
    });

    it('links a pair whose two sides are both re-modelled', () => {
      const derived = derive('059veh', ['wg_l_lr_rem1.dff', 'wg_r_lr_rem1.dff']);

      expect(derived.links).toEqual([['wg_l_lr_rem1_059veh', 'wg_r_lr_rem1_059veh']]);
    });

    it('gives a mirrored part no shop entry of its own — it is bought through its partner', () => {
      const derived = derive('059veh', ['wg_r_lr_rem1.dff']);

      expect(derived.shop).toEqual([]);
      expect(derived.rows).toHaveLength(1);
    });
  });
});

describe('slotTokens', () => {
  describe('negative cases', () => {
    it('gives a slot whose whole name is another slot prefix its full name, and the longer one more', () => {
      const tokens = slotTokens(['bus', 'bussy', 'taxi']);

      expect(tokens.get('bus')).toBe('bus');
      expect(tokens.get('bussy')).toBe('buss');
    });
  });

  describe('positive cases', () => {
    it('is the shortest prefix that is not another slot prefix, never below the floor', () => {
      const tokens = slotTokens(['voodoo', 'slamvan', 'blade', 'bl']);

      expect(tokens.get('voodoo')).toBe('voo');
      expect(tokens.get('slamvan')).toBe('sla');
      expect(tokens.get('blade')).toBe('bla');
      expect(tokens.get('bl')).toBe('bl'); // shorter than the floor and already unique
      expect(MIN_SLOT_TOKEN).toBe(3);
    });

    it('reaches past a shared prefix as far as the family needs', () => {
      const tokens = slotTokens(['copcarla', 'copcarsf', 'copcarvg', 'copcarru']);

      expect(tokens.get('copcarla')).toBe('copcarl');
      expect(new Set([...tokens.values()]).size).toBe(4);
    });
  });
});

describe.skipIf(!existsSync(STOCK_IDE) || !existsSync(STOCK_CARMODS))('slotTokens (the real stock tables)', () => {
  /** The fixtures read the way the tool reads a built tree — through `vehicleSlots`, boats included. */
  const stockTree = (): string => {
    const tree = mkdtempSync(join(tmpdir(), 'stock-ide-'));
    mkdirSync(join(tree, 'data'));
    cpSync(STOCK_IDE, join(tree, 'data', 'vehicles.ide'));
    cpSync(STOCK_CARMODS, join(tree, 'data', 'carmods.dat'));
    trees.push(tree);

    return tree;
  };

  describe('positive cases', () => {
    it('tells all 212 slots apart, boats included', () => {
      const slots = vehicleSlots(stockTree());

      expect(slots).toHaveLength(212);
      expect(new Set(slotTokens(slots).values()).size).toBe(212);
    });

    it('keeps every part a stock car can wear under the ceiling, where the slot name did not', () => {
      const tree = stockTree();
      const tokens = slotTokens(vehicleSlots(tree));
      const { mods } = parseCarmods(readFileSync(join(tree, 'data', 'carmods.dat'), 'latin1'));
      const derived = [...mods].flatMap(([slot, parts]) => parts.map((part) => `${part}_${tokens.get(slot)}`));
      const longest = derived.reduce((a, b) => (b.length > a.length ? b : a));
      const bySlot = [...mods].flatMap(([slot, parts]) => parts.map((part) => `${part}_${slot}`));

      expect(longest.length).toBeLessThanOrEqual(MAX_PART_NAME);
      // What the scheme replaced: the whole slot name overflows on this very data.
      expect(bySlot.some((name) => name.length > MAX_PART_NAME)).toBe(true);
    });
  });
});
