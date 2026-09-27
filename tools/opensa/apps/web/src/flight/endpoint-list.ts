/**
 * Endpoint track list for imported recordings — the selection/disambiguation surface of the analysis overlay.
 *
 * The endpoint/heat view is the 3D marker layer (`endpoint-markers.ts`): every recording's terminal coordinate
 * is drawn in the world, and density reads from the cluster halo. This module is what remains of the old flat
 * panel: the SHARED endpoint model (`track-endpoints.ts`) rendered as an HTML list of rows — one per endpoint,
 * carrying the end reason plus the exact GTA coordinates — so a marker can always be resolved back to a track.
 * The 2D density canvas is gone; nothing here draws a top-down map.
 */
import type { FlightTrack } from './csv';

import { buildTrackEndpoints, type TrackEndpoint } from './track-endpoints';

export interface EndpointListOptions {
  onSelect?: (endpoint: TrackEndpoint) => void;
}

export class EndpointList {
  private activeIndex = 0;
  private container: HTMLElement | null = null;
  private endpoints: TrackEndpoint[] = [];
  private list: HTMLOListElement | null = null;
  private readonly listeners = new Set<(endpoint: TrackEndpoint) => void>();
  private readonly options: EndpointListOptions;
  private selectedIndex = -1;

  constructor(options: EndpointListOptions = {}) {
    this.options = options;
  }

  destroy(): void {
    this.container?.replaceChildren();
    this.container = null;
    this.list = null;
    this.endpoints = [];
    this.selectedIndex = -1;
  }

  endpointAt(index: number): null | TrackEndpoint {
    return this.endpoints[index] ?? null;
  }

  getEndpoints(): readonly TrackEndpoint[] {
    return this.endpoints;
  }

  /** Build the endpoint list inside `container` (which gets the `endpoint-list` class). */
  mount(container: HTMLElement): HTMLElement {
    if (this.container === container && this.list) {
      return container;
    }
    this.destroy();
    this.container = container;
    container.classList.add('endpoint-list');
    const title = document.createElement('div');
    title.className = 'endpoint-list__title';
    title.textContent = '终点列表';
    this.list = document.createElement('ol');
    this.list.className = 'endpoint-list__rows';
    container.append(title, this.list);
    this.render();

    return container;
  }

  /** Subscribe to endpoint selections. Returns an unsubscribe function. */
  onSelect(callback: (endpoint: TrackEndpoint) => void): () => void {
    this.listeners.add(callback);

    return () => {
      this.listeners.delete(callback);
    };
  }

  /** Select an endpoint programmatically (also fires the `onSelect` listeners / the row click flow). */
  select(index: number): void {
    const endpoint = this.endpoints[index];
    if (!endpoint) {
      return;
    }
    this.selectedIndex = index;
    this.render();
    this.options.onSelect?.(endpoint);
    for (const listener of this.listeners) {
      listener(endpoint);
    }
    const row = this.list?.children[index];
    // jsdom has no scrollIntoView; a test host must not make selection throw for a scroll nicety.
    if (row && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ block: 'nearest' });
    }
  }

  /** Mark the endpoint belonging to `trackIndex` as active (the highlighted row). */
  setActive(trackIndex: number): void {
    this.activeIndex = this.endpointIndexForTrack(trackIndex);
    this.render();
  }

  /** Rebuild from the current import list; every track with a finite endpoint contributes exactly one row. */
  setTracks(tracks: readonly FlightTrack[], activeIndex = 0): void {
    this.endpoints = buildTrackEndpoints(tracks);
    this.activeIndex = this.endpointIndexForTrack(activeIndex);
    this.render();
  }

  /** Map a track index to its endpoint slot. Tracks with no usable endpoint are absent, so indices differ. */
  private endpointIndexForTrack(trackIndex: number): number {
    const found = this.endpoints.findIndex((endpoint) => endpoint.trackIndex === trackIndex);
    if (found >= 0) {
      return found;
    }

    return Math.max(0, Math.min(this.endpoints.length - 1, trackIndex));
  }

  private render(): void {
    const list = this.list;
    if (!list) {
      return;
    }
    list.replaceChildren();
    if (this.endpoints.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'endpoint-list__empty';
      empty.textContent = '还没有航迹端点';
      list.append(empty);

      return;
    }
    this.endpoints.forEach((endpoint, index) => {
      const item = document.createElement('li');
      item.className = 'endpoint-list__item';
      if (index === this.activeIndex) {
        item.classList.add('is-active');
      }
      if (index === this.selectedIndex) {
        item.classList.add('is-selected');
      }
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'endpoint-list__row';
      button.dataset.trackIndex = String(endpoint.trackIndex);
      button.dataset.reason = endpoint.endReason;
      button.textContent = `#${index + 1} ${shortName(endpoint.name)} · ${endpoint.endReason} · ${endpoint.model} · ${endpoint.time.toFixed(1)}s · (${endpoint.position[0].toFixed(0)}, ${endpoint.position[1].toFixed(0)}, ${endpoint.position[2].toFixed(0)})`;
      button.title = `${endpoint.name} · ${endpoint.endReason}`;
      button.addEventListener('click', () => this.select(index));
      item.append(button);
      list.append(item);
    });
  }
}

function shortName(name: string, max = 14): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}
