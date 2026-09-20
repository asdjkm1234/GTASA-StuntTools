import { createImg } from '@opensa/tool-kit/archive/img';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { VEH_MODS_IDE } from './tuning-parts';
import {
  assertUpgradeCollision,
  PARTS_COL,
  upgradeCollisionNames,
  VEH_MODS_COL,
  writeUpgradeCollision,
} from './upgrade-collision';

/** The stock collision library, straight out of `gta3.img` — 194 entries, the whole 1000–1193 block. */
const STOCK_COL = join('fixtures', 'original', 'col', VEH_MODS_COL);
/** A real part model, for the bounds a generated collision model takes. */
const PART_DFF = join('fixtures', 'original', 'dff', 'cutscene', 'bobcat.dff');

let game: string;

/** Put a `models/gta3.img` carrying the real `veh_mods.col` into the tree — the only entry this reads. */
const withStockCol = (): void => {
  const img = createImg();
  img.set(VEH_MODS_COL, new Uint8Array(readFileSync(STOCK_COL)));
  mkdirSync(join(game, 'models'), { recursive: true });
  writeFileSync(join(game, 'models', 'gta3.img'), img.build());
};

const writeIde = (rows: readonly string[]): void => {
  mkdirSync(join(game, 'data', 'maps', 'veh_mods'), { recursive: true });
  writeFileSync(join(game, VEH_MODS_IDE), ['objs', ...rows, 'end', ''].join('\n'), 'latin1');
};

beforeEach(() => {
  game = mkdtempSync(join(tmpdir(), 'upgrade-col-'));
  mkdirSync(join(game, 'data'), { recursive: true });
  writeFileSync(join(game, 'data', 'default.dat'), 'IDE DATA\\MAPS\\x.IDE\r\nCOLFILE 0 MODELS\\COLL\\WEAPONS.COL\r\n');
});

afterEach(() => {
  rmSync(game, { force: true, recursive: true });
});

describe.skipIf(!existsSync(STOCK_COL))('assertUpgradeCollision', () => {
  describe('negative cases', () => {
    it('refuses a part nothing gives collision — the flags it carries make no difference', () => {
      // Field 2026-08-20: 1194 spl_b_lr_bl and 19051 exh_lr_rem1_059 BOTH carried 0x200000 and both died at
      // 0x59F8B4 with a null m_pColModel. Only a collision model answers this.
      writeIde(['1194, spl_b_lr_bl, blade, 100, 2097152']);
      withStockCol();

      expect(() => assertUpgradeCollision(game)).toThrow(/spl_b_lr_bl \(id 1194\)/);
    });

    it('says so rather than passing when the archive carries no collision library at all', () => {
      writeIde(['1194, spl_b_lr_bl, blade, 100, 0']);
      mkdirSync(join(game, 'models'), { recursive: true });
      writeFileSync(join(game, 'models', 'gta3.img'), createImg().build());

      expect(assertUpgradeCollision(game)).toEqual([expect.stringContaining('could not be checked') as string]);
    });
  });

  describe('positive cases', () => {
    it('passes every stock part — each one has an entry of its own', () => {
      writeIde(['1000, spl_b_mar_m, vehicle, 70, 0', '1181, exh_lr_bl2, blade, 100, 0']);
      withStockCol();

      expect(assertUpgradeCollision(game)).toEqual([]);
    });

    it.skipIf(!existsSync(PART_DFF))('passes a new part once its collision has been written', () => {
      writeIde(['19051, exh_lr_rem1_059, 059veh, 100, 0']);
      withStockCol();
      writeUpgradeCollision(game, [{ dff: PART_DFF, name: 'exh_lr_rem1_059' }]);

      expect(assertUpgradeCollision(game)).toEqual([]);
    });
  });
});

describe.skipIf(!existsSync(PART_DFF))('writeUpgradeCollision', () => {
  describe('positive cases', () => {
    it('writes one 120-byte COL3 model per part, with the bounds of its own geometry', () => {
      writeUpgradeCollision(game, [{ dff: PART_DFF, name: 'exh_lr_rem1_059' }]);

      const bytes = new Uint8Array(readFileSync(join(game, PARTS_COL)));
      const view = new DataView(bytes.buffer);
      expect(bytes.length).toBe(120);
      expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('COL3');
      expect(view.getUint32(4, true)).toBe(112); // the size SA parses the next model from
      expect(String.fromCharCode(...bytes.subarray(8, 30)).replace(/\0.*$/, '')).toBe('exh_lr_rem1_059');
      expect(view.getFloat32(32, true)).toBeLessThan(0); // min.x — a real model, not a zero box
    });

    it('MERGES over what is already there, so a rebake keeps an earlier run’s parts', () => {
      writeUpgradeCollision(game, [{ dff: PART_DFF, name: 'first_part' }]);
      const names = writeUpgradeCollision(game, [{ dff: PART_DFF, name: 'second_part' }]);

      expect(names).toEqual(['first_part', 'second_part']);
    });

    it('registers the file in default.dat once, after the COLFILE lines already there', () => {
      writeUpgradeCollision(game, [{ dff: PART_DFF, name: 'first_part' }]);
      writeUpgradeCollision(game, [{ dff: PART_DFF, name: 'second_part' }]);

      const lines = readFileSync(join(game, 'data', 'default.dat'), 'latin1').split(/\r?\n/);
      expect(lines.filter((line) => /OPENSA-PARTS\.COL/i.test(line))).toHaveLength(1);
      expect(lines[lines.indexOf('COLFILE 0 MODELS\\COLL\\WEAPONS.COL') + 1]).toBe(
        'COLFILE 0 MODELS\\COLL\\OPENSA-PARTS.COL',
      );
    });
  });
});

describe.skipIf(!existsSync(STOCK_COL))('upgradeCollisionNames', () => {
  describe('positive cases', () => {
    it('is the whole stock upgrade block and nothing else', () => {
      withStockCol();
      const names = upgradeCollisionNames(game);

      expect(names?.size).toBe(194);
      expect(names?.has('exh_lr_bl2')).toBe(true);
    });
  });
});
