import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyTuningParts, assertCarmodsModels, parseTuningParts, VEH_MODS_IDE } from './tuning-parts';

/** The blade's file, as shipped (2026-08-17) — two new parts, their shop items and prices. */
const BLADE = `1194, spl_b_lr_bl, blade, 100, 0
1195, bnt_b_lr_bl, blade, 100, 0

# In section shops.carmod2 after exh_lr_bl2
shops.carmod2|exh_lr_bl2
item spl_b_lr_bl
item bnt_b_lr_bl
end

# In section prices.CarMods after exh_lr_bl2
prices.CarMods|exh_lr_bl2
spl_b_lr_bl 		SAVST   	respect 0 	sexy 0		1000
bnt_b_lr_bl 		SAVCS   	respect 0 	sexy 0		1540
end
`;

/** `veh_mods.ide` in the stock shape, three rows. */
const VEH_MODS = `objs
1000, spl_b_mar_m, vehicle, 70, 0
1013, lgt_b_rspt, vehicle, 70, 0
1181, exh_lr_bl2, blade, 100, 0
end
anim
end
txdp
end
`;

/** `shopping.dat` in the stock shape — the two nested sections the blocks address, plus a decoy. */
const SHOPPING = `section prices
\tsection CarMods
\t\texh_lr_bl1\t\tBLDE1\t\trespect 0 \tsexy 0\t\t1610
\t\texh_lr_bl2\t\tBLDE2   \trespect 0 \tsexy 0\t\t1540
\t\twg_l_lr_bl1\t\tBLDCS   \trespect 0 \tsexy 0\t\t780
\tend
\tsection Clothes
\tend
end
section shops
\tsection carmod1 # decoy
\t\ttype CarMods
\t\titem exh_lr_bl2
\tend
\tsection carmod2 # Lowriders
\t\ttype CarMods
\t\titem exh_lr_bl1
\t\titem exh_lr_bl2
\t\titem wg_l_lr_bl1
\tend
end
`;

let root: string;
let game: string;
let mod: string;

function apply(): string[] {
  return applyTuningParts(mod, ['tuning_new_parts.txt'], game);
}

function gameDir(carmods = 'mods\nblade, nto_b_l, exh_lr_bl2\nend\n'): string {
  mkdirSync(join(game, 'data', 'maps', 'veh_mods'), { recursive: true });
  writeFileSync(join(game, VEH_MODS_IDE), VEH_MODS);
  writeFileSync(join(game, 'data', 'shopping.dat'), SHOPPING);
  writeFileSync(join(game, 'data', 'carmods.dat'), carmods);
  writeFileSync(
    join(game, 'data', 'vehicles.ide'),
    'cars\n536, blade, blade, car, BLADE, BLADE, null, executive, 3, 0, 0, -1, 0.69, 0.69, 2\nend\n',
  );
  writeFileSync(join(game, 'data', 'default.ide'), 'objs\n1008, nto_b_l, vehicle, 70, 0\nend\n');

  return game;
}

