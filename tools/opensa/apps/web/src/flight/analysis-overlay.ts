/**
 * Public facade for the flight analysis surface.
 *
 * This is the single object `flight-replay.ts` wires: it owns the free camera (+ opt-in input), the
 * hideable HUD and the endpoint track list, and keeps the analysis of the active track cached. The endpoint
 * VIEW is the 3D world marker layer (`endpoint-markers.ts`); this overlay only renders the list that
 * resolves a marker back to its track. The replay entrypoint only has to:
 *
 * ```ts
 * const overlay = new FlightAnalysisOverlay();
 * overlay.mountHud();                       // body by default
 * overlay.mountEndpointList(document.getElementById('endpoint-list')!);
 * overlay.attachCameraInput(canvas);
 * overlay.setTracks(plays, active);
 * // per frame:
 * overlay.updateInput(dt);
 * const free = overlay.cameraState(aspect); // feed this to engine.frame() when non-null
 * overlay.update(elapsed, { playing });
 * ```
 *
 * Selecting an endpoint in the list or calling `focusEndpoint` switches to the free camera and flies it
 * to the endpoint (a bounded ease; any input interrupts it), without changing any replay state.
 *
 * For an MP4/PNG export, frame `overlay.captureRoot()` (the `.analysis-hud` subtree); the replay controls in
 * `flight-replay.html` carry `data-capture="exclude"` so the exporter drops them. The HUD can be folded with
 * `toggleHudCollapsed()` or hidden with `toggleHud()`.
 */
import type { CameraStateOut } from './camera';
import type { FlightTrack } from './csv';
import type { Vec3 } from './math';
import type { TrackEndpoint } from './track-endpoints';

import { AnalysisHud, type AnalysisHudContext, type AnalysisHudOptions } from './analysis-hud';
import { analyzeTrack, type FlightAnalysis, type FlightMetrics, sampleAnalysis } from './analysis-metrics';
import { EndpointList, type EndpointListOptions } from './endpoint-list';
import { FreeCamera, FreeCameraInput, type FreeCameraInputOptions, type FreeCameraOptions } from './free-camera';
import { gtaToEngine } from './math';

export interface FlightAnalysisOverlayOptions {
  camera?: FreeCameraOptions;
  endpoints?: EndpointListOptions;
  hud?: AnalysisHudOptions;
  input?: FreeCameraInputOptions;
  onEndpointFocus?: (endpoint: TrackEndpoint) => void;
}

export class FlightAnalysisOverlay {
  readonly camera: FreeCamera;
  readonly endpoints: EndpointList;
  readonly hud: AnalysisHud;
  readonly input: FreeCameraInput;

  private analysis: FlightAnalysis | null = null;
  private readonly focusListeners = new Set<(endpoint: TrackEndpoint) => void>();
  private free = false;
  private track: FlightTrack | null = null;

  constructor(options: FlightAnalysisOverlayOptions = {}) {
    this.camera = new FreeCamera(options.camera);
    this.hud = new AnalysisHud(options.hud);
    this.endpoints = new EndpointList(options.endpoints);
    this.input = new FreeCameraInput(this.camera, options.input);
    this.input.setEnabled(false);
    if (options.onEndpointFocus) {
      this.focusListeners.add(options.onEndpointFocus);
    }
    this.endpoints.onSelect((endpoint) => this.onEndpointSelected(endpoint));
  }

  attachCameraInput(element: HTMLElement): void {
    this.input.attach(element);
  }

  /** The free-camera state when free mode is active, else null (the replay camera should be used). */
  cameraState(aspect: number): CameraStateOut | null {
    return this.free ? this.camera.state(aspect) : null;
  }

  /** The DOM subtree an MP4/PNG capture should frame; everything else carries `data-capture="exclude"`. */
  captureRoot(): HTMLElement {
    return this.hud.element;
  }

  currentTrack(): FlightTrack | null {
    return this.track;
  }

  destroy(): void {
    this.input.dispose();
    this.hud.destroy();
    this.endpoints.destroy();
    this.focusListeners.clear();
    this.analysis = null;
    this.track = null;
  }

  detachCameraInput(): void {
    this.input.detach();
  }

