import { buildVer2Buffer } from '@opensa/renderware/archive/img-archive';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  findArchivesWithEntry,
  imgHasEntry,
  patchedEntries,
  patchImgEntry,
  readImgEntry,
  restoreImgEntry,
} from './img-patch';

const A = Uint8Array.from({ length: 100 }, (_, i) => i);
const B = Uint8Array.from({ length: 3000 }, (_, i) => (i * 7) % 256);
const NEW = Uint8Array.from({ length: 5000 }, () => 0xab);

let dir: string;
let img: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'img-patch-'));
  img = join(dir, 'gta3.img');
  writeFileSync(
    img,
    buildVer2Buffer([
      { data: A, name: 'a.dff' },
      { data: B, name: 'B.dff' },
    ]),
  );
});
afterEach(() => rmSync(dir, { force: true, recursive: true }));

describe('img-patch', () => {
  describe('negative cases', () => {
    it('refuses a name the directory does not carry', () => {
      expect(() => patchImgEntry(img, 'zzz.dff', NEW)).toThrow(/not in/);
      expect(restoreImgEntry(img, 'a.dff')).toBe(false); // never patched
    });

    it('finds no archive for a game dir whose gta3.img lacks the entry', () => {
      const game = join(dir, 'game');
      writeFileSync(join(dir, 'x'), ''); // keep tmp dir non-empty
      expect(findArchivesWithEntry(game, 'a.dff')).toEqual([]);
    });

    // An IMG editor that ADDS where it should replace leaves the name twice, and SA reads the FIRST record.
    // A last-wins index made `set` patch the copy the game never opens: success reported, nothing changed
    // in the field (the blade's `wg_r_lr_bl1.dff`, 2026-08-19).
    it('patches the FIRST record when the archive carries a name twice — the one SA reads', () => {
      const twice = join(dir, 'dup.img');
      writeFileSync(
        twice,
        buildVer2Buffer([
          { data: A, name: 'a.dff' },
          { data: B, name: 'b.dff' },
          { data: NEW, name: 'a.dff' },
        ]),
      );

      patchImgEntry(
        twice,
        'a.dff',
        Uint8Array.from({ length: 64 }, () => 0x5a),
      );

      expect(readImgEntry(twice, 'a.dff').subarray(0, 4)).toEqual(Uint8Array.of(0x5a, 0x5a, 0x5a, 0x5a));
    });
  });

  describe('positive cases', () => {
    it('set appends past the end, repoints the directory, and never shrinks the file', () => {
      const before = readFileSync(img).length;
      const { appendedAt } = patchImgEntry(img, 'b.dff', NEW); // case-insensitive name
      expect(appendedAt).toBe(before);
      expect(appendedAt % 2048).toBe(0);
      expect(readFileSync(img).length).toBeGreaterThan(before);
      expect(readImgEntry(img, 'B.dff').subarray(0, NEW.length)).toEqual(NEW);
      expect(readImgEntry(img, 'a.dff').subarray(0, A.length)).toEqual(A); // neighbour untouched
      expect(Object.keys(patchedEntries(img))).toEqual(['b.dff']);
    });

    it('restore puts the pristine bytes back, and a second set keeps the FIRST original', () => {
      patchImgEntry(img, 'b.dff', NEW);
      patchImgEntry(img, 'b.dff', A); // patch over a patch
      expect(readImgEntry(img, 'b.dff').subarray(0, A.length)).toEqual(A);
      expect(restoreImgEntry(img, 'b.dff')).toBe(true);
      expect(readImgEntry(img, 'b.dff').subarray(0, B.length)).toEqual(B);
      expect(patchedEntries(img)).toEqual({});
      expect(existsSync(`${img}.patches.json`)).toBe(true);
    });

    it('imgHasEntry is case-insensitive', () => {
      expect(imgHasEntry(img, 'A.DFF')).toBe(true);
      expect(imgHasEntry(img, 'c.dff')).toBe(false);
    });
  });
});