function modFolder(text = BLADE): string {
  mkdirSync(mod, { recursive: true });
  writeFileSync(join(mod, 'tuning_new_parts.txt'), text);

  return mod;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tuning-parts-'));
  game = join(root, 'game');
  mod = join(root, 'blade - 1964 Ford Thunderbird - gross');
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe('parseTuningParts', () => {
  describe('negative cases', () => {
    it('warns about a line that is neither an IDE row nor a block, and about a block with no end', () => {
      const parts = parseTuningParts('hello there\nshops.carmod2|exh_lr_bl2\nitem x\n');

      expect(parts.ideRows).toEqual([]);
      expect(parts.inserts).toEqual([]);
      expect(parts.warnings).toEqual([
        expect.stringContaining('not understood') as string,
        expect.stringContaining("no 'end'") as string,
      ]);
    });
  });

  describe('positive cases', () => {
    it('reads the IDE rows and both blocks of the shipped blade file', () => {
      const parts = parseTuningParts(BLADE);

      expect(parts.warnings).toEqual([]);
      expect(parts.ideRows).toEqual(['1194, spl_b_lr_bl, blade, 100, 0', '1195, bnt_b_lr_bl, blade, 100, 0']);
      expect(parts.inserts.map((insert) => [insert.top, insert.section, insert.after, insert.lines.length])).toEqual([
        ['shops', 'carmod2', 'exh_lr_bl2', 2],
        ['prices', 'CarMods', 'exh_lr_bl2', 2],
      ]);
      expect(parts.inserts[0].lines).toEqual(['item spl_b_lr_bl', 'item bnt_b_lr_bl']);
    });
  });
});

describe('applyTuningParts', () => {
  describe('negative cases', () => {
    it('does nothing for a folder without the file', () => {
      gameDir();

      expect(applyTuningParts(mod, ['blade.dff'], game)).toEqual([]);
    });

    it('refuses an IDE row whose id another model owns, and says whose', () => {
      gameDir();
      modFolder('1013, spl_b_lr_bl, blade, 100, 0\n');

      const warnings = apply();

      expect(warnings).toEqual([expect.stringContaining("id 1013 already belongs to 'lgt_b_rspt'") as string]);
      expect(readFileSync(join(game, VEH_MODS_IDE), 'utf8')).not.toContain('spl_b_lr_bl');
    });

    it('warns and appends at the section end when the anchor line is missing', () => {
      gameDir();
      modFolder('shops.carmod2|nosuchitem\nitem spl_b_lr_bl\nend\n');

      const warnings = apply();

      expect(warnings).toEqual([expect.stringContaining("no line 'nosuchitem'") as string]);
      const lines = readFileSync(join(game, 'data', 'shopping.dat'), 'utf8').split('\n');
      const at = lines.findIndex((line) => line.trim() === 'item spl_b_lr_bl');
      expect(lines[at - 1].trim()).toBe('item wg_l_lr_bl1');
      expect(lines[at + 1].trim()).toBe('end');
    });

    it('warns when the nested section does not exist, and writes nothing', () => {
      gameDir();
      modFolder('shops.carmod9|exh_lr_bl2\nitem spl_b_lr_bl\nend\n');
      const before = readFileSync(join(game, 'data', 'shopping.dat'), 'utf8');

      expect(apply()).toEqual([expect.stringContaining('no section shops → carmod9') as string]);
      expect(readFileSync(join(game, 'data', 'shopping.dat'), 'utf8')).toBe(before);
    });
  });

  describe('positive cases', () => {
    it('adds the IDE rows before objs/end, the items after their anchor in the RIGHT section, the prices likewise', () => {
      gameDir();
      modFolder();

      expect(apply()).toEqual([]);

      const ide = readFileSync(join(game, VEH_MODS_IDE), 'utf8').split('\n');
      expect(ide.slice(0, 7)).toEqual([
        'objs',
        '1000, spl_b_mar_m, vehicle, 70, 0',
        '1013, lgt_b_rspt, vehicle, 70, 0',
        '1181, exh_lr_bl2, blade, 100, 0',
        // Written exactly as the author wrote them. A row for a part with no `veh_mods.col` entry once had
        // `0x200000` forced into it here, on a reading the field disproved — see upgrade-collision.ts.
        '1194, spl_b_lr_bl, blade, 100, 0',
        '1195, bnt_b_lr_bl, blade, 100, 0',
        'end',
      ]);
      const shop = readFileSync(join(game, 'data', 'shopping.dat'), 'utf8').split('\n');
      const decoy = shop.findIndex((line) => line.includes('carmod1'));
      const real = shop.findIndex((line) => line.includes('carmod2'));
      // The decoy section also holds the anchor — nothing landed there.
      expect(shop.slice(decoy, real).some((line) => line.includes('spl_b_lr_bl'))).toBe(false);
      const anchor = shop.findIndex((line, at) => at > real && line.trim() === 'item exh_lr_bl2');
      expect(shop[anchor + 1]).toBe('\t\titem spl_b_lr_bl');
      expect(shop[anchor + 2]).toBe('\t\titem bnt_b_lr_bl');
      expect(shop[anchor + 3].trim()).toBe('item wg_l_lr_bl1');
      const price = shop.findIndex((line) => line.trim().startsWith('exh_lr_bl2'));
      expect(shop[price + 1].trim().split(/\s+/)[0]).toBe('spl_b_lr_bl');
      expect(shop[price + 2].trim().split(/\s+/)[0]).toBe('bnt_b_lr_bl');
    });

    it('is idempotent — a second application changes neither file', () => {
      gameDir();
      modFolder();
      apply();
      const ide = readFileSync(join(game, VEH_MODS_IDE), 'utf8');
      const shop = readFileSync(join(game, 'data', 'shopping.dat'), 'utf8');

      expect(apply()).toEqual([]);

      expect(readFileSync(join(game, VEH_MODS_IDE), 'utf8')).toBe(ide);
      expect(readFileSync(join(game, 'data', 'shopping.dat'), 'utf8')).toBe(shop);
    });
  });
});

describe('assertCarmodsModels', () => {
  describe('negative cases', () => {
    it('throws naming the line and the token when carmods names a model no IDE row defines', () => {
      gameDir('mods\nblade, nto_b_l, exh_lr_bl2, spl_b_lr_bl\nend\nwheel\n1, wheel_gn1\nend\n');

      expect(() => assertCarmodsModels(game)).toThrow(
        /line 2 \(mods\): 'spl_b_lr_bl'.*\n.*line 5 \(wheel\): 'wheel_gn1'/,
      );
    });
  });

  describe('positive cases', () => {
    it('passes once the mod’s tuning parts have supplied the rows', () => {
      gameDir('mods\nblade, nto_b_l, exh_lr_bl2, spl_b_lr_bl, bnt_b_lr_bl\nend\n');
      modFolder();
      apply();

      expect(() => assertCarmodsModels(game)).not.toThrow();
    });

    it('does not judge a tree that has no veh_mods.ide — a data fixture, not a bootable game', () => {
      mkdirSync(join(game, 'data'), { recursive: true });
      writeFileSync(join(game, 'data', 'carmods.dat'), 'mods\nblade, nosuchpart\nend\n');

      expect(() => assertCarmodsModels(game)).not.toThrow();
    });
  });
});
