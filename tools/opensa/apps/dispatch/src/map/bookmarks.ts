/**
 * Saved views — "my sector", "the docks", "where the shift started" (201/7-03).
 *
 * A dispatcher works the same few places all shift and returns to them dozens of times, which is why every
 * map application has this and why it is not a nicety: without it, going back to a sector is a pan, a zoom
 * and a tilt, done from memory, forty times a night.
 *
 * **Per operator, on their own machine.** There is no account and no backend on this surface yet, so the
 * store is `localStorage` and the honest scope is *this browser*. When the console becomes a module of the
 * CAD application ([202 phase 3](../../../../docs/plans/202-pcad-dispatch/readme.md)) the shape below is
 * what a server round-trips: an array of named poses, nothing derived, nothing about the world in it.
 *
 * The store never throws — see `storage.ts`, which owns that half for both the things this console
 * remembers per operator.
 */
import type { MapPose } from './map-camera';
import type { JsonStorage } from './storage';

import { browserStorage, readJson, STORAGE_KEYS, writeJson } from './storage';

export interface Bookmark {
  /** What the operator called it. Trimmed, non-empty, unique within the store — the newest wins. */
  readonly name: string;
  readonly pose: MapPose;
  /** `Date.now()` when it was saved, so a list can be shown newest-first without a second field. */
  readonly saved: number;
}

/**
 * How many are kept. Not a storage limit — a full pose is ~120 bytes and the quota is megabytes — but a
 * LIST limit: a picker nobody can scan is a picker nobody uses, and an operator with more than this many
 * saved views is really asking for the search box next door.
 */
export const BOOKMARK_LIMIT = 12;

/** Read every saved view, newest first. Answers `[]` for anything it cannot read or parse. */
export function readBookmarks(storage: JsonStorage = browserStorage()): readonly Bookmark[] {
  return parse(readJson(STORAGE_KEYS.bookmarks, storage));
}

/** Drop one by name and answer the new list. Removing something that is not there is not an error. */
export function removeBookmark(name: string, storage: JsonStorage = browserStorage()): readonly Bookmark[] {
  return write(
    readBookmarks(storage).filter((entry) => entry.name !== name),
    storage,
  );
}

/**
 * Save a view under a name and answer the new list. A name already in the store is REPLACED — an operator
 * who saves "my sector" twice means the second one, and a store that silently kept both would hand them a
 * picker with two identical labels and no way to tell which is which.
 */
export function saveBookmark(
  name: string,
  pose: MapPose,
  storage: JsonStorage = browserStorage(),
): readonly Bookmark[] {
  const label = name.trim();
  if (label === '') {
    return readBookmarks(storage);
  }
  const kept = readBookmarks(storage).filter((entry) => entry.name !== label);

  return write([{ name: label, pose, saved: Date.now() }, ...kept].slice(0, BOOKMARK_LIMIT), storage);
}

function isBookmark(row: unknown): row is Bookmark {
  const entry = row as Bookmark;
  const pose = entry?.pose;

  return (
    typeof entry?.name === 'string' &&
    entry.name !== '' &&
    typeof entry.saved === 'number' &&
    Array.isArray(pose?.at) &&
    pose.at.length === 2 &&
    pose.at.every(Number.isFinite) &&
    Number.isFinite(pose.height) &&
    Number.isFinite(pose.pitch) &&
    Number.isFinite(pose.yaw) &&
    (pose.projection === 'ortho' || pose.projection === 'perspective')
  );
}

/** Shape-checked rather than cast: this is data a previous VERSION of the console wrote, and a pose that
 *  lost a field would otherwise reach the camera and put the view somewhere nobody asked for. */
function parse(rows: unknown): readonly Bookmark[] {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.filter(isBookmark).slice(0, BOOKMARK_LIMIT);
}

function write(entries: readonly Bookmark[], storage: JsonStorage): readonly Bookmark[] {
  writeJson(STORAGE_KEYS.bookmarks, entries, storage);

  return entries;
}
