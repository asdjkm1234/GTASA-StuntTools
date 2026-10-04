import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { PROPOSED_ANCHORS, resolveGameExe, validateAnchor, validateExecutable } from './spike-recorder-offsets.mts';

const gameFlag = process.argv.indexOf('--game');
const gameDirectory = gameFlag >= 0 ? process.argv[gameFlag + 1] : undefined;
const executable = resolveGameExe(gameDirectory);

describe('recorder byte anchors', () => {
  describe('negative cases', () => {
    it('rejects the deliberately wrong expected byte', () => {
      // Given: a fixture whose fourth byte differs from the local executable.
      const corrupt: unknown = JSON.parse(readFileSync(resolve('scripts/fixtures/anchor-corrupt.json'), 'utf8'));

      // When/Then: validating it against freshly-read executable bytes fails.
      expect(() => validateAnchor(executable, corrupt)).toThrow(/byte-anchor-mismatch/);
    });
  });

  describe('positive cases', () => {
    it('accepts the canonical fingerprint and every proposed byte anchor', () => {
      // Given/When: the executable is hashed and every anchor is read at test time.
      const result = validateExecutable(executable, PROPOSED_ANCHORS);

      // Then: identity and all proposed instruction anchors match the canonical contract.
      expect(result.fingerprint).toEqual({
        sha1: '8c23ceffafa9fd88ea567be7926a33413b8e3c00',
        size: 14_383_616,
      });
      expect(result.anchors.every((anchor) => anchor.matches)).toBe(true);
    });
  });
});
