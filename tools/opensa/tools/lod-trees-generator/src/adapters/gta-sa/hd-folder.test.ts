import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { hdFolder } from './index';

/**
 * The optional HD-tree folder. perfect-map-builder passes `<mods-src>/vegetation` unconditionally, whether or
 * not the user keeps it — a bare `statSync` on that path threw ENOENT and killed the whole pipeline stage,
 * even though the generator has always had a complete no-`--in` path.
 */
describe('hdFolder', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lod-trees-hd-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  describe('negative cases', () => {
    it('treats an absent folder as no HD source', () => {
      expect(hdFolder(join(dir, 'nope'))).toBeUndefined();
    });

    it('treats a folder with no .dff as no HD source', () => {
      writeFileSync(join(dir, 'readme.txt'), 'not a model');

      expect(hdFolder(dir)).toBeUndefined();
    });

    it('passes `undefined` straight through', () => {
      expect(hdFolder(undefined)).toBeUndefined();
    });
  });

  describe('positive cases', () => {
    it('keeps a folder that ships models', () => {
      writeFileSync(join(dir, 'tree.dff'), 'x');

      expect(hdFolder(dir)).toBe(dir);
    });

    it('keeps a single-file pick', () => {
      const file = join(dir, 'tree.dff');
      writeFileSync(file, 'x');

      expect(hdFolder(file)).toBe(file);
    });
  });
});
