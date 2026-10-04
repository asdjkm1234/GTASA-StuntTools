/**
 * The console's per-operator storage: saved views (201/7-03), rebound keys (201/7-06), where the operator
 * dragged their panels and which skin they chose (201/7-08).
 *
 * One module rather than two copies of the same five lines, because the awkward half is identical for both
 * and getting it wrong is not a data bug: **touching `localStorage` THROWS** in private-mode Safari, in a
 * locked-down profile and when the quota is full, and an uncaught throw at module scope takes the whole
 * console down before a dispatcher sees anything. A surface that cannot remember a preference must still
 * boot and still work.
 *
 * The scope is honestly *this browser*: there is no account and no backend here yet. When the console
 * becomes a module of the CAD application ([202 phase 3](../../../../docs/plans/202-pcad-dispatch/readme.md)),
 * what a server round-trips is exactly what these keys hold.
 */

/** Everything the console stores, named in one place so a reader can see the whole surface at once. */
export const STORAGE_KEYS = {
  bookmarks: 'opensa.dispatch.bookmarks',
  /** Whether the metrics panel is folded to its one-line header (201/3-05). */
  inventoryOpen: 'opensa.dispatch.inventory-open',
  keymap: 'opensa.dispatch.keymap',
  theme: 'opensa.dispatch.theme',
  windows: 'opensa.dispatch.windows',
} as const;

/** What a caller may pass instead of the real thing — a test's map, or nothing at all. */
export type JsonStorage = Pick<Storage, 'getItem' | 'setItem'> | undefined;

/** `localStorage`, or `undefined` where reaching for it throws. Never let this one escape. */
export function browserStorage(): JsonStorage {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Parse what is stored under `key`, or `undefined` for anything that cannot be read or is not JSON.
 *
 * It answers `unknown` on purpose: what comes back was written by a possibly OLDER version of this console,
 * so every caller shape-checks it. A cast here would satisfy the compiler and hand the camera a pose with
 * no `pitch`.
 */
export function readJson(key: string, storage: JsonStorage = browserStorage()): unknown {
  try {
    const raw = storage?.getItem(key);

    return raw === null || raw === undefined ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Store `value` under `key`. A refused or full quota loses the write, never the session. */
export function writeJson(key: string, value: unknown, storage: JsonStorage = browserStorage()): void {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Nothing to do and nothing to report: the caller's in-memory state is already what the operator asked
    // for, it simply will not survive a reload.
  }
}
