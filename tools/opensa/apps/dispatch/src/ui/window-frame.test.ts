import { describe, expect, it } from 'vitest';

import type { JsonStorage } from '../map/storage';

import {
  clampWindow,
  loadWindowLayout,
  MIN_WINDOW,
  moveWindow,
  resizeWindow,
  saveWindowRect,
  type WindowRect,
} from './window-frame';

const BOX = { h: 800, w: 1200 };
const RECT: WindowRect = { h: 300, w: 320, x: 100, y: 100 };

/** A `localStorage` stand-in; the real one is not available in a Node test and must not be needed. */
function fakeStorage(seed: Record<string, string> = {}): NonNullable<JsonStorage> & { store: Map<string, string> } {
  const store = new Map(Object.entries(seed));

  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    store,
  };
}

describe('window-frame', () => {
  describe('negative cases', () => {
    it('pulls a window back inside a box it has been dragged past', () => {
      expect(clampWindow({ h: 300, w: 320, x: 1500, y: 900 }, BOX)).toEqual({ h: 300, w: 320, x: 880, y: 500 });
    });

    it('pulls a window back inside when the box shrinks under it', () => {
      expect(clampWindow(RECT, { h: 200, w: 300 })).toEqual({ h: 200, w: 300, x: 0, y: 0 });
    });

    it('refuses a size below the minimum', () => {
      const squashed = resizeWindow(RECT, -1000, -1000, BOX);

      expect(squashed.w).toBe(MIN_WINDOW.w);
      expect(squashed.h).toBe(MIN_WINDOW.h);
    });

    it('lets the box win where it is smaller than the minimum, rather than overflowing it', () => {
      const tiny = clampWindow(RECT, { h: 90, w: 150 });

      expect(tiny).toEqual({ h: 90, w: 150, x: 0, y: 0 });
    });

    it('stops a resize at the box edge instead of sliding the window left', () => {
      const grown = resizeWindow(RECT, 2000, 0, BOX);

      expect(grown.x).toBe(RECT.x);
      expect(grown.w).toBe(BOX.w - RECT.x);
    });

    it('drops a stored rect whose numbers are not finite', () => {
      const storage = fakeStorage({
        'opensa.dispatch.windows': JSON.stringify({ bad: { h: null, w: 320, x: 0, y: 0 }, worse: 7 }),
      });

      expect(loadWindowLayout(storage)).toEqual({});
    });

    it('answers an empty layout for anything that is not an object', () => {
      expect(loadWindowLayout(fakeStorage({ 'opensa.dispatch.windows': '"nope"' }))).toEqual({});
      expect(loadWindowLayout(fakeStorage({ 'opensa.dispatch.windows': 'not json' }))).toEqual({});
      expect(loadWindowLayout(undefined)).toEqual({});
    });
  });

  describe('positive cases', () => {
    it('leaves a legal rect alone', () => {
      expect(clampWindow(RECT, BOX)).toEqual(RECT);
    });

    it('moves by the delta it is given', () => {
      expect(moveWindow(RECT, 40, -25, BOX)).toEqual({ ...RECT, x: 140, y: 75 });
    });

    it('grows from the bottom-right corner without moving the window', () => {
      const grown = resizeWindow(RECT, 60, 40, BOX);

      expect(grown).toEqual({ h: 340, w: 380, x: 100, y: 100 });
    });

    it('remembers one window without disturbing the others', () => {
      const storage = fakeStorage();
      saveWindowRect('calls', RECT, storage);
      saveWindowRect('units', { h: 200, w: 220, x: 10, y: 20 }, storage);

      expect(loadWindowLayout(storage)).toEqual({
        calls: RECT,
        units: { h: 200, w: 220, x: 10, y: 20 },
      });
    });

    it('keeps the readable rects out of a record that also holds a broken one', () => {
      const storage = fakeStorage({
        'opensa.dispatch.windows': JSON.stringify({ calls: RECT, units: { w: 220 } }),
      });

      expect(loadWindowLayout(storage)).toEqual({ calls: RECT });
    });
  });
});
