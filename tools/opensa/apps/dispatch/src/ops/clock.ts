/**
 * The console's clock (201/8-03): the single T everything on the operator's screen is drawn at.
 *
 * **Two notions of time live on this screen and they must never be read for each other.** The GAME HOUR is
 * what the environment driver applies to the world — the light, the sky, the mood the timecyc authored — and
 * it is a dial on the top bar. WALL TIME is when things happened on the board, and it is what this clock
 * runs and what a scrub moves along. Scrubbing back an hour of the shift does not make the city darker, and
 * turning the world to midnight does not rewind a call. The chain says to say which is which on screen or
 * the operator will confuse them; the two are labelled `WORLD` and `SHIFT` for that reason.
 *
 * The clock is a plain value with pure transitions, so the whole of replay is testable without a browser.
 */

export interface Clock {
  readonly bookmarks: readonly Bookmark[];
  /** `live` follows the wall clock; `replay` runs `t` forward at {@link Clock.rate} and can be dragged. */
  readonly mode: 'live' | 'replay';
  readonly rate: PlaybackRate;
  /** Wall ms the console is showing. In `live` this is simply now. */
  readonly t: number;
}

/** The span of history a scrub may ask for — the tracks' own window. */
export interface HistoryWindow {
  readonly newest: number;
  readonly oldest: number;
}

/** Playback speeds the operator can pick. ×1 is real time; the two above it are for catching up. */
export type PlaybackRate = 1 | 2 | 8;

/** A moment the operator marked, so it can be returned to. Reached through {@link Clock.bookmarks}. */
interface Bookmark {
  readonly label: string;
  readonly t: number;
}

export const PLAYBACK_RATES: readonly PlaybackRate[] = [1, 2, 8];

/** Mark the moment currently on screen. */
export function addBookmark(clock: Clock, label: string): Clock {
  return { ...clock, bookmarks: [...clock.bookmarks, { label, t: clock.t }].sort((a, b) => a.t - b.t) };
}

/**
 * Advance the clock by one frame.
 *
 * Live follows the wall clock. Replay runs forward at its rate and **stops at the newest sample rather than
 * slipping into live**: a console that silently becomes live while the operator is reading an hour-old
 * picture has changed what is on screen without being asked. Returning to live is one press of a button
 * that says so.
 */
export function advance(clock: Clock, nowMs: number, dtMs: number, window: HistoryWindow | null): Clock {
  if (clock.mode === 'live') {
    return { ...clock, t: nowMs };
  }
  const newest = window?.newest ?? nowMs;

  return { ...clock, t: Math.min(newest, clock.t + dtMs * clock.rate) };
}

/** A fresh clock, live at `now`. */
export function createClock(now: number): Clock {
  return { bookmarks: [], mode: 'live', rate: 1, t: now };
}

/** Back to following the wall clock. */
export function goLive(clock: Clock, nowMs: number): Clock {
  return { ...clock, mode: 'live', t: nowMs };
}

export function removeBookmark(clock: Clock, t: number): Clock {
  return { ...clock, bookmarks: clock.bookmarks.filter((mark) => mark.t !== t) };
}

/**
 * Drag to a moment. Always leaves the clock in `replay`, clamped to what the history actually holds — a
 * scrub past the end of the tracks would ask for a picture nobody recorded.
 */
export function scrubTo(clock: Clock, t: number, window: HistoryWindow | null): Clock {
  if (!window) {
    return clock;
  }

  return { ...clock, mode: 'replay', t: Math.min(window.newest, Math.max(window.oldest, t)) };
}

/** Pick a playback speed. Choosing one enters replay — a rate has no meaning while live. */
export function setRate(clock: Clock, rate: PlaybackRate, window: HistoryWindow | null): Clock {
  return clock.mode === 'live' ? { ...scrubTo(clock, clock.t, window), rate } : { ...clock, rate };
}
