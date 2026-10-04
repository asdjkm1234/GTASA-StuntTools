import type { FlightTrack } from './csv';

export interface VisualPropellerMotion {
  phase: number;
  source: 'inferred';
  spinning: boolean;
}

// Display cadence only: recordings do not contain engine-on state or Rustler RPM.
const VISUAL_PHASE_RATE = 37;
const activeSeconds = new WeakMap<FlightTrack, Float64Array>();

/** Capture-time animation, independent of frame rate, pause and seek order. */
export function visualPropellerMotion(track: FlightTrack, seconds: number): null | VisualPropellerMotion {
  if (track.model !== 476 || track.rows.length === 0 || !Number.isFinite(seconds)) return null;
  const rows = track.rows;
  let active = activeSeconds.get(track);
  if (!active) {
    active = new Float64Array(rows.length);
    for (let i = 1; i < rows.length; i++) {
      active[i] = active[i - 1] + (rows[i - 1].health > 0 ? Math.max(0, rows[i].s - rows[i - 1].s) : 0);
    }
    activeSeconds.set(track, active);
  }
  const s = Math.max(rows[0].s, Math.min(rows[rows.length - 1].s, seconds));
  let low = 0;
  let high = rows.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (rows[mid].s <= s) low = mid;
    else high = mid - 1;
  }
  const spinning = rows[low].health > 0;

  return {
    phase: ((active[low] + (spinning ? s - rows[low].s : 0)) * VISUAL_PHASE_RATE) % (Math.PI * 2),
    source: 'inferred',
    spinning,
  };
}
