import { afterEach, describe, expect, it, vi } from 'vitest';

import { cacheNote, rotatingStatus, toPercent } from './boot-status';

describe('toPercent', () => {
  describe('negative cases', () => {
    it('is 0 when nothing is known yet', () => {
      expect(toPercent({ loadedBytes: 0, loadedChunks: 0, totalBytes: 0, totalChunks: 0 })).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('rounds the byte ratio and clamps to 100', () => {
      expect(toPercent({ loadedBytes: 50, loadedChunks: 1, totalBytes: 200, totalChunks: 4 })).toBe(25);
      expect(toPercent({ loadedBytes: 999, loadedChunks: 4, totalBytes: 200, totalChunks: 4 })).toBe(100);
    });
  });
});

describe('rotatingStatus', () => {
  describe('negative cases', () => {
    it('returns an empty string for no messages', () => {
      expect(rotatingStatus([], 3)).toBe('');
    });
  });

  describe('positive cases', () => {
    it('wraps the index around the list (including negatives)', () => {
      const messages = ['a', 'b', 'c'];
      expect(rotatingStatus(messages, 0)).toBe('a');
      expect(rotatingStatus(messages, 4)).toBe('b');
      expect(rotatingStatus(messages, -1)).toBe('c');
    });
  });
});

describe('cacheNote', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('negative cases', () => {
    it('says nothing for a loader that does not download — a folder is read where it is', () => {
      vi.stubGlobal('caches', undefined);
      vi.stubGlobal('isSecureContext', false);

      expect(cacheNote('local')).toBe('');
      expect(cacheNote('http-dir')).toBe('');
    });

    it('says nothing when the download IS kept', () => {
      vi.stubGlobal('caches', { open: (): void => undefined });

      expect(cacheNote('fetch')).toBe('');
    });
  });

  describe('positive cases', () => {
    it('names the insecure context, because https is the fix the reader can act on', () => {
      vi.stubGlobal('caches', undefined);
      vi.stubGlobal('isSecureContext', false);

      const note = cacheNote('fetch');

      expect(note).toMatch(/will not be kept/);
      expect(note).toMatch(/secure context/);
      expect(note).toMatch(/https/);
    });

    it('does not blame the protocol when the context IS secure — that instruction would be wrong', () => {
      vi.stubGlobal('caches', undefined);
      vi.stubGlobal('isSecureContext', true);

      const note = cacheNote('fetch');

      expect(note).toMatch(/no Cache Storage API/);
      expect(note).not.toMatch(/https/);
    });
  });
});
