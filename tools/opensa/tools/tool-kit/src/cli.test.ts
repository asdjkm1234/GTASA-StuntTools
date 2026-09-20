import { isAbsolute } from 'node:path';
import { describe, expect, it } from 'vitest';

import { argValue, fromCwd } from './cli';

describe('cli helpers', () => {
  describe('negative cases', () => {
    it('argValue is undefined for an absent flag and for a trailing flag with no value', () => {
      expect(argValue('--game', ['node', 'cli.ts'])).toBeUndefined();
      expect(argValue('--game', ['node', 'cli.ts', '--game'])).toBeUndefined();
    });
  });

  describe('positive cases', () => {
    it('argValue returns the token after the flag', () => {
      expect(argValue('--game', ['node', 'cli.ts', '--game', './mods', '--out', './build'])).toBe('./mods');
    });

    it('fromCwd resolves relative paths and passes absolute ones through', () => {
      expect(fromCwd('/abs/path')).toBe('/abs/path');
      expect(isAbsolute(fromCwd('./relative'))).toBe(true);
      expect(fromCwd('./relative').endsWith('/relative')).toBe(true);
    });
  });
});
