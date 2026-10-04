import { describe, expect, it } from 'vitest';

import type { Verdict } from './verdict';

import { collect, isBlocked, runChecks, worstLevel } from './verdict';

const OK: Verdict = { code: 'test.ok', level: 'ok', message: 'fine' };
const WARN: Verdict = { code: 'test.warning', level: 'warning', message: 'odd' };
const FAIL: Verdict = { code: 'test.error', fix: 'do the thing', level: 'error', message: 'broken' };

describe('verdict', () => {
  describe('negative cases', () => {
    it('reports error as the worst level when anything failed', () => {
      expect(worstLevel([OK, WARN, FAIL])).toBe('error');
    });

    it('reports warning as the worst level when nothing failed but something is odd', () => {
      expect(worstLevel([OK, WARN, OK])).toBe('warning');
    });

    it('keeps every failing check rather than stopping at the first', () => {
      const report = runChecks([(): Verdict[] => [FAIL], (): Verdict[] => [WARN], (): Verdict[] => [FAIL]]);

      expect(report.verdicts).toHaveLength(3);
      expect(report.level).toBe('error');
    });

    it('blocks on an error report', () => {
      expect(isBlocked(collect([WARN, FAIL]))).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('reports ok for an empty list', () => {
      expect(collect([])).toStrictEqual({ level: 'ok', verdicts: [] });
    });

    it('reports ok for an empty run of checks', () => {
      expect(runChecks([])).toStrictEqual({ level: 'ok', verdicts: [] });
    });

    it('keeps the ok verdicts too — a report is the whole run, not just its failures', () => {
      const report = runChecks([(): Verdict[] => [OK, OK], (): Verdict[] => [WARN]]);

      expect(report.verdicts).toStrictEqual([OK, OK, WARN]);
      expect(report.level).toBe('warning');
    });

    it('does not block on a warning', () => {
      expect(isBlocked(collect([OK, WARN]))).toBe(false);
    });
  });
});
