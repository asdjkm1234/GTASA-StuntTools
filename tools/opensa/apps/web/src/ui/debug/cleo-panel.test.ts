import { describe, expect, it } from 'vitest';

import { coverageValue, threadValue } from './cleo-panel';

describe('threadValue', () => {
  describe('negative cases', () => {
    it('shouts a killed thread — a fault must not read like a state', () => {
      expect(threadValue({ instructions: 0, name: 't', state: 'fault', waitMs: 0 })).toBe('FAULT');
    });
  });

  describe('positive cases', () => {
    it('prints the per-tick cost while running and the remaining wait while sleeping', () => {
      expect(threadValue({ instructions: 34, name: 't', state: 'run', waitMs: 0 })).toBe('run · 34 instr');
      expect(threadValue({ instructions: 0, name: 't', state: 'sleep', waitMs: 240 })).toBe('sleep 240 ms');
      expect(threadValue({ instructions: 0, name: 't', state: 'done', waitMs: 0 })).toBe('done');
    });
  });
});

describe('coverageValue', () => {
  describe('negative cases', () => {
    it('flags an UNDECLARED gap — the row that means "declare me or implement me"', () => {
      expect(coverageValue({ count: 3, declared: false, tier: 'noop' })).toBe('×3 noop · UNDECLARED');
    });
  });

  describe('positive cases', () => {
    it('prints the hit count and tier for a declared gap', () => {
      expect(coverageValue({ count: 299, declared: true, tier: 'conditional-false' })).toBe('×299 conditional-false');
    });

    it('omits the count for an atlas row (misses deduplicate, a count would lie)', () => {
      expect(coverageValue({ declared: true, tier: 'noop' })).toBe('noop');
    });
  });
});
