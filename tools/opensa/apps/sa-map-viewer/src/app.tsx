import { type ReactElement, useState } from 'react';

import type { ViewerHandle, ViewerReadout } from './world/viewer-host';

import { useMapSource } from './source/use-map-source';
import { SourcePanel } from './ui/source-panel';
import { ViewerCanvas } from './ui/viewer-canvas';

/** sa-map-viewer's shell (plan 094): the engine canvas, with the permanent panel over it. */
export function App(): ReactElement {
  const controller = useMapSource();
  const [readout, setReadout] = useState<null | ViewerReadout>(null);
  const [viewer, setViewer] = useState<null | ViewerHandle>(null);
  const map = controller.state.kind === 'ready' ? controller.state.map : null;

  return (
    <>
      {map && <ViewerCanvas map={map} onReadout={setReadout} onReady={setViewer} />}
      {!panelHidden() && <SourcePanel controller={controller} readout={readout} viewer={viewer} />}
    </>
  );
}

/**
 * `?panel=0` — capture mode: hide the panel, keep the source caption. The panel carries a live fps line, so a
 * pixel A/B of two runs would differ on the chrome alone; the caption is static and must never be hidden (a
 * capture from this tool always says which tree it read).
 */
function panelHidden(): boolean {
  return new URLSearchParams(window.location.search).get('panel') === '0';
}
