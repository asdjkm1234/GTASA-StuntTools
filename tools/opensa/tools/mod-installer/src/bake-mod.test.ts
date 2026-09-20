import { createImg, openImg } from '@opensa/tool-kit/archive/img';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { bakeMod, scanModloaderMod } from './bake-mod';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bake-mod-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** Write a file (and its parents) under `dir`, returning its absolute path. */
function write(rel: string, content: string | Uint8Array): string {
  const path = join(dir, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);

  return path;
}

/** A full 14-column procobj.dat data row (`surface model spacing …`). */
const proc = (surface: string, model: string, spacing: string): string =>
  [surface, model, spacing, '60', '0', '360', '1', '1', '1', '1', '0', '0', '0', '0'].join('\t');

describe('scanModloaderMod', () => {
  describe('negative cases', () => {
    it('reports loaderFound=false for a plain mod (a dff + a prose readme, no loader directives)', () => {
      write('mod/models/x.dff', Uint8Array.of(1));
      write('mod/readme.txt', 'Thanks for downloading! KEEP THIS FILE INSIDE MODLOADER');
      const scan = scanModloaderMod(join(dir, 'mod'));

      expect(scan.loaderFound).toBe(false);
      expect([...scan.assets.keys()]).toEqual(['x.dff']);
      expect(scan.refs).toEqual({ col: [], ide: [], ipl: [] });
    });
  });

  describe('positive cases', () => {
    it('buckets assets / texts / dataMerges by bare name and collects loader IDE/IPL/COLFILE refs', () => {
      write('mod/sub/Loader.txt', 'IDE data/maps/a.ide\nIPL data/maps/b.ipl\nCOLFILE 0 data/maps/c.col');
      write('mod/files/hero.dff', Uint8Array.of(1));
      write('mod/files/hero.txd', Uint8Array.of(2));
      write('mod/col/c.col', Uint8Array.of(3));
      write('mod/data/maps/a.ide', 'objs\nend');
      write('mod/data/procobj.dat', proc('p_sand', 'cactus', '16'));
      write('mod/notes.txt', 'just prose, no directives here');
      const scan = scanModloaderMod(join(dir, 'mod'));

      expect(scan.loaderFound).toBe(true);
      expect([...scan.assets.keys()].sort()).toEqual(['c.col', 'hero.dff', 'hero.txd']);
      expect([...scan.texts.keys()]).toEqual(['a.ide']);
      expect([...scan.dataMerges.keys()]).toEqual(['procobj.dat']);
      expect(scan.refs.ide).toEqual(['data/maps/a.ide']);
      expect(scan.refs.ipl).toEqual(['data/maps/b.ipl']);
      expect(scan.refs.col).toEqual(['data/maps/c.col']);
    });

    it('buckets CLEO content separately: cleo-dir files (any extension) + loose .cs/.ini/.fxt', () => {
      write('mod/Loader.txt', 'IDE data/maps/a.ide');
      write('mod/CLEO/Rotating Wheel.cs', 'code');
      write('mod/CLEO/cleo_text/wheel.fxt', 'GXT');
      write('mod/deep/nested/extra.cs', 'code2');
      write('mod/settings.ini', 'k=v');
      write('mod/models/x.dff', Uint8Array.of(1));
      const scan = scanModloaderMod(join(dir, 'mod'));

      expect([...scan.cleo.keys()].sort()).toEqual([
        'Rotating Wheel.cs',
        'cleo_text/wheel.fxt',
        'extra.cs',
        'settings.ini',
      ]);
      expect([...scan.assets.keys()]).toEqual(['x.dff']); // untouched by the cleo bucket
    });

    it('matches the cleo segment against the MOD-relative path only (a corpus under a cleo/ parent)', () => {
      write('cleo/mod/Loader.txt', 'IDE data/maps/a.ide');
      write('cleo/mod/models/x.dff', Uint8Array.of(1));
      const scan = scanModloaderMod(join(dir, 'cleo', 'mod'));

      expect(scan.cleo.size).toBe(0); // the OUTER cleo/ dir is not the mod's script folder
      expect([...scan.assets.keys()]).toEqual(['x.dff']);
    });

    it('detects a UTF-16 loader file (BOM-aware read) — the real SA Brightened Project fixture', () => {
      cpSync('fixtures/custom/modloader/utf16-loader.txt', join(dir, 'mod', 'Loader.txt'));
      const scan = scanModloaderMod(join(dir, 'mod'));

      expect(scan.loaderFound).toBe(true);
      expect(scan.refs.ipl).toContain('data\\maps\\vinelumination.ipl');
    });
  });
});

