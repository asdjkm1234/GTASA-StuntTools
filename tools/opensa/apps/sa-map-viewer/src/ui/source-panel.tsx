import { CELL_SIZE } from '@opensa/cell-weld/cell-size';
import { styles } from '@opensa/web/ui/debug/debug-styles';
import { MapInspector } from '@opensa/web/ui/debug/map-inspector';
import { type ReactElement, useMemo } from 'react';

import type { MapSourceController } from '../source/use-map-source';
import type { ViewerHandle, ViewerReadout } from '../world/viewer-host';

import { isConverted, mapStats } from '../source/map-source';
import { viewerStyles } from './viewer-styles';

/**
 * The permanent left panel (plan 094): pick the source, read back what was resolved, and — once the engine is
 * up — the debugger's OWN `MapInspector` as one always-open section (cell grid, whole map, LOD mode). The
 * SOURCE line is the important one: it is what makes a capture from this tool self-describing.
 */
export function SourcePanel({
  controller,
  readout,
  viewer,
}: {
  controller: MapSourceController;
  readout: null | ViewerReadout;
  viewer: null | ViewerHandle;
}): ReactElement {
  const { open, state } = controller;
  const map = state.kind === 'ready' ? state.map : null;
  const stats = useMemo(() => (map ? mapStats(map) : null), [map]);

  return (
    <div style={styles.panel}>
      <div style={styles.title}>SA-MAP-VIEWER</div>

      {state.kind === 'idle' && (
        <>
          <button onClick={() => open({ kind: 'folder' })} style={styles.actionButton} type="button">
            OPEN GAME FOLDER
          </button>
          <div style={styles.hint}>
            A raw GTA SA install (or an SA-format build dir). Chromium only. A served dir loads without the picker:{' '}
            <code>?src=http://localhost:3001/game-src/original</code>
          </div>
        </>
      )}

      {state.kind === 'loading' && <div style={styles.hint}>reading gta.dat + IDE/IPL…</div>}

      {state.kind === 'error' && (
        <>
          <div style={styles.info}>{state.message}</div>
          <button onClick={() => open({ kind: 'folder' })} style={styles.actionButton} type="button">
            TRY ANOTHER FOLDER
          </button>
        </>
      )}

      {map && stats && (
        <>
          <div style={styles.hint}>SOURCE</div>
          <div style={styles.info}>{map.label}</div>
          {isConverted(map) && (
            <div style={viewerStyles.warning}>
              This is an OpenSA-CONVERTED dir ({map.models.osm} .osm vs {map.models.dff} .dff). Its geometry is no
              longer RenderWare, so nothing will weld. Point this tool at an SA-format tree — an OpenSA build already
              has a map viewer, in the in-game debugger.
            </div>
          )}
          <div style={styles.divider} />
          <Stat label="cells" value={`${stats.cells} @ ${CELL_SIZE}`} />
          <Stat label="instances" value={stats.instances} />
          <Stat label="hd / lod" value={`${stats.hd} / ${stats.lod}`} />
          <Stat label="models" value={stats.models} />
          <Stat label="resolve" value={state.kind === 'ready' ? `${state.ms} ms` : '—'} />
        </>
      )}

      {readout && (
        <>
          <div style={styles.divider} />
          <div style={styles.hint}>VIEW</div>
          <Stat
            label="at"
            value={`${readout.pose.at[0].toFixed(0)},${readout.pose.at[1].toFixed(0)} · h ${readout.pose.height.toFixed(0)}`}
          />
          <Stat label="pitch / yaw" value={`${degrees(readout.pose.pitch)}° / ${degrees(readout.pose.yaw)}°`} />
          <Stat label={`cells ${readout.lod ? 'LOD' : 'HD'}`} value={readout.load.cells} />
          <Stat
            label="weld"
            value={`${readout.load.weldMs} ms · med ${readout.load.medianWeldMs} · max ${readout.load.slowestWeldMs}`}
          />
          <Stat
            label="textures"
            value={`${readout.load.arrays} × ${(readout.load.textures / 1024 / 1024).toFixed(1)} MB`}
          />
          <Stat label="tris" value={readout.load.indices / 3} />
          <Stat label="fps" value={readout.fps} />
          {readout.progress && (
            <div style={styles.hint}>
              welding {readout.progress.done}/{readout.progress.total}…
            </div>
          )}
        </>
      )}

      {viewer && (
        <>
          <div style={styles.divider} />
          <MapInspector game={viewer.game} />
        </>
      )}
    </div>
  );
}

function degrees(radians: number): string {
  return ((radians * 180) / Math.PI).toFixed(0);
}

function Stat({ label, value }: { label: string; value: number | string }): ReactElement {
  return (
    <div style={styles.statRow}>
      <span style={styles.hint}>{label}</span>
      <span style={styles.info}>{value}</span>
    </div>
  );
}
