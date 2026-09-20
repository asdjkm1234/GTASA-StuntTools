import { describe, expect, it } from 'vitest';

import { createStageProfiler } from './profiling';

/** A deterministic clock: each call advances by the next step (ms). */
function clock(steps: number[]): () => number {
  let at = 0;
  let i = 0;

  return () => {
    at += steps[i] ?? 0;
    i += 1;

    return at;
  };
}

describe('createStageProfiler', () => {
  describe('negative cases', () => {
    it('reports an empty run without dividing by zero', () => {
      const report = createStageProfiler(clock([])).report();

      expect(report).toContain('total 0.0s');
      expect(report).not.toContain('NaN');
    });

    it('still records a stage whose function throws', () => {
      const profiler = createStageProfiler(clock([0, 1000]));

      expect(() =>
        profiler.time('boom', () => {
          throw new Error('x');
        }),
      ).toThrow('x');
      expect(profiler.report()).toContain('boom');
    });
  });

  describe('positive cases', () => {
    it('aggregates totals, shares and call counts per stage', () => {
      // time() calls now() twice per stage: start, end. Steps: merge 3000ms ×1, cull 1000ms ×1.
      const profiler = createStageProfiler(clock([0, 3000, 0, 1000]));
      profiler.time('merge', () => undefined);
      profiler.time('cull', () => undefined);
      const report = profiler.report();

      expect(report).toContain('total 4.0s');
      expect(report).toMatch(/merge\s+3\.0s\s+75\.0%\s+×1/);
      expect(report).toMatch(/cull\s+1\.0s\s+25\.0%\s+×1/);
    });

    it('lists the slowest cells first, capped at topCells', () => {
      const profiler = createStageProfiler(clock([0, 1000, 0, 5000, 0, 2000]));
      profiler.cell('cell a', () => undefined);
      profiler.cell('cell b', () => undefined);
      profiler.cell('cell c', () => undefined);
      const report = profiler.report(2);

      const bAt = report.indexOf('cell b');
      const cAt = report.indexOf('cell c');
      expect(bAt).toBeGreaterThan(-1);
      expect(cAt).toBeGreaterThan(bAt); // b (5s) before c (2s)
      expect(report).not.toContain('cell a'); // capped at 2
    });
  });
});
