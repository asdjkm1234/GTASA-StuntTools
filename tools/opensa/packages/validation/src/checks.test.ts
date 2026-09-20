import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkDirectory, checkEntries, checkFile, checkWritable } from './checks';

// sha1 of 'hello'
const HELLO_SHA1 = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'opensa-validation-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('checks', () => {
  describe('negative cases', () => {
    it('errors when the directory does not exist', () => {
      const [verdict] = checkDirectory(join(dir, 'nope'), 'game folder');

      expect(verdict.level).toBe('error');
      expect(verdict.code).toBe('path.missing');
    });

    it('errors when the path is a file rather than a directory', () => {
      writeFileSync(join(dir, 'a-file'), '');

      const [verdict] = checkDirectory(join(dir, 'a-file'), 'game folder');

      expect(verdict.code).toBe('path.not-a-directory');
    });

    // Not a chmod'd folder: as root that write succeeds and the test would pass for the wrong reason.
    it('errors when the directory cannot be written to', () => {
      const [verdict] = checkWritable(join(dir, 'no-such-parent', 'out'), 'output folder');

      expect(verdict.code).toBe('path.not-writable');
    });

    it('reports every missing entry separately, naming each one', () => {
      writeFileSync(join(dir, 'present.img'), '');

      const verdicts = checkEntries(dir, ['present.img', 'gone.img', 'also-gone.ide'], 'game folder');

      expect(verdicts).toHaveLength(2);
      expect(verdicts.map((verdict) => verdict.message)).toStrictEqual([
        'The game folder is missing gone.img.',
        'The game folder is missing also-gone.ide.',
      ]);
    });

    it('errors when a named entry sits in a subfolder that does not exist', () => {
      const verdicts = checkEntries(dir, ['models/gta3.img'], 'game folder');

      expect(verdicts).toHaveLength(1);
      expect(verdicts[0].code).toBe('path.entry-missing');
    });

    it('errors when the file is absent', () => {
      const [verdict] = checkFile(join(dir, 'gone.exe'), { size: 5 }, 'gta_sa.exe');

      expect(verdict.code).toBe('file.missing');
    });

    it('errors when the size differs, naming both sizes in the detail', () => {
      const path = join(dir, 'a.exe');
      writeFileSync(path, 'hello');

      const [verdict] = checkFile(path, { size: 6 }, 'gta_sa.exe');

      expect(verdict.code).toBe('file.size-mismatch');
      expect(verdict.detail).toContain('is 5 bytes, expected 6');
    });

    it('errors when the sha1 differs, naming both hashes in the detail', () => {
      const path = join(dir, 'a.exe');
      writeFileSync(path, 'hello');

      const [verdict] = checkFile(path, { sha1: '0'.repeat(40) }, 'gta_sa.exe');

      expect(verdict.code).toBe('file.sha1-mismatch');
      expect(verdict.detail).toContain(HELLO_SHA1);
    });

    it('gives every error a fix — an error a user cannot act on is a crash with extra steps', () => {
      const verdicts = [
        ...checkDirectory(join(dir, 'nope'), 'game folder'),
        ...checkEntries(dir, ['gone.img'], 'game folder'),
        ...checkFile(join(dir, 'gone.exe'), {}, 'gta_sa.exe'),
      ];

      expect(verdicts).toHaveLength(3);
      for (const verdict of verdicts) {
        expect(verdict.level).toBe('error');
        expect(verdict.level === 'error' && verdict.fix.length).toBeGreaterThan(0);
      }
    });
  });

  describe('positive cases', () => {
    it('passes an existing directory', () => {
      const [verdict] = checkDirectory(dir, 'game folder');

      expect(verdict.level).toBe('ok');
      expect(verdict.code).toBe('path.ok');
    });

    it('passes a writable directory and leaves no probe file behind', () => {
      const [verdict] = checkWritable(dir, 'output folder');

      expect(verdict.code).toBe('path.writable');
      expect(existsSync(join(dir, `.opensa-write-probe-${process.pid}`))).toBe(false);
    });

    it('passes when every named entry is present, subfolders included', () => {
      mkdirSync(join(dir, 'models'), { recursive: true });
      writeFileSync(join(dir, 'models', 'gta3.img'), '');
      writeFileSync(join(dir, 'top.ide'), '');

      const verdicts = checkEntries(dir, ['models/gta3.img', 'top.ide'], 'game folder');

      expect(verdicts).toHaveLength(1);
      expect(verdicts[0].level).toBe('ok');
      expect(verdicts[0].message).toContain('all 2 files');
    });

    it('passes a file matching both size and sha1', () => {
      const path = join(dir, 'a.exe');
      writeFileSync(path, 'hello');

      const [verdict] = checkFile(path, { sha1: HELLO_SHA1, size: 5 }, 'gta_sa.exe');

      expect(verdict.level).toBe('ok');
      expect(verdict.code).toBe('file.ok');
    });

    it('passes a file when nothing is expected of it beyond existing', () => {
      const path = join(dir, 'a.exe');
      writeFileSync(path, 'hello');

      expect(checkFile(path, {}, 'gta_sa.exe')[0].level).toBe('ok');
    });
  });
});
