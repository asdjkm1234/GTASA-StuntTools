import { encodeBinaryIpl } from '@opensa/map-placement/ipl-binary-write';
import { parseTxd } from '@opensa/renderware/parsers/binary/txd';
import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { createImg, openImg } from '@opensa/tool-kit/archive/img';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { install } from './install';
import { pngToTextureNative } from './png-texture';
import { buildTxd, encodePng, solidRgba } from './test-utils';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mod-installer-e2e-'));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

function write(path: string, content: string | Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

describe('install (end-to-end)', () => {
  describe('negative cases', () => {
    it('fails the install when a *.merge target does not exist', () => {
      const game = join(root, 'game');
      const mods = join(root, 'mods');
      const out = join(root, 'out');

      write(join(game, 'data', 'stub.txt'), 'base');
      write(join(mods, 'a_mod', 'data', 'missing.ide.merge'), 'add to "objs":\n1, a, b, 100, 0\n');

      expect(() => install({ gamePath: game, inPath: mods, outPath: out })).toThrow(/\.merge target does not exist/);
    });
  });

  describe('positive cases', () => {
    it('copies the base, overlays mods alphabetically, and merges gta3_img into gta3.img', () => {
      const game = join(root, 'game');
      const mods = join(root, 'mods');
      const out = join(root, 'out');

      // Base game: two data files + a gta3.img with one entry.
      write(join(game, 'data', 'keep.txt'), 'base');
      write(join(game, 'data', 'conf.txt'), 'base');
      const baseImg = createImg();
      baseImg.set('base.dff', Uint8Array.from([1]));
      write(join(game, 'models', 'gta3.img'), baseImg.build());

      // a_mod (applied first): a new file, a conf override, and a gta3_img entry.
      write(join(mods, 'a_mod', 'data', 'new.txt'), 'a-new');
      write(join(mods, 'a_mod', 'data', 'conf.txt'), 'a');
      write(join(mods, 'a_mod', 'gta3_img', 'x.dff'), Uint8Array.from([2, 2]));

      // b_mod (applied last): another conf override → wins.
      write(join(mods, 'b_mod', 'data', 'conf.txt'), 'b');

      install({ gamePath: game, inPath: mods, outPath: out });

      expect(readFileSync(join(out, 'data', 'keep.txt'), 'utf8')).toBe('base'); // untouched base file
      expect(readFileSync(join(out, 'data', 'new.txt'), 'utf8')).toBe('a-new'); // added by a_mod
      expect(readFileSync(join(out, 'data', 'conf.txt'), 'utf8')).toBe('b'); // b_mod applied after a_mod → wins
      expect(existsSync(join(out, 'gta3_img'))).toBe(false); // gta3_img is merged, never copied as a folder

      const img = openImg(new Uint8Array(readFileSync(join(out, 'models', 'gta3.img'))));
      expect(img.has('base.dff')).toBe(true); // base archive entry preserved
      expect(img.has('x.dff')).toBe(true); // merged from a_mod/gta3_img
    });

    it('merges gta_int_img into models/gta_int.img, seeding the archive when the base has none', () => {
      const game = join(root, 'game');
      const mods = join(root, 'mods');
      const out = join(root, 'out');

      write(join(game, 'data', 'keep.txt'), 'base'); // minimal base — no gta_int.img on purpose
      write(join(mods, 'a_mod', 'gta_int_img', 'int.dff'), Uint8Array.from([3, 3, 3]));

      install({ gamePath: game, inPath: mods, outPath: out });

      expect(existsSync(join(out, 'gta_int_img'))).toBe(false); // merged, never copied as a folder
      const img = openImg(new Uint8Array(readFileSync(join(out, 'models', 'gta_int.img'))));
      expect(img.has('int.dff')).toBe(true);
    });

    it('merges cutscene_img into models/cutscene.img (add + replace by name)', () => {
      const game = join(root, 'game');
      const mods = join(root, 'mods');
      const out = join(root, 'out');

      write(join(game, 'data', 'keep.txt'), 'base');
      const baseImg = createImg();
      baseImg.set('csburgerbox.txd', Uint8Array.from([1]));
      baseImg.set('cskeep.txd', Uint8Array.from([9]));
      write(join(game, 'models', 'cutscene.img'), baseImg.build());
      write(join(mods, 'a_mod', 'cutscene_img', 'csburgerbox.txd'), Uint8Array.from([2, 2]));
      write(join(mods, 'a_mod', 'cutscene_img', 'csnew.dff'), Uint8Array.from([3]));

      install({ gamePath: game, inPath: mods, outPath: out });

      expect(existsSync(join(out, 'cutscene_img'))).toBe(false); // merged, never copied as a folder
      const img = openImg(new Uint8Array(readFileSync(join(out, 'models', 'cutscene.img'))));
      // entries come back sector-padded — compare the payload prefix
      expect([...img.get('csburgerbox.txd')!.slice(0, 2)]).toEqual([2, 2]); // replaced by the mod
      expect(img.get('cskeep.txd')![0]).toBe(9); // untouched neighbour
      expect(img.has('csnew.dff')).toBe(true); // added
    });

    it("stacks an .ipl.merge over another mod's whole-file replacement of the same IPL (plan 007)", () => {
      const game = join(root, 'game');
      const mods = join(root, 'mods');
      const out = join(root, 'out');

      const vanillaIpl = [
        'inst',
        '710, vgs_palm01, 0, 100, 200, 30, 0, 0, 0, 1, -1',
        '714, veg_bevtree2, 0, 120, 220, 32, 0, 0, 0, 1, -1',
        'end',
        '',
      ].join('\n');
      write(join(game, 'data', 'maps', 'la', 'lae.ipl'), vanillaIpl);

      // mod a (first): sinks the palm via a replace merge.
      const sinkMerge = [
        'replace in "inst":',
        '- 710, vgs_palm01, 0, 100, 200, 30, 0, 0, 0, 1, -1',
        '+ 710, vgs_palm01, 0, 100, 200, -300.0, 0, 0, 0, 1, -1',
        '',
      ].join('\n');
      write(join(mods, 'a_fixes', 'data', 'maps', 'la', 'lae.ipl.merge'), sinkMerge);

      // mod b (second): replaces the IPL whole (adds a feature row) — this would erase mod a's sink…
      write(
        join(mods, 'b_features', 'data', 'maps', 'la', 'lae.ipl'),
        vanillaIpl.replace('end', '999, xbox_tree, 0, 1, 2, 3, 0, 0, 0, 1, -1\nend'),
      );
      // …so mod b also carries the sink merge, re-applied after its own overlay.
      write(join(mods, 'b_features', 'data', 'maps', 'la', 'lae.ipl.merge'), sinkMerge);

      install({ gamePath: game, inPath: mods, outPath: out });

      const final = readFileSync(join(out, 'data', 'maps', 'la', 'lae.ipl'), 'utf8');
      expect(final).toContain('710, vgs_palm01, 0, 100, 200, -300.0, 0, 0, 0, 1, -1'); // sink survived
      expect(final).toContain('999, xbox_tree, 0, 1, 2, 3, 0, 0, 0, 1, -1'); // feature row present
      expect(final.split('\n')[1]).toContain('-300.0'); // sunk row kept its index (row 1 of inst)
    });

    it('inst removal rebases the text AND the area binary streams; a stream merge stacks on top (plan 008)', () => {
      const game = join(root, 'game');
      const mods = join(root, 'mods');
      const out = join(root, 'out');

      // Base: a text IPL whose row 1 will be removed + a companion binary stream linking to rows 1 and 2.
      write(
        join(game, 'data', 'maps', 'la', 'lae.ipl'),
        [
          'inst',
          '700, keep_a, 0, 1, 2, 3, 0, 0, 0, 1, -1',
          '701, gone_b, 0, 4, 5, 6, 0, 0, 0, 1, -1',
          '702, keep_c, 0, 7, 8, 9, 0, 0, 0, 1, -1',
          'end',
          '',
        ].join('\n'),
      );
      const stream = encodeBinaryIpl([
        { id: 800, interior: 0, lod: 2, position: [10, 20, 30], rotation: [0, 0, 0, 1] },
        { id: 801, interior: 0, lod: 0, position: [11, 21, 31], rotation: [0, 0, 0, 1] },
      ]);
      const baseImg = createImg();
      baseImg.set('lae_stream0.ipl', stream);
      write(join(game, 'models', 'gta3.img'), baseImg.build());

      // mod a: removes text row 1 → rebase must shift the stream's lod 2 → 1.
      write(
        join(mods, 'a_remove', 'data', 'maps', 'la', 'lae.ipl.merge'),
        'remove from "inst":\n701, gone_b, 0, 4, 5, 6, 0, 0, 0, 1, -1\n',
      );
      // mod b: edits the stream itself — adds an instance in the FINAL (post-rebase) index space.
      write(
        join(mods, 'b_stream', 'gta3_img', 'lae_stream0.ipl.merge'),
        'add to "inst":\n900, 0, 50, 60, 70, 0, 0, 0, 1, 1\n',
      );

      install({ gamePath: game, inPath: mods, outPath: out });

      const text = readFileSync(join(out, 'data', 'maps', 'la', 'lae.ipl'), 'utf8');
      expect(text).not.toContain('gone_b');
      const img = openImg(new Uint8Array(readFileSync(join(out, 'models', 'gta3.img'))));
      const entry = img.get('lae_stream0.ipl')!;
      const inst = parseBinaryIpl(
        entry.buffer.slice(entry.byteOffset, entry.byteOffset + entry.byteLength) as ArrayBuffer,
      );
      expect(inst.map((i) => [i.id, i.lod])).toEqual([
        [800, 1], // was lod 2 — rebased past the removed row
        [801, 0], // below the removal — untouched
        [900, 1], // added by mod b's stream merge
      ]);
    });

    it('applies a *.merge data edit onto the installed file instead of copying it', () => {
      const game = join(root, 'game');
      const mods = join(root, 'mods');
      const out = join(root, 'out');

      write(join(game, 'data', 'maps', 'generic', 'multiobj.ide'), 'objs\n1682, radar, tex, 100, 2097152\nend\n');
      write(
        join(mods, 'a_mod', 'data', 'maps', 'generic', 'multiobj.ide.merge'),
        'remove from "objs":\n1682, radar, tex, 100, 2097152\n\nadd to "anim":\n1682, radar, tex, radar, 600, 0\n',
      );

      install({ gamePath: game, inPath: mods, outPath: out });

      const ide = readFileSync(join(out, 'data', 'maps', 'generic', 'multiobj.ide'), 'utf8');
      expect(existsSync(join(out, 'data', 'maps', 'generic', 'multiobj.ide.merge'))).toBe(false); // never copied
      expect(ide).not.toMatch(/objs\n1682/); // moved out of objs
      expect(ide).toContain('anim\n1682, radar, tex, radar, 600, 0\nend'); // into anim
    });

    it('applies a *.merge after the mod own-file overlay (the shipped target is edited)', () => {
      const game = join(root, 'game');
      const mods = join(root, 'mods');
      const out = join(root, 'out');

      write(join(game, 'data', 'stub.txt'), 'base');
      // The mod ships BOTH the target file and a merge editing it — the merge must see the shipped copy.
      write(join(mods, 'a_mod', 'data', 'custom.ide'), 'objs\n7001, radar, tex, 100, 0\nend\n');
      write(join(mods, 'a_mod', 'data', 'custom.ide.merge'), 'add to "anim":\n7002, dish, tex, spin, 300, 0\n');

      install({ gamePath: game, inPath: mods, outPath: out });

      const ide = readFileSync(join(out, 'data', 'custom.ide'), 'utf8');
      expect(ide).toContain('7001, radar, tex, 100, 0'); // the mod's own copy survived
      expect(ide).toContain('anim\n7002, dish, tex, spin, 300, 0\nend'); // and was edited by its merge
    });

    it('merges a mod PNG folder into a loose .txd matching its name (nested), not copying the folder', () => {
      const version = 0x1803ffff;
      const game = join(root, 'game');
      const mods = join(root, 'mods');
      const out = join(root, 'out');

      // Base ships a loose models/generic/vehicle.txd with one texture.
      write(
        join(game, 'models', 'generic', 'vehicle.txd'),
        buildTxd([pngToTextureNative('stock', png(8, [10, 10, 10, 255]), version)], version),
      );

      // The mod ships models/generic/vehicle/ as a PNG folder (replace `stock`, add `decal`).
      write(join(mods, 'paint', 'models', 'generic', 'vehicle', 'stock.png'), png(16, [20, 20, 20, 255]));
      write(join(mods, 'paint', 'models', 'generic', 'vehicle', 'decal.png'), png(4, [30, 30, 30, 128]));

      install({ gamePath: game, inPath: mods, outPath: out });

      // The folder is consumed by the merge — never copied as a directory.
      expect(existsSync(join(out, 'models', 'generic', 'vehicle'))).toBe(false);

      const textures = parseTxd(
        Uint8Array.from(readFileSync(join(out, 'models', 'generic', 'vehicle.txd'))).buffer,
      ).textures;
      const byName = new Map(textures.map((t) => [t.name, t]));
      expect([...byName.keys()].sort()).toEqual(['decal', 'stock']);
      expect(byName.get('stock')?.width).toBe(16); // replaced (was 8)
      expect(byName.get('decal')?.format).toBe('dxt5'); // added, alpha
    });

    it('merges a PNG folder the author named WITH the extension (particle.txd/) into that same file', () => {
      // Real mod: "55. Tiers faces on the asphalt from GTA 4" ships `models/particle.txd/particleskid.png`.
      // The folder used to miss the `<dir>.txd` test (it looked for `particle.txd.txd`), fall through to
      // mkdir, and kill the whole build on `EEXIST` against the stock `particle.txd` FILE.
      const version = 0x1803ffff;
      const game = join(root, 'game');
      const mods = join(root, 'mods');
      const out = join(root, 'out');

      write(
        join(game, 'models', 'particle.txd'),
        buildTxd([pngToTextureNative('stock', png(8, [10, 10, 10, 255]), version)], version),
      );
      write(join(mods, 'skid', 'models', 'particle.txd', 'particleskid.png'), png(16, [20, 20, 20, 255]));

      install({ gamePath: game, inPath: mods, outPath: out });

      const textures = parseTxd(Uint8Array.from(readFileSync(join(out, 'models', 'particle.txd'))).buffer).textures;
      expect(textures.map((texture) => texture.name).sort()).toEqual(['particleskid', 'stock']);
    });

    it('warns about a PNG folder with no dictionary to patch, and still copies it', () => {
      // The IMG side has always warned here; the loose side used to copy in silence. Copying stays the
      // behaviour (the game ignores stray PNGs) — the warning is what points at `txd-from-pngs.ts`.
      const game = join(root, 'game');
      const mods = join(root, 'mods');
      const out = join(root, 'out');
      write(join(game, 'data', 'gta.dat'), 'IDE data/x.ide\n');
      write(join(mods, 'unpacked', 'models', 'philss', 'body.png'), png(8, [1, 2, 3, 255]));

      const warnings: string[] = [];
      const warn = console.warn;
      console.warn = (message: string): void => void warnings.push(message);
      try {
        install({ gamePath: game, inPath: mods, outPath: out });
      } finally {
        console.warn = warn;
      }

      expect(warnings.some((line) => /texture folder .*philss.* no .*philss\.txd/.test(line))).toBe(true);
      expect(existsSync(join(out, 'models', 'philss', 'body.png'))).toBe(true);
    });

    it('routes each mod by kind: a loader mod is baked (gta.dat + gta3.img), a plain mod overlays', () => {
      const game = join(root, 'game');
      const mods = join(root, 'mods');
      const out = join(root, 'out');

      // Base: gta.dat + a stock IDE + a seeded gta3.img.
      write(join(game, 'data', 'gta.dat'), 'IDE DATA\\MAPS\\stock.ide\n');
      write(join(game, 'data', 'maps', 'stock.ide'), 'objs\nend\n');
      const baseImg = createImg();
      baseImg.set('base.dff', Uint8Array.from([1]));
      write(join(game, 'models', 'gta3.img'), baseImg.build());

      // a_loader: a Modloader mod (loader.txt registers a new IDE + a scattered dff) → BAKED.
      write(join(mods, 'a_loader', 'loader.txt'), 'IDE data/maps/extra.ide');
      write(join(mods, 'a_loader', 'files', 'extra.ide'), 'objs\n5000, ext, exttxd, 1500, 0\nend\n');
      write(join(mods, 'a_loader', 'deep', 'extra.dff'), Uint8Array.from([7, 7]));

      // b_plain: a plain mod (file overlay + gta3_img/) → OVERLAID.
      write(join(mods, 'b_plain', 'data', 'extra-note.txt'), 'plain');
      write(join(mods, 'b_plain', 'gta3_img', 'plain.dff'), Uint8Array.from([8]));

      install({ gamePath: game, inPath: mods, outPath: out });

      // a_loader baked: gta.dat gained the new IDE (canonicalised), the IDE is on disk, the dff is in gta3.img.
      const gtaDat = readFileSync(join(out, 'data', 'gta.dat'), 'utf8');
      expect(gtaDat).toContain('IDE DATA\\MAPS\\extra.ide');
      expect(readFileSync(join(out, 'data', 'maps', 'extra.ide'), 'utf8')).toContain('5000, ext');
      expect(existsSync(join(out, 'loader.txt'))).toBe(false); // loader parsed, never copied
      // b_plain overlaid: its file copied, its gta3_img/ merged (not copied as a folder).
      expect(readFileSync(join(out, 'data', 'extra-note.txt'), 'utf8')).toBe('plain');
      expect(existsSync(join(out, 'gta3_img'))).toBe(false);
      // both mods' assets + the base coexist in gta3.img.
      const img = openImg(new Uint8Array(readFileSync(join(out, 'models', 'gta3.img'))));
      expect(img.has('base.dff')).toBe(true);
      expect(img.has('extra.dff')).toBe(true); // baked (a_loader, scattered)
      expect(img.has('plain.dff')).toBe(true); // overlaid (b_plain, gta3_img/)
    });

    it('applies a mod-shipped .txd file before merging its sibling PNG folder (files-first)', () => {
      const version = 0x1803ffff;
      const game = join(root, 'game');
      const mods = join(root, 'mods');
      const out = join(root, 'out');

      write(join(game, 'data', 'gta.dat'), 'x'); // a base so --out isn't empty (no pre-existing skin.txd)

      // The SAME mod ships both `models/skin.txd` (a file with `orig`) and `models/skin/` (a PNG folder adding
      // `patch`). Only if the file is copied first does the folder find a `skin.txd` to merge into.
      write(
        join(mods, 'a', 'models', 'skin.txd'),
        buildTxd([pngToTextureNative('orig', png(8, [9, 9, 9, 255]), version)], version),
      );
      write(join(mods, 'a', 'models', 'skin', 'patch.png'), png(8, [7, 7, 7, 255]));

      install({ gamePath: game, inPath: mods, outPath: out });

      expect(existsSync(join(out, 'models', 'skin'))).toBe(false); // folder consumed, not copied
      const names = parseTxd(Uint8Array.from(readFileSync(join(out, 'models', 'skin.txd'))).buffer)
        .textures.map((t) => t.name)
        .sort();
      expect(names).toEqual(['orig', 'patch']); // the mod's own .txd + the folder merged into it
    });
  });
});

describe('install (layered mods — plan 011)', () => {
  describe('negative cases', () => {
    it('refuses a layered --in with no target', () => {
      const game = join(root, 'game');
      const mods = join(root, 'mods');

      write(join(game, 'data', 'conf.txt'), 'base');
      write(join(mods, 'common', '0. everyone', 'data', 'conf.txt'), 'common');

      expect(() => install({ gamePath: game, inPath: mods, outPath: join(root, 'out') })).toThrow(/needs a target/);
    });
  });

  describe('positive cases', () => {
    it('applies common first, then the target layer, and leaves the other target out', () => {
      const game = join(root, 'game');
      const mods = join(root, 'mods');

      write(join(game, 'data', 'conf.txt'), 'base');
      write(join(mods, 'common', '0. everyone', 'data', 'conf.txt'), 'common');
      write(join(mods, 'common', '0. everyone', 'data', 'shared.txt'), 'common');
      write(join(mods, 'sa', '0. real game', 'data', 'conf.txt'), 'sa');
      write(join(mods, 'sa', '0. real game', 'data', 'sa-only.txt'), 'sa');
      write(join(mods, 'opensa', '0. our engine', 'data', 'conf.txt'), 'opensa');
      write(join(mods, 'opensa', '0. our engine', 'data', 'opensa-only.txt'), 'opensa');

      const sa = join(root, 'out-sa');
      install({ gamePath: game, inPath: mods, outPath: sa, target: 'sa' });

      expect(readFileSync(join(sa, 'data', 'shared.txt'), 'utf8')).toBe('common'); // common applied
      expect(readFileSync(join(sa, 'data', 'conf.txt'), 'utf8')).toBe('sa'); // the target layer wrote last
      expect(existsSync(join(sa, 'data', 'sa-only.txt'))).toBe(true);
      expect(existsSync(join(sa, 'data', 'opensa-only.txt'))).toBe(false); // the other layer never ran
      expect(existsSync(join(sa, 'common'))).toBe(false); // layer folders are not mods

      const opensa = join(root, 'out-opensa');
      install({ gamePath: game, inPath: mods, outPath: opensa, target: 'opensa' });

      expect(readFileSync(join(opensa, 'data', 'shared.txt'), 'utf8')).toBe('common'); // the common half is identical
      expect(readFileSync(join(opensa, 'data', 'conf.txt'), 'utf8')).toBe('opensa');
      expect(existsSync(join(opensa, 'data', 'opensa-only.txt'))).toBe(true);
      expect(existsSync(join(opensa, 'data', 'sa-only.txt'))).toBe(false);
    });

    // The layer order DOMINATES the numbering: a target mod numbered 0 still applies after a common mod
    // numbered 50, because the target layer has to be the last writer for the split to mean anything.
    it('applies the whole common layer before the target layer, whatever the numbers say', () => {
      const game = join(root, 'game');
      const mods = join(root, 'mods');
      const out = join(root, 'out');

      write(join(game, 'data', 'conf.txt'), 'base');
      write(join(mods, 'common', '50. late in common', 'data', 'conf.txt'), 'common-50');
      write(join(mods, 'sa', '0. first in sa', 'data', 'conf.txt'), 'sa-0');

      install({ gamePath: game, inPath: mods, outPath: out, target: 'sa' });

      expect(readFileSync(join(out, 'data', 'conf.txt'), 'utf8')).toBe('sa-0');
    });

    it('installs nothing but the base when only the OTHER target has a layer', () => {
      const game = join(root, 'game');
      const mods = join(root, 'mods');
      const out = join(root, 'out');

      write(join(game, 'data', 'conf.txt'), 'base');
      write(join(mods, 'opensa', '0. our engine', 'data', 'conf.txt'), 'opensa');

      install({ gamePath: game, inPath: mods, outPath: out, target: 'sa' });

      expect(readFileSync(join(out, 'data', 'conf.txt'), 'utf8')).toBe('base');
    });
  });
});

const png = (size: number, color: [number, number, number, number]): Uint8Array =>
  encodePng(solidRgba(size, size, color), size, size);
