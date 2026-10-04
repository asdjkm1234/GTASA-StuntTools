import {
  createImg,
  imgFamilyMembers,
  openImg,
  openImgFamily,
  writeImgFamily,
  writeImgFile,
} from '@opensa/tool-kit/archive/img';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { rewriteModelArchives } from './archive-edit';

function entriesOf(root: string, file: string): string[] {
  return openImg(new Uint8Array(readFileSync(join(root, 'models', file)))).names();
}

/** A game-dir stub with `models/<file>.img` archives holding the given entries. */
function gameDir(archives: Record<string, Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'archive-edit-'));
  mkdirSync(join(root, 'models'));
  for (const [file, entries] of Object.entries(archives)) {
    const img = createImg();
    for (const [name, text] of Object.entries(entries)) {
      img.set(name, new TextEncoder().encode(text));
    }
    writeImgFile(img, join(root, 'models', file));
  }

  return root;
}

describe('rewriteModelArchives', () => {
  describe('negative cases', () => {
    it('does not write an insert whose `near` no archive holds', () => {
      const root = gameDir({ 'gta3.img': { 'landstal.dff': 'model' } });

      const report = rewriteModelArchives(root, {
        deletes: [],
        inserts: [{ bytes: new Uint8Array([1]), name: 'ghost.osm', near: 'ghost.dff' }],
      });

      expect(report.unplaced).toEqual(['ghost.osm']);
      expect(entriesOf(root, 'gta3.img')).toEqual(['landstal.dff']);
    });

    it('reports a delete no archive holds instead of failing', () => {
      const root = gameDir({ 'gta3.img': { 'landstal.dff': 'model' } });

      const report = rewriteModelArchives(root, { deletes: ['absent.txd'], inserts: [] });

      expect(report.missingDeletes).toEqual(['absent.txd']);
      expect(report.archives).toEqual([]);
    });

    it('leaves an archive with nothing to change untouched', () => {
      const root = gameDir({ 'gta3.img': { 'landstal.dff': 'model' }, 'gta_int.img': { 'chair.dff': 'prop' } });

      const report = rewriteModelArchives(root, {
        deletes: ['landstal.dff'],
        inserts: [{ bytes: new Uint8Array([1]), name: 'landstal.osm', near: 'landstal.dff' }],
      });

      expect(report.archives.map((archive) => archive.file)).toEqual(['gta3.img']);
      expect(entriesOf(root, 'gta_int.img')).toEqual(['chair.dff']);
    });
  });

  describe('positive cases', () => {
    it('replaces an entry with its optimized form in the same archive', () => {
      const root = gameDir({ 'gta3.img': { 'landstal.dff': 'model', 'landstal.txd': 'textures' } });

      const report = rewriteModelArchives(root, {
        deletes: ['landstal.dff', 'landstal.txd'],
        inserts: [
          { bytes: new TextEncoder().encode('osm'), name: 'landstal.osm', near: 'landstal.dff' },
          { bytes: new TextEncoder().encode('ostex'), name: 'landstal.ostex', near: 'landstal.dff' },
        ],
      });

      expect(entriesOf(root, 'gta3.img').sort()).toEqual(['landstal.osm', 'landstal.ostex']);
      expect(report.archives).toHaveLength(1);
      expect(report.archives[0].deleted).toBe(2);
      expect(report.archives[0].inserted).toBe(2);
      expect(report.archives[0].file).toBe('gta3.img');
      expect(report.unplaced).toEqual([]);
    });

    it('places each insert in the archive that held its origin', () => {
      const root = gameDir({ 'gta3.img': { 'landstal.dff': 'model' }, 'gta_int.img': { 'chair.dff': 'prop' } });

      rewriteModelArchives(root, {
        deletes: ['landstal.dff', 'chair.dff'],
        inserts: [
          { bytes: new Uint8Array([1]), name: 'landstal.osm', near: 'landstal.dff' },
          { bytes: new Uint8Array([2]), name: 'chair.osm', near: 'chair.dff' },
        ],
      });

      expect(entriesOf(root, 'gta3.img')).toEqual(['landstal.osm']);
      expect(entriesOf(root, 'gta_int.img')).toEqual(['chair.osm']);
    });

    it('keeps the bytes it inserted readable after the rebuild', () => {
      const root = gameDir({ 'gta3.img': { 'landstal.dff': 'model' } });

      rewriteModelArchives(root, {
        deletes: ['landstal.dff'],
        inserts: [{ bytes: new TextEncoder().encode('OSM1payload'), name: 'landstal.osm', near: 'landstal.dff' }],
      });

      const img = openImg(new Uint8Array(readFileSync(join(root, 'models', 'gta3.img'))));
      expect(new TextDecoder().decode(img.get('landstal.osm')?.subarray(0, 11))).toBe('OSM1payload');
    });
  });
});

