/**
 * The half of the readout an operator judges the console by, and the half that was silently wrong.
 *
 * The negative cases below are the shapes render-on-demand produces every time the map is left alone: a
 * console at rest, and the first frame after it. Both used to report a frame rate nobody was running.
 */
import { describe, expect, it } from 'vitest';

import { FrameClock } from './frame-clock';

/** A run of frames at a fixed interval, the first one `intervalMs` after `from`. Returns the last one's time. */
function drawAt(clock: FrameClock, from: number, intervalMs: number, count: number): number {
  let at = from;
  for (let frame = 0; frame < count; frame += 1) {
    at += intervalMs;
    clock.drew(at, intervalMs);
  }

  return at;
}

describe('FrameClock', () => {
  describe('negative cases', () => {
    it('does not count the idle wakes the render gate skipped as frames', () => {
      const clock = new FrameClock();
      const at = drawAt(clock, 0, 16, 20);
      // A second of rest: the loop woke ten times at 100 ms and drew nothing (201/4-01).
      for (let wake = 0; wake < 10; wake += 1) {
        clock.skipped();
      }

      expect(clock.read(at + 1001)).toEqual({ fps: 0, frameMs: 0 });
    });

    it('never reports the interval that spans a rest as a frame time, however long the rest was', () => {
      const clock = new FrameClock();
      drawAt(clock, 0, 16, 5);
      clock.skipped();
      // The operator touches the map again — 1 120 ms since the last frame, none of it spent drawing.
      clock.drew(1200, 1120);
      const at = drawAt(clock, 1200, 16, 3);

      expect(clock.read(at)).toEqual({ fps: 4, frameMs: 16 });
    });

    it('reports no frame time when the window holds a single drawn frame', () => {
      const clock = new FrameClock();
      clock.skipped();
      clock.drew(1200, 1120);

      expect(clock.read(1200)).toEqual({ fps: 1, frameMs: 0 });
    });
  });

  describe('positive cases', () => {
    it('counts the frames drawn in the last second', () => {
      const clock = new FrameClock();
      const at = drawAt(clock, 0, 50, 40);

      expect(clock.read(at).fps).toBe(21);
    });

    it('reports the median interval between consecutive drawn frames, not the mean', () => {
      const clock = new FrameClock();
      let at = drawAt(clock, 0, 16, 8);
      // One hitch. The median is what the operator is running at; the mean would blame every frame for it.
      at += 120;
      clock.drew(at, 120);

      expect(clock.read(at).frameMs).toBe(16);
    });

    it('says which kind of interval each drawn frame carried, so one rule serves both readers', () => {
      // The status bar and the capture collector ask the same question — is this gap a frame time? — and
      // two copies of the answer would be two consoles disagreeing about one loop. The clock decides.
      const clock = new FrameClock();

      expect(clock.drew(16, 16)).toBe('after-rest'); // the first interval is measured against page load
      expect(clock.drew(32, 16)).toBe('consecutive');
      clock.skipped();
      expect(clock.drew(140, 108)).toBe('after-rest');
      expect(clock.drew(156, 16)).toBe('consecutive');
    });

    it('drops frames out of the window as they age past a second', () => {
      const clock = new FrameClock();
      const at = drawAt(clock, 0, 16, 200);

      expect(clock.read(at + 600).fps).toBe(26);
    });
  });
});
