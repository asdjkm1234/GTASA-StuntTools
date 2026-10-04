/**
 * The collector's storage, which until now grew for as long as the capture ran.
 *
 * The negative cases are the two ways an instrument lies about the thing it measures: by costing more the
 * longer it runs, and by rounding away the outlier it exists to catch.
 */
import { describe, expect, it } from 'vitest';

import { BIN_MS, BIN_TAIL_MS, COARSE_BIN_MS, COARSE_FROM_MS, FrameHistogram, MAX_BINS } from './frame-histogram';

/** A plausible frame series: a vsync ladder with a few hitches, which is what this device actually produces. */
function ladder(count: number): number[] {
  const values: number[] = [];
  for (let frame = 0; frame < count; frame += 1) {
    const rung = [16.7, 16.7, 33.4, 33.4, 50.1, 66.8][frame % 6];
    values.push(frame % 97 === 0 ? 240 + (frame % 7) : rung + (frame % 3) * 0.4);
  }

  return values;
}

/** The percentile the old collector computed, off a full sorted copy — what the bins must agree with. */
function sortedPercentile(values: readonly number[], fraction: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));

  return sorted[index];
}

describe('FrameHistogram', () => {
  describe('negative cases', () => {
    it('reports zeroes rather than dividing by no samples', () => {
      const histogram = new FrameHistogram();

      expect({ count: histogram.count, maxMs: histogram.maxMs, meanMs: histogram.meanMs }).toEqual({
        count: 0,
        maxMs: 0,
        meanMs: 0,
      });
      expect(histogram.percentileMs(0.5)).toBe(0);
    });

    it('does not grow with the length of the capture — the point of holding bins rather than samples', () => {
      // The old collector kept every dt in an array and copied-and-sorted the whole thing on every report,
      // at the 2 Hz the panel polls. Two hours at 30 fps is 216 000 numbers sorted twice a second, inside
      // the build whose whole job is to measure what a frame costs.
      const histogram = new FrameHistogram();
      for (const [frame, ms] of ladder(200_000).entries()) {
        // Every thousandth frame is a freeze of its own length, so the values SPREAD without limit. A
        // histogram that did not saturate would open a bin for each of them, which is the failure this
        // asserts against — without them the ladder alone never reaches the tail and the test cannot fail.
        histogram.add(frame % 1000 === 0 ? BIN_TAIL_MS + frame : ms);
      }

      expect(histogram.count).toBe(200_000);
      // 50 fine bins, 45 coarse ones and the tail. Nothing above that, however long the run.
      expect(histogram.bins().length).toBeLessThanOrEqual(MAX_BINS);
    });

    it('keeps the true maximum exact, so the tail bin cannot hide a hitch', () => {
      const histogram = new FrameHistogram();
      histogram.add(16.7);
      histogram.add(16_550.3); // the frozen backgrounded tab of the 2026-08-31 capture

      // The percentile is a bin's floor and says only "at or above the tail"; the max is the real number.
      expect(histogram.percentileMs(1)).toBe(BIN_TAIL_MS);
      expect(histogram.bins()).toEqual([
        [16, 1],
        [BIN_TAIL_MS, 1],
      ]);
      expect(histogram.maxMs).toBe(16_550.3);
    });

    it('keeps the mean exact rather than averaging the bins it landed in', () => {
      const histogram = new FrameHistogram();
      for (const ms of [16.7, 17.9, 18.3]) {
        histogram.add(ms);
      }

      // All three land in the 16 ms bin. A mean taken off the bins would say 16.
      expect(histogram.meanMs).toBeCloseTo(17.633, 3);
    });
  });

  describe('positive cases', () => {
    it('agrees with the sorted percentile it replaces, to within the bin it reports', () => {
      const values = ladder(4000);
      const histogram = new FrameHistogram();
      for (const ms of values) {
        histogram.add(ms);
      }

      for (const fraction of [0.5, 0.95, 0.99]) {
        const exact = sortedPercentile(values, fraction);
        const binned = histogram.percentileMs(fraction);
        // A bin's floor, so it is at most one bin low and never high — and which bin depends on where
        // in the range it fell, which is the whole reason the range has two resolutions.
        expect(binned).toBeLessThanOrEqual(exact);
        expect(exact - binned).toBeLessThan(exact >= COARSE_FROM_MS ? COARSE_BIN_MS : BIN_MS);
      }
    });

    it('bins on the same edges the filed captures already carry', () => {
      const histogram = new FrameHistogram();
      for (const ms of [15.9, 16.7, 17.9, 33.4]) {
        histogram.add(ms);
      }

      expect(histogram.bins()).toEqual([
        [14, 1],
        [16, 2],
        [32, 1],
      ]);
    });

    it('sums the window it accounts for, so a report can say how much of it was this population', () => {
      const histogram = new FrameHistogram();
      for (const ms of [100, 100.5, 99.5]) {
        histogram.add(ms);
      }

      expect(histogram.totalMs).toBe(300);
    });
  });
});