  /** Focus the free camera on one endpoint (also selects it in the endpoint list). */
  focusEndpoint(index: number): void {
    if (!this.endpoints.endpointAt(index)) {
      return;
    }
    this.setFreeMode(true);
    this.endpoints.select(index);
  }

  /** Convenience: focus any world point directly (does not touch the endpoint list). */
  focusPoint(point: Vec3, distance?: number): void {
    this.setFreeMode(true);
    this.camera.focus(point, distance !== undefined ? { distance } : {});
  }

  /** Focus the endpoint that belongs to a loaded track index (maps track → endpoint slot). */
  focusTrack(trackIndex: number): void {
    const slot = this.endpoints.getEndpoints().findIndex((endpoint) => endpoint.trackIndex === trackIndex);
    if (slot >= 0) {
      this.focusEndpoint(slot);
    }
  }

  getAnalysis(): FlightAnalysis | null {
    return this.analysis;
  }

  isFreeMode(): boolean {
    return this.free;
  }

  isHudVisible(): boolean {
    return this.hud.isVisible();
  }

  mountEndpointList(container: HTMLElement): HTMLElement {
    return this.endpoints.mount(container);
  }

  mountHud(parent: HTMLElement = document.body): HTMLElement {
    return this.hud.mount(parent);
  }

  /** Subscribe to endpoint focus events. Returns an unsubscribe function. */
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
    if (!enabled) {
      this.camera.cancelFlyTo();
    }
  }

  /**
   * Retired with the flat 2D density panel (the endpoint view is the 3D marker layer). Kept as a harmless
   * no-op so a caller written before the retirement cannot throw and cannot resurrect the panel.
   */
  setHeatmapVisible(_visible: boolean): void {
    void _visible; // no-op: there is no flat panel to show or hide any more
  }

  /** Fold/unfold every HUD gauge in one call (keeps the title bar). */
  setHudCollapsed(collapsed: boolean): void {
    this.hud.setCollapsed(collapsed);
  }

  setHudVisible(visible: boolean): void {
    this.hud.setVisible(visible);
  }

  setTrack(track: FlightTrack | null): void {
    this.track = track;
    this.analysis = track ? analyzeTrack(track) : null;
  }

  /** Replace the whole track list (the endpoint set). The active track is analysed. */
  setTracks(tracks: readonly FlightTrack[], activeIndex = 0): void {
    this.endpoints.setTracks(tracks, activeIndex);
    this.setTrack(tracks[activeIndex] ?? null);
  }

  /** Retired with the flat 2D density panel; see `setHeatmapVisible`. */
  toggleHeatmap(): void {
    // no-op: toggling the retired panel must change nothing (and log nothing)
  }

  toggleHud(): void {
    this.hud.toggleVisible();
  }

  toggleHudCollapsed(): void {
    this.hud.toggleCollapsed();
  }

  /** Sample the cached analysis at `elapsed` seconds and push it to the HUD. */
  update(elapsed: number, context: AnalysisHudContext = {}): FlightMetrics | null {
    const metrics = this.analysis ? sampleAnalysis(this.analysis, elapsed) : null;
    if (!metrics) {
      return null;
    }
    const model = context.model ?? this.track?.model;
    this.hud.update(metrics, {
      ...context,
      ...(model !== undefined ? { model } : {}),
      free: this.free,
      playing: context.playing ?? false,
    });

    return metrics;
  }

  updateInput(dt: number): void {
    this.input.update(dt);
    this.camera.advance(dt);
  }

  private onEndpointSelected(endpoint: TrackEndpoint): void {
    this.setFreeMode(true);
    // Endpoints carry GTA world coordinates; the camera lives in engine space — convert at this seam, or the
    // flight (and the old instant focus) aims at a mirrored point hundreds of units off the marker.
    const position = endpoint.position;
    // Fly rather than jump: the marker pick reads as a move, and any input cancels it (see `FreeCamera.flyTo`).
    this.camera.flyTo(gtaToEngine(position[0], position[1], position[2]));
    for (const listener of this.focusListeners) {
      listener(endpoint);
    }
  }
}

export function createAnalysisOverlay(options: FlightAnalysisOverlayOptions = {}): FlightAnalysisOverlay {
  return new FlightAnalysisOverlay(options);
}
