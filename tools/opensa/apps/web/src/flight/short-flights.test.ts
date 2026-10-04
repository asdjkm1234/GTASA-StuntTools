import { describe, expect, it } from 'vitest';

import type { FlightTrack } from './csv';

import { parseFlightCsv } from './csv';
import { analyzeShortFlights } from './short-flights';

function track(frames: number): FlightTrack {
  return parseFlightCsv(
    'local_timestamp,model,health,x,y,z,capture_elapsed_s\n' +
      Array.from({ length: frames }, (_, i) => `2026-10-03T00:00:00.000,520,1000,0,0,40,${i / 25}`).join('\n'),
    `${frames}-frames.csv`,
  );
}

describe('frame-count short recording filter', () => {
  it('uses the batch median, preserves equality and never mutates the tracks or import order', () => {
    const tracks = [9, 10, 100, 100, 10000].map(track);
    const analysis = analyzeShortFlights(tracks);
    expect(analysis.medianFrames).toBe(100);
    expect(analysis.thresholdFrames).toBe(10);
    expect(analysis.removed).toEqual([tracks[0]]);
    expect(tracks.map((item) => item.rows.length)).toEqual([9, 10, 100, 100, 10000]);
  });

  it('averages both middle counts for even batches without rounding away the boundary', () => {
    const tracks = [10, 100, 110, 10000].map(track);
    expect(analyzeShortFlights(tracks)).toEqual({ medianFrames: 105, removed: [tracks[0]], thresholdFrames: 10.5 });
  });

  it('preserves fewer than three records, equally short batches and empty batches', () => {
    expect(analyzeShortFlights([]).removed).toEqual([]);
    expect(analyzeShortFlights([track(2), track(10000)]).thresholdFrames).toBeNull();
    expect(analyzeShortFlights([track(2), track(2), track(2)]).removed).toEqual([]);
  });

  it('only counts samples, regardless of distance, duration or recording end reason', () => {
    const tracks = [5, 100, 100].map(track);
    tracks[0].duration = 1000;
    tracks[0].rows[4].pos = [10000, 0, 10000];
    tracks[0].endReason = 'game_closed';
    tracks[2].duration = 0.1;
    expect(analyzeShortFlights(tracks).removed).toEqual([tracks[0]]);
  });
});
