/** Free-camera input and track endpoint navigation, independent of instrument presentation. */
import type { CameraStateOut } from './camera';
import type { FlightTrack } from './csv';
import type { Vec3 } from './math';
import type { TrackEndpoint } from './track-endpoints';

import { EndpointList, type EndpointListOptions } from './endpoint-list';
import { FreeCamera, FreeCameraInput, type FreeCameraInputOptions, type FreeCameraOptions } from './free-camera';
import { gtaToEngine } from './math';

export interface ReplayNavigationOptions {
  camera?: FreeCameraOptions;
  endpoints?: EndpointListOptions;
  input?: FreeCameraInputOptions;
  onEndpointFocus?: (endpoint: TrackEndpoint) => void;
}

export class ReplayNavigation {
  readonly camera: FreeCamera;
  readonly endpoints: EndpointList;
  readonly input: FreeCameraInput;
  private readonly focusListeners = new Set<(endpoint: TrackEndpoint) => void>();
  private free = false;
  private track: FlightTrack | null = null;

  constructor(options: ReplayNavigationOptions = {}) {
    this.camera = new FreeCamera(options.camera);
    this.endpoints = new EndpointList(options.endpoints);
    this.input = new FreeCameraInput(this.camera, options.input);
    this.input.setEnabled(false);
    if (options.onEndpointFocus) this.focusListeners.add(options.onEndpointFocus);
    this.endpoints.onSelect((endpoint) => this.onEndpointSelected(endpoint));
  }

  attachCameraInput(element: HTMLElement): void {
    this.input.attach(element);
  }
  cameraState(aspect: number): CameraStateOut | null {
    return this.free ? this.camera.state(aspect) : null;
  }
  currentTrack(): FlightTrack | null {
    return this.track;
  }
  destroy(): void {
    this.input.dispose();
    this.endpoints.destroy();
    this.focusListeners.clear();
    this.track = null;
  }
  detachCameraInput(): void {
    this.input.detach();
  }

  focusEndpoint(index: number): void {
    if (!this.endpoints.endpointAt(index)) return;
    this.setFreeMode(true);
    this.endpoints.select(index);
  }
  focusPoint(point: Vec3, distance?: number): void {
    this.setFreeMode(true);
    this.camera.focus(point, distance !== undefined ? { distance } : {});
  }
  focusTrack(trackIndex: number): void {
    const slot = this.endpoints.getEndpoints().findIndex((endpoint) => endpoint.trackIndex === trackIndex);
    if (slot >= 0) this.focusEndpoint(slot);
  }
  isFreeMode(): boolean {
    return this.free;
  }
  mountEndpointList(container: HTMLElement): HTMLElement {
    return this.endpoints.mount(container);
  }
  onEndpointFocus(callback: (endpoint: TrackEndpoint) => void): () => void {
    this.focusListeners.add(callback);

    return () => {
      this.focusListeners.delete(callback);
    };
  }
  resetCamera(options: FreeCameraOptions = {}): void {
    this.camera.reset(options);
  }
  setFreeMode(enabled: boolean): void {
    this.free = enabled;
    this.input.setEnabled(enabled);
    if (!enabled) this.camera.cancelFlyTo();
  }
  /** Compatibility for the previously retired flat endpoint density panel. */
  setHeatmapVisible(_visible: boolean): void {
    void _visible;
  }
  setTrack(track: FlightTrack | null): void {
    this.track = track;
  }
  setTracks(tracks: readonly FlightTrack[], activeIndex = 0): void {
    this.endpoints.setTracks(tracks, activeIndex);
    this.setTrack(tracks[activeIndex] ?? null);
  }
  toggleHeatmap(): void {
    /* retired */
  }
  updateInput(dt: number): void {
    this.input.update(dt);
    this.camera.advance(dt);
  }
  private onEndpointSelected(endpoint: TrackEndpoint): void {
    this.setFreeMode(true);
    const position = endpoint.position;
    this.camera.flyTo(gtaToEngine(position[0], position[1], position[2]));
    for (const listener of this.focusListeners) listener(endpoint);
  }
}
