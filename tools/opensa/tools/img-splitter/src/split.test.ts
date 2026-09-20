import { createImg, openImg, writeImgFile } from '@opensa/tool-kit/archive/img';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { assertArchiveSlots, split } from './split';

let dir: string;
let game: string;
let out: string;

/** One car, one part of it, one ped, one weapon and one map object — plus a `.col` nothing declares. */
const ENTRIES: Record<string, Uint8Array> = {
  'blade.dff': Uint8Array.of(1, 1, 1),
  'blade.txd': Uint8Array.of(2, 2),
  'cop.dff': Uint8Array.of(3),
  'countn2.col': Uint8Array.of(4),
  'gun_dildo1.dff': Uint8Array.of(5),
  'kb_bar.dff': Uint8Array.of(6),
  'nto_b_l.dff': Uint8Array.of(7),
};

const IDE = `
objs
1700, kb_bar, kb_stuff, 299, 0
end

peds
7, cop, cop, COP
end

weap
321, gun_dildo1, gun_dildo1, null, 1, 50, 0
end
`;

/** The game's two VEHICLE tables, in the paths it reads them from — the file is what makes a row a car's. */
const VEHICLES_IDE = `
cars
575, blade, blade, car
end
`;
const VEH_MODS_IDE = `
objs
1010, nto_b_l, blade, 200, 0
end
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'img-split-'));
  game = join(dir, 'game');
  out = join(dir, 'out');
  mkdirSync(join(game, 'models'), { recursive: true });
  mkdirSync(join(game, 'data'), { recursive: true });
  const img = createImg();
  for (const [name, bytes] of Object.entries(ENTRIES)) {
    img.set(name, bytes);
  }
  writeImgFile(img, join(game, 'models', 'gta3.img'));
  writeFileSync(join(game, 'data', 'default.ide'), IDE);
  writeFileSync(join(game, 'data', 'vehicles.ide'), VEHICLES_IDE);
  mkdirSync(join(game, 'data', 'maps', 'veh_mods'), { recursive: true });
  writeFileSync(join(game, 'data', 'maps', 'veh_mods', 'veh_mods.ide'), VEH_MODS_IDE);
  writeFileSync(join(game, 'data', 'carmods.dat'), 'mods\nblade, nto_b_l\nend\n');
  writeFileSync(join(game, 'data', 'gta.dat'), 'IMG DATA\\SCRIPT\\SCRIPT.IMG\nIDE DATA\\DEFAULT.IDE\n');
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** Every entry of one built archive, by name, trimmed of VER2's sector padding. */
function entriesOf(name: string): Map<string, string> {
  const img = openImg(new Uint8Array(readFileSync(join(out, 'models', name))));

  return new Map(
    img.names().map((entry) => {
      const bytes = [...(img.get(entry) ?? [])];

      return [entry.toLowerCase(), bytes.slice(0, ENTRIES[entry.toLowerCase()]?.length ?? 0).join(',')];
    }),
  );
}

describe('assertArchiveSlots', () => {
  describe('negative cases', () => {
    it('refuses a tree that registers more archives than the stock table holds', () => {
      // 3 hardcoded + 6 in gta.dat = 9. The game does not warn here, it dies at load.
      expect(() => assertArchiveSlots(6, false)).toThrow(/9 registered IMG archives of 8/);
    });
  });

  describe('positive cases', () => {
    it('allows exactly eight', () => {
      expect(() => assertArchiveSlots(5, false)).not.toThrow();
    });

    it('allows any number once our ASI has lifted the table', () => {
      expect(() => assertArchiveSlots(40, true)).not.toThrow();
    });
  });
});

describe('split', () => {
  describe('negative cases', () => {
    it('refuses an --out that contains --game', () => {
      expect(() => split({ gamePath: join(dir, 'game'), outPath: dir })).toThrow(/would wipe it/);
    });

    it('refuses a source archive holding one name twice', () => {
      // The layout rests on a name living in one archive. The reader keys its directory by name, so the
      // duplicate is already collapsed by the time anything sees it — only the DIRECTORY's own count catches it.
      writeFileSync(join(game, 'models', 'gta3.img'), duplicateNameArchive('dupe.dff'));

      expect(() => split({ gamePath: game, outPath: out })).toThrow(
        /declares 2 entries but holds 1 distinct names — 1 duplicate/,
      );
    });

    it('refuses to split more buckets than the archive table can register', () => {
      // gta.dat already carries SCRIPT.IMG, so three new archives make 3 hardcoded + 4 = 7 … still fine;
      // a gta.dat that already spends its slots is what makes the gate bite.
      writeFileSync(
        join(game, 'data', 'gta.dat'),
        ['CARREC', 'SCRIPT', 'CUTSCENE', 'SPARE1', 'SPARE2'].map((n) => `IMG MODELS\\${n}.IMG`).join('\n'),
      );

      expect(() => split({ gamePath: game, outPath: out })).toThrow(/registered IMG archives of 8/);
    });
  });

  describe('positive cases', () => {
    it('conserves every entry and every byte across the split', () => {
      const summary = split({ gamePath: game, outPath: out });

      const total = summary.archives.reduce((sum, archive) => sum + archive.entries, 0);
      expect(total).toBe(Object.keys(ENTRIES).length);

      const all = new Map([
        ...entriesOf('gta3.img'),
        ...entriesOf('vehicles.img'),
        ...entriesOf('peds.img'),
        ...entriesOf('weapons.img'),
      ]);
      expect(all.size).toBe(Object.keys(ENTRIES).length);
      for (const [name, bytes] of Object.entries(ENTRIES)) {
        expect(all.get(name)).toBe([...bytes].join(','));
      }
    });

    it('files each entry by the table that declares it, parts with their car', () => {
      split({ gamePath: game, outPath: out });

      expect([...entriesOf('vehicles.img').keys()].sort()).toEqual(['blade.dff', 'blade.txd', 'nto_b_l.dff']);
      expect([...entriesOf('peds.img').keys()]).toEqual(['cop.dff']);
      expect([...entriesOf('weapons.img').keys()]).toEqual(['gun_dildo1.dff']);
      // The map object and the .col nothing declares stay where the game already looks for them.
      expect([...entriesOf('gta3.img').keys()].sort()).toEqual(['countn2.col', 'kb_bar.dff']);
    });

    it('registers the new archives in gta.dat, beside the existing IMG lines and without doubling them', () => {
      split({ gamePath: game, outPath: out });
      const first = readFileSync(join(out, 'data', 'gta.dat'), 'latin1');

      expect(first.split('\n').filter((line) => line.startsWith('IMG'))).toEqual([
        'IMG DATA\\SCRIPT\\SCRIPT.IMG',
        'IMG MODELS\\VEHICLES.IMG',
        'IMG MODELS\\PEDS.IMG',
        'IMG MODELS\\WEAPONS.IMG',
      ]);

      split({ gamePath: out, outPath: join(dir, 'again') });
      expect(readFileSync(join(dir, 'again', 'data', 'gta.dat'), 'latin1')).toBe(first);
    });

    it('leaves a bucket in gta3.img when it is not asked for', () => {
      // The shape that fits a stock archive table: spend slots on vehicles only.
      const summary = split({ buckets: ['vehicles'], gamePath: game, outPath: out });

      expect(summary.archives.map((archive) => archive.name)).toEqual(['vehicles.img', 'gta3.img']);
      expect([...entriesOf('gta3.img').keys()].sort()).toEqual([
        'cop.dff',
        'countn2.col',
        'gun_dildo1.dff',
        'kb_bar.dff',
      ]);
    });

    it('reports the classifier’s own error bars and the slot cost', () => {
      const summary = split({ gamePath: game, outPath: out });

      expect(summary.unclaimed).toBe(1); // countn2.col
      expect(summary.contested).toEqual([]);
      expect(summary.slots).toEqual({ needed: 7, stock: 8 });
    });
  });
});

/**
 * A VER2 archive whose directory names one entry TWICE — hand-built, because our own writer cannot produce
 * one and the guard exists for archives that came from somewhere else.
 *
 * Layout: `VER2` + uint32 count, then 32 bytes per entry (uint32 sector offset, uint16 sector count, then a
 * 24-byte name), then the data at its sector.
 */
function duplicateNameArchive(name: string): Uint8Array {
  const sector = 2048;
  const bytes = new Uint8Array(sector * 2);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('VER2'), 0);
  view.setUint32(4, 2, true);
  for (const index of [0, 1]) {
    const base = 8 + index * 32;
    view.setUint32(base, 1, true); // both rows point at the same data sector
    view.setUint16(base + 4, 1, true);
    bytes.set(new TextEncoder().encode(name), base + 8);
  }

  return bytes;
}
