// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import type { FlightTrack } from './csv';
import type { TrackEndpoint } from './track-endpoints';

import { parseFlightCsv } from './csv';
import { ReplayNavigation } from './replay-navigation';

function track(name: string): FlightTrack {
  return parseFlightCsv(
    'local_timestamp,model,health,x,y,z\n' +
      '2026-01-01T00:00:00.000,520,1000,1111,-2222,34\n' +
      '2026-01-01T00:00:00.040,520,1000,1112,-2222,34\n',
    name,
  );
}

describe('ReplayNavigation beacon selection', () => {
  it('preserves a free overview while selecting different endpoints and notifying the replay', () => {
    const onEndpointFocus = vi.fn<(endpoint: TrackEndpoint) => void>();
    const navigation = new ReplayNavigation({
      camera: { pitch: -0.7, position: [1400, 950, 850], yaw: 1.2 },
      onEndpointFocus,
    });
    navigation.setTracks([track('a.csv'), track('b.csv')], 0);
    navigation.setFreeMode(true);
    const before = navigation.camera.pose;

    expect(navigation.focusTrack(1)).toBe(true);
    navigation.updateInput(1);
    navigation.focusTrack(0);
    navigation.updateInput(1);

    expect(navigation.camera.pose).toEqual(before);
    expect(navigation.isFreeMode()).toBe(true);
    expect(navigation.camera.flying()).toBe(false);
    expect(onEndpointFocus.mock.calls.map(([endpoint]) => endpoint.trackIndex)).toEqual([1, 0]);
    navigation.destroy();
  });

  it('stops an unfinished endpoint flight at its current pose when another beacon is selected', () => {
    const navigation = new ReplayNavigation();
    navigation.setTracks([track('a.csv'), track('b.csv')], 0);
    navigation.focusTrack(0);
    navigation.updateInput(0.2);
    expect(navigation.camera.flying()).toBe(true);
    const before = navigation.camera.pose;
    const distanceBefore = navigation.camera.focusDistance;

    navigation.focusTrack(1);
    navigation.updateInput(1);

    expect(navigation.camera.pose).toEqual(before);
    expect(navigation.camera.focusDistance).toBe(distanceBefore);
    expect(navigation.camera.flying()).toBe(false);
    navigation.destroy();
  });

  it('resolves import indices with missing endpoints and after removal, undo and clearing', () => {
    const onEndpointFocus = vi.fn<(endpoint: TrackEndpoint) => void>();
    const navigation = new ReplayNavigation({ onEndpointFocus });
    const a = track('a.csv'),
      b = track('b.csv'),
      unknown = track('unknown.csv');
    for (const row of unknown.rows) row.pos = [NaN, NaN, NaN];
    navigation.setTracks([a, unknown, b]);
    expect(navigation.focusTrack(1)).toBe(false);
    expect(navigation.focusTrack(2)).toBe(true);
    expect(onEndpointFocus.mock.lastCall?.[0].track).toBe(b);
    expect(onEndpointFocus.mock.lastCall?.[0].position).toEqual([1112, -2222, 34]);
    navigation.setTracks([unknown, b], 1);
    expect(navigation.focusTrack(1)).toBe(true);
    expect(onEndpointFocus.mock.lastCall?.[0].track).toBe(b);
    navigation.setTracks([a, unknown, b], 2);
    expect(navigation.focusTrack(2)).toBe(true);
    expect(onEndpointFocus.mock.lastCall?.[0].track).toBe(b);
    navigation.setTracks([], -1);
    onEndpointFocus.mockClear();
    expect(navigation.focusTrack(0)).toBe(false);
    expect(navigation.currentTrack()).toBeNull();
    expect(onEndpointFocus).not.toHaveBeenCalled();
    navigation.destroy();
  });
});
