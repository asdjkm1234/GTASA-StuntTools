import { SA_FINGERPRINT } from '@opensa/asi-sdk/sa-fingerprint';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkSaExe, SA_EXE } from './sa-exe';

let dir = '';

/** The accepted exe is 14 MB of bytes nobody has; the check reads size then sha1, so size alone gates. */
function writeExe(bytes: number): void {
  writeFileSync(join(dir, SA_EXE), Buffer.alloc(bytes));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'opensa-sa-exe-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('checkSaExe', () => {
  describe('negative cases', () => {
    it('errors when the folder has no exe at all', () => {
      const [verdict] = checkSaExe(dir);

      expect(verdict.code).toBe('file.missing');
    });

    it('errors on a one-byte-different exe and carries the fingerprint in the detail', () => {
      writeExe(SA_FINGERPRINT.exeSize - 1);

      const [verdict] = checkSaExe(dir);

      expect(verdict.code).toBe('file.size-mismatch');
      expect(verdict.detail).toContain(String(SA_FINGERPRINT.exeSize));
    });

    it('errors on an exe of the right size whose bytes are not the accepted build', () => {
      writeExe(SA_FINGERPRINT.exeSize);

      const [verdict] = checkSaExe(dir);

      expect(verdict.code).toBe('file.sha1-mismatch');
      expect(verdict.detail).toContain(SA_FINGERPRINT.sha1);
    });

    it('says what an unsupported exe costs, since the failure only shows up in-game', () => {
      writeExe(1);

      const [verdict] = checkSaExe(dir);

      expect(verdict.level).toBe('error');
      expect(verdict.level === 'error' && verdict.fix).toContain(SA_FINGERPRINT.sha1);
      expect(verdict.level === 'error' && verdict.fix).toContain('behind car glass');
    });
  });

  describe('positive cases', () => {
    // The real accepted build, from the fixture corpus (`copy('gta_sa.exe', …)`): the reject cases prove the
    // gate closes, and only this one proves it opens for the exe we actually ship to.
    it('passes the accepted exe', () => {
      const [verdict] = checkSaExe('fixtures/original');

      expect(verdict.level).toBe('ok');
      expect(verdict.code).toBe('file.ok');
    });

    it('reads the exe name it is given rather than assuming gta_sa.exe', () => {
      writeFileSync(join(dir, 'renamed.exe'), Buffer.alloc(1));

      const [verdict] = checkSaExe(dir, 'renamed.exe');

      expect(verdict.message).toContain('renamed.exe');
    });
  });
});
