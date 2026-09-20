/**
 * The two questions the layout asks about the machine it is running on, and they are NOT the same question.
 *
 * **How wide is it** decides what fits — panels beside the map, or a tabbed sheet under it. **How is it
 * pointed at** decides how big a target has to be: a finger needs one a mouse does not, and the two vary
 * independently. A phone in landscape is wide and coarse; a laptop with a touchscreen is wide and both; a
 * small window on a desk is narrow and fine. Answering either one with a user-agent string gets all three
 * wrong.
 */
import { useEffect, useState } from 'react';

/** Below this the two side panels stop fitting next to a usable map. */
const COMPACT_MAX_WIDTH = 860;
/**
 * Below this there is no room for a list UNDER the map and a map worth looking at.
 *
 * Measured 2026-08-25 on a phone in landscape (740x360 CSS): the header, the sheet at its 44% cap, the
 * timeline and the status bar left the map **98 px** — the console's whole subject reduced to a strip. Width
 * alone cannot see this, which is why it is a third question rather than a smaller `COMPACT_MAX_WIDTH`.
 */
const SHORT_MAX_HEIGHT = 520;

/**
 * Whether the primary pointer is a finger rather than a mouse — which is what decides TARGET SIZE, and the
 * one question a width media query cannot answer.
 *
 * `(pointer: coarse)` reports the primary input, so a laptop with a touchscreen and a mouse still answers
 * `fine` and keeps the dense layout it should have; a phone answers `coarse` at any width, including in
 * landscape where nothing about the width says "finger".
 */
export function useCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)');
}

export function useCompactLayout(): boolean {
  return useMediaQuery(`(max-width: ${COMPACT_MAX_WIDTH}px)`);
}

/** Whether the viewport is too SHORT to spend any of it on a list that is not being read. */
export function useShortViewport(): boolean {
  return useMediaQuery(`(max-height: ${SHORT_MAX_HEIGHT}px)`);
}

function matchesNow(query: string): boolean {
  return typeof window !== 'undefined' && window.matchMedia(query).matches;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => matchesNow(query));

  useEffect(() => {
    const media = window.matchMedia(query);
    // No synchronous set here: the initializer already read the query, so calling it again on mount would
    // only cost a second render. Subscribe, and let a real change drive the state.
    const update = (): void => setMatches(media.matches);
    media.addEventListener('change', update);

    return (): void => media.removeEventListener('change', update);
  }, [query]);

  return matches;
}
