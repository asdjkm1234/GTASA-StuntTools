import type { FlightTrack } from './csv';

export interface ShortFlightAnalysis {
  medianFrames: null | number;
  removed: FlightTrack[];
  thresholdFrames: null | number;
}

/** One pass over this batch only. No iterative pruning or influence from previously imported flights. */
export function analyzeShortFlights(tracks: readonly FlightTrack[]): ShortFlightAnalysis {
  const lengths = tracks
    .map((track) => track.rows.length)
    .filter((frames) => frames > 0)
    .sort((a, b) => a - b);
  // A pair does not establish a useful baseline; preserve small/single imports for manual removal.
  if (lengths.length < 3) return { medianFrames: null, removed: [], thresholdFrames: null };
  const middle = Math.floor(lengths.length / 2);
  const median = lengths.length % 2 ? lengths[middle] : (lengths[middle - 1] + lengths[middle]) / 2;
  const threshold = median * 0.1;

  return {
    medianFrames: median,
    removed: tracks.filter((track) => track.rows.length > 0 && track.rows.length < threshold),
    thresholdFrames: threshold,
  };
}