describe('bakeMod', () => {
  /** Lay down a minimal stock `--out` tree: gta.dat + a stock IDE + stock procobj.dat + a seeded gta3.img. */
  function stockOut(): string {
    const out = join(dir, 'out');
    write('out/data/gta.dat', 'IDE DATA\\MAPS\\stock.ide\n'); // stock gta.dat uses backslashes
    write('out/data/maps/stock.ide', 'objs\n700, stocktree, stocktxd, 299, 0\nend\n');
    write('out/data/procobj.dat', `# stock\n${proc('p_sand', 'cactus', '16')}\n`);
    const img = createImg();
    img.set('existing.dff', Uint8Array.of(9));
    write('out/models/gta3.img', img.build());

    return out;
  }

  describe('negative cases', () => {
    it('returns baked=false for a mod with no loader (caller should overlay instead)', () => {
      write('mod/models/x.dff', Uint8Array.of(1));

      expect(bakeMod(join(dir, 'mod'), stockOut())).toEqual({ assets: 0, baked: false, cleo: 0, texts: 0 });
    });
  });

  describe('positive cases', () => {
    it('REPLACES "Remove original/" entries with the stubs the mod ships (rotating ferris case)', () => {
      const out = stockOut();
      const img = createImg();
      img.set('existing.dff', Uint8Array.of(9));
      img.set('ferris01_law2.dff', Uint8Array.of(8)); // the stock geometry
      write('out/models/gta3.img', img.build());

      write('mod/loader.txt', 'IDE data/maps/ferriswheel.ide');
      write('mod/data/maps/ferriswheel.ide', 'objs\n14644, ferriswheel_wheel, ferriswheel_wheel, 299, 0\nend\n');
      write('mod/gta3_img/ferriswheel_wheel.dff', Uint8Array.of(1));
      write('mod/gta3_img/Remove original/ferris01_LAw2.dff', Uint8Array.of(7)); // the empty-clump stub

      const scan = scanModloaderMod(join(dir, 'mod'));
      expect(scan.assets.has('ferris01_law2.dff')).toBe(true); // an ordinary asset, injected by bare name

      const result = bakeMod(join(dir, 'mod'), out);
      expect(result.baked).toBe(true);
      const baked = openImg(new Uint8Array(readFileSync(join(out, 'models', 'gta3.img'))));
      // The entry SURVIVES carrying the stub — deleting it would leave the stock map placing a model the
      // streamer can never load (`docs/open-issues/fixed/sa-world-loads-only-lods.md`).
      expect([...baked.get('ferris01_law2.dff')!.slice(0, 1)]).toEqual([7]);
      expect(baked.has('ferriswheel_wheel.dff')).toBe(true); // new model injected
      expect(baked.has('existing.dff')).toBe(true); // untouched neighbour
    });

    it('carries CLEO files to <out>/cleo/ preserving author structure; prose .txt still dropped', () => {
      const out = stockOut();
      write('mod/loader.txt', 'IDE data/maps/ferriswheel.ide');
      write('mod/data/maps/ferriswheel.ide', 'objs\n14644, fw, fw, 299, 0\nend\n');
      write('mod/CLEO/Rotating Wheel.cs', 'code');
      write('mod/CLEO/cleo_text/wheel.fxt', 'GXT');
      write('mod/readme.txt', 'Thanks for downloading!');

      const result = bakeMod(join(dir, 'mod'), out);
      expect(result.cleo).toBe(2);
      expect(readFileSync(join(out, 'cleo', 'Rotating Wheel.cs'), 'utf8')).toBe('code');
      expect(readFileSync(join(out, 'cleo', 'cleo_text', 'wheel.fxt'), 'utf8')).toBe('GXT');
      expect(existsSync(join(out, 'cleo', 'readme.txt'))).toBe(false); // prose stays dropped
      expect(existsSync(join(out, 'readme.txt'))).toBe(false);
    });

    it('strips an id from stock IDEs when a baked IDE redefines it (Animal Statues anim case)', () => {
      const out = stockOut();
      // Stock defines 11470 in objs; the mod's NEW IDE moves it into anim (modloader merges by id at
      // runtime — baked, both would load → duplicate model-info ids corrupt SA's heap on data load).
      write(
        'out/data/maps/countryn.ide',
        'objs\n11470, des_bigbull, des_steakhouse, 299, 0\n700, keepme, tex, 100, 0\nend\n',
      );
      write('mod/loader.txt', 'IDE data/maps/asremastered.ide');
      write('mod/asremastered.ide', 'anim\n11470, des_bigbull, des_steakhouse, ASRemastered, 299, 0\nend\n');

      const result = bakeMod(join(dir, 'mod'), out);

      expect(result.baked).toBe(true);
      const stockIde = readFileSync(join(out, 'data', 'maps', 'countryn.ide'), 'utf8');
      expect(stockIde).not.toContain('11470'); // superseded by the baked anim def
      expect(stockIde).toContain('700, keepme'); // neighbours untouched
      expect(readFileSync(join(out, 'data', 'maps', 'asremastered.ide'), 'utf8')).toContain('11470'); // the winner
    });

    it('re-homes a modloader-relative loader path into data/maps (the Smoke in factory pipes case)', () => {
      const out = stockOut();
      // Author ships the modloader convention: the path points into the mod's OWN modloader folder — and the
      // loader.txt itself is UTF-16LE (also as shipped). Baked verbatim this used to create a literal
      // `modloader/` dir in the build and a MODLOADER\ gta.dat line (double-load with a real modloader.asi).
      const loader = 'IPL modloader\\Smoke in factory pipes\\tubsmoke.ipl\n';
      const utf16 = new Uint8Array(2 + loader.length * 2);
      utf16[0] = 0xff;
      utf16[1] = 0xfe; // BOM
      for (let i = 0; i < loader.length; i += 1) {
        utf16[2 + i * 2] = loader.charCodeAt(i);
      }
      write('mod/loader.txt', utf16);
      write('mod/tubsmoke.ipl', 'inst\n3256, dummy, 0, 1, 2, 3, 0, 0, 0, 1, -1\nend\n');

      const result = bakeMod(join(dir, 'mod'), out);

      expect(result.baked).toBe(true);
      const gtaDat = readFileSync(join(out, 'data', 'gta.dat'), 'utf8');
      expect(gtaDat).toContain('IPL DATA\\MAPS\\tubsmoke.ipl'); // re-homed, not MODLOADER\
      expect(gtaDat).not.toMatch(/MODLOADER/i);
      expect(readFileSync(join(out, 'data', 'maps', 'tubsmoke.ipl'), 'utf8')).toContain('3256, dummy');
      expect(existsSync(join(out, 'modloader'))).toBe(false); // no literal modloader/ dir in the build
    });

    it('patches gta.dat, places new + overwrites stock, merges procobj additively, injects gta3.img', () => {
      const out = stockOut();
      write('mod/loader.txt', 'IDE data/maps/newdefs.ide\nIPL data/maps/newplace.ipl\nCOLFILE 0 data/maps/new.col');
      write('mod/files/newdefs.ide', 'objs\n5000, newobj, newtxd, 1500, 0\nend\n'); // new → declared path
      write('mod/deep/newplace.ipl', 'inst\n5000, newobj, 0, 1, 2, 3, 0, 0, 0, 1, -1\nend\n'); // new → declared
      write('mod/x/stock.ide', 'objs\n700, stocktree, MODTXD, 299, 0\nend\n'); // modified stock → overwrite in place
      write('mod/y/custom.dff', Uint8Array.of(1, 2, 3)); // scattered → gta3.img
      write('mod/z/new.col', Uint8Array.of(4, 5)); // COLFILE col → gta3.img (auto-discovered, no COLFILE line)
      write('mod/data/procobj.dat', `${proc('p_sand', 'cactus', '99')}\n${proc('p_dirt', 'weed', '12')}`);
      write('mod/readme.txt', 'thanks — KEEP THIS INSIDE MODLOADER'); // prose → ignored

      const result = bakeMod(join(dir, 'mod'), out);

      expect(result.baked).toBe(true);
      // 1. gta.dat: the loader's new IDE/IPL registered, canonicalised to `DATA\MAPS\…` (filename as-is); COLFILE
      //    dropped (col → img).
      const gtaDat = readFileSync(join(out, 'data', 'gta.dat'), 'utf8');
      expect(gtaDat).toContain('IDE DATA\\MAPS\\newdefs.ide');
      expect(gtaDat).toContain('IPL DATA\\MAPS\\newplace.ipl');
      expect(gtaDat).not.toContain('COLFILE');
      expect(gtaDat).not.toMatch(/^(IDE|IPL) .*\//m); // no forward slashes in any directive line
      expect(gtaDat).not.toMatch(/^(IDE|IPL) [^\\]*data\\/m); // no lowercase `data\` directory
      // 2. new files written at the loader-declared paths; stock IDE overwritten in place.
      expect(readFileSync(join(out, 'data', 'maps', 'newdefs.ide'), 'utf8')).toContain('5000, newobj');
      expect(readFileSync(join(out, 'data', 'maps', 'newplace.ipl'), 'utf8')).toContain('5000, newobj');
      expect(readFileSync(join(out, 'data', 'maps', 'stock.ide'), 'utf8')).toContain('MODTXD');
      // 3. procobj.dat merged additively (cactus replaced, weed added, comment + the rest kept).
      const procobj = readFileSync(join(out, 'data', 'procobj.dat'), 'utf8');
      expect(procobj).toContain('# stock');
      expect(procobj).toContain('p_sand\tcactus\t99');
      expect(procobj).toContain('p_dirt\tweed');
      // 4. scattered dff + col injected into gta3.img by name; the existing entry kept.
      const img = openImg(new Uint8Array(readFileSync(join(out, 'models', 'gta3.img'))));
      expect(img.has('custom.dff')).toBe(true);
      expect(img.has('new.col')).toBe(true);
      expect(img.has('existing.dff')).toBe(true);
      // prose readme never reached the tree.
      expect(existsSync(join(out, 'readme.txt'))).toBe(false);
    });
  });
});
