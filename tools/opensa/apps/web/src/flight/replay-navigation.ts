/** Free-camera input and track endpoint navigation, independent of instrument presentation. */
import type { CameraStateOut } from './camera';
import type { FlightTrack } from './csv';
import type { Vec3 } from './math';
import type { TrackEndpoint } from './track-endpoints';

import { FreeCamera, FreeCameraInput, type FreeCameraInputOptions, type FreeCameraOptions } from './free-camera';
import { gtaToEngine } from './math';
import { buildTrackEndpoints } from './track-endpoints';

export interface ReplayNavigationOptions {
  camera?: FreeCameraOptions;
  input?: FreeCameraInputOptions;
  onEndpointFocus?: (endpoint: TrackEndpoint) => void;
}

export class ReplayNavigation {
  readonly camera: FreeCamera;
  readonly input: FreeCameraInput;
  private endpoints: TrackEndpoint[] = [];
  private readonly focusListeners = new Set<(endpoint: TrackEndpoint) => void>();
  private free = false;
  private track: FlightTrack | null = null;

  constructor(options: ReplayNavigationOptions = {}) {
    this.camera = new FreeCamera(options.camera);
    this.input = new FreeCameraInput(this.camera, options.input);
    this.input.setEnabled(false);
    if (options.onEndpointFocus) this.focusListeners.add(options.onEndpointFocus);
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
    this.endpoints = [];
    this.focusListeners.clear();
    this.track = null;
  }
  detachCameraInput(): void {
    this.input.detach();
  }

  focusPoint(point: Vec3, distance?: number): void {
    this.setFreeMode(true);
    this.camera.focus(point, distance !== undefined ? { distance } : {});
  }
  /** Resolve the picked beacon's import index directly, without a DOM list or endpoint-slot index. */
  focusTrack(trackIndex: number): boolean {
    const endpoint = this.endpoints.find((item) => item.trackIndex === trackIndex);
    if (!endpoint) return false;
    this.onEndpointSelected(endpoint);

    return true;
  }
  isFreeMode(): boolean {
    return this.free;
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
  setTrack(track: FlightTrack | null): void {
    this.track = track;
  }
  setTracks(tracks: readonly FlightTrack[], activeIndex = 0): void {
    this.endpoints = buildTrackEndpoints(tracks);
    this.setTrack(tracks[activeIndex] ?? null);
  }
  updateInput(dt: number): void {
    this.input.update(dt);
    this.camera.advance(dt);
  }
  private onEndpointSelected(endpoint: TrackEndpoint): void {
    const preserveCamera = this.free;
    this.setFreeMode(true);
    // Free-view endpoint selection switches the recording without disturbing the overview.
    if (preserveCamera) {
      this.camera.cancelFlyTo();
    } else {
      const position = endpoint.position;
      this.camera.flyTo(gtaToEngine(position[0], position[1], position[2]));
    }
    for (const listener of this.focusListeners) listener(endpoint);
  }
}
