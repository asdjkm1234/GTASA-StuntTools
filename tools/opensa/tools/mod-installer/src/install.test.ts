import { describe, expect, it } from 'vitest';

import { sortMods } from './install';

describe('sortMods', () => {
  describe('positive cases', () => {
    it('sorts numeric-aware: the number prefix is the apply priority (mod1, mod2, mod10)', () => {
      expect(sortMods(['mod2', 'mod10', 'mod1'])).toEqual(['mod1', 'mod2', 'mod10']);
      expect(sortMods(['10. b', '2. a', '1. c'])).toEqual(['1. c', '2. a', '10. b']);
    });

    it('is case-insensitive ascending', () => {
      expect(sortMods(['B_mod', 'a_mod', 'C_mod'])).toEqual(['a_mod', 'B_mod', 'C_mod']);
    });

    it('does not mutate the input', () => {
      const input = ['b', 'a'];
      sortMods(input);

      expect(input).toEqual(['b', 'a']);
    });
  });
});
