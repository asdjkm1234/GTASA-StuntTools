import { buildVer2Buffer } from '@opensa/renderware/archive/img-archive';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { createImg, openImg, writeImgFile } from '@opensa/tool-kit/archive/img';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installCutscene } from './install';
import { readClump } from './rig/clump-io';
import { toArrayBuffer } from './template';
import { textureNames } from './txd';

const CS_BOBCAT = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/csbobcat92.dff'));
const BOBCAT = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/bobcat.dff'));
const CS_MTBIKE = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/csmtbike92.dff'));
const MTBIKE = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/mtbike.dff'));
const MTBIKE_TXD = new Uint8Array(readFileSync('fixtures/original/dff/cutscene/mtbike.txd'));

const VEHICLES_IDE = [
  'cars',
  '422, bobcat, bobcat, car, BOBCAT, BOBCAT, null, worker, 10, 0, 0, -1, 0.7, 0.7, 0',
  '510, mtbike, mtbike, bmx, MTB, MTBIKE, mtb, bicycle, 7, 0, 0, 23, 0.68, 0.68, -1',
  '597, copcarsf, copcarsf, car, POLICE_SF, POLICAR, null, ignore, 10, 0, 0, -1, 0.7, 0.7, -1',
  'end',
].join('\n');

/** The stock file's shape, R*'s `csopcarla` typo row included. */
const TXDCUT_IDE = ['txdp', 'csopcarla, copcarla', 'csbobcat92, bobcat', 'csmtbike92, mtbike', 'end'].join('\n');

/** A two-colour palette + the bobcat/mtbike rows (indexes into it) — enough for the paint bake to run. */
const CARCOLS_DAT = ['col', '10,20,30', '40,50,60', 'end', 'car', 'bobcat, 0,1', 'mtbike, 0,1', 'end'].join('\n');

/** A real scene, so the two `anim/cuts.img` passes run rather than short-circuiting on a missing file. */
const SYND_4A = new Uint8Array(readFileSync('fixtures/original/anim/synd_4a.ifp'));

let dir: string;
let gamePath: string;
let inPath: string;
let outPath: string;

/** Every FILE under `root`, as `/`-joined relative paths, sorted — the shape of an emitted output. */
function filesUnder(root: string): string[] {
  return readdirSync(root, { recursive: true })
    .map(String)
    .filter((entry) => statSync(join(root, entry)).isFile())
    .map((entry) => entry.split(sep).join('/'))
    .sort();
}

