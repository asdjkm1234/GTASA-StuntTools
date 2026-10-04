import { type ReactElement, useEffect, useRef, useState } from 'react';

import type { LoadedMap } from '../source/map-source';
import type { ViewerHandle, ViewerReadout } from '../world/viewer-host';

import { bootViewer } from '../world/viewer-host';
import { viewerStyles } from './viewer-styles';

/** Module scope, so StrictMode's dev double-mount boots the engine on the canvas exactly once. */
let booted: null | Promise<ViewerHandle | void> = null;

/** The engine canvas plus the source caption that makes every capture self-describing. */
export function ViewerCanvas({
  map,
  onReadout,
  onReady,
}: {
  map: LoadedMap;
  onReadout: (readout: ViewerReadout) => void;
  onReady: (handle: ViewerHandle) => void;
}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    booted ??= bootViewer(canvas, map, onReadout).catch((error: unknown) => {
      // eslint-disable-next-line no-console -- a dead canvas must say why
      console.error('[sa-map-viewer] boot failed', error);
      setFailed(String(error));
    });
    void booted.then((handle) => {
      if (handle) {
        onReady(handle);
      }
    });
  }, [map, onReadout, onReady]);

  return (
    <>
      <canvas ref={canvasRef} style={viewerStyles.canvas} />
      <div style={viewerStyles.caption}>{failed || map.label}</div>
    </>
  );
}