describe('rewriteModelArchives — archive families', () => {
  describe('negative cases', () => {
    it('treats vehicles2.img as a member of vehicles.img, never as a base of its own', () => {
      // vehicles.img holds a.dff, vehicles2.img holds b.dff (a spilled install); an insert near b.dff must
      // land in the FAMILY, and a stray sibling with no base (lone7.img) is a base.
      const root = gameDir({ 'lone7.img': { 'z.dff': 'z' } });
      const family = createImg();
      family.set('a.dff', new TextEncoder().encode('a'));
      family.set('b.dff', new TextEncoder().encode('b'));
      writeImgFamily(family, join(root, 'models', 'vehicles.img'), 2048 + 2 * (2048 + 32) - 1);
      expect(imgFamilyMembers(join(root, 'models', 'vehicles.img'))).toHaveLength(2);
      mkdirSync(join(root, 'data'));
      writeFileSync(join(root, 'data', 'gta.dat'), 'IMG MODELS\\VEHICLES.IMG\nIMG MODELS\\VEHICLES2.IMG\n');

      const report = rewriteModelArchives(root, {
        deletes: ['b.dff'],
        inserts: [{ bytes: new TextEncoder().encode('B'), name: 'b.osm', near: 'b.dff' }],
      });

      expect(report.unplaced).toEqual([]);
      const written = openImgFamily(join(root, 'models', 'vehicles.img'));
      expect(written.names().sort()).toEqual(['a.dff', 'b.osm']);
      expect(entriesOf(root, 'lone7.img')).toEqual(['z.dff']);
      // Two tiny entries fit one file under the real cap: the sibling is gone AND un-registered.
      expect(existsSync(join(root, 'models', 'vehicles2.img'))).toBe(false);
      expect(readFileSync(join(root, 'data', 'gta.dat'), 'latin1')).toBe('IMG MODELS\\VEHICLES.IMG\n');
    });
  });

  describe('positive cases', () => {
    it('re-plans a family whose entries grew past the cap into a new sibling, and registers it', () => {
      const root = gameDir({ 'vehicles.img': { 'a.dff': 'a', 'b.dff': 'b' } });
      mkdirSync(join(root, 'data'));
      writeFileSync(join(root, 'data', 'gta.dat'), 'IMG MODELS\\VEHICLES.IMG\n');
      // The real cap is 1.75 GiB; the writer plans against ARCHIVE_CAP_BYTES, so growth is exercised by
      // giving one entry a payload past a sector — the family stays ONE file here, but the path is the
      // family writer, and a shrink un-registers: delete everything but one.
      const report = rewriteModelArchives(root, {
        deletes: ['a.dff', 'b.dff'],
        inserts: [{ bytes: new Uint8Array(5000).fill(1), name: 'a.osm', near: 'a.dff' }],
      });

      expect(report.archives.map((a) => a.file)).toEqual(['vehicles.img']);
      expect(openImgFamily(join(root, 'models', 'vehicles.img')).names()).toEqual(['a.osm']);
      expect(existsSync(join(root, 'models', 'vehicles2.img'))).toBe(false);
      expect(readFileSync(join(root, 'data', 'gta.dat'), 'latin1')).toBe('IMG MODELS\\VEHICLES.IMG\n');
    });
  });
});
