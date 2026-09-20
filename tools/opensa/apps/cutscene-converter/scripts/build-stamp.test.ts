import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { formatBuildStamp, readBuildStamp, UNKNOWN_STAMP } from './build-stamp';

describe('the build stamp', () => {
  describe('negative cases', () => {
    it('reads as unknown with no sha', () => {
      expect(formatBuildStamp('', false)).toBe(UNKNOWN_STAMP);
    });

    it('reads as unknown outside a git tree instead of failing the build', () => {
      const dir = mkdtempSync(join(tmpdir(), 'cutscene-converter-stamp-'));

      try {
        expect(readBuildStamp(dir)).toBe(UNKNOWN_STAMP);
      } finally {
        rmSync(dir, { force: true, recursive: true });
      }
    });
  });

  describe('positive cases', () => {
    it('is the short sha of a clean tree', () => {
      expect(formatBuildStamp('8e05ded2', false)).toBe('8e05ded2');
    });

    // An exe built over uncommitted work cannot be reproduced from its sha, and that is the thing worth
    // knowing when its behaviour does not match the commit.
    it('marks a tree that carries changes', () => {
      expect(formatBuildStamp('8e05ded2', true)).toBe('8e05ded2-dirty');
    });
  });
});
