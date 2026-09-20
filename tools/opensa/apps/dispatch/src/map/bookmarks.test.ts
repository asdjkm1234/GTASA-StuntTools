import { describe, expect, it } from 'vitest';

import type { MapPose } from './map-camera';

import { BOOKMARK_LIMIT, readBookmarks, removeBookmark, saveBookmark } from './bookmarks';

/**
 * The store holds POSES, which means a bad row here does not look like corrupt data: it puts the operator's
 * view somewhere nobody asked for, or it takes the console down at mount. Both halves are pinned — what a
 * malformed store answers, and what a storage that refuses to work at all does.
 */
const POSE: MapPose = { at: [1700, -1500], height: 900, pitch: -1.15, projection: 'perspective', yaw: Math.PI };

/** A `localStorage` stand-in; the real one is not available in a Node test and must not be needed. */
function memory(seed?: string): Pick<Storage, 'getItem' | 'setItem'> {
  const cells = new Map<string, string>();
  if (seed !== undefined) {
    cells.set('opensa.dispatch.bookmarks', seed);
  }

  return {
    getItem: (key) => cells.get(key) ?? null,
    setItem: (key, value) => void cells.set(key, value),
  };
}

/** A storage that throws on every call — private mode, a locked-down profile, a full quota. */
const refuses: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem: () => {
    throw new Error('refused');
  },
  setItem: () => {
    throw new Error('refused');
  },
};

describe('bookmarks', () => {
  describe('negative cases', () => {
    it('answers an empty list for a storage that refuses to be read', () => {
      expect(readBookmarks(refuses)).toEqual([]);
    });

    it('keeps the saved list usable even when writing it fails', () => {
      const saved = saveBookmark('my sector', POSE, refuses);

      // The save is lost on reload, not in this session — the operator's action still did something.
      expect(saved).toHaveLength(1);
      expect(saved[0].name).toBe('my sector');
    });

    it('drops rows that are not poses instead of handing one to the camera', () => {
      const store = memory(
        JSON.stringify([
          { name: 'good', pose: POSE, saved: 1 },
          { name: 'no pose', saved: 2 },
          { name: 'half a pose', pose: { at: [1, 2], height: 5 }, saved: 3 },
          { name: 'bad projection', pose: { ...POSE, projection: 'isometric' }, saved: 4 },
          'not even an object',
        ]),
      );

      expect(readBookmarks(store).map((entry) => entry.name)).toEqual(['good']);
    });

    it('does not save a view under a blank name', () => {
      const store = memory();

      expect(saveBookmark('   ', POSE, store)).toEqual([]);
    });

    it('answers an empty list for a stored value that is not JSON at all', () => {
      expect(readBookmarks(memory('{{{'))).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('round-trips a saved view through the store', () => {
      const store = memory();
      saveBookmark('the docks', POSE, store);

      const [entry] = readBookmarks(store);

      expect(entry.name).toBe('the docks');
      expect(entry.pose).toEqual(POSE);
      expect(Number.isFinite(entry.saved)).toBe(true);
    });

    it('replaces a view saved twice under one name, newest first', () => {
      const store = memory();
      saveBookmark('my sector', POSE, store);
      const moved: MapPose = { ...POSE, at: [2400, -1700] };
      saveBookmark('my sector', moved, store);
      const list = readBookmarks(store);

      expect(list).toHaveLength(1);
      expect(list[0].pose.at).toEqual([2400, -1700]);
    });

    it('keeps the newest views when the list is full', () => {
      const store = memory();
      for (let index = 0; index <= BOOKMARK_LIMIT; index += 1) {
        saveBookmark(`view ${index}`, POSE, store);
      }
      const list = readBookmarks(store);

      expect(list).toHaveLength(BOOKMARK_LIMIT);
      expect(list[0].name).toBe(`view ${BOOKMARK_LIMIT}`);
      expect(list.some((entry) => entry.name === 'view 0')).toBe(false);
    });

    it('forgets one view and leaves the rest', () => {
      const store = memory();
      saveBookmark('keep', POSE, store);
      saveBookmark('drop', POSE, store);

      expect(removeBookmark('drop', store).map((entry) => entry.name)).toEqual(['keep']);
      expect(removeBookmark('never existed', store).map((entry) => entry.name)).toEqual(['keep']);
    });
  });
});
