/**
 * Shift header: identity, the dial that drives the WORLD's lighting, and the desk's dispatch mode.
 *
 * The dial was labelled "Time" until 201/8-03, which is the one label it may not have: the console now
 * carries a second clock — the shift's wall time, on the timeline strip — and an operator who reads this one
 * as that one turns the sky when they meant to rewind the board. It says `WORLD` now, and the timeline says
 * `SHIFT`.
 *
 * The `PLAN` toggle (201/7-01) is the projection, not a display mode: the same world, drawn with parallel
 * rays instead of a perspective frustum.
 */
import type { CSSProperties, ReactElement } from 'react';

import type { MapProjection } from '../map/map-camera';
import type { ThemeId } from './theme';

import { ACCENT, COLORS, styles, TOUCH_TARGET } from './styles';
import { THEMES } from './theme';

export function TopBar({
  autoDispatch,
  compact = false,
  hour,
  latest,
  onAutoDispatch,
  onHour,
  onProjection,
  onTheme,
  projection,
  theme,
  touch = false,
}: {
  autoDispatch: boolean;
  /** Phone layout: shorten the title, drop the region badge and the log ticker, narrow the time slider. */
  compact?: boolean;
  hour: number;
  latest: string | undefined;
  onAutoDispatch: (enabled: boolean) => void;
  onHour: (hour: number) => void;
  onProjection: (projection: MapProjection) => void;
  onTheme: (theme: ThemeId) => void;
  /** What the map is drawing with right now — read back from the readout's pose, never held here. */
  projection: MapProjection;
  /** The skin in force. Held by `App` and written to the root as `data-theme`, never held here. */
  theme: ThemeId;
  /** The pointer is a finger: the dial and the switch take a finger-sized target. */
  touch?: boolean;
}): ReactElement {
  return (
    <div style={compact ? styles.topBarCompact : styles.topBar}>
      <strong style={{ letterSpacing: 1.5 }}>{compact ? 'DISPATCH' : 'OPENSA · DISPATCH'}</strong>
      {!compact && <span style={{ ...styles.badge, background: ACCENT.bg, color: COLORS.accent }}>SAN ANDREAS</span>}

      <label style={{ alignItems: 'center', display: 'flex', gap: 6, marginLeft: compact ? 0 : 12, minWidth: 0 }}>
        {!compact && <span style={{ color: COLORS.muted }}>WORLD</span>}
        <input
          max={24}
          min={0}
          onChange={(event) => onHour(Number(event.target.value))}
          step={0.25}
          style={{ ...(touch ? styles.rangeTouch : {}), minWidth: 0, width: compact ? 84 : 150 }}
          type="range"
          value={hour}
        />
        <span style={{ ...styles.mono, width: 42 }}>{clock(hour)}</span>
      </label>

      <button
        onClick={() => onProjection(projection === 'ortho' ? 'perspective' : 'ortho')}
        style={buttonStyle(touch, projection === 'ortho')}
        title="Plan view: parallel projection, so buildings stop leaning and distances read the same everywhere"
        type="button"
      >
        PLAN
      </button>

      {/* A button rather than a checkbox: the native box is 13x13 and no inline style reaches it, so on a
          phone this switch was a third of the target the criterion asks for. `aria-pressed` keeps it a
          two-state control for anything reading the tree. */}
      <button
        aria-pressed={autoDispatch}
        onClick={() => onAutoDispatch(!autoDispatch)}
        style={{
          ...(autoDispatch ? styles.toggleOn : styles.toggle),
          ...(touch ? { minHeight: TOUCH_TARGET, minWidth: TOUCH_TARGET } : {}),
          marginLeft: compact ? 'auto' : 0,
        }}
        title="Assign the nearest free unit to a new call automatically"
        type="button"
      >
        <span aria-hidden style={{ fontSize: 13 }}>
          {autoDispatch ? '☑' : '☐'}
        </span>
        <span>{compact ? 'Auto' : 'Auto-dispatch'}</span>
      </button>

      {!compact && (
        <span style={{ color: COLORS.muted, marginLeft: 'auto', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {latest ?? ''}
        </span>
      )}

      {/* A native `<select>` rather than a menu of swatches: it is one target, it is in the tab order for
          free, and on a phone it opens the OS picker — which is a better list than anything drawn here.
          Switching writes one attribute on the app root; nothing in this tree re-renders because of it. */}
      <label
        style={{
          alignItems: 'center',
          display: 'flex',
          gap: 6,
          marginLeft: compact ? 8 : 12,
        }}
        title="The console's skin"
      >
        <span aria-hidden style={{ color: COLORS.muted, letterSpacing: 0.6 }}>
          SKIN
        </span>
        <span style={{ clip: 'rect(0 0 0 0)', height: 1, overflow: 'hidden', position: 'absolute', width: 1 }}>
          Theme
        </span>
        <select
          onChange={(event) => onTheme(event.target.value as ThemeId)}
          style={touch ? styles.selectTouch : styles.select}
          value={theme}
        >
          {THEMES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function buttonStyle(touch: boolean, primary: boolean): CSSProperties {
  if (primary) {
    return touch ? styles.buttonPrimaryTouch : styles.buttonPrimary;
  }

  return touch ? styles.buttonTouch : styles.button;
}

function clock(hour: number): string {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour - Math.floor(hour)) * 60);

  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
