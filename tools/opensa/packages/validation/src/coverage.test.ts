import { describe, expect, it } from 'vitest';

import type { CoverageReport } from './coverage';

import { checkCoverage } from './coverage';

const READY = { id: 'csbobcat92', ready: true };
const REPORT: CoverageReport = {
  items: [
    READY,
    { id: 'cstaxi92', ready: false, reason: 'no mod' },
    { id: 'cszr350', ready: false, reason: 'mod incomplete' },
  ],
};

describe('checkCoverage', () => {
  describe('negative cases', () => {
    it('warns rather than blocks when some are uncovered — what has no donor keeps what it had', () => {
      const [verdict] = checkCoverage(REPORT, 'cutscene slots');

      expect(verdict.level).toBe('warning');
      expect(verdict.message).toBe('1 of 3 cutscene slots are covered.');
    });

    it('names the uncovered ones with the reason the owning tool gave', () => {
      const [verdict] = checkCoverage(REPORT, 'cutscene slots');

      expect(verdict.detail).toBe('cstaxi92 — no mod\ncszr350 — mod incomplete');
    });

    it('names an uncovered one even when the owning tool gave no reason', () => {
      const [verdict] = checkCoverage({ items: [{ id: 'cstaxi92', ready: false }] }, 'cutscene slots');

      expect(verdict.detail).toBe('cstaxi92');
    });

    it('errors on an unreadable input — that is a broken folder, not a missing donor', () => {
      const verdicts = checkCoverage({ ...REPORT, unreadable: ['vehicles/broken'] }, 'cutscene slots');

      expect(verdicts[0].level).toBe('error');
      expect(verdicts[0].code).toBe('coverage.unreadable');
      expect(verdicts).toHaveLength(2);
    });

    it('warns when there is nothing to cover at all', () => {
      const [verdict] = checkCoverage({ items: [] }, 'cutscene slots');

      expect(verdict.level).toBe('warning');
      expect(verdict.code).toBe('coverage.nothing-to-check');
    });
  });

  describe('positive cases', () => {
    it('passes when every item is covered', () => {
      const [verdict] = checkCoverage({ items: [READY, { id: 'cstaxi92', ready: true }] }, 'cutscene slots');

      expect(verdict.level).toBe('ok');
      expect(verdict.message).toBe('All 2 cutscene slots are covered.');
    });
  });
});
