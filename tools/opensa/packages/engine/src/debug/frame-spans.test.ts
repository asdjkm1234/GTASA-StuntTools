import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatFrameSpans, FrameSpans } from './frame-spans';

/** A scripted clock: every `performance.now()` returns the next value, so a segment's cost is exact. */
function clock(...readings: number[]): void {
  let index = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => readings[Math.min(index++, readings.length - 1)]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('FrameSpans', () => {
  describe('negative cases', () => {
    it('drains empty when the frame paid for nothing', () => {
      const spans = new FrameSpans();

      expect(spans.drain()).toEqual({ byName: [], totalMs: 0 });
    });

    it('still attributes a segment that threw — a failed spawn cost the frame the same time', () => {
      const spans = new FrameSpans();
      clock(10, 25);

      expect(() =>
        spans.measure('vehicle-spawn:previon', () => {
          throw new Error('no converted model');
        }),
      ).toThrow('no converted model');
      expect(spans.drain()).toEqual({ byName: [['vehicle-spawn:previon', 15]], totalMs: 15 });
    });

    it('drops sub-0.05 ms spans from the log line but keeps unattributed', () => {
      const spans = new FrameSpans();
      spans.add('pak-read', 0.01);

      expect(formatFrameSpans(spans.drain(), 12.5)).toBe('unattributed 12.5');
    });
  });

  describe('positive cases', () => {
    it('sums repeated segments under one name', () => {
      const spans = new FrameSpans();
      clock(0, 4, 10, 16);
      spans.measure('cell-collision', () => undefined);
      spans.measure('cell-collision', () => undefined);

      expect(spans.drain()).toEqual({ byName: [['cell-collision', 10]], totalMs: 10 });
    });

    it('gives a nested span its own time and the outer one the rest — never both', () => {
      const spans = new FrameSpans();
      clock(0, 2, 7, 20);
      const totals = ((): ReturnType<FrameSpans['drain']> => {
        spans.measure('vehicle-spawn:previon', () => {
          spans.measure('vehicle-model:previon', () => undefined);
        });

        return spans.drain();
      })();

      expect(totals).toEqual({
        byName: [
          ['vehicle-spawn:previon', 15],
          ['vehicle-model:previon', 5],
        ],
        totalMs: 20,
      });
    });

    it('drains once — the next frame starts empty', () => {
      const spans = new FrameSpans();
      spans.add('cell-collision', 8);
      spans.drain();

      expect(spans.drain()).toEqual({ byName: [], totalMs: 0 });
    });

    it('prints the spans descending, with unattributed last', () => {
      const spans = new FrameSpans();
      spans.add('cell-collision', 31.2);
      spans.add('vehicle-spawn:previon', 180.4);

      expect(formatFrameSpans(spans.drain(), 14.1)).toBe(
        'vehicle-spawn:previon 180.4 · cell-collision 31.2 · unattributed 14.1',
      );
    });

    it('collapses a class into its total and its worst member', () => {
      const spans = new FrameSpans();
      spans.add('vehicle-osm:majestic', 4);
      spans.add('vehicle-osm:sadler', 3.2);
      spans.add('vehicle-osm:tampa', 1);
      spans.add('cell-collision-bodies', 87.9);

      expect(formatFrameSpans(spans.drain(), 49)).toBe(
        'cell-collision-bodies 87.9 · vehicle-osm ×3 8.2 (worst majestic 4.0) · unattributed 49.0',
      );
    });
  });
});
