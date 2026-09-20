import { buildVer2Buffer } from '@opensa/renderware/archive/img-archive';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ARCHIVE_MANIFEST, openArchiveIndex, openLazyVer2, writeArchiveManifest } from './layout';

let dir: string;

/** A game tree whose entries are spread across three archives, as a split one is. */
function tree(): string {
  const game = join(dir, 'game');
  mkdirSync(join(game, 'models'), { recursive: true });
  mkdirSync(join(game, 'data'), { recursive: true });
  writeFileSync(join(game, 'models', 'gta3.img'), buildVer2Buffer([{ data: Uint8Array.of(1), name: 'kb_bar.dff' }]));
  writeFileSync(
    join(game, 'models', 'vehicles.img'),
    buildVer2Buffer([{ data: Uint8Array.of(2), name: 'dinghy.txd' }]),
  );
  writeFileSync(
    join(game, 'models', 'vehicles2.img'),
    buildVer2Buffer([{ data: Uint8Array.of(3), name: 'washing.txd' }]),
  );

  return game;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'img-layout-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('openLazyVer2', () => {
  describe('negative cases', () => {
    it('returns null for anything that is not VER2', () => {
      const path = join(dir, 'not.img');
      writeFileSync(path, 'WIMG-or-junk');
      expect(openLazyVer2(path)).toBeNull();
    });
  });

  describe('positive cases', () => {
    it('reads an entry without buffering the archive', () => {
      const path = join(dir, 'a.img');
      writeFileSync(path, buildVer2Buffer([{ data: Uint8Array.of(7, 8), name: 'x.dff' }]));

      const reader = openLazyVer2(path);
      expect(reader?.names).toEqual(['x.dff']);
      expect([...new Uint8Array(reader!.get('x.dff')!).slice(0, 2)]).toEqual([7, 8]);
    });
  });
});

describe('openArchiveIndex', () => {
  describe('negative cases', () => {
    it('resolves nothing for an absent entry, and survives a tree with no models dir', () => {
      const index = openArchiveIndex(tree());
      expect(index.archiveOf('nope.dff')).toBeNull();
      expect(index.get('nope.dff')).toBeNull();
      expect(openArchiveIndex(join(dir, 'empty')).archives).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('finds an entry in whichever archive holds it — the split’s whole point', () => {
      // The failure this replaces: vehicle-cutscene opened gta3.img by name and reported a txdp parent
      // missing after the split had moved it into a vehicles archive.
      const index = openArchiveIndex(tree());

      expect(index.archiveOf('kb_bar.dff')).toBe('gta3.img');
      expect(index.archiveOf('dinghy.txd')).toBe('vehicles.img');
      expect(index.archiveOf('WASHING.TXD')).toBe('vehicles2.img');
      expect([...new Uint8Array(index.get('washing.txd')!).slice(0, 1)]).toEqual([3]);
    });
  });
});

describe('writeArchiveManifest', () => {
  describe('positive cases', () => {
    it('reports every archive, and says in the file that it is a report', () => {
      const game = tree();

      const archives = writeArchiveManifest(game, { contested: ['slamvan.txd'] });

      expect(archives.map((archive) => archive.name)).toEqual(['gta3.img', 'vehicles.img', 'vehicles2.img']);
      const written = JSON.parse(readFileSync(join(game, ARCHIVE_MANIFEST), 'utf8')) as {
        archives: { entries: number }[];
        contested: string[];
        note: string;
      };
      expect(written.archives.map((archive) => archive.entries)).toEqual([1, 1, 1]);
      expect(written.contested).toEqual(['slamvan.txd']);
      expect(written.note).toMatch(/REPORT/);
    });

    it('refreshes the archives and KEEPS what an earlier stage knew', () => {
      // The first pipeline run shipped a manifest describing the tree as it had been at stage one: gta3.img
      // 750 MB lighter and no spill sibling. Whoever finishes a tree restates the part it can see, and the
      // classifier's lists survive because this stage cannot recompute them.
      const game = tree();
      writeArchiveManifest(game, { contested: ['slamvan.txd'], unclaimed: 952 });
      writeFileSync(join(game, 'models', 'peds.img'), buildVer2Buffer([{ data: Uint8Array.of(4), name: 'cop.dff' }]));

      writeArchiveManifest(game);

      const written = JSON.parse(readFileSync(join(game, ARCHIVE_MANIFEST), 'utf8')) as {
        archives: { name: string }[];
        contested: string[];
        unclaimed: number;
      };
      expect(written.archives.map((archive) => archive.name)).toContain('peds.img');
      expect(written.contested).toEqual(['slamvan.txd']);
      expect(written.unclaimed).toBe(952);
    });
  });
});
