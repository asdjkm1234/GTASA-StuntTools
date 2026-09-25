/**
 * Public facade for the flight analysis surface.
 *
 * This is the single object `flight-replay.ts` wires: it owns the free camera (+ opt-in input), the
 * hideable HUD and the endpoint heatmap, and keeps the analysis of the active track cached. The replay
 * entrypoint only has to:
 *
 * ```ts
 * const overlay = new FlightAnalysisOverlay();
 * overlay.mountHud();                       // body by default
 * overlay.mountHeatmap(document.getElementById('analysis-heatmap')!);
 * overlay.attachCameraInput(canvas);
 * overlay.setTracks(plays, active);
 * // per frame:
 * overlay.updateInput(dt);
 * const free = overlay.cameraState(aspect); // feed this to engine.frame() when non-null
 * overlay.update(elapsed, { playing });
 * ```
 *
 * Selecting an endpoint in the heatmap or calling `focusEndpoint` switches to the free camera and focuses
 * it, without changing any replay state.
 *
 * For an MP4/PNG export, frame `overlay.captureRoot()` (the `.analysis-hud` subtree); the replay controls in
 * `flight-replay.html` carry `data-capture="exclude"` so the exporter drops them. The HUD can be folded with
 * `toggleHudCollapsed()` or hidden with `toggleHud()`; the heatmap toggles with `toggleHeatmap()`.
 */
import type { CameraStateOut } from './camera';
import type { FlightTrack } from './csv';
import type { Vec3 } from './math';

import { analyzeTrack, sampleAnalysis, type FlightAnalysis, type FlightMetrics } from './analysis-metrics';
import { AnalysisHud, type AnalysisHudContext, type AnalysisHudOptions } from './analysis-hud';
import { EndpointHeatmap, type EndpointHeatmapOptions, type TrackEndpoint } from './endpoint-heatmap';
import { FreeCamera, FreeCameraInput, type FreeCameraInputOptions, type FreeCameraOptions } from './free-camera';

export interface FlightAnalysisOverlayOptions {
  hud?: AnalysisHudOptions;
  heatmap?: EndpointHeatmapOptions;
  camera?: FreeCameraOptions;
  input?: FreeCameraInputOptions;
  onEndpointFocus?: (endpoint: TrackEndpoint) => void;
}

export class FlightAnalysisOverlay {
  readonly camera: FreeCamera;
  readonly hud: AnalysisHud;
  readonly heatmap: EndpointHeatmap;
  readonly input: FreeCameraInput;

  private analysis: FlightAnalysis | null = null;
  private track: FlightTrack | null = null;
  private free = false;
  private readonly focusListeners = new Set<(endpoint: TrackEndpoint) => void>();

  constructor(options: FlightAnalysisOverlayOptions = {}) {
    this.camera = new FreeCamera(options.camera);
    this.hud = new AnalysisHud(options.hud);
    this.heatmap = new EndpointHeatmap(options.heatmap);
    this.input = new FreeCameraInput(this.camera, options.input);
    this.input.setEnabled(false);
    if (options.onEndpointFocus) {
      this.focusListeners.add(options.onEndpointFocus);
    }
    this.heatmap.onSelect((endpoint) => this.onEndpointSelected(endpoint));
  }

  mountHud(parent: HTMLElement = document.body): HTMLElement {
    return this.hud.mount(parent);
  }

  mountHeatmap(container: HTMLElement): HTMLElement {
    return this.heatmap.mount(container);
  }

  attachCameraInput(element: HTMLElement): void {
    this.input.attach(element);
  }

  detachCameraInput(): void {
    this.input.detach();
  }

  /** Replace the whole track list (the heatmap endpoint set). The active track is analysed. */
  setTracks(tracks: readonly FlightTrack[], activeIndex = 0): void {
    this.heatmap.setTracks(tracks, activeIndex);
    this.setTrack(tracks[activeIndex] ?? null);
  }

  setTrack(track: FlightTrack | null): void {
    this.track = track;
    this.analysis = track ? analyzeTrack(track) : null;
  }

  currentTrack(): FlightTrack | null {
    return this.track;
  }

  getAnalysis(): FlightAnalysis | null {
    return this.analysis;
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

  /** The DOM subtree an MP4/PNG capture should frame; everything else carries `data-capture="exclude"`. */
  captureRoot(): HTMLElement {
    return this.hud.element;
  }

  setHudVisible(visible: boolean): void {
    this.hud.setVisible(visible);
  }

  isHudVisible(): boolean {
    return this.hud.isVisible();
  }

  toggleHud(): void {
    this.hud.toggleVisible();
  }

  setHeatmapVisible(visible: boolean): void {
    this.heatmap.setVisible(visible);
  }

  toggleHeatmap(): void {
    this.heatmap.setVisible(!this.heatmap.isVisible());
  }

  /** Fold/unfold every HUD gauge in one call (keeps the title bar). */
  setHudCollapsed(collapsed: boolean): void {
    this.hud.setCollapsed(collapsed);
  }

  toggleHudCollapsed(): void {
    this.hud.toggleCollapsed();
  }

  /** The free-camera state when free mode is active, else null (the replay camera should be used). */
  cameraState(aspect: number): CameraStateOut | null {
    return this.free ? this.camera.state(aspect) : null;
  }

  setFreeMode(enabled: boolean): void {
    this.free = enabled;
    this.input.setEnabled(enabled);
  }

  isFreeMode(): boolean {
    return this.free;
  }

  /** Focus the free camera on one heatmap endpoint (also selects it in the heatmap/legend). */
  focusEndpoint(index: number): void {
    if (!this.heatmap.endpointAt(index)) {
      return;
    }
    this.setFreeMode(true);
    this.heatmap.select(index);
  }

  /** Focus the endpoint that belongs to a loaded track index (maps track → endpoint slot). */
  focusTrack(trackIndex: number): void {
    const slot = this.heatmap.getEndpoints().findIndex((endpoint) => endpoint.index === trackIndex);
    if (slot >= 0) {
      this.focusEndpoint(slot);
    }
  }

  /** Subscribe to endpoint focus events. Returns an unsubscribe function. */
  onEndpointFocus(callback: (endpoint: TrackEndpoint) => void): () => void {
    this.focusListeners.add(callback);

    return () => {
      this.focusListeners.delete(callback);
    };
  }

  updateInput(dt: number): void {
    this.input.update(dt);
  }

  resetCamera(options: FreeCameraOptions = {}): void {
    this.camera.reset(options);
  }

  /** Convenience: focus any world point directly (does not touch the heatmap). */
  focusPoint(point: Vec3, distance?: number): void {
    this.setFreeMode(true);
    this.camera.focus(point, distance !== undefined ? { distance } : {});
  }

  destroy(): void {
    this.input.dispose();
    this.hud.destroy();
    this.heatmap.destroy();
    this.focusListeners.clear();
    this.analysis = null;
    this.track = null;
  }

  private onEndpointSelected(endpoint: TrackEndpoint): void {
    this.setFreeMode(true);
    this.camera.focus(endpoint.position);
    for (const listener of this.focusListeners) {
      listener(endpoint);
    }
  }
}

export function createAnalysisOverlay(options: FlightAnalysisOverlayOptions = {}): FlightAnalysisOverlay {
  return new FlightAnalysisOverlay(options);
}
