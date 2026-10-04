import type { FlightRow, FlightTrack } from './csv';

/** Independent visual lifetime; never appended to the recording's progress bar. */
export const EXPLOSION_REPLAY_SECONDS = 4;

/** After the recording ends, the burst advances on wall time even while playback is paused. */
export class ExplosionAnimationClock {
  private startedAt: null | number = null;
  private track: FlightTrack | null = null;

  reset(): void {
    this.track = null;
    this.startedAt = null;
  }

  sample(track: FlightTrack, seconds: number, nowMs: number): { age: null | number; seconds: number } {
    if (track !== this.track) {
      this.track = track;
      this.startedAt = null;
    }
    const eventSeconds = track.explosionReplay?.explosionSeconds;
    if (eventSeconds === undefined || seconds < eventSeconds) {
      this.startedAt = null;

      return { age: null, seconds };
    }
    this.startedAt ??= nowMs;
    const age = Math.min(EXPLOSION_REPLAY_SECONDS, Math.max(0, (nowMs - this.startedAt) / 1000));

    return { age, seconds: eventSeconds + age };
  }
}

export function explosionExportDuration(track: FlightTrack): number {
  return track.duration + (track.explosionReplay ? EXPLOSION_REPLAY_SECONDS : 0);
}

/** Replace measured post-explosion motion with a stationary ending, without editing the recording. */
export function prepareExplosionReplay(track: FlightTrack): FlightTrack {
  if (track.explosionReplay || track.rows.length === 0) return track;
  const explosion = track.events
    .filter(
      (event) =>
        event.kind === 'explosion' && Number.isFinite(event.s) && event.s >= 0 && event.pos.every(Number.isFinite),
    )
    .sort((a, b) => a.s - b.s)[0];
  if (!explosion) return track;

  // The recorder writes the explosion position from its latest actual sample. Do not borrow a later
  // wreck rotation or detached-node state, even if the event falls between two samples.
  const retained = track.rows.filter((row) => row.s < explosion.s);
  let anchor = track.rows[0];
  for (const row of track.rows) {
    if (row.s > explosion.s) break;
    anchor = row;
  }
  const frozen: FlightRow = {
    ...anchor,
    brake: 0,
    health: 0,
    pos: [...explosion.pos],
    s: explosion.s,
    smokeActive: false,
    steer: 0,
    throttle: 0,
    timeMs: anchor.timeMs + (explosion.s - anchor.s) * 1000,
    velocity: [0, 0, 0],
  };
  const duration = explosion.s;

  return {
    ...track,
    duration,
    events: track.events.filter((event) => event.s <= explosion.s),
    explosionReplay: {
      explosionSeconds: explosion.s,
      recordedDuration: track.duration,
      removedSamples: track.rows.filter((row) => row.s > explosion.s).length,
    },
    rows: [...retained, frozen],
  };
}
