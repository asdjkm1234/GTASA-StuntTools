import { describe, expect, it } from 'vitest';

import { BUILD_TARGETS, parseBuildTarget } from './target';

describe('parseBuildTarget', () => {
  describe('negative cases', () => {
    it('throws on a target that does not exist rather than silently building for the wrong host', () => {
      expect(() => parseBuildTarget('sa-stock')).toThrow(/got 'sa-stock'/);
    });

    it('names both valid targets in the error', () => {
      expect(() => parseBuildTarget('')).toThrow(/sa \| opensa/);
    });
  });

  describe('positive cases', () => {
    it('passes undefined through so the caller resolves its own default', () => {
      expect(parseBuildTarget(undefined)).toBeUndefined();
    });

    it('accepts every declared target', () => {
      expect(BUILD_TARGETS.map((target) => parseBuildTarget(target))).toEqual(['sa', 'opensa']);
    });
  });
});
