import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadCreaseOverrides } from './crease-overrides';

function writeJson(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'crease-'));
  const path = join(dir, 'crease.json');
  writeFileSync(path, content);

  return path;
}

describe('loadCreaseOverrides', () => {
  describe('negative cases', () => {
    it('throws on an out-of-range angle', () => {
      expect(() => loadCreaseOverrides(writeJson('{"sphinx01_lvs": 200}'))).toThrow(/\(0, 180\)/);
    });

    it('throws on a non-numeric value', () => {
      expect(() => loadCreaseOverrides(writeJson('{"sphinx01_lvs": "steep"}'))).toThrow(/angle/);
    });

    it('returns undefined for a missing file', () => {
      expect(loadCreaseOverrides('/nonexistent/crease.json')).toBeUndefined();
    });

    it('returns undefined for a comment-only file (the shipped default today)', () => {
      expect(loadCreaseOverrides(writeJson('{"_comment": "curation loop"}'))).toBeUndefined();
    });
  });

  describe('positive cases', () => {
    it('parses entries lowercased and skips comment keys', () => {
      const overrides = loadCreaseOverrides(writeJson('{"_comment": "x", "Sphinx01_LVS": 80}'));
      expect(overrides?.get('sphinx01_lvs')).toBe(80);
      expect(overrides?.size).toBe(1);
    });
  });
});
