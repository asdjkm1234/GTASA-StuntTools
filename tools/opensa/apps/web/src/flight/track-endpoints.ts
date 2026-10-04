/**
 * The single shared ENDPOINT MODEL for imported recordings.
 *
 * One entity per imported track that has at least one finite coordinate, taken from that track's last usable
 * sample (`finalValidSample`) and carrying the EXACT recorded GTA world position — no rounding, no
 * projection, no reinterpretation. `trackIndex` keeps the import-list position, so a DB or marker layer can
 * always map an endpoint back to its track even when some tracks have no endpoint.
 *
 * The `# session_end` reason travels as text only: it is never interpreted as a death and never used to
 * filter an endpoint out. Reading goes through {@link endReasonOf}, so a track object produced by an older
 * parser revision (no `endReason` field) answers `unknown` instead of `undefined` — the optional-field
 * contract of `track-fx.ts` applied to this field.
 */
import type { FlightTrack, SessionEndReason } from './csv';
import type { Vec3 } from './math';

import { finalValidSample } from './analysis-metrics';

export interface TrackEndpoint {
  /** Why the recorder closed the session; `unknown` when the file carried no readable line. */
  readonly endReason: SessionEndReason;
  readonly model: number;
  readonly name: string;
  /** Exact GTA world position (x east, y north, z up) of the endpoint. */
  readonly position: Vec3;
  /** Replay seconds of the endpoint sample. */
  readonly time: number;
  readonly track: FlightTrack;
  /** Position in the current imported list; rebuilt after removal/undo. Use `track` for identity. */
  readonly trackIndex: number;
}

/**
 * Build one endpoint per imported track that has a finite coordinate, in import order.
 * A track without any finite coordinate contributes nothing; a track with one is never dropped.
 */
export function buildTrackEndpoints(tracks: readonly FlightTrack[]): TrackEndpoint[] {
  const endpoints: TrackEndpoint[] = [];
  tracks.forEach((track, trackIndex) => {
    if (!hasFiniteCoordinate(track)) {
      return;
    }
    const row = finalValidSample(track);
    if (!row) {
      return;
    }
    endpoints.push({
      endReason: endReasonOf(track),
      model: track.model,
      name: track.name,
      position: [row.pos[0], row.pos[1], row.pos[2]],
      time: row.s,
      track,
      trackIndex,
    });
  });

  return endpoints;
}

/** `FlightTrack.endReason`, or `unknown` for a track object from before the field existed. */
export function endReasonOf(track: FlightTrack): SessionEndReason {
  return (track as FlightTrack & Partial<Pick<FlightTrack, 'endReason'>>).endReason ?? 'unknown';
}

/** True when the track carries at least one finite GTA coordinate. */
export function hasFiniteCoordinate(track: FlightTrack): boolean {
  return track.rows.some((row) => row.pos.every(Number.isFinite));
}
