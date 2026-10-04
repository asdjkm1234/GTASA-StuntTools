import { readRw, RW_STRUCT, RW_TEXTURE_DICTIONARY, RW_TEXTURE_NATIVE } from '@opensa/rw-codec/chunk';
import { readTextureName } from '@opensa/rw-codec/texture-native';
import { createImg, openImg } from '@opensa/tool-kit/archive/img';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mergeImgDir } from './img-merge';
import { pngToTextureNative } from './png-texture';
import { buildTxd, encodePng, solidRgba } from './test-utils';

/** The RW version the png-texture tests use — any SA-era version works for the codec. */
const VERSION = 0x1803ffff;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mod-installer-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

/** Write a loose IMG folder with the given `name → bytes` entries; returns its path. */
function imgDir(entries: Record<string, Uint8Array>): string {
  const path = join(dir, 'gta3_img');
  mkdirSync(path, { recursive: true });
  for (const [name, bytes] of Object.entries(entries)) {
    writeFileSync(join(path, name), bytes);
  }

  return path;
}

describe('mergeImgDir', () => {
  describe('negative cases', () => {
    it('does nothing for an empty IMG folder', () => {
      const path = join(dir, 'gta3_img');
      mkdirSync(path, { recursive: true });

      expect(mergeImgDir(path, join(dir, 'models', 'gta3.img'))).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('seeds a fresh archive when the target img does not exist', () => {
      const imgPath = join(dir, 'models', 'gta3.img');
      const merged = mergeImgDir(imgDir({ 'a.dff': Uint8Array.from([1, 2, 3, 4]) }), imgPath);

      const img = openImg(new Uint8Array(readFileSync(imgPath)));
      expect(merged).toBe(1);
      expect(img.has('a.dff')).toBe(true);
      // IMG VER2 pads entries to 2048-byte sectors, so compare the leading bytes.
      expect([...img.get('a.dff')!.slice(0, 4)]).toEqual([1, 2, 3, 4]);
    });

    it('replaces an existing entry by name and keeps the others', () => {
      const imgPath = join(dir, 'gta3.img');
      const base = createImg();
      base.set('a.dff', Uint8Array.from([9, 9]));
      base.set('keep.dff', Uint8Array.from([7]));
      writeFileSync(imgPath, base.build());

      mergeImgDir(imgDir({ 'a.dff': Uint8Array.from([1, 1, 1, 1]) }), imgPath);

      const img = openImg(new Uint8Array(readFileSync(imgPath)));
      expect([...img.get('a.dff')!.slice(0, 4)]).toEqual([1, 1, 1, 1]); // replaced
      expect(img.has('keep.dff')).toBe(true); // untouched
    });

    it('treats a "Remove original/" subfolder as organisational — its stubs REPLACE, never delete', () => {
      const imgPath = join(dir, 'gta3.img');
      const base = createImg();
      base.set('ferris01_law2.dff', Uint8Array.from([9])); // the stock geometry
      base.set('keep.dff', Uint8Array.from([7]));
      writeFileSync(imgPath, base.build());

      const path = imgDir({ 'ferriswheel_wheel.dff': Uint8Array.from([1]) });
      mkdirSync(join(path, 'Remove original'));
      writeFileSync(join(path, 'Remove original', 'ferris01_LAw2.dff'), Uint8Array.from([2])); // empty-clump stub

      const applied = mergeImgDir(path, imgPath);

      const img = openImg(new Uint8Array(readFileSync(imgPath)));
      expect(applied).toBe(2); // both files are entries
      expect([...img.get('ferris01_law2.dff')!.slice(0, 1)]).toEqual([2]); // stubbed, NOT retired
      expect(img.has('ferriswheel_wheel.dff')).toBe(true); // added
      expect(img.has('keep.dff')).toBe(true); // untouched
    });

    it('collects files from organisational subfolders by bare name (plan 009 — gta3_img/LV/… layouts)', () => {
      const imgPath = join(dir, 'gta3.img');
      const path = imgDir({ 'root.dff': Uint8Array.from([1]) });
      mkdirSync(join(path, 'LV', 'deep'), { recursive: true });
      writeFileSync(join(path, 'LV', 'nested.dff'), Uint8Array.from([2, 2]));
      writeFileSync(join(path, 'LV', 'deep', 'deeper.dff'), Uint8Array.from([3, 3, 3]));

      const applied = mergeImgDir(path, imgPath);

      const img = openImg(new Uint8Array(readFileSync(imgPath)));
      expect(applied).toBe(3);
      expect(img.has('root.dff')).toBe(true);
      expect(img.has('nested.dff')).toBe(true);
      expect(img.has('deeper.dff')).toBe(true);
    });

    it('merges a PNG subfolder into the same-named .txd ENTRY, warning when the entry is missing (plan 009)', () => {
      const imgPath = join(dir, 'gta3.img');
      const base = createImg();
      base.set(
        'philss.txd',
        buildTxd(
          [pngToTextureNative('existing', encodePng(solidRgba(8, 8, [10, 20, 30, 255]), 8, 8), VERSION)],
          VERSION,
        ),
      );
      writeFileSync(imgPath, base.build());

      const path = imgDir({});
      mkdirSync(join(path, 'philss'));
      writeFileSync(join(path, 'philss', 'cap_up.png'), encodePng(solidRgba(8, 8, [70, 80, 90, 255]), 8, 8));
      mkdirSync(join(path, 'ghosttxd'));
      writeFileSync(join(path, 'ghosttxd', 'orphan.png'), encodePng(solidRgba(8, 8, [1, 2, 3, 255]), 8, 8)); // warns

      const applied = mergeImgDir(path, imgPath);

      expect(applied).toBe(1); // one texture merged; the orphan folder only warned
      expect(txdNames(imgPath, 'philss.txd')).toEqual(['existing', 'cap_up']);
    });

    it('accepts a PNG folder named WITH the extension (previon.txd/), same as previon/', () => {
      const imgPath = join(dir, 'gta3.img');
      const base = createImg();
      base.set(
        'previon.txd',
        buildTxd([pngToTextureNative('existing', encodePng(solidRgba(8, 8, [9, 9, 9, 255]), 8, 8), VERSION)], VERSION),
      );
      writeFileSync(imgPath, base.build());

      const path = imgDir({});
      mkdirSync(join(path, 'previon.txd'));
      writeFileSync(join(path, 'previon.txd', 'remap.png'), encodePng(solidRgba(8, 8, [70, 80, 90, 255]), 8, 8));

      expect(mergeImgDir(path, imgPath)).toBe(1);
      expect(txdNames(imgPath, 'previon.txd')).toEqual(['existing', 'remap']);
    });

    it('merges the PNG subfolder into the .txd the SAME mod ships, not the stock entry', () => {
      // A mod may carry BOTH `<txd>.txd` and a `<txd>/` PNG folder: the mod's file lands first, then the
      // PNGs patch THAT dictionary — the stock entry (and its textures) must be fully superseded.
      const imgPath = join(dir, 'gta3.img');
      const base = createImg();
      base.set(
        'philss.txd',
        buildTxd([pngToTextureNative('stock', encodePng(solidRgba(8, 8, [9, 9, 9, 255]), 8, 8), VERSION)], VERSION),
      );
      writeFileSync(imgPath, base.build());

      const path = imgDir({
        'philss.txd': buildTxd(
          [pngToTextureNative('modded', encodePng(solidRgba(8, 8, [50, 60, 70, 255]), 8, 8), VERSION)],
          VERSION,
        ),
      });
      mkdirSync(join(path, 'philss'));
      writeFileSync(join(path, 'philss', 'cap_up.png'), encodePng(solidRgba(8, 8, [70, 80, 90, 255]), 8, 8));

      const applied = mergeImgDir(path, imgPath);

      expect(applied).toBe(2); // the mod's txd entry + one merged texture
      // 'stock' is gone (the mod's txd replaced the entry), 'cap_up' merged into the MOD's dictionary.
      expect(txdNames(imgPath, 'philss.txd')).toEqual(['modded', 'cap_up']);
    });
  });
});

/** The texture names of a `.txd` entry inside the img at `imgPath`, in dictionary order. */
function txdNames(imgPath: string, entryName: string): string[] {
  const img = openImg(new Uint8Array(readFileSync(imgPath)));
  const file = readRw(new Uint8Array(img.get(entryName)!));
  const dict = file.chunks.find((chunk) => chunk.type === RW_TEXTURE_DICTIONARY)!;

  return dict
    .children!.filter((c) => c.type === RW_TEXTURE_NATIVE)
    .map((c) => readTextureName(c.children!.find((s) => s.type === RW_STRUCT)!.data!));
}
