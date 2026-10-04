import { describe, expect, it } from 'vitest';

import { resolveScriptFilePath } from './script-path';

describe('resolveScriptFilePath', () => {
  describe('negative cases', () => {
    it('does not invent a cleo/ prefix — a bare name stays a root key', () => {
      expect(resolveScriptFilePath('Settings.ini')).toBe('settings.ini');
    });
  });

  describe('positive cases', () => {
    it('resolves the corpus form: backslashes + author casing (the Car Left Door ini)', () => {
      expect(resolveScriptFilePath('cleo\\Car Left Door.ini')).toBe('cleo/car left door.ini');
    });

    it('strips the .\\ game-dir prefix and collapses duplicate slashes', () => {
      expect(resolveScriptFilePath('.\\CLEO\\\\text\\a.fxt')).toBe('cleo/text/a.fxt');
    });

    it('accepts an already-forward-slash reference unchanged apart from case', () => {
      expect(resolveScriptFilePath('/cleo/Data.ini')).toBe('cleo/data.ini');
    });
  });
});
