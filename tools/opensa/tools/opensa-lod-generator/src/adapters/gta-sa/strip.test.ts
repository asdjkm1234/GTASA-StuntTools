import { openArchive } from '@opensa/renderware/archive/img-archive';
import { createImg } from '@opensa/tool-kit/archive/img';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { stripOldLods } from './strip';

/**
 * A synthetic build: one text IPL where `renameda` (non-`lod` name!) is a pure LOD target, `renamedb` is
 * dual-role (targeted once + placed standalone), and `lodplate` is a name-rule exterior LOD. gta3.img carries
 * their DFFs (and no binary streams).
 */
function makeBuild(): string {
  const dir = mkdtempSync(join(tmpdir(), 'opensa-strip-'));
  mkdirSync(join(dir, 'data'));
  mkdirSync(join(dir, 'models'));
  writeFileSync(join(dir, 'data', 'gta.dat'), 'IDE DATA\\x.ide\nIPL DATA\\x.ipl\n');
  writeFileSync(
    join(dir, 'data', 'x.ide'),
    [
      'objs',
      '1, hd_a, txda, 300, 0',
      '2, renameda, txdb, 1500, 0',
      '3, renamedb, txdb, 1500, 0',
      '4, lodplate, txdc, 1500, 0',
      'end',
    ].join('\n'),
  );
  writeFileSync(
    join(dir, 'data', 'x.ipl'),
    [
      'inst',
      '1, hd_a, 0, 0,0,0, 0,0,0,1, 1', // HD → targets row 1
      '2, renameda, 0, 0,0,0, 0,0,0,1, -1', // pure target, name-rule blind to it
      '1, hd_a, 0, 9,9,9, 0,0,0,1, 3', // HD → targets row 3
      '3, renamedb, 0, 9,9,9, 0,0,0,1, -1', // targeted here…
      '3, renamedb, 0, 50,50,50, 0,0,0,1, -1', // …but standalone here — must survive
      '4, lodplate, 0, 20,20,20, 0,0,0,1, -1', // name-rule exterior LOD
      'end',
    ].join('\n'),
  );
  const img = createImg();
  for (const name of ['renameda.dff', 'renamedb.dff', 'lodplate.dff', 'hd_a.dff']) {
    img.set(name, Uint8Array.of(1, 2, 3));
  }
  writeFileSync(join(dir, 'models', 'gta3.img'), img.build());

  return dir;
}

describe('stripOldLods', () => {
  describe('negative cases', () => {
    it('keeps a dual-role model’s standalone placement and its DFF', () => {
      const dir = makeBuild();
      stripOldLods(dir);
      const ipl = readFileSync(join(dir, 'data', 'x.ipl'), 'utf8');
      const archive = openArchive(new Uint8Array(readFileSync(join(dir, 'models', 'gta3.img'))));

      expect(ipl).toContain('50,50,50'); // the standalone renamedb row survives
      expect(archive.get('renamedb.dff')).not.toBeNull(); // still placed → DFF stays
      expect(archive.get('hd_a.dff')).not.toBeNull();
    });
  });

  describe('positive cases', () => {
    it('strips lod-index targets regardless of naming and deletes fully-unplaced DFFs', () => {
      const dir = makeBuild();
      const { entries, instances } = stripOldLods(dir);
      const ipl = readFileSync(join(dir, 'data', 'x.ipl'), 'utf8');
      const archive = openArchive(new Uint8Array(readFileSync(join(dir, 'models', 'gta3.img'))));

      expect(ipl).not.toContain('renameda'); // pure target gone despite the non-lod name
      expect(ipl).toContain('hd_a'); // the HD rows stay…
      expect(ipl).not.toMatch(/hd_a.*,\s*[13]\s*$/m); // …with their lod pointers repaired (no dangling index)
      expect(archive.get('renameda.dff')).toBeNull(); // no surviving placement → DFF deleted
      expect(instances).toBe(3); // renameda target + renamedb target + lodplate
      expect(entries).toBe(2); // renameda.dff + lodplate.dff
    });
  });
});
