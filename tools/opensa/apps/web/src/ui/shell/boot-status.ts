/**
 * Preloader status text + progress maths (pure, plan 051). The shell ticks an index on an interval and
 * shows `rotatingStatus(messages, tick)` so a long download never looks frozen.
 */
import type { AssetLoaderKind, ProgressSnapshot } from '@opensa/loaders';

import { cacheStorageStatus } from '@opensa/loaders';

/** Rotating status lines for the core (data + others + models) phase. */
export const CORE_STATUS: readonly string[] = ['Loading', 'Loading assets…', 'Preparing the world…', 'Almost there…'];

/** Richer rotation for the heavier textures phase. */
export const TEXTURE_STATUS: readonly string[] = [
  'Loading textures…',
  'Streaming San Andreas…',
  'Painting Los Santos…',
  'Waxing the lowriders…',
  'Unfolding the map…',
  'Almost there…',
];

/**
 * The standing note under the preloader: what this load will NOT do, when that is worth saying.
 *
 * Only the `fetch` loader downloads and caches — a picked folder and a served dir are read where they are, so
 * a cache has nothing to do with them. When Cache Storage is unavailable the download is disposable, and
 * silence there costs the whole game again on the next visit (plan 200/4-06). Empty ⇒ nothing to say.
 */
export function cacheNote(loader: AssetLoaderKind): string {
  if (loader !== 'fetch') {
    return '';
  }
  const status = cacheStorageStatus();

  return status.available ? '' : `This download will not be kept — ${status.reason}`;
}

/** The status line for a tick (wraps around the list). */
export function rotatingStatus(messages: readonly string[], tick: number): string {
  if (messages.length === 0) {
    return '';
  }

  return messages[((tick % messages.length) + messages.length) % messages.length];
}

/** Progress as a 0–100 integer; 0 when nothing is known yet. */
export function toPercent(snapshot: ProgressSnapshot): number {
  if (snapshot.totalBytes <= 0) {
    return 0;
  }

  return Math.min(100, Math.round((snapshot.loadedBytes / snapshot.totalBytes) * 100));
}
