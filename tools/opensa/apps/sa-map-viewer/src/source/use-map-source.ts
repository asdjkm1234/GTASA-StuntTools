/**
 * The source screen's controller (plan 094, phase 0): drives {@link loadMapSource} and exposes its phase.
 * `?src=` auto-loads on mount; a folder pick has to come from a click (the picker needs the user activation).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { LoadedMap, MapSource } from './map-source';

import { loadMapSource, sourceFromQuery } from './map-source';

export interface MapSourceController {
  /** Open a source — call this straight from the click for `{ kind: 'folder' }`. */
  open: (source: MapSource) => void;
  state: MapSourceState;
}

export type MapSourceState =
  | { kind: 'error'; message: string }
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; map: LoadedMap; ms: number };

export function useMapSource(): MapSourceController {
  const [state, setState] = useState<MapSourceState>({ kind: 'idle' });
  const startedRef = useRef(false); // one load per session (and StrictMode-safe)

  /* eslint-disable @eslint-react/set-state-in-effect -- `open` is a click handler that the `?src=` effect also
     kicks off once at mount; everything after the first line lands in a promise callback, not in the effect. */
  const open = useCallback((source: MapSource): void => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    setState({ kind: 'loading' });
    const started = performance.now();
    // Not awaited: the picker inside must be this call's first await, so the activation survives.
    void loadMapSource(source)
      .then((map) => {
        const ms = Math.round(performance.now() - started);
        // eslint-disable-next-line no-console -- the load record: a capture from this tool must name its source
        console.log(`[sa-map-viewer] source ${map.label} — ${map.defs.instances.length} instances in ${ms} ms`);
        setState({ kind: 'ready', map, ms });
      })
      .catch((error: unknown) => {
        startedRef.current = false; // a cancelled picker / bad ?src= must be retryable
        setState({ kind: 'error', message: String(error) });
      });
  }, []);
  /* eslint-enable @eslint-react/set-state-in-effect */

  useEffect(() => {
    const source = sourceFromQuery(window.location.search);
    if (source) {
      open(source);
    }
  }, [open]);

  return { open, state };
}
