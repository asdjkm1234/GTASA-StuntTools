import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { discoverScriptDirs, SCRIPT_ENTRY } from './build';

const tempRoots: string[] = [];

function makeScriptsHome(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'cleo-sdk-build-'));
  tempRoots.push(root);

  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('discoverScriptDirs', () => {
  describe('negative cases', () => {
    it('throws when the scripts home does not exist', () => {
      expect(() => discoverScriptDirs(path.join(tmpdir(), 'cleo-sdk-missing-home'))).toThrow('scripts home not found');
    });
  });

  describe('positive cases', () => {
    it('returns an empty list for an empty scripts home', () => {
      expect(discoverScriptDirs(makeScriptsHome())).toEqual([]);
    });

    it('lists only directories carrying a script entry, sorted by name', () => {
      const root = makeScriptsHome();
      for (const name of ['zulu', 'alpha']) {
        mkdirSync(path.join(root, name));
        writeFileSync(path.join(root, name, SCRIPT_ENTRY), '');
      }
      mkdirSync(path.join(root, 'no-entry'));
      writeFileSync(path.join(root, 'README.md'), '');

      expect(discoverScriptDirs(root)).toEqual(['alpha', 'zulu']);
    });
  });
});
