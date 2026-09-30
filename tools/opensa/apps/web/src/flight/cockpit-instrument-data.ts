import type { FlightRow, FlightTrack, SampledPose } from './csv';

import { rotateVec } from './math';

export interface CockpitInstrumentState {
  altitude: number;
  damage: (null | number)[];
  gear: 'DOWN' | 'MOVING' | 'UP';
  heading: number;
  health: number;
  healthDisplay: number;
  nozzle: null | number;
  pitch: number;
  roll: number;
  s: number;
  speedKmh: number;
  throttle: null | number;
  throttleDisplay: null | number;
  throttleInferred: boolean;
  throttleSource: 'keys' | 'legacy_control' | 'recorded' | 'unknown';
}

const speeds = new WeakMap<FlightTrack, Float64Array>();
// Two damped stages suppress capture jitter, with about 0.5 s total response lag.
const SPEED_DAMPING_SECONDS = 0.25;
const inferredThrottle = new WeakMap<FlightTrack, boolean>();
interface LevelTransition {
  from: null | number;
  start: number;
  target: null | number;
}
const levelAnimations = new WeakMap<FlightTrack, { health: LevelTransition[]; throttle: LevelTransition[] }>();
const HEALTH_ANIMATION_SECONDS = 0.4,
  THROTTLE_ANIMATION_SECONDS = 0.28;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Shared by visible replay and GPU export; all inputs come from the sampled flight time. */
export function cockpitInstrumentState(track: FlightTrack, pose: SampledPose, s = pose.row.s): CockpitInstrumentState {
  const row = pose.row;
  const forward = rotateVec(pose.orientation, [0, 1, 0]);
  const up = rotateVec(pose.orientation, [0, 0, 1]);
  const right = rotateVec(pose.orientation, [1, 0, 0]);
  const progress = Math.abs(row.gear);

  return {
    altitude: pose.pos[2],
    damage: row.surfaceDamage.states,
    gear: progress < 0.01 ? 'DOWN' : progress > 0.99 ? 'UP' : 'MOVING',
    heading: ((Math.atan2(forward[0], -forward[2]) * 180) / Math.PI + 360) % 360,
    health: clamp(row.health / 1000, 0, 1),
    nozzle: row.nozzleRotation === null ? null : clamp(row.nozzleRotation / 5000, 0, 1),
    pitch: (Math.asin(clamp(forward[1], -1, 1)) * 180) / Math.PI,
    roll: (Math.atan2(-right[1], up[1]) * 180) / Math.PI,
    s,
    speedKmh: speedFromTrack(track, s) * 3.6,
    ...throttleForRow(track, row),
    ...animatedLevels(track, s),
  };
}

/** Damped instrument velocity, in world units/s; raw GTA movement vectors are not SI velocity. */
export function speedFromTrack(track: FlightTrack, s: number): number {
  let values = speeds.get(track);
  if (!values) {
    let first = 0,
      second = 0;
    values = Float64Array.from(track.rows, (_, i) => {
      const a = track.rows[Math.max(0, i - 1)];
      const b = track.rows[Math.min(track.rows.length - 1, i + 1)];
      const dt = b.s - a.s;

      const raw = dt > 0 ? Math.hypot(...b.pos.map((v, axis) => v - a.pos[axis])) / dt : 0;
      if (i === 0) first = second = raw;
      else {
        // Exact response of two cascaded low-pass stages to this sample. Use capture time,
        // not rendering frames, so seeking, playback rates and video export agree.
        const t = Math.max(0, track.rows[i].s - track.rows[i - 1].s) / SPEED_DAMPING_SECONDS;
        const decay = Math.exp(-t),
          previous = first;
        first = raw + (first - raw) * decay;
        second = raw + (second - raw + (previous - raw) * t) * decay;
      }

      return second;
    });
    speeds.set(track, values);
  }
  let hi = track.rows.length - 1,
    lo = 0;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (track.rows[mid].s <= s) lo = mid;
    else hi = mid;
  }
  const t = clamp((s - track.rows[lo].s) / Math.max(1e-6, track.rows[hi].s - track.rows[lo].s), 0, 1);

  return values[lo] + (values[hi] - values[lo]) * t;
}

/** Causal display-only transitions: actual control inputs and damage warnings stay immediate. */
function animatedLevels(
  track: FlightTrack,
  s: number,
): Pick<CockpitInstrumentState, 'healthDisplay' | 'throttleDisplay'> {
  let animations = levelAnimations.get(track);
  if (!animations) {
    animations = { health: [], throttle: [] };
    for (const row of track.rows) {
      for (const [values, target, duration] of [
        [animations.health, clamp(row.health / 1000, 0, 1), HEALTH_ANIMATION_SECONDS],
        [animations.throttle, throttleForRow(track, row).throttle, THROTTLE_ANIMATION_SECONDS],
      ] as const) {
        const previous = values[values.length - 1];
        // Unknown input clears immediately; valid input starts afresh without guessing a bridge.
        values.push(
          previous?.target === target
            ? previous
            : {
                from: previous && target !== null ? (transitionValue(previous, row.s, duration) ?? target) : target,
                start: row.s,
                target,
              },
        );
      }
    }
    levelAnimations.set(track, animations);
  }
  let hi = track.rows.length - 1,
    lo = 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (track.rows[mid].s <= s) lo = mid;
    else hi = mid - 1;
  }

  return {
    healthDisplay: transitionValue(animations.health[lo], s, HEALTH_ANIMATION_SECONDS) ?? 0,
    throttleDisplay: transitionValue(animations.throttle[lo], s, THROTTLE_ANIMATION_SECONDS),
  };
}

/** Physical default W/S input proxy; do not confuse it with measured thrust or engine RPM. */
function throttleForRow(
  track: FlightTrack,
  row: FlightRow,
): Pick<CockpitInstrumentState, 'throttle' | 'throttleInferred' | 'throttleSource'> {
  if (track.version >= 11) {
    if (!row.keyboardStateValid || row.keyW === null || row.keyS === null)
      return { throttle: null, throttleInferred: true, throttleSource: 'unknown' };
    const throttle = row.keyW === row.keyS ? 0.5 : row.keyW === 1 ? 1 : 0;

    return { throttle, throttleInferred: true, throttleSource: 'keys' };
  }
  let proxy = inferredThrottle.get(track);
  if (proxy === undefined) {
    proxy = !track.rows.some((r) => Math.abs(r.throttle) > 0.001);
    inferredThrottle.set(track, proxy);
  }
  if (!proxy) return { throttle: clamp(row.throttle, 0, 1), throttleInferred: false, throttleSource: 'recorded' };
  const throttle = row.brake < 0.25 ? 1 : row.brake > 0.75 ? 0 : 0.5;

  return { throttle, throttleInferred: true, throttleSource: 'legacy_control' };
}

function transitionValue(transition: LevelTransition, s: number, duration: number): null | number {
  if (transition.target === null || transition.from === null) return transition.target;
  const t = clamp((s - transition.start) / duration, 0, 1);
  const eased = 1 - (1 - t) ** 3;

  return transition.from + (transition.target - transition.from) * eased;
}
