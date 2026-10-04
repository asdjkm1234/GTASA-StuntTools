import { describe, expect, it } from 'vitest';

import { addBookmark, advance, createClock, goLive, removeBookmark, scrubTo, setRate } from './clock';

const WINDOW = { newest: 100_000, oldest: 0 };

describe('the console clock', () => {
  describe('negative cases', () => {
    it('cannot be scrubbed before the history starts', () => {
      expect(scrubTo(createClock(0), -50_000, WINDOW).t).toBe(WINDOW.oldest);
    });

    it('cannot be scrubbed past the newest thing recorded — nobody recorded that picture', () => {
      expect(scrubTo(createClock(0), 500_000, WINDOW).t).toBe(WINDOW.newest);
    });

    it('cannot be scrubbed at all before anything has been recorded', () => {
      const clock = createClock(1234);

      expect(scrubTo(clock, 500, null)).toBe(clock);
      expect(scrubTo(clock, 500, null).mode).toBe('live');
    });

    it('does NOT slip into live when playback catches up — it stops at the end', () => {
      const replaying = { ...scrubTo(createClock(0), 90_000, WINDOW), rate: 8 as const };
      const caught = advance(replaying, 200_000, 5000, WINDOW);

      expect(caught.t).toBe(WINDOW.newest);
      expect(caught.mode).toBe('replay');
    });
  });

  describe('positive cases', () => {
    it('follows the wall clock while live, whatever its rate says', () => {
      expect(advance({ ...createClock(0), rate: 8 }, 42_000, 16, WINDOW).t).toBe(42_000);
    });

    it('runs the shift forward at the chosen rate while replaying', () => {
      const replaying = scrubTo(createClock(0), 10_000, WINDOW);

      expect(advance(replaying, 0, 1000, WINDOW).t).toBe(11_000);
      expect(advance({ ...replaying, rate: 8 }, 0, 1000, WINDOW).t).toBe(18_000);
    });

    it('picking a rate while live enters replay at the moment on screen', () => {
      const entered = setRate({ ...createClock(0), t: 40_000 }, 2, WINDOW);

      expect(entered.mode).toBe('replay');
      expect(entered.rate).toBe(2);
      expect(entered.t).toBe(40_000);
    });

    it('returns to live at the wall clock, not at where the scrub was', () => {
      const back = goLive(scrubTo(createClock(0), 10_000, WINDOW), 99_000);

      expect(back.mode).toBe('live');
      expect(back.t).toBe(99_000);
    });

    it('keeps bookmarks in time order however they were added, and can drop one', () => {
      const late = addBookmark({ ...createClock(0), t: 9000 }, 'it ended here');
      const both = addBookmark({ ...late, t: 2000 }, 'it started here');

      expect(both.bookmarks.map((mark) => mark.label)).toEqual(['it started here', 'it ended here']);
      expect(removeBookmark(both, 9000).bookmarks.map((mark) => mark.t)).toEqual([2000]);
    });
  });
});
