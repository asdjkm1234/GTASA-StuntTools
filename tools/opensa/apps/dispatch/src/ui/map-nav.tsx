/**
 * The map's own controls (201/7-06): a compass that says which way north is and puts it back, plus zoom,
 * turn and tilt.
 *
 * Every one of them is a key as well, and that is the point rather than duplication: an operator on a phone
 * has no keyboard, an operator who has never read the key sheet has no keys, and a compass is the only thing
 * on screen that answers "which way am I facing" at all. They all go through the same handle methods the
 * keys go through, so the two cannot drift.
 *
 * The needle is an SVG rather than a glyph because it has to ROTATE with the view, and it is redrawn from
 * the readout — four times a second, off the frame path, like everything else in this tree.
 *
 * **The zoom LEVELS live here too, and that is the cross-platform rule rather than a layout preference**: on
 * a phone there is no `1`/`2`/`3` to press, so a capability that exists only on the keyboard exists only on
 * a desk ([restrictions/cross-platform-surface.md](../../../../docs/restrictions/cross-platform-surface.md)).
 * Every control grows to a finger's target size where the pointer is coarse, and stays dense where it is a
 * mouse — one component, two sizes, no second layout to keep in step.
 */
import { type ReactElement, useState } from 'react';

import type { DispatchHandle } from '../world/boot';
import type { MapMode } from '../world/mode-switch';

import { MAP_YAW } from '../map/map-camera';
import { styles } from './styles';

/** One press of turn or tilt. An eighth of a turn is the smallest step that reads as a deliberate move. */
const TURN_STEP = Math.PI / 4;
const TILT_STEP = Math.PI / 12;

