// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import type { FlightTrack, SessionEndReason } from './csv';

import { FlightAnalysisOverlay } from './analysis-overlay';
import { parseFlightCsv } from './csv';
import { EndpointList } from './endpoint-list';

const HEADER = 'local_timestamp,model,health,x,y,z';
const TWO_ROWS = [
  '2026-01-01T00:00:00.000,520,100.0,1111.12345,-2222.54321,33.9375',
  '2026-01-01T00:00:00.040,520,100.0,1111.22345,-2222.44321,34.0625',
].join('\n');

function track(name: string, endReason: SessionEndReason = 'unknown'): FlightTrack {
  return parseFlightCsv(`# session_end,${endReason},2026-01-01T00:00:00.040\n${HEADER}\n${TWO_ROWS}\n`, name);
}

describe('EndpointList', () => {
  describe('negative cases', () => {
    it('renders the empty placeholder when there are no endpoints', () => {
      const list = new EndpointList();
      const host = document.createElement('div');
      list.mount(host);
      list.setTracks([], 0);

      expect(host.querySelectorAll('.endpoint-list__row')).toHaveLength(0);
      expect(host.querySelector('.endpoint-list__empty')?.textContent).toBe('还没有航迹端点');
    });
  });

  describe('positive cases', () => {
    it('renders one row per endpoint with the end reason and the exact coordinates', () => {
      const list = new EndpointList();
      const host = document.createElement('div');
      list.mount(host);
      list.setTracks([track('a.csv', 'quickhome_teleport_detected')], 0);

      const row = host.querySelector<HTMLButtonElement>('.endpoint-list__row');
      expect(host.querySelectorAll('.endpoint-list__row')).toHaveLength(1);
      expect(row?.dataset.reason).toBe('quickhome_teleport_detected');
      expect(row?.dataset.trackIndex).toBe('0');
      expect(row?.textContent).toContain('quickhome_teleport_detected');
      expect(row?.textContent).toContain('(1111, -2222, 34)');
    });

    it('select() fires onSelect and marks the row selected', () => {
      const list = new EndpointList();
      const host = document.createElement('div');
      const seen: number[] = [];
      list.onSelect((endpoint) => seen.push(endpoint.trackIndex));
      list.mount(host);
      list.setTracks([track('a.csv'), track('b.csv', 'game_closed')], 0);

      list.select(1);

      expect(seen).toEqual([1]);
      expect(host.querySelectorAll('.endpoint-list__item.is-selected')).toHaveLength(1);
    });
  });
});

describe('FlightAnalysisOverlay retired flat panel', () => {
  describe('negative cases', () => {
    it('setHeatmapVisible/toggleHeatmap are no-ops that never mount a heatmap node', () => {
      const overlay = new FlightAnalysisOverlay();
      overlay.setHeatmapVisible(true);
      overlay.toggleHeatmap();
      overlay.setHeatmapVisible(false);
      overlay.setTracks([track('a.csv', 'game_closed')], 0);
      overlay.toggleHeatmap();

      expect(document.querySelector('.analysis-heatmap')).toBeNull();
      expect(document.querySelector('.analysis-heatmap__canvas')).toBeNull();
      expect(document.getElementById('analysis-heatmap')).toBeNull();
      overlay.destroy();
    });
  });

  describe('positive cases', () => {
    it('mountEndpointList is the only endpoint surface and focusTrack resolves the track slot', () => {
      const overlay = new FlightAnalysisOverlay();
      const host = document.createElement('div');
      overlay.mountEndpointList(host);
      overlay.setTracks([track('a.csv'), track('b.csv', 'game_closed')], 0);

      expect(host.querySelectorAll('.endpoint-list__row')).toHaveLength(2);

      const flyTo = vi.spyOn(overlay.camera, 'flyTo');
      overlay.focusTrack(1);

      expect(flyTo).toHaveBeenCalledTimes(1);
      expect(overlay.endpoints.endpointAt(1)?.trackIndex).toBe(1);
      expect(host.querySelectorAll('.endpoint-list__item.is-selected')).toHaveLength(1);
      overlay.destroy();
    });
  });
});
