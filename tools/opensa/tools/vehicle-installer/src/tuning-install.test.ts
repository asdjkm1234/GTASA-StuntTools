import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DerivedTuning } from './tuning-derive';

import { installDerivedTuning } from './tuning-install';
import { VEH_MODS_IDE } from './tuning-parts';

/** The three files a derived part is written across, cut to what these tests key on. */
const VEH_MODS = ['objs', '1181, exh_lr_bl2, blade, 100, 2097152', 'end', ''].join('\n');
const CARMODS = ['link', 'wg_l_lr_bl1, wg_r_lr_bl1', 'end', '', 'mods', 'blade, exh_lr_bl2', 'end', ''].join('\n');
const SHOPPING = [
  'section prices',
  '\tsection CarMods',
  '\t\texh_lr_bl2\t\tEXHBL2\t\trespect 0 \tsexy 0\t\t500',
  '\tend',
  'end',
  'section shops',
  '\tsection carmod2',
  '\t\titem exh_lr_bl2',
  '\tend',
  'end',
  '',
].join('\n');

/** One part, cloned from `exh_lr_bl2` — the shape `deriveTuning` hands over. */
const DERIVED: DerivedTuning = {
  links: [],
  renames: new Map([['exh_lr_bl2.dff', 'exh_lr_bl2_voo.dff']]),
  rows: [{ from: 'exh_lr_bl2', name: 'exh_lr_bl2_voo', row: '<:id>, exh_lr_bl2_voo, voodoo, 100, 2097152' }],
  shop: [
    {
      after: 'exh_lr_bl2',
      item: 'exh_lr_bl2_voo',
      price: 'exh_lr_bl2_voo\tEXHBL2\trespect 0\tsexy 0\t500',
      section: 'carmod2',
    },
  ],
  warnings: [],
};

let game: string;

const install = (
  ids: ReadonlyMap<string, number>,
  derived: DerivedTuning = DERIVED,
): ReturnType<typeof installDerivedTuning> =>
  installDerivedTuning({ derived, gameDir: game, ids, source: 'voodoo - 1960 Chevrolet Impala - chezy' });

const read = (path: string): string => readFileSync(join(game, path), 'latin1');

beforeEach(() => {
  game = mkdtempSync(join(tmpdir(), 'tuning-install-'));
  mkdirSync(join(game, 'data', 'maps', 'veh_mods'), { recursive: true });
  writeFileSync(join(game, VEH_MODS_IDE), VEH_MODS, 'latin1');
  writeFileSync(join(game, 'data', 'carmods.dat'), CARMODS, 'latin1');
  writeFileSync(join(game, 'data', 'shopping.dat'), SHOPPING, 'latin1');
});

afterEach(() => {
  rmSync(game, { force: true, recursive: true });
});

describe('installDerivedTuning', () => {
  describe('negative cases', () => {
    it('writes nothing at all when the car derived no part', () => {
      const before = read(VEH_MODS_IDE);

      expect(install(new Map(), { ...DERIVED, rows: [], shop: [] })).toEqual({ rows: [], warnings: [] });
      expect(read(VEH_MODS_IDE)).toBe(before);
    });

    it('reports a part no id was allocated for, and does not write its row', () => {
      const { rows, warnings } = install(new Map());

      expect(rows).toEqual([]);
      expect(warnings[0]).toMatch(/no id was allocated for 'exh_lr_bl2_voo'/);
      expect(read(VEH_MODS_IDE)).not.toContain('exh_lr_bl2_voo');
    });
  });

  describe('positive cases', () => {
    it('writes the IDE row with the allocated id in place of the placeholder', () => {
      install(new Map([['exh_lr_bl2_voo', 19_804]]));

      expect(read(VEH_MODS_IDE)).toContain('19804, exh_lr_bl2_voo, voodoo, 100, 2097152');
    });

    it('clones the shop item and the price straight after the stock part they came from', () => {
      install(new Map([['exh_lr_bl2_voo', 19_804]]));
      const lines = read('data/shopping.dat').split('\n');

      expect(lines[lines.findIndex((line) => line.trim() === 'item exh_lr_bl2') + 1].trim()).toBe(
        'item exh_lr_bl2_voo',
      );
      expect(lines.some((line) => line.trim().startsWith('exh_lr_bl2_voo\t'))).toBe(true);
    });

    it('returns a ledger row per part, naming the stock part it was cloned from — the id is a promise', () => {
      const { rows } = install(new Map([['exh_lr_bl2_voo', 19_804]]));

      expect(rows).toEqual([
        {
          bases: ['exh_lr_bl2'],
          folder: 'voodoo - 1960 Chevrolet Impala - chezy',
          id: 19_804,
          kind: 'part',
          slot: 'exh_lr_bl2_voo',
        },
      ]);
    });

    it('adds a link pair for a part whose mirror was derived too', () => {
      install(new Map([['exh_lr_bl2_voo', 19_804]]), {
        ...DERIVED,
        links: [['wg_l_lr_bl1_voo', 'wg_r_lr_bl1_voo']],
      });

      expect(read('data/carmods.dat')).toContain('wg_l_lr_bl1_voo, wg_r_lr_bl1_voo');
      expect(read('data/carmods.dat')).toContain('wg_l_lr_bl1, wg_r_lr_bl1'); // the stock pair kept
    });

    it('is idempotent — a rebake over the same tree writes the same bytes', () => {
      const ids = new Map([['exh_lr_bl2_voo', 19_804]]);
      install(ids, { ...DERIVED, links: [['wg_l_lr_bl1_voo', 'wg_r_lr_bl1_voo']] });
      const once = [read(VEH_MODS_IDE), read('data/shopping.dat'), read('data/carmods.dat')];
      install(ids, { ...DERIVED, links: [['wg_l_lr_bl1_voo', 'wg_r_lr_bl1_voo']] });

      expect([read(VEH_MODS_IDE), read('data/shopping.dat'), read('data/carmods.dat')]).toEqual(once);
    });
  });
});
