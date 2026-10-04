import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readAsi, requireAsi } from './asi-resource';

// sha1 of 'hello'
const HELLO_SHA1 = 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d';

let dir = '';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cutscene-converter-asi-'));
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

describe('the embedded plugin', () => {
  describe('negative cases', () => {
    it('reports no resource when the binary has not been built', () => {
      expect(readAsi(join(dir, 'nope.asi'))).toBeUndefined();
    });

    // Shipping the app without its plugin produces cutscenes that lose their actors behind car glass, and
    // the user has no way to tell which half is missing. The build must stop, and say how to fix it.
    it('fails the build naming the path and the command that produces the file', () => {
      const missing = join(dir, 'nope.asi');

      expect(() => requireAsi(missing)).toThrow(missing);
      expect(() => requireAsi(missing)).toThrow('npm run build:asi');
    });
  });

  describe('positive cases', () => {
    it('reports the size and sha1 the about screen shows', () => {
      const path = join(dir, 'perfect-cutscene.asi');
      writeFileSync(path, 'hello');

      expect(requireAsi(path)).toStrictEqual({ bytes: 5, path, sha1: HELLO_SHA1 });
    });
  });
});
