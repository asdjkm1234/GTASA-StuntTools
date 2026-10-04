/**
 * The geometry of a floating panel, and where it is remembered.
 *
 * The console's desk layout puts the MAP under everything ([201/7-08](../../../../docs/plans/201-dispatch-console/7-the-operator-map/readme.md)):
 * the queue and the roster are windows over the world rather than columns beside it. That only works if a
 * window can be moved and sized by the operator, and the awkward half of that is not the dragging — it is
 * what happens afterwards. A window whose rect is trusted blindly ends up off the map after a rotate, or
 * two pixels tall after a mis-drag, and neither state has a way back except clearing storage.
 *
 * So the rules live here, as pure functions over a rect and the box it must stay in, and the components
 * only wire pointers to them.
 *
 * **A window is always FULLY inside its box.** Not "56 px of it stays reachable": a panel hanging half off
 * the map is a bug that looks like a feature, and on a 360-px screen it is simply lost. Where the box is
 * smaller than the minimum, the box wins — a window may be squeezed, never pushed out.
 */
import type { JsonStorage } from '../map/storage';

import { readJson, STORAGE_KEYS, writeJson } from '../map/storage';

/** The box a window must stay inside — the map's own size in CSS px. */
export interface WindowBox {
  readonly h: number;
  readonly w: number;
}

/** A window's rect in CSS px, relative to the top-left of the map it floats over. */
export interface WindowRect {
  readonly h: number;
  readonly w: number;
  readonly x: number;
  readonly y: number;
}

/**
 * The smallest a window may be dragged to.
 *
 * Not a taste: 200×120 is what a call row needs to still show its code and its place, measured against
 * `styles.row`'s 12-px padding and three lines of text. Below it the panel is not "small", it is a panel an
 * operator has to resize before they can read it.
 */
export const MIN_WINDOW: WindowBox = { h: 120, w: 200 };

/** What an arrow key moves or resizes a focused window by, CSS px. */
export const KEY_STEP = 8;

/** All windows' rects, by the id the component passes. */
export type WindowLayout = Readonly<Record<string, WindowRect>>;

/**
 * The rect, made legal for `box`.
 *
 * Size is clamped first and position second, because the other order lets a window that is too wide push
 * its own `x` negative on the way to being trimmed.
 */
export function clampWindow(rect: WindowRect, box: WindowBox, min: WindowBox = MIN_WINDOW): WindowRect {
  // `Math.min(min.w, box.w)` rather than `min.w`: a map narrower than 200 px is a real state (a phone in
  // portrait with the console embedded in a card), and clamping UP to the minimum there would make every
  // window wider than the thing it floats over.
  const w = clamp(rect.w, Math.min(min.w, box.w), box.w);
  const h = clamp(rect.h, Math.min(min.h, box.h), box.h);

  return { h, w, x: clamp(rect.x, 0, Math.max(0, box.w - w)), y: clamp(rect.y, 0, Math.max(0, box.h - h)) };
}

/** Every remembered rect, with anything unreadable dropped rather than trusted. */
export function loadWindowLayout(storage?: JsonStorage): WindowLayout {
  const stored = readJson(STORAGE_KEYS.windows, storage);
  if (stored === null || typeof stored !== 'object') {
    return {};
  }
  const layout: Record<string, WindowRect> = {};
  for (const [id, rect] of Object.entries(stored as Record<string, unknown>)) {
    if (isRect(rect)) {
      layout[id] = rect;
    }
  }

  return layout;
}

/** The rect moved by a delta, still legal. */
export function moveWindow(rect: WindowRect, dx: number, dy: number, box: WindowBox): WindowRect {
  return clampWindow({ ...rect, x: rect.x + dx, y: rect.y + dy }, box);
}

/**
 * The rect grown by a delta from its bottom-right corner, still legal.
 *
 * The size is capped against the space to the RIGHT of `x` rather than against the whole box, so dragging
 * the grip past the map's edge stops the window growing instead of sliding it left out from under the
 * pointer.
 */
export function resizeWindow(rect: WindowRect, dw: number, dh: number, box: WindowBox): WindowRect {
  const w = Math.min(rect.w + dw, box.w - rect.x);
  const h = Math.min(rect.h + dh, box.h - rect.y);

  return clampWindow({ ...rect, h, w }, box);
}

/** Remember one window's rect, leaving the others alone. */
export function saveWindowRect(id: string, rect: WindowRect, storage?: JsonStorage): void {
  writeJson(STORAGE_KEYS.windows, { ...loadWindowLayout(storage), [id]: rect }, storage);
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

/**
 * Whether a stored value is a rect this version can use.
 *
 * What comes back was written by a possibly older console, so every field is checked — and `Number.isFinite`
 * rather than `typeof === 'number'`, because `NaN` and `Infinity` both pass the typeof test and both make
 * `clampWindow` answer `NaN`, which CSS drops silently and leaves a window at 0×0.
 */
function isRect(value: unknown): value is WindowRect {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const rect = value as Partial<Record<keyof WindowRect, unknown>>;

  return (['h', 'w', 'x', 'y'] as const).every((key) => typeof rect[key] === 'number' && Number.isFinite(rect[key]));
}
