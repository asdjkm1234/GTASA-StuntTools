/**
 * The shift timeline (201/8-03): where in the shift the console is showing, and the controls to move there.
 *
 * **This is the WALL clock, and it is not the world's.** The top bar's dial turns the sky; this strip moves
 * the board through time. The chain's own warning is that an operator will read one for the other, so the
 * two are labelled — `WORLD` up there, `SHIFT` here — and this one shouts REPLAY whenever the picture on
 * screen is not the current one.
 */
import { type ReactElement } from 'react';

import type { Clock, PlaybackRate } from '../ops/clock';

import { PLAYBACK_RATES } from '../ops/clock';
import { COLORS, styles } from './styles';

export function TimelineBar({
  clock,
  compact = false,
  onBookmark,
  onLive,
  onRate,
  onScrub,
  touch = false,
  window,
}: {
  clock: Clock;
  /** Phone layout: drop the labels and the bookmark button, keep the scrub and Live. */
  compact?: boolean;
  onBookmark: () => void;
  onLive: () => void;
  onRate: (rate: PlaybackRate) => void;
  onScrub: (t: number) => void;
  /** The pointer is a finger: the scrub and the rate keys take a finger-sized target. */
  touch?: boolean;
  window: null | { newest: number; oldest: number };
}): ReactElement {
  const replaying = clock.mode === 'replay';
  const button = touch ? styles.buttonTouch : styles.button;
  const buttonPrimary = touch ? styles.buttonPrimaryTouch : styles.buttonPrimary;
  const span = window ? Math.max(1, window.newest - window.oldest) : 1;
  const behindMs = window ? window.newest - clock.t : 0;

  return (
    <div style={styles.timeline}>
      {!compact && <span style={{ color: COLORS.muted }}>SHIFT</span>}
      <input
        disabled={window === null}
        max={window?.newest ?? 1}
        min={window?.oldest ?? 0}
        onChange={(event) => onScrub(Number(event.target.value))}
        step={Math.max(1, Math.round(span / 1000))}
        style={touch ? { ...styles.timelineRange, ...styles.rangeTouch } : styles.timelineRange}
        type="range"
        value={clock.t}
      />
      <span style={{ ...styles.mono, minWidth: 62, textAlign: 'right' }}>
        {replaying ? `−${elapsed(behindMs)}` : elapsed(window ? window.newest - window.oldest : 0)}
      </span>

      {PLAYBACK_RATES.map((rate) => (
        <button
          key={rate}
          onClick={() => onRate(rate)}
          style={replaying && clock.rate === rate ? buttonPrimary : button}
          type="button"
        >
          ×{rate}
        </button>
      ))}

      <button onClick={onLive} style={replaying ? button : buttonPrimary} type="button">
        Live
      </button>
      {replaying && <span style={styles.timelineReplay}>REPLAY</span>}

      {!compact && (
        <button onClick={onBookmark} style={button} type="button">
          Mark
        </button>
      )}
      {clock.bookmarks.map((mark) => (
        <button key={mark.t} onClick={() => onScrub(mark.t)} style={button} type="button">
          {mark.label}
        </button>
      ))}
    </div>
  );
}

/** A duration as `1h 04m` / `4m 12s` / `9s` — a shift is read in minutes, not in milliseconds. */
function elapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }

  return minutes > 0 ? `${minutes}m ${String(total % 60).padStart(2, '0')}s` : `${total}s`;
}