/** Give the fixture game an `anim/cuts.img`, so both scene-value passes have something to read. */
function seedCutsImg(): void {
  mkdirSync(join(gamePath, 'anim'), { recursive: true });
  writeFileSync(join(gamePath, 'anim', 'cuts.img'), buildVer2Buffer([{ data: SYND_4A, name: 'synd_4a.ifp' }]));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vehicle-cutscene-install-'));
  gamePath = join(dir, 'game');
  inPath = join(dir, 'mods');
  outPath = join(dir, 'out');

  mkdirSync(join(gamePath, 'data'), { recursive: true });
  mkdirSync(join(gamePath, 'models', 'generic'), { recursive: true });
  writeFileSync(join(gamePath, 'data', 'vehicles.ide'), VEHICLES_IDE);
  writeFileSync(join(gamePath, 'data', 'txdcut.ide'), TXDCUT_IDE);
  writeFileSync(join(gamePath, 'data', 'carcols.dat'), CARCOLS_DAT);
  writeFileSync(
    join(gamePath, 'models', 'generic', 'vehicle.txd'),
    readFileSync('fixtures/original/models/generic/vehicle.txd'),
  );
  const gta3 = createImg();
  gta3.set('bobcat.txd', new Uint8Array(readFileSync('fixtures/original/dff/cutscene/bobcat.txd')));
  gta3.set('mtbike.txd', MTBIKE_TXD);
  writeImgFile(gta3, join(gamePath, 'models', 'gta3.img'));
  const img = createImg();
  img.set('csbobcat92.dff', CS_BOBCAT);
  img.set('csbobcat92.txd', new Uint8Array(16));
  img.set('csmtbike92.dff', CS_MTBIKE);
  img.set('csmtbike92.txd', new Uint8Array(8));
  img.set('cscopcarsf.dff', CS_BOBCAT); // stands in for the SFPD cutscene rig
  img.set('cscopcarsf.txd', new Uint8Array(8));
  img.set('csbarrel.dff', new Uint8Array(8)); // a prop the tool must leave alone
  writeImgFile(img, join(gamePath, 'models', 'cutscene.img'));

  mkdirSync(join(inPath, 'bobcat - some truck - author'), { recursive: true });
  writeFileSync(join(inPath, 'bobcat - some truck - author', 'bobcat.dff'), BOBCAT);
  writeFileSync(
    join(inPath, 'bobcat - some truck - author', 'bobcat.txd'),
    readFileSync('fixtures/original/dff/cutscene/bobcat.txd'),
  );
  mkdirSync(join(inPath, 'mtbike - a bike - author'), { recursive: true });
  writeFileSync(join(inPath, 'mtbike - a bike - author', 'mtbike.dff'), MTBIKE);
  writeFileSync(join(inPath, 'mtbike - a bike - author', 'mtbike.txd'), MTBIKE_TXD);
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('installCutscene', () => {
  describe('negative cases', () => {
    it('refuses an --out that equals --game', () => {
      expect(() => installCutscene({ gamePath, inPath, outPath: gamePath })).toThrow('--out must differ');
    });

    // The dangerous one: without the base copy there is no wipe to warn anybody, so a run onto the live
    // game would quietly overwrite three of its files. Case folded, because that is one folder on Windows.
    it('refuses an --out that equals --game under --no-base-copy, whatever its case', () => {
      expect(() => installCutscene({ gamePath, inPath, noBaseCopy: true, outPath: gamePath })).toThrow(
        '--out must differ',
      );
      expect(() => installCutscene({ gamePath, inPath, noBaseCopy: true, outPath: gamePath.toUpperCase() })).toThrow(
        '--out must differ',
      );
    });

    it('collects a conversion error instead of aborting the run', () => {
      writeFileSync(join(inPath, 'bobcat - some truck - author', 'bobcat.dff'), new Uint8Array([1, 2, 3]));
      const summary = installCutscene({ gamePath, inPath, outPath });
      expect(summary.converted).toEqual(['csmtbike92']);
      expect(summary.errors).toHaveLength(1);
      expect(summary.errors[0].csName).toBe('csbobcat92');
      expect(summary.errors[0].message).toContain('not a DFF');
    });

    it('fails the slot loudly when the txdp parent cannot resolve the textures', () => {
      const gta3 = createImg();
      writeImgFile(gta3, join(gamePath, 'models', 'gta3.img')); // no bobcat.txd parent any more
      const summary = installCutscene({ gamePath, inPath, outPath });
      expect(summary.converted).toEqual([]);
      expect(summary.errors[0].message).toContain('unresolved textures');
      expect(summary.errors[0].message).toContain('bobcat92interior128');
    });
  });

  describe('positive cases', () => {
    it('converts the ready car and bike, skips the pending boat-less slot, leaves props alone', () => {
      const summary = installCutscene({ gamePath, inPath, outPath });

      expect(summary.converted).toEqual(['csbobcat92', 'csmtbike92']);
      expect(summary.skipped).toEqual([{ csName: 'cscopcarsf', reason: 'no mod' }]);
      expect(summary.errors).toEqual([]);

      const img = openImg(new Uint8Array(readFileSync(join(outPath, 'models', 'cutscene.img'))));
      const converted = readClump(img.get('csbobcat92.dff')!);
      expect(converted.frames[1].name).toBe('bobcat_dummy');
      expect(converted.geometries).toHaveLength(16); // rebuilt (shared wheel, one extra by policy), not copied
      expect(readClump(img.get('csmtbike92.dff')!).frames[1].name).toBe('csbikechassis_dummy');
      // IMG VER2 pads entries to 2 048-byte sectors — presence + one-sector size says "untouched".
      expect(img.get('csbarrel.dff')?.byteLength).toBe(2048);
      // The slot's TXD is an empty dictionary (txdp does the resolving, step 6) PLUS the baked plate
      // pair (plan 003) — the bobcat wears the placeholder quads, the bike does not.
      expect(textureNames(img.get('csbobcat92.txd')!)).toEqual(['carplate', 'carpback']);
      expect(textureNames(img.get('csmtbike92.txd')!)).toEqual([]);
      expect(summary.plates).toHaveLength(1);
      expect(summary.plates[0].csName).toBe('csbobcat92');
      expect(summary.plates[0].text).toMatch(/^[A-Z]{2}\d{2} \d[A-Z]{2}$/); // the game's own LLDD DLL mask
      expect(summary.txdBytes).toBeGreaterThan(12_000); // the pair is ~12.5 KB against the 40 B empties
      expect(summary.txdBytes).toBeLessThan(20_000);

      // The paint bake ran: markers replaced by the fake palette, none of the marker RGBs survive.
      const paintedBobcat = summary.painted.find((entry) => entry.csName === 'csbobcat92');
      expect(paintedBobcat?.materials).toBeGreaterThan(0);
      const parsed = parseDff(toArrayBuffer(img.get('csbobcat92.dff')!));
      const colours = parsed.geometries.flatMap((geometry) =>
        geometry.materials.map((material) => `${material.color[0]},${material.color[1]},${material.color[2]}`),
      );
      expect(colours).not.toContain('60,255,0');
      expect(colours).not.toContain('255,0,175');
      expect(colours).toContain('10,20,30');
    });

    it('patches txdcut.ide: fixes the csopcarla typo, appends the rows R* left out', () => {
      installCutscene({ gamePath, inPath, outPath });
      const text = readFileSync(join(outPath, 'data', 'txdcut.ide'), 'utf8');
      expect(text).toContain('cscopcarla, copcarla');
      expect(text).not.toMatch(/^csopcarla,/m);
      expect(text).toContain('cscopcarsf, copcarsf');
      expect(text.trim().endsWith('end')).toBe(true);
    });

    it('embeds the MOD txd under --self-contained-txd when the parent cannot resolve', () => {
      const gta3 = createImg();
      writeImgFile(gta3, join(gamePath, 'models', 'gta3.img')); // stock-like parent: no bobcat.txd
      const summary = installCutscene({ gamePath, inPath, outPath, selfContainedTxd: true });
      expect(summary.errors).toEqual([]);
      expect(summary.converted).toEqual(['csbobcat92', 'csmtbike92']);
      const img = openImg(new Uint8Array(readFileSync(join(outPath, 'models', 'cutscene.img'))));
      expect(textureNames(img.get('csbobcat92.txd')!)).toContain('bobcat92interior128');
    });

    it('--no-base-copy emits the three written files and leaves the rest of --out alone', () => {
      seedCutsImg();
      mkdirSync(outPath, { recursive: true });
      writeFileSync(join(outPath, 'notes.txt'), 'the user picked a folder of their own');

      const summary = installCutscene({ gamePath, inPath, noBaseCopy: true, outPath });

      expect(summary.errors).toEqual([]);
      expect(filesUnder(outPath)).toEqual(['anim/cuts.img', 'data/txdcut.ide', 'models/cutscene.img', 'notes.txt']);
      expect(readFileSync(join(outPath, 'notes.txt'), 'utf8')).toBe('the user picked a folder of their own');
      // Emitted, not just present: the patched row set, read out of --game and written to --out.
      expect(readFileSync(join(outPath, 'data', 'txdcut.ide'), 'utf8')).toContain('cscopcarsf, copcarsf');
      expect(summary.converted).toEqual(['csbobcat92', 'csmtbike92']);
    });

    // The load-bearing check of plan 006: it is what lets the app and the pmb pipeline share one converter.
    // TWO full conversions, so it runs ~2.8 s alone and past the default 5 s timeout when the whole suite is
    // competing for the machine — it failed 4 runs in 5 at load average 8 while passing on its own. The work
    // is the test, not a leak: given its own budget rather than being made to do less.
    it('emits bytes identical to the base-copy run, file for file', () => {
      seedCutsImg();
      const leanPath = join(dir, 'out-lean');

      const copied = installCutscene({ gamePath, inPath, outPath });
      const lean = installCutscene({ gamePath, inPath, noBaseCopy: true, outPath: leanPath });

      expect(lean.converted).toEqual(copied.converted);
      expect(lean.imgBytesBefore).toBe(copied.imgBytesBefore);
      expect(lean.imgBytesAfter).toBe(copied.imgBytesAfter);
      for (const relative of [join('models', 'cutscene.img'), join('data', 'txdcut.ide'), join('anim', 'cuts.img')]) {
        expect(readFileSync(join(leanPath, relative))).toEqual(readFileSync(join(outPath, relative)));
      }
    }, 30_000);

    it('honours --only, converting nothing else', () => {
      const summary = installCutscene({ gamePath, inPath, only: new Set(['mtbike']), outPath });
      expect(summary.converted).toEqual(['csmtbike92']);
      expect(summary.skipped).toHaveLength(0);
      const img = openImg(new Uint8Array(readFileSync(join(outPath, 'models', 'cutscene.img'))));
      expect(img.get('csbobcat92.dff')).toHaveLength(CS_BOBCAT.length); // untouched
    });
  });
});
