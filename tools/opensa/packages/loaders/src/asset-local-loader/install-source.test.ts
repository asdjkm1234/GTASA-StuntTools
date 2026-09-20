/**
 * Defends the "user picked a folder" boot path: picking the wrong folder must fail with a readable message
 * instead of a crash deep in the parser, an install whose models live in extra `models/*.img` archives (mods,
 * our cell-LOD `lods.img`) must still resolve, and the on-disk casing of a real GTA install (`MODELS/GTA3.IMG`)
 * must never decide whether the game boots.
 */
import { buildVer2Buffer } from '@opensa/renderware/archive';
import { describe, expect, it } from 'vitest';

import { browserInstallSource } from './install-source';

interface Tree {
  [name: string]: Tree | Uint8Array;
}

/** A fake File System Access directory tree — `Uint8Array` leaves are files, objects are subfolders. */
function fakeDir(name: string, tree: Tree): FileSystemDirectoryHandle {
  const entries = Object.entries(tree).map(([child, value]) =>
    value instanceof Uint8Array ? fakeFile(child, value) : fakeDir(child, value),
  );

  return {
    kind: 'directory',
    name,
    values: (): Generator<FileSystemDirectoryHandle | FileSystemFileHandle> => iterate(entries),
  } as unknown as FileSystemDirectoryHandle;
}

function fakeFile(name: string, bytes: Uint8Array): FileSystemFileHandle {
  return {
    getFile: () => Promise.resolve(new File([bytes as BlobPart], name)),
    kind: 'file',
    name,
  } as unknown as FileSystemFileHandle;
}

function* iterate<T>(items: readonly T[]): Generator<T> {
  for (const item of items) {
    yield item;
  }
}

const GTA3 = buildVer2Buffer([
  { data: new Uint8Array([1, 2, 3, 4]), name: 'cj.dff' },
  { data: new Uint8Array([5, 5]), name: 'dup.dff' },
]);
const GTA_INT = buildVer2Buffer([{ data: new Uint8Array([7, 7]), name: 'dup.dff' }]);
const MOD_IMG = buildVer2Buffer([
  { data: new Uint8Array([9, 9]), name: 'dup.dff' },
  { data: new Uint8Array([4, 2]), name: 'lod_5_5.dff' },
]);

/** A minimal but realistic install: gta3.img + a loose data file, plus whatever extra tree a test adds. */
function install(extra: Tree = {}): FileSystemDirectoryHandle {
  return fakeDir('gta-sa', {
    ...extra,
    data: { 'gta.dat': new TextEncoder().encode('IDE data/x.ide'), ...(extra.data as Tree) },
    models: { 'gta3.img': GTA3, ...(extra.models as Tree) },
  });
}

describe('browserInstallSource', () => {
  describe('negative cases', () => {
    it('throws a folder-picking hint when models/gta3.img is absent', async () => {
      const dir = fakeDir('downloads', { data: { 'gta.dat': new Uint8Array([1]) } });

      await expect(browserInstallSource(dir)).rejects.toThrow(/gta3\.img not found/i);
    });

    it('throws when models/gta3.img is not a VER2 archive', async () => {
      const dir = fakeDir('gta-sa', { models: { 'gta3.img': new Uint8Array(64) } });

      await expect(browserInstallSource(dir)).rejects.toThrow(/VER2/);
    });

    it('names the path when a loose file that was never indexed is read', async () => {
      const source = await browserInstallSource(install());

      await expect(source.readLoose('data/missing.ide')).rejects.toThrow(/loose file not found: data\/missing\.ide/);
    });

    it('reports no override archive when the install ships only gta3.img', async () => {
      const source = await browserInstallSource(install());

      expect(source.gtaInt).toBeNull();
    });

    it('keeps the lazily served archives and anim.img out of the loose-file set', async () => {
      const source = await browserInstallSource(
        install({ anim: { 'anim.img': new Uint8Array([1]) }, models: { 'gta_int.img': GTA_INT } }),
      );

      expect(await source.looseFiles()).toEqual(['data/gta.dat']);
    });

    it('skips .DS_Store droppings left by macOS', async () => {
      const source = await browserInstallSource(install({ data: { '.DS_Store': new Uint8Array([1]) } }));

      expect(await source.looseFiles()).toEqual(['data/gta.dat']);
    });
  });

  describe('positive cases', () => {
    it('finds the archives regardless of the on-disk casing', async () => {
      const dir = fakeDir('GTA-SA', { MODELS: { 'GTA3.IMG': GTA3, 'GTA_INT.IMG': GTA_INT } });
      const source = await browserInstallSource(dir);

      expect(source.gta3.has('cj.dff')).toBe(true);
      expect(source.gtaInt?.has('DUP.DFF')).toBe(true);
    });

    it('merges every extra models/*.img into one override archive so mod models resolve', async () => {
      const source = await browserInstallSource(install({ models: { 'lods.img': MOD_IMG } }));

      expect(source.gtaInt?.names.sort()).toEqual(['dup.dff', 'lod_5_5.dff']);
      expect(Array.from((await source.gtaInt!.read('lod_5_5.dff'))!.subarray(0, 2))).toEqual([4, 2]);
    });

    it('gives gta_int.img precedence over other mod archives for a duplicated name', async () => {
      // `aaa.img` sorts before gta_int.img alphabetically — precedence must not fall back to name order.
      const source = await browserInstallSource(install({ models: { 'aaa.img': MOD_IMG, 'gta_int.img': GTA_INT } }));

      expect(Array.from((await source.gtaInt!.read('dup.dff'))!.subarray(0, 2))).toEqual([7, 7]);
    });

    it('resolves an override name that no archive owns to null instead of throwing', async () => {
      const source = await browserInstallSource(install({ models: { 'lods.img': MOD_IMG } }));

      expect(await source.gtaInt!.read('nothing.dff')).toBeNull();
      expect(source.gtaInt!.has('nothing.dff')).toBe(false);
    });

    it('indexes loose files recursively under lowercased paths', async () => {
      const source = await browserInstallSource(
        install({ DATA: { Maps: { 'LA.IPL': new TextEncoder().encode('inst\nend') } } }),
      );

      expect((await source.looseFiles()).sort()).toEqual(['data/gta.dat', 'data/maps/la.ipl']);
      expect(await source.readLooseText('data/maps/la.ipl')).toBe('inst\nend');
    });

    it('reads loose bytes and gta3 entries from the picked folder', async () => {
      const source = await browserInstallSource(install());

      expect(Array.from(await source.readLoose('data/gta.dat'))).toEqual([
        ...new TextEncoder().encode('IDE data/x.ide'),
      ]);
      expect(Array.from((await source.gta3.read('CJ.DFF'))!.subarray(0, 4))).toEqual([1, 2, 3, 4]);
    });
  });
});
