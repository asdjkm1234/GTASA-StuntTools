import { frameOrderReport } from '@opensa/renderware/parsers/binary/frame-order';
import { createImg, openImg, writeImgFile } from '@opensa/tool-kit/archive/img';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pruneReplacedSlotTextures, sharedVehicleFiles, stageVehicleImg, vehicleCohortKey } from './img-merge';

/** The blade mod's right side skirt, whose export declares frame 0's parent as frame 1. */
const FORWARD_PARENT_DFF = join(process.cwd(), 'fixtures', 'custom', 'dff', 'wg_r_lr_bl1-forward-parent.dff');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vehicle-img-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** A vehicle folder with the given files, plus a settings file that must be ignored by the IMG merge. */
function vehicleFolder(files: Record<string, Uint8Array>): string {
  const folder = mkdtempSync(join(dir, 'alpha-'));
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(join(folder, name), bytes);
  }
  writeFileSync(join(folder, 'alpha.settings.txt'), 'not an asset');

  return folder;
}

describe('stageVehicleImg', () => {
  describe('negative cases', () => {
    it('returns no names and skips a folder with no dff/txd', () => {
      const folder = mkdtempSync(join(dir, 'empty-'));
      writeFileSync(join(folder, 'readme.txt'), 'x');
      expect(stageVehicleImg(folder, createImg())).toEqual({ names: [], repaired: [] });
    });

    it.skipIf(!existsSync(FORWARD_PARENT_DFF))('reports no repair for a dff whose frame list is ordered', () => {
      const ordered = readFileSync(join(process.cwd(), 'fixtures', 'custom', 'dff', 'wg_l_lr_bl1-ordered.dff'));
      const folder = vehicleFolder({ 'alpha.dff': ordered });
      const img = createImg();

      expect(stageVehicleImg(folder, img).repaired).toEqual([]);
      // Staged by PATH, byte for byte — a healthy mod file is never rewritten.
      expect(img.get('alpha.dff')).toEqual(new Uint8Array(ordered));
    });

    it('stages WITHOUT writing — the caller owns the archive and writes it once', () => {
      // The whole point of the batch fix: one rebuild per run, not one per car. A stage that wrote would put
      // the 2 GiB ceiling back on every car.
      const imgPath = join(dir, 'gta3.img');
      const img = createImg();

      stageVehicleImg(vehicleFolder({ 'alpha.dff': Uint8Array.of(1) }), img);

      expect(img.has('alpha.dff')).toBe(true);
      expect(() => readFileSync(imgPath)).toThrow(); // nothing on disk yet
    });
  });

  describe('positive cases', () => {
    it.skipIf(!existsSync(FORWARD_PARENT_DFF))(
      'reorders a dff whose frame list names a parent after its child, and says so',
      () => {
        const broken = readFileSync(FORWARD_PARENT_DFF);
        const folder = vehicleFolder({ 'alpha.dff': broken });
        const img = createImg();

        expect(stageVehicleImg(folder, img).repaired).toEqual(['alpha.dff']);

        // What reaches the archive is the ordered file, not what the folder holds — the real game reads
        // this one, and the mod's own copy is left as its author shipped it.
        const staged = img.get('alpha.dff') as Uint8Array;
        const asBuffer = new Uint8Array(staged).buffer;
        expect(frameOrderReport(asBuffer).forward).toEqual([]);
        expect(staged.byteLength).toBe(broken.byteLength);
      },
    );

    it('stages the dff + every txd (incl. extra numbered ones), ignoring the settings file', () => {
      const folder = vehicleFolder({
        'alpha1.txd': Uint8Array.of(3),
        'alpha2.txd': Uint8Array.of(4),
        'alpha.dff': Uint8Array.of(1),
        'alpha.txd': Uint8Array.of(2),
      });
      const imgPath = join(dir, 'gta3.img');
      const staged = createImg();

      expect(stageVehicleImg(folder, staged).names.sort()).toEqual([
        'alpha.dff',
        'alpha.txd',
        'alpha1.txd',
        'alpha2.txd',
      ]);
      writeImgFile(staged, imgPath);

      const img = openImg(new Uint8Array(readFileSync(imgPath)));
      expect(img.has('alpha.dff')).toBe(true);
      expect(img.has('alpha.txd')).toBe(true);
      expect(img.has('alpha1.txd')).toBe(true);
      expect(img.has('alpha2.txd')).toBe(true);
      expect(img.has('alpha.settings.txt')).toBe(false);
    });

    it('replaces an existing entry by name, keeping the others', () => {
      const imgPath = join(dir, 'gta3.img');
      const base = createImg();
      base.set('alpha.dff', Uint8Array.of(9)); // stock
      base.set('stock.dff', Uint8Array.of(7));
      writeFileSync(imgPath, base.build());

      const staged = openImg(new Uint8Array(readFileSync(imgPath)));
      stageVehicleImg(vehicleFolder({ 'alpha.dff': Uint8Array.of(1) }), staged);
      writeImgFile(staged, imgPath);

      const img = openImg(new Uint8Array(readFileSync(imgPath)));
      expect(new Uint8Array(img.get('alpha.dff')!)[0]).toBe(1); // overridden (VER2 pads the rest of the sector)
      expect(img.has('stock.dff')).toBe(true); // preserved
    });

    it('reads a staged file only when the write pulls it — the mod set stays on disk', () => {
      // Staging N cars must cost N paths, not N buffers: the fix would otherwise trade 212 archive rewrites
      // for 3 GB of resident vehicle bytes.
      const folder = vehicleFolder({ 'alpha.dff': Uint8Array.of(1) });
      const img = createImg();
      stageVehicleImg(folder, img);
      writeFileSync(join(folder, 'alpha.dff'), Uint8Array.of(42)); // changed AFTER staging

      expect(new Uint8Array(img.get('alpha.dff')!)[0]).toBe(42);
    });
  });
});

