import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkGameFolder, GAME_FILES } from './game-folder';
import { worstLevel } from './verdict';

let dir = '';

function makeGame(skip?: string): void {
  for (const file of GAME_FILES) {
    if (file === skip) {
      continue;
    }

    const path = join(dir, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '');
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'opensa-game-folder-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('checkGameFolder', () => {
  describe('negative cases', () => {
    it('errors on a folder that does not exist, without listing files that cannot be there', () => {
      const verdicts = checkGameFolder(join(dir, 'nope'));

      expect(verdicts).toHaveLength(1);
      expect(verdicts[0].code).toBe('path.missing');
    });

    it.each(GAME_FILES)('errors when %s is missing, naming that file', (file) => {
      makeGame(file);

      const verdicts = checkGameFolder(dir);
      const errors = verdicts.filter((verdict) => verdict.level === 'error');

      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain(file);
    });

    it('names every missing file at once rather than stopping at the first', () => {
      mkdirSync(join(dir, 'data'), { recursive: true });
      writeFileSync(join(dir, 'data', 'carcols.dat'), '');

      const errors = checkGameFolder(dir).filter((verdict) => verdict.level === 'error');

      expect(errors).toHaveLength(GAME_FILES.length - 1);
    });
  });

  describe('positive cases', () => {
    it('passes a folder carrying every file we read', () => {
      makeGame();

      expect(worstLevel(checkGameFolder(dir))).toBe('ok');
    });

    it('passes a MODIFIED game — extra files are not our business', () => {
      makeGame();
      writeFileSync(join(dir, 'modloader.asi'), '');
      writeFileSync(join(dir, 'data', 'handling.cfg'), 'modded');

      expect(worstLevel(checkGameFolder(dir))).toBe('ok');
    });
  });
});
