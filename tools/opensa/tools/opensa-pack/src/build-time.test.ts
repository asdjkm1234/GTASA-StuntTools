import { describe, expect, it } from 'vitest';

import { formatBuildTime, readAppVersion } from './pack';

describe('formatBuildTime', () => {
  describe('positive cases', () => {
    it('formats HH:mm DD-MM-YYYY in local time', () => {
      expect(formatBuildTime(new Date(2026, 6, 21, 7, 52))).toBe('07:52 21-07-2026');
    });

    it('zero-pads single-digit hour, minute, day and month', () => {
      expect(formatBuildTime(new Date(2026, 0, 3, 9, 5))).toBe('09:05 03-01-2026');
    });

    it('offsets the zero-based month by one (December is 12)', () => {
      expect(formatBuildTime(new Date(2025, 11, 31, 23, 59))).toBe('23:59 31-12-2025');
    });
  });
});

describe('readAppVersion', () => {
  describe('positive cases', () => {
    it('reads the repo root package.json version', () => {
      const version = readAppVersion();
      expect(version).toMatch(/^\d+\.\d+\.\d+/);
    });
  });
});