describe('sharedVehicleFiles', () => {
  describe('negative cases', () => {
    it('reports nothing when every folder ships its own names, whatever the case', () => {
      const a = vehicleFolder({ 'alpha.dff': Uint8Array.of(1), 'Alpha.txd': Uint8Array.of(2) });
      const b = vehicleFolder({ 'beta.dff': Uint8Array.of(1), 'beta.txd': Uint8Array.of(2) });

      expect(
        sharedVehicleFiles([
          { folder: a, name: 'a' },
          { folder: b, name: 'b' },
        ]).size,
      ).toBe(0);
    });

    it('ignores the settings file and anything that is not a dff/txd', () => {
      const a = vehicleFolder({ 'readme.txt': Uint8Array.of(1) });
      const b = vehicleFolder({ 'readme.txt': Uint8Array.of(1) });

      expect(
        sharedVehicleFiles([
          { folder: a, name: 'a' },
          { folder: b, name: 'b' },
        ]).size,
      ).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('names a part two folders ship, owners in install order with their sizes, case-insensitively', () => {
      // The voodoo re-uses the blade's `rbmp_lr_bl1` slot with its own geometry (2026-08-17).
      const blade = vehicleFolder({ 'blade.dff': Uint8Array.of(1), 'rbmp_lr_bl1.dff': Uint8Array.of(2) });
      const voodoo = vehicleFolder({ 'RBMP_LR_BL1.dff': Uint8Array.of(3, 3), 'voodoo.dff': Uint8Array.of(1) });

      const shared = sharedVehicleFiles([
        { folder: blade, name: 'blade - x' },
        { folder: voodoo, name: 'voodoo - y' },
      ]);

      expect([...shared]).toEqual([
        [
          'rbmp_lr_bl1.dff',
          [
            { name: 'blade - x', size: 1 },
            { name: 'voodoo - y', size: 2 },
          ],
        ],
      ]);
    });

    it('asks about the entry a file is STAGED under, so a renamed part no longer collides (014)', () => {
      const blade = vehicleFolder({ 'blade.dff': Uint8Array.of(1), 'rbmp_lr_bl1.dff': Uint8Array.of(2) });
      const voodoo = vehicleFolder({ 'rbmp_lr_bl1.dff': Uint8Array.of(3, 3), 'voodoo.dff': Uint8Array.of(1) });

      const shared = sharedVehicleFiles(
        [
          { folder: blade, name: 'blade - x' },
          { folder: voodoo, name: 'voodoo - y' },
        ],
        new Map([[voodoo, new Map([['rbmp_lr_bl1.dff', 'rbmp_lr_bl1_voo.dff']])]]),
      );

      expect(shared.size).toBe(0);
    });
  });
});

describe('pruneReplacedSlotTextures', () => {
  /** The stock bundle of a tunable car, as the archive holds it before a mod takes the slot over. */
  const stockImg = (): ReturnType<typeof createImg> => {
    const img = createImg();
    for (const name of ['blade.txd', 'blade1.txd', 'blade2.txd', 'blade3.txd', 'bladed.txd', 'voodoo.txd']) {
      img.set(name, Uint8Array.of(1));
    }

    return img;
  };

  describe('negative cases', () => {
    it('leaves the slot alone when the folder ships no dictionary of its own', () => {
      const img = stockImg();

      expect(pruneReplacedSlotTextures(img, 'blade', ['blade.dff'])).toEqual([]);
      expect(img.has('blade1.txd')).toBe(true);
    });

    it('never reaches another slot, nor a name that merely starts the same', () => {
      const img = stockImg();

      pruneReplacedSlotTextures(img, 'blade', ['blade.txd']);

      expect(img.has('voodoo.txd')).toBe(true);
      expect(img.has('bladed.txd')).toBe(true); // a car of its own, not blade's paintjob
    });
  });

  describe('positive cases', () => {
    it('drops the stock paintjobs the mod does not ship, and keeps the ones it does', () => {
      const img = stockImg();

      const dropped = pruneReplacedSlotTextures(img, 'blade', ['blade.dff', 'blade.txd', 'blade1.txd']);

      expect(dropped).toEqual(['blade2.txd', 'blade3.txd']);
      expect(img.has('blade.txd')).toBe(true); // the mod's own, staged over it a moment later
      expect(img.has('blade1.txd')).toBe(true);
    });

    it('drops all three when the mod brings a body with no paintjobs at all', () => {
      const img = stockImg();

      expect(pruneReplacedSlotTextures(img, 'blade', ['blade.txd'])).toEqual([
        'blade1.txd',
        'blade2.txd',
        'blade3.txd',
      ]);
    });
  });
});

describe('vehicleCohortKey', () => {
  /** A tree with the two tables the key is derived from — a car, and a part textured by it. */
  const tree = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'cohort-'));
    mkdirSync(join(dir, 'data', 'maps', 'veh_mods'), { recursive: true });
    writeFileSync(
      join(dir, 'data', 'vehicles.ide'),
      ['cars', '536, blade, blade, car', '412, voodoo, voodoo, car', 'end', ''].join('\n'),
    );
    writeFileSync(
      join(dir, 'data', 'maps', 'veh_mods', 'veh_mods.ide'),
      ['objs', '1181, exh_lr_bl2, blade, 100, 0', '1008, nto_b_l, vehicle, 70, 0', 'end', ''].join('\n'),
    );

    return dir;
  };

  describe('negative cases', () => {
    it('answers null for anything that is not a car file — the entry is placed on its own', () => {
      const key = vehicleCohortKey(tree());

      expect(key('veh_mods.col')).toBeNull(); // not a dff/txd
      expect(key('kb_bar.dff')).toBeNull(); // a map object
      expect(key('nto_b_l.dff')).toBeNull(); // a GENERIC part: no one car owns it
      expect(key('lae2_roads17.txd')).toBeNull(); // reads like `<car><n>` but `lae2_roads` is no car
    });

    it('is empty-handed rather than throwing on a tree with no tables at all', () => {
      const empty = mkdtempSync(join(tmpdir(), 'cohort-empty-'));

      expect(vehicleCohortKey(empty)('blade.dff')).toBeNull();
      rmSync(empty, { force: true, recursive: true });
    });
  });

  describe('positive cases', () => {
    it("keys a car's model, its dictionary, its paintjobs and its parts to the one car", () => {
      const key = vehicleCohortKey(tree());

      expect(key('blade.dff')).toBe('blade');
      expect(key('blade.txd')).toBe('blade');
      expect(key('blade3.txd')).toBe('blade'); // a paintjob, which no row names
      expect(key('exh_lr_bl2.dff')).toBe('blade'); // a part, by the car its txd column names
      expect(key('voodoo.dff')).toBe('voodoo');
    });
  });
});
