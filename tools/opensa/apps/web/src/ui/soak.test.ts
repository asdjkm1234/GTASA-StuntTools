import { describe, expect, it } from 'vitest';

import type { SoakInterval } from './soak';

import { judgeSoak } from './soak';

/** A healthy steady-state leg; override single fields to inject a failure signature. */
function leg(index: number, overrides: Partial<SoakInterval> = {}): SoakInterval {
  return {
    avgMs: 8.3,
    cells: 60,
    frames: 1800,
    heapMb: 500,
    lateCreates: 0,
    longTasks: 0,
    p95Ms: 9.3,
    residencyMb: 1200,
    scene: 'ls-noon',
    slowFrames: 0,
    t: (index + 1) * 16,
    textureMb: 900,
    ...overrides,
  };
}

const healthyRun = (count: number): SoakInterval[] => Array.from({ length: count }, (_, index) => leg(index));

describe('judgeSoak', () => {
  describe('negative cases', () => {
    it('fails a run with too few legs to judge', () => {
      const verdict = judgeSoak(healthyRun(3), 30);
      expect(verdict.verdict).toBe('FAIL');
      expect(verdict.checks.coverage.pass).toBe(false);
    });

    it('fails on monotonic heap growth beyond the allowance', () => {
      const intervals = healthyRun(40).map((sample, index) => ({ ...sample, heapMb: 500 + index * 30 }));
      const verdict = judgeSoak(intervals, 30);
      expect(verdict.verdict).toBe('FAIL');
      expect(verdict.checks.heapFlat.pass).toBe(false);
    });

    it('fails when the texture bucket keeps growing to the end of the run', () => {
      const intervals = healthyRun(40).map((sample, index) => ({ ...sample, textureMb: 900 + index * 50 }));
      const verdict = judgeSoak(intervals, 30);
      expect(verdict.verdict).toBe('FAIL');
      expect(verdict.checks.textureFlat.pass).toBe(false);
    });

    it('fails when frame p95 degrades over the run', () => {
      const intervals = healthyRun(40).map((sample, index) => ({
        ...sample,
        p95Ms: index >= 30 ? 25 : 9.3,
      }));
      const verdict = judgeSoak(intervals, 30);
      expect(verdict.verdict).toBe('FAIL');
      expect(verdict.checks.frameStable.pass).toBe(false);
    });

    it('fails on late creates over the budget', () => {
      const intervals = healthyRun(40).map((sample, index) => ({ ...sample, lateCreates: index % 2 }));
      const verdict = judgeSoak(intervals, 30);
      expect(verdict.verdict).toBe('FAIL');
      expect(verdict.checks.lateBounded.pass).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('passes a flat healthy run', () => {
      const verdict = judgeSoak(healthyRun(40), 30);
      expect(verdict.verdict).toBe('PASS');
      expect(Object.values(verdict.checks).every((check) => check.pass)).toBe(true);
    });

    it('passes when heap and longtask probes are unavailable (Safari) and marks them skipped', () => {
      const intervals = healthyRun(40).map((sample) => ({ ...sample, heapMb: null, longTasks: null }));
      const verdict = judgeSoak(intervals, 30);
      expect(verdict.verdict).toBe('PASS');
      expect(verdict.checks.heapFlat.detail).toContain('skipped');
      expect(verdict.checks.longTasksBounded.detail).toContain('skipped');
    });

    it('passes a texture curve that plateaus after the LRU floor (growth early, flat tail)', () => {
      const intervals = healthyRun(40).map((sample, index) => ({
        ...sample,
        textureMb: Math.min(1200, 700 + index * 50),
      }));
      expect(judgeSoak(intervals, 30).verdict).toBe('PASS');
    });
  });
});