export function MapNav({
  compact = false,
  handle,
  mode = null,
  onToggleMode,
  touch = false,
  yaw,
}: {
  /** Narrow screen: the cluster keeps what is used every few seconds and folds the rest behind one key. */
  compact?: boolean;
  handle: DispatchHandle | null;
  /** Which surface is drawing (201/6-03). Null before the first one is up. */
  mode?: MapMode | null;
  /** Change it. Absent for a host that does not offer the choice. */
  onToggleMode?: () => void;
  /** The pointer is a finger: every control takes a finger-sized target. */
  touch?: boolean;
  yaw: number;
}): ReactElement {
  const disabled = handle === null;
  const key = touch ? styles.mapNavKeyTouch : styles.mapNavKey;
  const level = touch ? styles.mapNavLevelTouch : styles.mapNavLevel;
  /**
   * On a narrow screen the full ladder is 240 px of a ~350-px-tall map, down the edge the thumb reaches
   * with — so what stays out is what is pressed constantly (north, zoom in, zoom out) and the rest folds.
   * Nothing is REMOVED: turn, tilt and the three levels are one key away, because a capability that exists
   * only on a desk is the failure this cluster was written to fix in the first place.
   */
  const [open, setOpen] = useState(false);
  const folded = compact && !open;

  return (
    <div style={compact ? styles.mapNavCompact : styles.mapNav}>
      <button
        aria-label="Face north"
        disabled={disabled}
        onClick={() => handle?.faceNorth()}
        style={touch ? styles.mapNavCompassTouch : styles.mapNavCompass}
        title="Face north"
        type="button"
      >
        <Compass yaw={yaw} />
      </button>

      {compact && (
        <button
          aria-expanded={open}
          aria-label={open ? 'Hide turn, tilt and zoom levels' : 'Show turn, tilt and zoom levels'}
          onClick={() => setOpen(!open)}
          style={key}
          type="button"
        >
          {open ? '×' : '⋯'}
        </button>
      )}

      <div style={{ ...styles.mapNavRow, display: folded ? 'none' : 'flex' }}>
        <button
          aria-label="Turn left"
          disabled={disabled}
          onClick={() => handle?.turnBy(-TURN_STEP)}
          style={key}
          type="button"
        >
          ⟲
        </button>
        <button
          aria-label="Turn right"
          disabled={disabled}
          onClick={() => handle?.turnBy(TURN_STEP)}
          style={key}
          type="button"
        >
          ⟳
        </button>
      </div>

      <div style={{ ...styles.mapNavRow, display: folded ? 'none' : 'flex' }}>
        <button
          aria-label="Tilt towards the horizon"
          disabled={disabled}
          onClick={() => handle?.tiltBy(TILT_STEP)}
          style={key}
          type="button"
        >
          ▲
        </button>
        <button
          aria-label="Tilt towards the ground"
          disabled={disabled}
          onClick={() => handle?.tiltBy(-TILT_STEP)}
          style={key}
          type="button"
        >
          ▼
        </button>
      </div>

      <div style={{ ...styles.mapNavRow, display: folded ? 'none' : 'flex' }}>
        <button
          aria-label="Zoom to the city"
          disabled={disabled}
          onClick={() => handle?.setZoomLevel('city')}
          style={level}
          title="Zoom to the city"
          type="button"
        >
          CITY
        </button>
        <button
          aria-label="Zoom to the district"
          disabled={disabled}
          onClick={() => handle?.setZoomLevel('district')}
          style={level}
          title="Zoom to the district"
          type="button"
        >
          DIST
        </button>
        <button
          aria-label="Zoom to a block"
          disabled={disabled}
          onClick={() => handle?.setZoomLevel('block')}
          style={level}
          title="Zoom to a block"
          type="button"
        >
          BLK
        </button>
      </div>

      {/* Which surface draws the world (201/6-03). It sits with the folded controls rather than beside the
          compass because it is pressed once a shift, not once a minute — and the phone cluster was measured
          at 240 px of a ~350-px map before folding, so a permanently visible fifth key would cost the map
          what the fold was written to give it back. The label says where the press GOES, not where it is. */}
      {onToggleMode && mode !== null && (
        <div style={{ ...styles.mapNavRow, display: folded ? 'none' : 'flex' }}>
          <button
            aria-label={mode === 'live' ? 'Switch to the flat map' : 'Switch to the 3D map'}
            onClick={onToggleMode}
            style={level}
            title={mode === 'live' ? 'Switch to the flat map' : 'Switch to the 3D map'}
            type="button"
          >
            {mode === 'live' ? '2D' : '3D'}
          </button>
        </div>
      )}

      {/* Vertical where the screen is narrow: a column is 44 px wide against the row's 92, which keeps the
          cluster in the thumb's edge zone instead of reaching across the map and its labels. */}
      <div style={{ ...styles.mapNavRow, flexDirection: compact ? 'column' : 'row' }}>
        <button
          aria-label="Zoom in"
          disabled={disabled}
          onClick={() => handle?.zoomBySteps(1)}
          style={key}
          type="button"
        >
          +
        </button>
        <button
          aria-label="Zoom out"
          disabled={disabled}
          onClick={() => handle?.zoomBySteps(-1)}
          style={key}
          type="button"
        >
          −
        </button>
      </div>
    </div>
  );
}

/**
 * The rose. `MAP_YAW` is north-up, so what the needle shows is the view's departure from it — turn the map
 * east and the N ticks round to the left, which is the only reading that matches what is under it.
 */
function Compass({ yaw }: { yaw: number }): ReactElement {
  const degrees = ((MAP_YAW - yaw) * 180) / Math.PI;

  return (
    <svg height="34" viewBox="-20 -20 40 40" width="34">
      <circle cx="0" cy="0" fill="none" r="17" stroke="#2a3a4d" strokeWidth="1.5" />
      <g transform={`rotate(${degrees.toFixed(2)})`}>
        <polygon fill="#e5534b" points="0,-14 4.5,0 0,3 -4.5,0" />
        <polygon fill="#7d8ea1" points="0,14 4.5,0 0,-3 -4.5,0" />
        <text fill="#c9d6e4" fontSize="7" textAnchor="middle" y="-15.5">
          N
        </text>
      </g>
    </svg>
  );
}
