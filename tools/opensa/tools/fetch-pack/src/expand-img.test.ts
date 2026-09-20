import { createImg } from '@opensa/tool-kit/archive/img';
import { describe, expect, it } from 'vitest';

import { archiveOrder, expandModelArchives, isModelArchive } from './expand-img';

/** A VER2 archive holding `entries` — the real writer, so `openImg` reads it the way it reads a built game's. */
function img(entries: Record<string, string>): Uint8Array {
  const archive = createImg();
  for (const [name, text] of Object.entries(entries)) {
    archive.set(name, new TextEncoder().encode(text));
  }

  return archive.build();
}

/**
 * Read back what an expansion produced, as `name → text`.
 *
 * The NUL tail is stripped because a VER2 entry comes back PADDED to its 2 KiB sectors — the format stores a
 * size in sectors and the exact byte length is simply not in the directory. The local loader hands the runtime
 * the same padded bytes, so this is parity, not a defect.
 */
function textOf(entries: readonly { bytes: Uint8Array; name: string }[]): Record<string, string> {
  return Object.fromEntries(
    entries.map((entry) => [entry.name, new TextDecoder().decode(entry.bytes).replace(/\0+$/, '')]),
  );
}

describe('isModelArchive', () => {
  describe('negative cases', () => {
    it('does not claim the animation archive, whose entries nothing resolves by name', () => {
      expect(isModelArchive('anim/anim.img')).toBe(false);
    });

    it('does not claim a backup or an archive outside models/', () => {
      expect(isModelArchive('models/gostown6.img.bak')).toBe(false);
      expect(isModelArchive('data/paths/nodes.img')).toBe(false);
      expect(isModelArchive('models/sub/nested.img')).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('claims every models/*.img, whatever its case', () => {
      expect(isModelArchive('models/gta3.img')).toBe(true);
      expect(isModelArchive('models/GTA_INT.IMG')).toBe(true);
      expect(isModelArchive('models/gostown6.img')).toBe(true);
    });
  });
});

describe('archiveOrder', () => {
  describe('negative cases', () => {
    it('drops everything that is not a model archive', () => {
      expect(archiveOrder(['anim/anim.img', 'models/gta3.img', 'data/x.dat'])).toEqual(['models/gta3.img']);
    });
  });

  describe('positive cases', () => {
    it('puts gta3 first, gta_int second and the rest alphabetically (the local loader’s precedence)', () => {
      const paths = ['models/lods.img', 'models/gta_int.img', 'models/gostown6.img', 'models/gta3.img'];

      expect(archiveOrder(paths)).toEqual([
        'models/gta3.img',
        'models/gta_int.img',
        'models/gostown6.img',
        'models/lods.img',
      ]);
    });
  });
});

describe('expandModelArchives', () => {
  describe('negative cases', () => {
    it('returns nothing when the build ships no model archive', () => {
      expect(expandModelArchives(() => new Uint8Array(), ['anim/anim.img'])).toEqual([]);
    });

    it('lets gta3 win a name two archives both carry', () => {
      // `resolveSource` gives gta3 precedence in the local loader; serving the override's bytes instead would
      // render a different model depending on which loader the player arrived through.
      const files: Record<string, Uint8Array> = {
        'models/gta3.img': img({ 'shared.dff': 'from-gta3' }),
        'models/lods.img': img({ 'shared.dff': 'from-lods' }),
      };
      const entries = expandModelArchives((path) => files[path], Object.keys(files));

      expect(textOf(entries)).toEqual({ 'shared.dff': 'from-gta3' });
    });

    it('lets gta_int win over the other overrides, but never over gta3', () => {
      const files: Record<string, Uint8Array> = {
        'models/aaa.img': img({ 'both.txd': 'from-aaa', 'only-aaa.txd': 'aaa' }),
        'models/gta_int.img': img({ 'both.txd': 'from-gta-int' }),
      };
      const entries = expandModelArchives((path) => files[path], Object.keys(files));

      expect(textOf(entries)).toEqual({ 'both.txd': 'from-gta-int', 'only-aaa.txd': 'aaa' });
    });
  });

  describe('positive cases', () => {
    it('yields every entry under its bare lowercased name — the key the runtime asks for', () => {
      const files = { 'models/gta3.img': img({ 'BMYCG.osm': 'ped', 'Infernus.OSM': 'car' }) };
      const entries = expandModelArchives((path) => files[path as keyof typeof files], Object.keys(files));

      expect(entries.map((entry) => entry.name).sort()).toEqual(['bmycg.osm', 'infernus.osm']);
    });

    it('buckets each entry by its own extension, collision going with the geometry', () => {
      const files = {
        'models/gta3.img': img({
          'la.col': 'collision',
          'lae.ipl': 'placement',
          'ped.ifp': 'anim',
          'stock.dff': 'geometry',
          'stock.txd': 'dictionary',
          'x.osm': 'geometry',
          'x.ostex': 'dictionary',
        }),
      };
      const entries = expandModelArchives((path) => files[path as keyof typeof files], Object.keys(files));
      const group = Object.fromEntries(entries.map((entry) => [entry.name, entry.group]));

      expect(group).toEqual({
        'la.col': 'models',
        'lae.ipl': 'others',
        'ped.ifp': 'others',
        'stock.dff': 'models',
        'stock.txd': 'textures',
        'x.osm': 'models',
        'x.ostex': 'textures',
      });
    });

    it('merges several archives into one flat namespace', () => {
      const files: Record<string, Uint8Array> = {
        'models/gostown6.img': img({ 'town.col': 'c' }),
        'models/gta3.img': img({ 'bmycg.osm': 'ped' }),
      };
      const entries = expandModelArchives((path) => files[path], Object.keys(files));

      expect(entries.map((entry) => entry.name).sort()).toEqual(['bmycg.osm', 'town.col']);
    });
  });
});
