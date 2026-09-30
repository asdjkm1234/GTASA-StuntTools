import type { DebugLineSetId } from '@opensa/engine';

/**
 * GTASA flight replay — OpenSA renders the user's locally baked pak, driven by recorder CSV files.
 * `?local=latest` loads the newest local recording. The GTA install is needed to bake, not to replay.
 */
import { Engine } from '@opensa/engine';
import { createEngineEnvironmentDriver } from '@opensa/game/adapters/engine-environment-driver';
import { WEATHER_NAMES } from '@opensa/renderware/parsers/text/timecyc.parser';

import type { AircraftHandle } from '../flight/aircraft';
import type { FlightTrack } from '../flight/csv';

import { loadAircraft } from '../flight/aircraft';
import { type WebAudioListenerPose, WebAudioReplay } from '../flight/audio-engine-web';
import { renderOfflineWav } from '../flight/audio-offline';
import { coreManifestFromPak, createOfflineSampleBank } from '../flight/audio-sample-bank';
import { normalizeAudioMixTuning } from '../flight/audio-tuning';
import { type CameraMode, type CameraStateOut, ReplayCamera } from '../flight/camera';
import { ChaseCameraTimeline, type ChaseMode, isChaseMode } from '../flight/camera-track';
import { cockpitInstrumentState, type CockpitInstrumentState } from '../flight/cockpit-instrument-data';
import { CockpitLookCamera, type CockpitLookPose } from '../flight/cockpit-look';
import { NODE_NAMES, parseFlightCsv, sampleTrack } from '../flight/csv';
import { EndpointMarkers } from '../flight/endpoint-markers';
import { type MarkerProjection, pickEndpointMarker, projectMarkerEndpoints } from '../flight/endpoint-picking';
import { type FlightEffects, setupFlightEffects } from '../flight/fx';
import { gtaDirToEngine, rotateVec, type Vec3 } from '../flight/math';
import { PakResources } from '../flight/pak-resources';
import { PakWorld } from '../flight/pak-world';
import { ReplayAudio } from '../flight/replay-audio';
import { ReplayNavigation } from '../flight/replay-navigation';
import { installWater } from '../flight/water';
import { AudioMixer } from './audio-mixer';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '"': '&quot;',
        '&': '&amp;',
        "'": '&#39;',
        '<': '&lt;',
        '>': '&gt;',
      })[character] ?? character,
  );

/** Pointer hit radius for a 3D marker, in CSS px. The pillar is thin, so the click target is forgiving. */
const MARKER_PICK_RADIUS_PX = 26;
/** A press that moved further than this is a free-camera drag, not a marker pick. */
const MARKER_CLICK_DRAG_PX = 5;

/** Live diagnostic state, readable from a CDP/automation session (`window.__flight`). */
interface FlightDebug {
  /** Active track (import-list position): the endpoint-list selection, not only the marker layer's. */
  activeTrackIndex: number;
  aircraft: string;
  /** Selected audio source: `synth` (Web Audio), `wav` (recorded element) or `both` (comparison). */
  audioSourceMode: string;
  /** Recorded WAV element — the untouched comparison/fallback path, probed so it stays asserted. */
  audioWavActive: boolean;
  audioWavHasAudio: boolean;
  audioWavMuted: boolean;
  audioWavRate: number;
  audioWavTime: number;
  /** Web Audio synthesis renderer (todo 18): node/timeline counts, so a test asserts the LIVE renderer. */
  audioWebContext: string;
  /** The per-model engine bank name the current track's model plays (e.g. the Hydra jet bank). */
  audioWebEngineBank: string;
  audioWebEngineGain: number;
  audioWebEngineRate: number;
  audioWebListenerPos: null | Vec3;
  audioWebLiveOneShots: number;
  audioWebLiveSources: number;
  audioWebMessage: string;
  audioWebMuted: boolean;
  audioWebNodesCreated: number;
  audioWebOneShotsStarted: number;
  audioWebPlaying: boolean;
  audioWebReleasedOneShots: number;
  audioWebReverbZone: string;
  audioWebSamples: number;
  audioWebSpeed: number;
  audioWebState: string;
  audioWebTimelineEvents: number;
  audioWebTrackEpoch: number;
  audioWebUpdates: number;
  cameraDistance: number;
  cameraMode: string;
  /** Exact camera state the last frame was drawn with — the picking projection's input. */
  cameraState: CameraStateOut | null;
  cameraTravelDot: number;
  cells: number;
  densityMax: number;
  envHud: string;
  error: null | string;
  /** Free-camera fly-to state (numeric, so a test asserts the tween itself, never a screenshot). */
  flyActive: boolean;
  flyProgress: number;
  gpu: string;
  instrumentState: CockpitInstrumentState | null;
  instrumentUploads: number;
  markerActiveTrackId: number;
  markerCapacity: number;
  /** 3D endpoint markers — counts only, so a test asserts completeness from the probe, never a screenshot. */
  markerCount: number;
  markerHalos: number;
  /** Track id of the last successful marker pick; -1 when the last click hit no marker. */
  markerPickedTrackId: number;
  /** Pointer hit radius in CSS px the marker picking uses. */
  markerPickRadius: number;
  markerRecreates: number;
  /** Screen-space marker projections (CSS px, canvas-relative) for the camera of the last frame. */
  markerScreenPositions: MarkerProjection[];
  markerTrackIds: number[];
  maxFrameMs: number;
  maxUpStepDeg: number;
  parts: string;
  pedalMotion: NonNullable<AircraftHandle['pedals']>['state'];
  phase: string;
  renders: number;
  seatSource: string;
  seeks: number;
  slowFrames: number;
  status: string;
  stickMotion: AircraftHandle['stickMotion'];
  worldReady: boolean;
}
const debug: FlightDebug = {
  activeTrackIndex: 0,
  aircraft: 'none',
  audioSourceMode: 'synth',
  audioWavActive: false,
  audioWavHasAudio: false,
  audioWavMuted: false,
  audioWavRate: 1,
  audioWavTime: 0,
  audioWebContext: 'none',
  audioWebEngineBank: '',
  audioWebEngineGain: 0,
  audioWebEngineRate: 0,
  audioWebListenerPos: null,
  audioWebLiveOneShots: 0,
  audioWebLiveSources: 0,
  audioWebMessage: '',
  audioWebMuted: false,
  audioWebNodesCreated: 0,
  audioWebOneShotsStarted: 0,
  audioWebPlaying: false,
  audioWebReleasedOneShots: 0,
  audioWebReverbZone: 'urban',
  audioWebSamples: 0,
  audioWebSpeed: 1,
  audioWebState: 'none',
  audioWebTimelineEvents: 0,
  audioWebTrackEpoch: 0,
  audioWebUpdates: 0,
  cameraDistance: 0,
  cameraMode: 'chase-mid',
  cameraState: null,
  cameraTravelDot: 0,
  cells: 0,
  densityMax: 0,
  envHud: '',
  error: null,
  flyActive: false,
  flyProgress: 1,
  gpu: '',
  instrumentState: null,
  instrumentUploads: 0,
  markerActiveTrackId: -1,
  markerCapacity: 0,
  markerCount: 0,
  markerHalos: 0,
  markerPickedTrackId: -1,
  markerPickRadius: MARKER_PICK_RADIUS_PX,
  markerRecreates: 0,
  markerScreenPositions: [],
  markerTrackIds: [],
  maxFrameMs: 0,
  maxUpStepDeg: 0,
  parts: '',
  pedalMotion: null,
  phase: 'boot',
  renders: 0,
  seatSource: 'none',
  seeks: 0,
  slowFrames: 0,
  status: '',
  stickMotion: null,
  worldReady: false,
};
/** Camera-up from the previous frame, for the jitter metric (`maxUpStepDeg`). */
let lastCameraUp: null | Vec3 = null;
(window as unknown as { __flight: FlightDebug }).__flight = debug;

/** Debug axes overlay (`?axes=1`): green = recorded forward, blue = up, red = right. */
let axisForward: DebugLineSetId | null = null;
let axisRight: DebugLineSetId | null = null;
let axisUp: DebugLineSetId | null = null;
function drawAxes(p: Vec3, forward: Vec3, right: Vec3, up: Vec3): void {
  if (!SHOW_AXES || axisForward === null || axisRight === null || axisUp === null) {
    return;
  }
  const seg = (v: Vec3, length: number) =>
    new Float32Array([p[0], p[1], p[2], p[0] + v[0] * length, p[1] + v[1] * length, p[2] + v[2] * length]);
  engine.updateDebugLines(axisForward, seg(forward, 30));
  engine.updateDebugLines(axisRight, seg(right, 15));
  engine.updateDebugLines(axisUp, seg(up, 15));
}
function ensureAxes(): void {
  if (!SHOW_AXES || axisForward !== null) {
    return;
  }
  axisForward = engine.createDebugLines(new Float32Array(6), [0.1, 1, 0.1, 1]);
  axisRight = engine.createDebugLines(new Float32Array(6), [1, 0.2, 0.2, 1]);
  axisUp = engine.createDebugLines(new Float32Array(6), [0.3, 0.5, 1, 1]);
}

/** The endpoint marker layer needs a live engine, so it is created once after `engine.init`. */
function ensureEndpointMarkers(): void {
  if (endpointMarkers) {
    return;
  }
  endpointMarkers = new EndpointMarkers(engine, {
    onUpdate: (stats) => {
      debug.markerCount = stats.count;
      debug.markerTrackIds = [...stats.trackIds];
      debug.densityMax = stats.densityMax;
      debug.markerHalos = stats.halos;
      debug.markerCapacity = stats.capacity;
      debug.markerRecreates = stats.recreates;
      debug.markerActiveTrackId = stats.activeTrackIndex;
    },
  });
  endpointMarkers.setTracks([], 0);
}

/** Pick the 3D marker under a pointer and drive the EXISTING endpoint focus flow (list → onEndpointFocus). */
function pickMarkerAt(clientX: number, clientY: number): void {
  const cameraState = lastRenderedCameraState;
  if (!endpointMarkers || !cameraState) {
    return;
  }
  // Project from the LIVE camera state every click — debug lines are not pickable, so this is the only test.
  const rect = canvas.getBoundingClientRect();
  const picked = pickEndpointMarker(
    projectMarkers(cameraState),
    clientX - rect.left,
    clientY - rect.top,
    MARKER_PICK_RADIUS_PX,
    debug.markerActiveTrackId,
  );
  debug.markerPickedTrackId = picked?.trackIndex ?? -1;
  if (!picked) {
    return;
  }
  // Marker slots and endpoint-list slots are both import order, but a track with no usable endpoint exists in
  // one and not the other — resolve through the endpoint list instead of assuming the slots are equal.
  const slot = navigation.endpoints.getEndpoints().findIndex((endpoint) => endpoint.trackIndex === picked.trackIndex);
  if (slot >= 0) {
    navigation.focusEndpoint(slot);
  }
}

/** Project the marker layer's own anchors with `cameraState`; empty until the layer exists. */
function projectMarkers(cameraState: CameraStateOut): MarkerProjection[] {
  const markers = endpointMarkers;
  if (!markers) {
    return [];
  }

  return projectMarkerEndpoints(
    markers.markerPositions,
    markers.markerTrackIds,
    cameraState,
    canvas.clientWidth,
    canvas.clientHeight,
  );
}

const params = new URLSearchParams(location.search);
const VIDEO_EXPORT = params.get('videoExport') === '1';
// `?axes=1` draws the aircraft's recorded forward (green) / up (blue) / right (red) as world-space lines.
// If green does not run along the model's nose, the model orientation is wrong — a pixel fact, not a guess.
let SHOW_AXES = params.get('axes') === '1';
// Debug overrides for the environment: `?weather=N` and `?hour=H` ignore the recorded value (which is how a
// bad timecyc column for one weather is told apart from a bad frame).
const FORCE_WEATHER = params.has('weather') ? Number(params.get('weather')) : null;
const FORCE_HOUR = params.has('hour') ? Number(params.get('hour')) : null;

/** HUD environment overrides. `null` = follow the recorded value (the `跟随录制` checkbox). */
let hudWeather: null | number = null;
let hudHour: null | number = null;
let lastEnv = { hour: 12, weather: 0 };
const isFollowingEnv = (): boolean => hudWeather === null && hudHour === null;

function formatHour(hour: number): string {
  const h = Math.floor(((hour % 24) + 24) % 24);
  const m = Math.round((hour - Math.floor(hour)) * 60);

  return `${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Keep the sliders/labels in step with the effective environment (and follow the recording when asked). */
function syncEnvControls(hour: number, weather: number): void {
  const id = Math.max(0, Math.min(WEATHER_NAMES.length - 1, Math.round(weather)));
  el('weatherLabel').textContent = `${id} ${WEATHER_NAMES[id] ?? '?'}`;
  el('hourLabel').textContent = formatHour(hour);
  if (isFollowingEnv()) {
    const weatherSlider = el<HTMLInputElement>('weatherSlider');
    const hourSlider = el<HTMLInputElement>('hourSlider');
    if (document.activeElement !== weatherSlider) weatherSlider.value = String(id);
    if (document.activeElement !== hourSlider) hourSlider.value = String(Math.round(hour * 4) / 4);
  }
}

const canvas = el<HTMLCanvasElement>('canvas');
const status = el<HTMLParagraphElement>('status');
const clock = el<HTMLSpanElement>('clock');
const scrub = el<HTMLInputElement>('scrub');
const playButton = el<HTMLButtonElement>('play');
const readout = el<HTMLDListElement>('readout');
const keys = el<HTMLDivElement>('keys');
const tracksEl = el<HTMLDivElement>('tracks');
const mapLoading = el<HTMLDivElement>('mapLoading');
const mapLoadingText = el<HTMLSpanElement>('mapLoadingText');
const modeChip = el<HTMLElement>('mode');
const segmentChip = el<HTMLElement>('segment');

const plays: FlightTrack[] = [];
const trackSources = new WeakMap<FlightTrack, string>();
const trackFilenames = new WeakMap<FlightTrack, string>();
const replayAudio = new ReplayAudio();
/** Audio source selection: `synth` = todo-18 Web Audio renderer, `wav` = recorded element, `both`. */
type AudioSourceMode = 'both' | 'synth' | 'wav';
let audioSourceMode: AudioSourceMode = 'synth';
let webAudio: null | WebAudioReplay = null;
let audioSourceSelect: HTMLSelectElement | null = null;
let audioStatusEl: HTMLSpanElement | null = null;
let audioMixer: AudioMixer | null = null;
const audioObjectUrls: string[] = [];
const navigation = new ReplayNavigation({
  onEndpointFocus: (endpoint) => {
    cockpitLook = null;
    active = endpoint.trackIndex;
    debug.activeTrackIndex = active;
    elapsed = endpoint.time;
    playing = false;
    playButton.textContent = '▶';
    replayAudio.select(endpoint.track, elapsed);
    navigation.setTrack(endpoint.track);
    navigation.endpoints.setActive(active);
    endpointMarkers?.setActive(active);
    renderTrackList();
    void ensureAircraft();
    frameOnce();
  },
});
let routeBakeRunning = false;
let active = 0;
let playing = false;
let elapsed = 0;
let lastFrame = performance.now();
const CAMERA_MODES: CameraMode[] = ['chase-near', 'chase-mid', 'chase-far', 'first-person', 'cockpit'];
const CAMERA_LABELS: Record<CameraMode, string> = {
  'chase-far': '原版跟随·远',
  'chase-mid': '原版跟随·中',
  'chase-near': '原版跟随·近',
  cockpit: '机舱第一人称',
  'first-person': '原版第一人称',
};
let cameraMode: CameraMode = 'chase-mid';
let cockpitLook: CockpitLookCamera | null = null;
interface ExportView {
  audioTuning?: unknown;
  cockpitLookPose?: CockpitLookPose;
  mode: 'cockpit-look' | 'free' | CameraMode;
  pitch?: number;
  position?: Vec3;
  yaw?: number;
}
let exportView: ExportView | null = null;
if (VIDEO_EXPORT && params.has('exportView')) {
  try {
    const view = JSON.parse(params.get('exportView') ?? '') as ExportView;
    if (view && (view.mode === 'free' || view.mode === 'cockpit-look' || CAMERA_MODES.includes(view.mode))) {
      exportView = view;
      if (view.mode === 'cockpit-look') cameraMode = 'cockpit';
      else if (view.mode !== 'free') cameraMode = view.mode;
    }
  } catch {
    /* malformed export view falls back to chase camera */
  }
}

// ---------------------------------------------------------------------------------------------------
// Video-export compositor (todo 23): one RAW RGBA frame per encode frame, no screenshot and no rAF.
//
// The engine renders into its owned surface; after the queue flush this reads the finished frame
// deterministically and returns the tightly-packed bytes to the exporter.
// Frame time is injected, so a frame is a pure function of its timestamp — nothing here waits for presentation,
// but the capture IS synchronized to the engine submit and to the composite raster (todo 33, the black-frame
// fix): the returned bytes are always a completed render.
// ---------------------------------------------------------------------------------------------------
const EXPORT_FRAME_WIDTH = 1920;
const EXPORT_FRAME_HEIGHT = 1080;
const EXPORT_PIXEL_FORMAT = 'rgba';
/** Export rates `web-replay/video-export.mjs` accepts (its `SUPPORTED_FPS`); the UI offers nothing else. */
const EXPORT_FPS_CHOICES: readonly number[] = [30, 60, 120];
const DEFAULT_EXPORT_FPS = 30;
/**
 * A captured frame whose every sampled channel is at/below this is a black capture, not content: the engine's
 * post pass clears the surface to opaque black and an unsynchronized read catches that clear. Real footage on
 * this map has sky/terrain well above 0, so an 8-bit threshold of 4 never trips on a legitimately dark frame.
 */
const EXPORT_BLACK_CHANNEL_MAX = 4;

interface ExportCompositor {
  /** Readback is `bgra8unorm`-ordered when the presentation format is BGRA; swizzled to RGBA before use. */
  readonly bgra: boolean;
  /** Owned offscreen colour target the engine renders into (`Engine.renderTarget`), then read back. */
  readonly surface: GPUTexture;
}

/**
 * Whether a sampled frame is uniformly black. Detection is what gates the capture: a black frame is re-rendered
 * once and, if it is STILL black, thrown so the exporter falls back to the raw lane instead of emitting it.
 * The stride is an odd multiple of 4 (RGBA-aligned, column-drifting) so the ~500 samples spread over the whole
 * frame without the cost of scanning all 8.3 MB.
 */
function frameIsAllBlack(pixels: Uint8Array): boolean {
  const stride = 4 * 4093;
  for (let offset = 0; offset + 3 < pixels.length; offset += stride) {
    if (
      pixels[offset] > EXPORT_BLACK_CHANNEL_MAX ||
      pixels[offset + 1] > EXPORT_BLACK_CHANNEL_MAX ||
      pixels[offset + 2] > EXPORT_BLACK_CHANNEL_MAX
    ) {
      return false;
    }
  }

  return true;
}
let exportCompositor: ExportCompositor | null = null;
/** While an export drives its own frames, the rAF loop keeps pumping textures but must not render. */
let videoExportDriving = false;
/** Injected engine clock for the current export frame (milliseconds, `Engine.setTimeSource`). */
let exportClockMs = 0;
/** HUD frame-rate selector (todo 30); null until `bindUi` mounts it — selection then falls back to 30 fps. */
let exportFpsSelect: HTMLSelectElement | null = null;

// ---------------------------------------------------------------------------------------------------
// In-page hardware H.264 (todo 28): the composited canvas is fed straight to a WebCodecs `VideoEncoder`,
// so only small encoded chunks leave the page — the 8.3 MB frame never crosses CDP. `latencyMode:"quality"`
// is mandatory (no frame dropping) and `avc.format:"annexb"` lets Node copy-mux without re-encoding.
// ---------------------------------------------------------------------------------------------------
/** Encoded chunks are transferred base64; `VideoEncoder` output arrives asynchronously per frame. */
interface ExportEncodeState {
  chunks: string[];
  readonly codec: string;
  readonly config: VideoEncoderConfig;
  error: null | string;
  readonly fps: number;
  framesEncoded: number;
  readonly keyInterval: number;
  totalBytes: number;
  totalChunks: number;
}

/** What `beginEncode` reports back: whether hardware H.264 is available and with which config. */
interface ExportEncodeSupport {
  readonly adapter: string;
  readonly codec: null | string;
  readonly config: null | VideoEncoderConfig;
  readonly hardwareAcceleration: HardwareAcceleration;
  readonly mediaCapabilities: null | { powerEfficient: boolean; smooth: boolean; supported: boolean };
  readonly reason: null | string;
  readonly supported: boolean;
}

/**
 * Read the engine's owned export surface back as tightly-packed RGBA/BGRA bytes.
 *
 * `copyTextureToBuffer` + `mapAsync` is the deterministic readback: the engine already wrote the post pass into
 * this texture in a submit, and the caller waits for `queue.onSubmittedWorkDone()`, so the mapped bytes are
 * always the finished frame. No canvas snapshot is involved.
 */
async function readExportSurface(surface: GPUTexture): Promise<Uint8Array> {
  const bytesPerRow = EXPORT_FRAME_WIDTH * 4; // 7680 is already 256-byte aligned (WebGPU's copy requirement)
  const buffer = engine.device.createBuffer({
    label: 'export-readback',
    size: bytesPerRow * EXPORT_FRAME_HEIGHT,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = engine.device.createCommandEncoder({ label: 'export-readback' });
  encoder.copyTextureToBuffer(
    { texture: surface },
    { buffer, bytesPerRow, rowsPerImage: EXPORT_FRAME_HEIGHT },
    { height: EXPORT_FRAME_HEIGHT, width: EXPORT_FRAME_WIDTH },
  );
  engine.device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  // The mapped range is only valid until `unmap`: copy it before releasing the buffer.
  const pixels = new Uint8Array(buffer.getMappedRange().slice(0));
  buffer.unmap();
  buffer.destroy();

  return pixels;
}

/**
 * The offline-synthesized engine audio for the ACTIVE track, as a complete RIFF/WAVE file. This is the page's
 * half of the export audio bridge: the exporter asks for it and muxes it INSTEAD of the recorded game WAV.
 * It is a pure function of the track, the pak manifest and the decoded pak samples, so the same recording
 * renders byte-identical audio every time. A missing audio lane or a malformed sample throws (loudly) rather
 * than yielding silence or touching the recording.
 */
async function renderExportAudio(): Promise<Uint8Array> {
  await bootPromise;
  const track = activeTrack();
  if (!track) throw new Error('回放未就绪，无法合成导出音频');
  const pakManifest = resources.getAudioManifest();
  if (!pakManifest || pakManifest.samples.length === 0) {
    throw new Error('预烘焙地图没有音频清单（audio/manifest.json），无法合成导出音频');
  }
  const bank = createOfflineSampleBank(resources);
  const exportTuning = exportView?.audioTuning ? normalizeAudioMixTuning(exportView.audioTuning) : undefined;
  const result = renderOfflineWav(track, coreManifestFromPak(pakManifest), bank, {
    duration: track.duration,
    tuning: exportTuning,
  });

  return result.wav;
}

/** One composited RAW frame for `seconds`, returned as RGBA bytes (the explicit fallback path). */
async function renderExportFrame(seconds: number): Promise<Uint8Array> {
  return renderExportPixels(seconds);
}

/**
 * Render one frame for `seconds` and return its composited RGBA pixels.
 *
 * DETERMINISM (the black-frame fix). The engine renders into an OWNED offscreen texture
 * (`Engine.renderTarget`) instead of the canvas swapchain, so the post pass is a normal submit whose completion
 * `await queue.onSubmittedWorkDone()` guarantees before the readback. The pixels come from
 * `copyTextureToBuffer` + `mapAsync` — never a `drawImage` of a GPU canvas, which is what raced the post pass's
 * opaque-black `loadOp:'clear'` (a fully-black capture). The
 * `VideoFrame` is built FROM the bytes. A frame that is still uniformly black after one re-render is a hard
 * error, so the exporter falls back to the raw lane rather than emitting a black frame.
 */
async function renderExportPixels(seconds: number, attempt = 0): Promise<Uint8Array> {
  const compositor = exportCompositor;
  const track = activeTrack();
  if (!track || !engine || !compositor) throw new Error('回放未就绪');
  const time = Math.max(0, Math.min(track.duration, seconds));
  playing = false;
  elapsed = time;
  snapCamera = true;
  exportClockMs = time * 1000;
  update(track, true);
  // Pak streaming without a display frame: pump the texture uploads directly instead of waiting on rAF.
  const streamDeadline = performance.now() + 30_000;
  while (pakWorld?.isLoading && performance.now() < streamDeadline) {
    pakWorld.pump(2);
    await engine.device.queue.onSubmittedWorkDone();
  }
  if (pakWorld?.isLoading) throw new Error('地图地块载入超时');
  // `update` submitted the post pass into the export surface; complete it before reading, or the readback
  // captures the post pass's opaque-black clear.
  await engine.device.queue.onSubmittedWorkDone();
  const pixels = await readExportSurface(compositor.surface);
  if (compositor.bgra) {
    swizzleBgraToRgba(pixels);
  }
  if (debug.error) throw new Error(debug.error);
  // A finished engine frame must contain scene pixels before it can be encoded.
  if (frameIsAllBlack(pixels)) {
    if (attempt === 0) {
      // Re-render once, after the queue flush above, before giving up.
      return renderExportPixels(seconds, 1);
    }
    throw new Error('导出帧全黑：GPU 同步后仍未捕获到已完成渲染的帧');
  }

  return pixels;
}

function setupExportCompositor(): void {
  if (exportCompositor) return;
  if (!engine) throw new Error('回放未就绪');
  // The engine renders into an OWNED offscreen texture during an export (the `Engine.renderTarget` seam),
  // never the canvas swapchain: the post pass then runs as a normal submit whose completion the readback can
  // await, which is what makes the capture deterministic. (Reading the swapchain canvas with `drawImage` raced
  // the post pass's opaque-black clear — the black-frame defect.)
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  const surface = engine.device.createTexture({
    format: `${presentationFormat}-srgb` as GPUTextureFormat,
    label: 'export-surface',
    size: { height: EXPORT_FRAME_HEIGHT, width: EXPORT_FRAME_WIDTH },
    usage: GPUTextureUsage.COPY_SRC | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  exportCompositor = {
    bgra: presentationFormat === 'bgra8unorm',
    surface,
  };
  engine.renderTarget = surface;
  engine.setTimeSource(() => exportClockMs);
}

/** BGRA -> RGBA in place, so both the HUD blend and `VideoFrame` see the same channel order. */
function swizzleBgraToRgba(pixels: Uint8Array): void {
  for (let offset = 0; offset + 3 < pixels.length; offset += 4) {
    const blue = pixels[offset];
    pixels[offset] = pixels[offset + 2];
    pixels[offset + 2] = blue;
  }
}

let exportEncoder: null | VideoEncoder = null;
let exportEncodeState: ExportEncodeState | null = null;

/**
 * Candidate AVC codecs for 1920x1080. Level 5.1 (0x33) covers 1080p120; level 4.2 (0x2A) covers 1080p60.
 * The first profile/level the browser accepts under `prefer-hardware` wins; the others are named rejections.
 * `avc.format:"annexb"` is REQUIRED so the output can be copy-muxed, but Chrome's `isConfigSupported` rejects
 * a config that carries `avc` (measured: `supported:false` for every candidate). So support is probed WITHOUT
 * `avc` and the encoder is configured WITH it — the Annex-B format is then verified from the actual output
 * (the first chunk must start with a start code), never assumed.
 */
function avcCodecCandidates(fps: number): string[] {
  return fps > 60 ? ['avc1.640033', 'avc1.64002A', 'avc1.42E01E'] : ['avc1.64002A', 'avc1.64001F', 'avc1.42E01E'];
}

/**
 * `VideoEncoder.isConfigSupported` first (recorded by the caller), then configure hardware H.264. Returns
 * `supported:false` with a reason when no candidate is accepted, so Node falls back EXPLICITLY to raw frames.
 */
async function beginExportEncode(fps: number): Promise<ExportEncodeSupport> {
  setupExportCompositor();
  if (exportEncodeState && exportEncoder && exportEncodeState.fps === fps && !exportEncodeState.error) {
    return {
      adapter: debug.gpu || 'unknown',
      codec: exportEncodeState.codec,
      config: exportEncodeState.config,
      hardwareAcceleration: 'prefer-hardware',
      mediaCapabilities: null,
      reason: null,
      supported: true,
    };
  }
  const adapter = await navigator.gpu.requestAdapter().catch(() => null);
  const adapterLabel = adapter
    ? `${adapter.info?.vendor ?? '?'} ${adapter.info?.architecture ?? ''}`.trim()
    : debug.gpu || 'unknown';
  let reason = 'no AVC codec candidate was tested';
  for (const codec of avcCodecCandidates(fps)) {
    const config: VideoEncoderConfig = {
      avc: { format: 'annexb' },
      bitrate: fps > 60 ? 24_000_000 : 16_000_000,
      codec,
      framerate: fps,
      hardwareAcceleration: 'prefer-hardware',
      height: EXPORT_FRAME_HEIGHT,
      latencyMode: 'quality',
      width: EXPORT_FRAME_WIDTH,
    };
    // Probe WITHOUT `avc`: Chrome rejects a config carrying `avc` in isConfigSupported even though the
    // encoder accepts it (measured). The Annex-B format is verified from the first encoded chunk instead.
    const probeConfig: VideoEncoderConfig = { ...config };
    delete probeConfig.avc;
    let support: VideoEncoderSupport;
    try {
      support = await VideoEncoder.isConfigSupported(probeConfig);
    } catch (error) {
      reason = `isConfigSupported threw for ${codec}: ${error instanceof Error ? error.message : String(error)}`;
      continue;
    }
    if (!support.supported) {
      reason = `isConfigSupported rejected ${codec}`;
      continue;
    }
    const mediaCapabilities =
      (await navigator.mediaCapabilities
        ?.encodingInfo({
          type: 'record',
          video: {
            bitrate: config.bitrate ?? 0,
            contentType: `video/mp4; codecs="${codec}"`,
            framerate: fps,
            height: EXPORT_FRAME_HEIGHT,
            width: EXPORT_FRAME_WIDTH,
          },
        })
        .catch(() => null)) ?? null;
    const encoder = new VideoEncoder({
      error: (error) => {
        if (exportEncodeState) exportEncodeState.error = String(error?.message ?? error);
      },
      output: captureEncodedChunk,
    });
    encoder.configure(config);
    exportEncoder = encoder;
    exportEncodeState = {
      chunks: [],
      codec,
      config,
      error: null,
      fps,
      framesEncoded: 0,
      keyInterval: Math.max(1, Math.round(fps)),
      totalBytes: 0,
      totalChunks: 0,
    };

    return {
      adapter: adapterLabel,
      codec,
      config,
      hardwareAcceleration: 'prefer-hardware',
      mediaCapabilities,
      reason: null,
      supported: true,
    };
  }

  return {
    adapter: adapterLabel,
    codec: null,
    config: null,
    hardwareAcceleration: 'prefer-hardware',
    mediaCapabilities: null,
    reason,
    supported: false,
  };
}

/** Base64 an encoded chunk without spreading megabytes into `String.fromCharCode`. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const block = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += block) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + block));
  }

  return btoa(binary);
}

function captureEncodedChunk(chunk: EncodedVideoChunk): void {
  const state = exportEncodeState;
  if (!state) return;
  const bytes = new Uint8Array(chunk.byteLength);
  chunk.copyTo(bytes);
  // The copy-mux contract is Annex-B: the first chunk must carry a start code, or Node would hand FFmpeg a
  // stream it cannot copy-mux. Verified from the real output, never assumed from the config.
  if (state.totalChunks === 0 && !isAnnexBStart(bytes)) {
    state.error = 'in-page encoder did not produce an Annex-B H.264 stream';

    return;
  }
  state.chunks.push(bytesToBase64(bytes));
  state.totalChunks += 1;
  state.totalBytes += bytes.byteLength;
}

/** Encode `count` frames starting at `startFrame`; returns the chunks emitted so far as base64. */
async function encodeExportFrames(
  startFrame: number,
  count: number,
): Promise<{ bytes: number; chunks: string[]; error: null | string; frames: number }> {
  const state = exportEncodeState;
  const encoder = exportEncoder;
  if (!state || !encoder) throw new Error('导出编码器未初始化');
  if (state.error) throw new Error(state.error);
  for (let index = 0; index < count; index += 1) {
    const frameIndex = startFrame + index;
    // Build the VideoFrame from the composited BYTES, never from the canvas: a `new VideoFrame(canvas)`
    // snapshot could precede the canvas's own drawImage (the black-frame defect). The bytes are read at a real
    // synchronization point inside `renderExportPixels`.
    const pixels = await renderExportPixels(frameIndex / state.fps);
    const frame = new VideoFrame(pixels, {
      codedHeight: EXPORT_FRAME_HEIGHT,
      codedWidth: EXPORT_FRAME_WIDTH,
      duration: Math.round(1_000_000 / state.fps),
      format: 'RGBA',
      timestamp: Math.round((frameIndex * 1_000_000) / state.fps),
    });
    try {
      encoder.encode(frame, { keyFrame: frameIndex % state.keyInterval === 0 });
    } finally {
      frame.close();
    }
    state.framesEncoded += 1;
    // Keep the encoder queue shallow so a hardware encoder's backpressure cannot grow without bound. The
    // queue is drained page-side; the batch boundary is where Node waits, so this is the only sync point.
    await waitForEncodeQueue(4);
  }
  if (state.error) throw new Error(state.error);
  const chunks = state.chunks.splice(0, state.chunks.length);
  const bytes = chunks.reduce((sum, encoded) => sum + Math.floor((encoded.length * 3) / 4), 0);

  return { bytes, chunks, error: null, frames: state.framesEncoded };
}

/** Flush the encoder (all frames encoded, none dropped), return the tail chunks and release it. */
async function finishExportEncode(): Promise<{
  bytes: number;
  chunks: string[];
  error: null | string;
  framesEncoded: number;
  totalBytes: number;
  totalChunks: number;
}> {
  const state = exportEncodeState;
  const encoder = exportEncoder;
  if (!state || !encoder) throw new Error('导出编码器未初始化');
  const error = state.error;
  let flushError: null | string = null;
  try {
    await encoder.flush();
  } catch (flushFailure) {
    flushError = flushFailure instanceof Error ? flushFailure.message : String(flushFailure);
  }
  const chunks = state.chunks.splice(0, state.chunks.length);
  const bytes = chunks.reduce((sum, encoded) => sum + Math.floor((encoded.length * 3) / 4), 0);
  encoder.close();
  exportEncoder = null;
  exportEncodeState = null;

  return {
    bytes,
    chunks,
    error: error ?? flushError,
    framesEncoded: state.framesEncoded,
    totalBytes: state.totalBytes,
    totalChunks: state.totalChunks,
  };
}

/** AVC Annex-B elementary streams begin with a 3- or 4-byte start code (0x000001 / 0x00000001). */
function isAnnexBStart(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1) return true;

  return bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 1;
}

/** Wait for the encoder queue to drain so a hardware encoder's backpressure cannot grow without bound. */
async function waitForEncodeQueue(limit: number): Promise<void> {
  const encoder = exportEncoder;
  if (!encoder) return;
  const deadline = performance.now() + 30_000;
  while (encoder.encodeQueueSize > limit) {
    if (exportEncodeState?.error) throw new Error(exportEncodeState.error);
    if (performance.now() > deadline) throw new Error('导出编码器队列超时');
    await new Promise<void>((resolve) => {
      const done = (): void => {
        encoder.removeEventListener('dequeue', done);
        resolve();
      };
      encoder.addEventListener('dequeue', done, { once: true });
      setTimeout(done, 250);
    });
  }
}

let aircraft: AircraftHandle | null = null;
let aircraftModel = -1;
/** Part index of the cockpit/canopy, used only when the pilot seat dummy is absent. */
const COCKPIT_EYE_AFT = 0.2;
const HYDRA_COCKPIT_EYE_DOWN = 0.07;
let cockpitPart = -1;
let seatLocal: null | Vec3 = null;
let modelLength = 14;
let modelTop = 3;
let snapCamera = true;
let lastWeather = -1;
let envDriver: null | ReturnType<typeof createEngineEnvironmentDriver> = null;
let engine: Engine;
let flightEffects: FlightEffects | null = null;
/** 3D world endpoint markers (red pillar + cross per endpoint, density halo for clusters). */
let endpointMarkers: EndpointMarkers | null = null;
/** Route A only: the world streams from a locally baked pak (no welding, no texture-array growth). */
let pakWorld: null | PakWorld = null;
const MAP_PAK_BASE = params.get('pak') ?? '/map-pak';
let camera: ReplayCamera;
let lastRenderedCameraState: CameraStateOut | null = null;
let chaseTimeline: ChaseCameraTimeline | null = null;
let chaseTrack: FlightTrack | null = null;
let chaseSize = '';
let chaseTransition: null | { from: ChaseMode; started: number } = null;
let timecycText = '';

function activeTrack(): FlightTrack | null {
  return plays[active] ?? null;
}

async function addFiles(files: File[]): Promise<void> {
  const csvFiles = files.filter((file) => /\.csv$/i.test(file.name));
  const wavFiles = files.filter((file) => /\.wav$/i.test(file.name));
  for (const file of csvFiles) {
    try {
      const csv = await file.text();
      const track = parseFlightCsv(csv, file.name);
      trackSources.set(track, csv);
      trackFilenames.set(track, file.name);
      plays.push(track);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }
  for (const file of wavFiles) {
    const stem = file.name.replace(/\.wav$/i, '').toLowerCase();
    const track = [...plays].reverse().find((item) => item.name.replace(/\.csv$/i, '').toLowerCase() === stem);
    if (track) {
      const url = URL.createObjectURL(file);
      audioObjectUrls.push(url);
      replayAudio.attach(track, url);
    }
  }
  navigation.setTracks(plays, active);
  endpointMarkers?.setTracks(plays, active);
  if (plays.length) {
    renderTrackList();
    await ensureAircraft();
    selectTrack(plays.length - 1);
  }
}

/** Apply the recorded (or curated) environment: real game hour + weather from the CSV, never the PC clock. */
function applyEnvironment(
  row: null | { gameHour: null | number; gameMinute: null | number; weatherNew: null | number },
): void {
  const recordedHour =
    row?.gameHour !== null && row?.gameHour !== undefined ? row.gameHour + (row.gameMinute ?? 0) / 60 : 12;
  const recordedWeather = row?.weatherNew ?? 0;
  const hour = hudHour ?? FORCE_HOUR ?? recordedHour;
  const weather = hudWeather ?? FORCE_WEATHER ?? recordedWeather;
  lastEnv = { hour, weather };
  debug.envHud = `hud=${hudWeather},${hudHour} force=${FORCE_WEATHER},${FORCE_HOUR} rec=${recordedWeather},${recordedHour.toFixed(2)} eff=${weather},${hour.toFixed(2)}`;
  syncEnvControls(hour, weather);
  if (!timecycText) {
    return;
  }
  if (weather !== lastWeather) {
    lastWeather = weather;
    envDriver = createEngineEnvironmentDriver(engine.environment, { timecyc: { text: timecycText }, weather });
  }
  envDriver?.apply(hour);
}

async function bakeActiveRoute(): Promise<void> {
  const track = activeTrack();
  const csv = track && trackSources.get(track);
  if (!csv) return;
  const button = el<HTMLButtonElement>('bakeRoute');
  const note = el<HTMLSpanElement>('bakeStatus');
  routeBakeRunning = true;
  button.disabled = true;
  note.textContent = '正在烘焙航迹附近地图…';
  try {
    const response = await fetch('/route-bake', {
      body: JSON.stringify({ csv }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) throw new Error(await response.text());
    const { id } = (await response.json()) as { id: string };
    for (;;) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      const progress = await fetch(`/route-bake/${id}`);
      if (!progress.ok) throw new Error('烘焙状态不可用');
      const job = (await progress.json()) as { message: string; state: string };
      note.textContent = job.message;
      if (job.state === 'failed') throw new Error(job.message);
      if (job.state === 'ready') {
        const url = new URL(location.href);
        url.searchParams.set('pak', `/route-pak/${id}`);
        url.searchParams.set('recording', `/route-pak/${id}/recording.csv`);
        location.assign(url.href);

        return;
      }
    }
  } catch (error) {
    note.textContent = `航迹烘焙失败：${error instanceof Error ? error.message : String(error)}`;
    routeBakeRunning = false;
    button.disabled = false;
  }
}

/** Geometry probe: the tail fin reaches the highest native Z, so its Y sign names the nose direction. */
function describeNose(handle: AircraftHandle): string {
  const positions = handle.data.positions;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const topCut = maxZ - (maxZ - minZ) * 0.15;
  let topX = 0;
  let topY = 0;
  let topN = 0;
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i + 2] >= topCut) {
      topX += positions[i];
      topY += positions[i + 1];
      topN += 1;
    }
  }
  const tailX = topN ? topX / topN : 0;
  const tailY = topN ? topY / topN : 0;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return `x=[${minX.toFixed(1)},${maxX.toFixed(1)}] y=[${minY.toFixed(1)},${maxY.toFixed(1)}] z=[${minZ.toFixed(1)},${maxZ.toFixed(1)}] tailX=${tailX.toFixed(1)} tailY=${tailY.toFixed(1)} centerX=${centerX.toFixed(1)} centerY=${centerY.toFixed(1)}`;
}

async function ensureAircraft(): Promise<void> {
  const track = activeTrack();
  if (!track) {
    return;
  }
  if (aircraft && aircraftModel === track.model) {
    return;
  }
  aircraft?.dispose();
  aircraft = null;
  cockpitPart = -1;
  seatLocal = null;
  modelLength = 14;
  modelTop = 3;
  debug.seatSource = 'none';
  aircraftModel = track.model;
  try {
    aircraft = await loadAircraft(engine, resources, track.model);
    cockpitPart = aircraft.data.parts.findIndex((part) => part.name === 'door_lf');
    if (cockpitPart < 0) {
      cockpitPart = aircraft.data.parts.findIndex((part) => part.name === 'chassis');
    }
    const seat = aircraft.data.dummies.find((dummy) => dummy.name.toLowerCase() === 'ped_frontseat');
    // GTA's vehicle first-person camera ignores the seat's sideways offset.
    seatLocal = seat ? [0, seat.position[1] + 0.08, seat.position[2] + 0.62] : null;
    debug.seatSource = seat ? 'ped_frontseat' : 'fallback';
    let minY = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < aircraft.data.positions.length; i += 3) {
      minY = Math.min(minY, aircraft.data.positions[i + 1]);
      maxZ = Math.max(maxZ, aircraft.data.positions[i + 2]);
    }
    modelLength = Number.isFinite(minY) ? Math.max(8, Math.min(35, -2 * minY)) : 14;
    modelTop = Number.isFinite(maxZ) ? Math.max(1, Math.min(8, maxZ)) : 3;
    debug.aircraft = `${aircraft.name} ${describeNose(aircraft)}`;
    debug.parts = aircraft.data.parts.map((part, index) => `${index}:${part.name}`).join(' ');
    setStatus(`已载入原版 ${aircraft.name}（模型 ${track.model}）`);
  } catch (error) {
    debug.aircraft = `failed: ${error instanceof Error ? error.message : String(error)}`;
    setStatus(`原版飞机加载失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

function fmt(s: number): string {
  const safe = Number.isFinite(s) ? Math.max(0, s) : 0;

  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${(safe % 60).toFixed(3).padStart(6, '0')}`;
}

function frameOnce(): void {
  const track = activeTrack();
  if (track) {
    update(track, snapCamera);
  }
}

async function loadLatest(): Promise<void> {
  try {
    const recording = params.get('recording') ?? '/local-recording/latest.csv';
    const response = await fetch(recording);
    if (!response.ok) {
      throw new Error('没有找到本地录制文件');
    }
    const csv = await response.text();
    const track = parseFlightCsv(
      csv,
      recording === '/local-recording/latest.csv' ? '最新本地记录.csv' : '航迹包录像.csv',
    );
    trackSources.set(track, csv);
    const originalName = response.headers.get('X-Recording-Name');
    if (originalName) trackFilenames.set(track, originalName);
    const audioUrl =
      response.headers.get('X-Recording-Audio') ??
      (recording !== '/local-recording/latest.csv' && recording.endsWith('.csv')
        ? `${recording.slice(0, -4)}.wav`
        : '');
    if (audioUrl && !VIDEO_EXPORT) replayAudio.attach(track, audioUrl);
    plays.push(track);
    navigation.setTracks(plays, active);
    endpointMarkers?.setTracks(plays, active);
    renderTrackList();
    await ensureAircraft();
    selectTrack(plays.length - 1);
  } catch (error) {
    setStatus(`本地记录载入失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Copy the renderer's counters onto `window.__flight`; every number a test asserts comes from here. */
function publishAudioStats(track: FlightTrack): void {
  const stats = webAudio?.stats ?? null;
  if (stats) {
    debug.audioWebContext = stats.contextState;
    debug.audioWebEngineBank = stats.engineBank;
    debug.audioWebEngineGain = stats.engineGain;
    debug.audioWebEngineRate = stats.engineRate;
    debug.audioWebListenerPos = stats.listenerPos;
    debug.audioWebLiveOneShots = stats.liveOneShots;
    debug.audioWebLiveSources = stats.liveSources;
    debug.audioWebMessage = stats.message;
    debug.audioWebMuted = stats.muted;
    debug.audioWebNodesCreated = stats.nodesCreated;
    debug.audioWebOneShotsStarted = stats.oneShotsStarted;
    debug.audioWebPlaying = stats.playing;
    debug.audioWebReleasedOneShots = stats.releasedOneShots;
    debug.audioWebReverbZone = stats.reverbZone;
    debug.audioWebSamples = stats.samples;
    debug.audioWebSpeed = stats.speed;
    debug.audioWebState = stats.state;
    debug.audioWebTimelineEvents = stats.timelineEvents;
    debug.audioWebTrackEpoch = stats.trackEpoch;
    debug.audioWebUpdates = stats.updates;
    // Missing lane + a loaded WAV: fall back to the recording so the take is still audible.
    const noSynthesis = stats.state === 'no-samples' || stats.state === 'error' || stats.state === 'unavailable';
    if (audioSourceMode === 'synth' && noSynthesis && replayAudio.hasAudio) {
      setAudioSourceMode('wav');
    }
  }
  const wavSource = replayAudio.sourceFor(track);
  debug.audioSourceMode = audioSourceMode;
  debug.audioWavActive = Boolean(wavSource) && !replayAudio.paused;
  debug.audioWavHasAudio = replayAudio.hasAudio;
  debug.audioWavMuted = replayAudio.muted;
  debug.audioWavRate = replayAudio.playbackRate;
  debug.audioWavTime = replayAudio.currentTime;
}

function renderTrackList(): void {
  el<HTMLButtonElement>('bakeRoute').disabled = !activeTrack() || routeBakeRunning;
  tracksEl.innerHTML = plays
    .map(
      (track, index) =>
        `<div class="track ${index === active ? 'active' : ''}" data-i="${index}">` +
        `<span class="track-name">${escapeHtml(track.name)}</span><span class="badge">${track.rows.length}</span>` +
        `<span class="track-meta">${fmt(track.duration)} · 模型 ${track.model}</span></div>`,
    )
    .join('');
  tracksEl.querySelectorAll<HTMLElement>('.track').forEach((node) => {
    node.onclick = () => void selectTrack(Number(node.dataset.i));
  });
}

function selectTrack(index: number): void {
  if (cockpitLook) navigation.setFreeMode(false);
  cockpitLook = null;
  active = Math.max(0, Math.min(plays.length - 1, index));
  debug.activeTrackIndex = active;
  elapsed = 0;
  replayAudio.select(plays[active], elapsed);
  audioMixer?.setModel(plays[active].model);
  if (audioMixer) webAudio?.setTuning(audioMixer.get(plays[active].model));
  webAudio?.attachTrack(plays[active]);
  navigation.setTrack(plays[active]);
  navigation.endpoints.setActive(active);
  endpointMarkers?.setActive(active);
  snapCamera = true;
  chaseTransition = null;
  void ensureAircraft();
  renderTrackList();
  frameOnce();
}

function setAudioSourceMode(mode: AudioSourceMode): void {
  audioSourceMode = mode;
  if (audioSourceSelect && audioSourceSelect.value !== mode) {
    audioSourceSelect.value = mode;
  }
}

function setStatus(text: string): void {
  status.textContent = text;
  debug.status = text;
}

function surfaceDamageLabel(state: null | number): string {
  return state === null ? '未知' : (['完好', '受损', '脱落', '其他原始状态（3）'][state] ?? '未知');
}

/** Drive both audio paths from the SAME replay clock; the synthesis listener is the replay camera. */
function syncAudio(track: FlightTrack, pose: ReturnType<typeof sampleTrack>): void {
  const speed = Number(el<HTMLSelectElement>('speed').value);
  // The WAV element is only unpaused while it is the selected path; otherwise it stays parked at `elapsed`
  // so switching to it resumes exactly in sync (this is the comparison/fallback path, unchanged otherwise).
  replayAudio.sync(audioSourceMode !== 'synth' && playing, speed, elapsed);
  const renderer = webAudio;
  const cameraState = lastRenderedCameraState;
  if (renderer && cameraState) {
    const listener: WebAudioListenerPose = {
      forward: [
        cameraState.target[0] - cameraState.eye[0],
        cameraState.target[1] - cameraState.eye[1],
        cameraState.target[2] - cameraState.eye[2],
      ],
      position: cameraState.eye,
      up: cameraState.up,
      velocity: gtaDirToEngine(pose.velocity),
    };
    renderer.sync(playing && audioSourceMode !== 'wav', speed, elapsed, listener, pose.pos);
  }
  publishAudioStats(track);
  updateAudioStatus();
}

function timelineFor(track: FlightTrack): ChaseCameraTimeline {
  const size = `${modelLength},${modelTop}`;
  if (!chaseTimeline || chaseTrack !== track || chaseSize !== size) {
    chaseTimeline = new ChaseCameraTimeline(track, modelLength, modelTop);
    chaseTrack = track;
    chaseSize = size;
  }

  return chaseTimeline;
}

function update(track: FlightTrack, forceSnap: boolean): void {
  const pose = sampleTrack(track, elapsed);
  applyEnvironment(pose.row);
  const posEngine: Vec3 = [pose.pos[0], pose.pos[2], -pose.pos[1]];
  updateSceneAircraft(track, pose);
  // Camera axes come from the SLERP-ed orientation, NOT the raw sampled row vectors: the raw row is only
  // updated at 25 Hz, so during a barrel roll its up/forward jumped every sample and the cockpit shook
  // relative to the (smoothly interpolated) airframe.
  const forward = rotateVec(pose.orientation, [0, 1, 0]);
  const up = rotateVec(pose.orientation, [0, 0, 1]);
  const right = rotateVec(pose.orientation, [1, 0, 0]);
  // Objective jitter metric: the biggest per-frame turn of the camera's up axis. A smooth barrel roll keeps
  // this near the roll rate / frame rate; spikes mean the camera axes are jumping (the bug this measures).
  if (lastCameraUp) {
    const dot = Math.min(1, Math.max(-1, up[0] * lastCameraUp[0] + up[1] * lastCameraUp[1] + up[2] * lastCameraUp[2]));
    const step = (Math.acos(dot) * 180) / Math.PI;
    if (step > debug.maxUpStepDeg) {
      debug.maxUpStepDeg = step;
    }
  }
  lastCameraUp = up;
  drawAxes(posEngine, forward, right, up);
  // Flatten BEFORE the camera: the fallback cockpit part matrix is only valid for this frame.
  engine.updateVehicles();
  const firstPersonPosition: undefined | Vec3 = seatLocal
    ? [
        posEngine[0] + right[0] * seatLocal[0] + forward[0] * seatLocal[1] + up[0] * seatLocal[2],
        posEngine[1] + right[1] * seatLocal[0] + forward[1] * seatLocal[1] + up[1] * seatLocal[2],
        posEngine[2] + right[2] * seatLocal[0] + forward[2] * seatLocal[1] + up[2] * seatLocal[2],
      ]
    : undefined;
  // The cockpit camera uses the pilot's seat rather than the canopy hinge. Sit a little aft at
  // a slightly lower Hydra eye height so the windshield rail frames the pilot's view.
  // Keep the old part anchor as a fallback for aircraft without a ped_frontseat dummy.
  let cockpitPosition: undefined | Vec3 = firstPersonPosition
    ? [
        firstPersonPosition[0] - forward[0] * COCKPIT_EYE_AFT,
        firstPersonPosition[1] - forward[1] * COCKPIT_EYE_AFT,
        firstPersonPosition[2] - forward[2] * COCKPIT_EYE_AFT,
      ]
    : undefined;
  if (!cockpitPosition && aircraft && cockpitPart >= 0) {
    const matrices = aircraft.instance.entity.matrices;
    const offset = cockpitPart * 16;
    cockpitPosition = [
      matrices[offset + 12] + forward[0] * 0.6 + up[0] * 0.3,
      matrices[offset + 13] + forward[1] * 0.6 + up[1] * 0.3,
      matrices[offset + 14] + forward[2] * 0.6 + up[2] * 0.3,
    ];
  }
  if (cockpitPosition && pose.row.model === 520) {
    cockpitPosition = cockpitPosition.map((value, axis) => value - up[axis] * HYDRA_COCKPIT_EYE_DOWN) as Vec3;
  }
  const dt = Math.min(0.1, Math.max(0.0001, (performance.now() - lastFrame) / 1000));
  const velocity = gtaDirToEngine(pose.velocity);
  const aspect = canvas.width / Math.max(1, canvas.height);
  const gameAspect = window.screen.width / Math.max(1, window.screen.height);
  const freeCameraState =
    cockpitLook && navigation.isFreeMode() && cockpitPosition
      ? cockpitLook.state({
          aspect,
          canopy: aircraft?.canopyPlanes.length
            ? {
                anchor: [right, forward, up].map((axis) =>
                  axis.reduce((sum, value, index) => sum + value * (cockpitPosition[index] - posEngine[index]), 0),
                ) as Vec3,
                planes: aircraft.canopyPlanes,
              }
            : undefined,
          eye: cockpitPosition,
          forward,
          right,
          up,
        })
      : navigation.cameraState(aspect);
  const cameraState = updateSceneCamera(
    track,
    forceSnap,
    aspect,
    gameAspect,
    freeCameraState,
    cockpitPosition,
    firstPersonPosition,
    dt,
    velocity,
    forward,
    up,
    posEngine,
    pose,
  );
  debug.cameraMode = cockpitLook ? 'cockpit-look' : freeCameraState ? 'free' : cameraMode;
  const view = [
    cameraState.target[0] - cameraState.eye[0],
    cameraState.target[1] - cameraState.eye[1],
    cameraState.target[2] - cameraState.eye[2],
  ];
  debug.cameraDistance = Math.hypot(...view);
  debug.cameraTravelDot =
    view.reduce((sum, component, index) => sum + component * velocity[index], 0) /
    Math.max(1e-6, Math.hypot(...view) * Math.hypot(...velocity));
  snapCamera = false;
  lastRenderedCameraState = cameraState;
  debug.cameraState = cameraState;
  debug.flyActive = navigation.camera.flying();
  debug.flyProgress = navigation.camera.flyProgress();
  debug.markerScreenPositions = projectMarkers(cameraState);
  updateSceneRender(track, pose, cameraState);
  updateScenePanels(track, pose, freeCameraState, posEngine);
}

function updateAudioStatus(): void {
  if (!audioStatusEl) {
    return;
  }
  const stats = webAudio?.stats ?? null;
  const label = stats ? (stats.muted ? `${stats.message}（已静音）` : stats.message) : '合成音频：未启用（视频导出）';
  if (audioStatusEl.textContent !== label) {
    audioStatusEl.textContent = label;
  }
}

function updateReadout(track: FlightTrack, pose: ReturnType<typeof sampleTrack>): void {
  const row = pose.row;
  const speed = pose.speed;
  const colors = row.colors.every(Number.isFinite) ? row.colors.join(' / ') : '未采集';
  const source =
    row.nodeStatus === 0 ? '按键推测（inferred）' : row.nodeStatus >= 0x1f ? '真实节点（real）' : '部分真实（partial）';
  const nodeText = NODE_NAMES.map((name, index) => `${name}:${row.nodes[index] ? 'R' : '—'}`).join(' ');
  const gear = Number.isFinite(row.gear) ? row.gear.toFixed(3) : '—';
  const items: [string, string][] = [
    ['文件', track.name],
    ['模型', String(row.model)],
    ['本地时间', new Date(row.timeMs).toLocaleTimeString('zh-CN', { hour12: false })],
    [
      '游戏时间',
      `${row.gameHour ?? '—'}:${String(row.gameMinute ?? 0).padStart(2, '0')}（天气 ${row.weatherNew ?? '—'}）`,
    ],
    [
      '环境(显示)',
      `${Math.round(lastEnv.weather)} ${WEATHER_NAMES[Math.round(lastEnv.weather)] ?? ''} @ ${formatHour(lastEnv.hour)} · ${isFollowingEnv() ? '跟随录制' : '手动'}`,
    ],
    ['地图来源', pakWorld ? `预烘焙 pak${pakWorld.note()}` : '预烘焙 pak 未加载'],
    ['显卡', `${debug.gpu || '—'}${debug.phase === 'device-lost' ? ' · 设备已丢失!' : ''}`],
    ['坐标', `${row.pos[0].toFixed(2)}, ${row.pos[1].toFixed(2)}, ${row.pos[2].toFixed(2)}`],
    ['航向', `${row.heading.toFixed(2)}°`],
    ['速度', `${speed.toFixed(2)} 单位/秒`],
    ['血量', row.health.toFixed(1)],
    ['舵面损伤来源', row.surfaceDamage.source === 'game_memory' ? '游戏内存（已校验布局）' : '未知／未采集'],
    ...['方向舵', '左升降舵', '右升降舵', '左副翼', '右副翼'].map((label, index): [string, string] => [
      label,
      surfaceDamageLabel(row.surfaceDamage.states[index]),
    ]),
    ['颜色 ID', colors],
    ['姿态', track.axesNote],
    ['起落架原始值', gear],
    ['Hydra 喷口控制', row.nozzleRotation === null ? '未采集' : `${Math.round(row.nozzleRotation)} / 5000`],
    ['冒烟', row.smokeActive === null ? '未采集' : row.smokeActive ? '是' : '否'],
    ['动画节点来源', source],
    ['节点', nodeText],
  ];
  readout.innerHTML = items
    .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join('');
  const keyItems: [string, null | number][] = [
    ['Q', row.keyQ],
    ['W', row.keyW],
    ['E', row.keyE],
    ['A', row.keyA],
    ['S', row.keyS],
    ['D', row.keyD],
    ['↑', row.keyUp],
    ['↓', row.keyDown],
    ['←', row.keyLeft],
    ['→', row.keyRight],
  ];
  keys.innerHTML = keyItems
    .map(([label, value]) => {
      const state = track.version >= 11 && !row.keyboardStateValid ? null : value;

      return `<div class="key ${state === 1 ? 'on' : ''}" title="${state === null ? '未录制或失去焦点' : '录制的按键状态'}">${label}${state === null ? ' ·?' : ''}</div>`;
    })
    .join('');
  const note = `${track.name} · 采样 ${track.rows.length} · ${source}`;
  setStatus(note);
  segmentChip.textContent = track.name;
}

let instrumentTrack: FlightTrack | null = null;
function updateSceneAircraft(track: FlightTrack, pose: ReturnType<typeof sampleTrack>): void {
  if (aircraft) {
    aircraft.setVisible(cameraMode !== 'first-person');
    aircraft.applyPose(pose.pos, pose.orientation);
    aircraft.applyPaint(pose.row.colors);
    const keysInferred = {
      pitch: ((pose.row.keyUp || 0) - (pose.row.keyDown || 0)) * 0.3,
      roll: ((pose.row.keyD || 0) - (pose.row.keyA || 0)) * 0.38,
      yaw: ((pose.row.keyE || 0) - (pose.row.keyQ || 0)) * 0.28,
    };
    aircraft.applyNodes(pose.nodes, pose.row.gear, keysInferred);
    debug.stickMotion = aircraft.stickMotion;
    debug.pedalMotion = aircraft.pedals?.state ?? null;
    aircraft.applyProps({ nodes: pose.row.propNodes, nozzleRotation: pose.row.nozzleRotation });
    aircraft.instruments?.update(cockpitInstrumentState(track, pose, elapsed), instrumentTrack !== track);
    instrumentTrack = track;
    debug.instrumentState = aircraft.instruments?.state ?? null;
    debug.instrumentUploads = aircraft.instruments?.uploads ?? 0;
  }
}

function updateSceneCamera(
  track: FlightTrack,
  forceSnap: boolean,
  aspect: number,
  gameAspect: number,
  freeCameraState: CameraStateOut | null,
  cockpitPosition: undefined | Vec3,
  firstPersonPosition: undefined | Vec3,
  dt: number,
  velocity: Vec3,
  forward: Vec3,
  up: Vec3,
  posEngine: Vec3,
  pose: ReturnType<typeof sampleTrack>,
): CameraStateOut {
  let cameraState = isChaseMode(cameraMode)
    ? timelineFor(track).state(elapsed, cameraMode, aspect, gameAspect)
    : camera.state({
        aspect,
        cockpitPosition,
        dt,
        firstPersonPosition,
        forward,
        gameAspect,
        model: pose.row.model,
        modelLength,
        modelTop,
        position: posEngine,
        snap: forceSnap || snapCamera,
        up,
        velocity,
      });
  if (freeCameraState) {
    cameraState = freeCameraState;
  }
  if (!freeCameraState && chaseTransition && isChaseMode(cameraMode)) {
    const blend = Math.min(1, (performance.now() - chaseTransition.started) / 250);
    if (blend < 1) {
      const previous = timelineFor(track).state(elapsed, chaseTransition.from, aspect, gameAspect);
      cameraState.eye = [0, 1, 2].map(
        (axis) => previous.eye[axis] + (cameraState.eye[axis] - previous.eye[axis]) * blend,
      ) as Vec3;
    } else {
      chaseTransition = null;
    }
  }
  if (!freeCameraState && isChaseMode(cameraMode) && pakWorld?.isReady) {
    cameraState = pakWorld.resolveCamera(cameraState, cameraMode, dt, forceSnap || snapCamera);
  }

  return cameraState;
}

function updateScenePanels(
  track: FlightTrack,
  pose: ReturnType<typeof sampleTrack>,
  freeCameraState: CameraStateOut | null,
  posEngine: Vec3,
): void {
  updateReadout(track, pose);
  syncAudio(track, pose);
  clock.textContent = `${fmt(elapsed)} / ${fmt(track.duration)}`;
  // The scrubber's range must track the ACTIVE recording, or dragging it clamps every value to 0.
  if (scrub.max !== String(track.duration)) {
    scrub.max = String(track.duration);
  }
  scrub.value = String(elapsed);
  modeChip.textContent = `${cockpitLook ? '机舱观察' : freeCameraState ? '自由视角' : CAMERA_LABELS[cameraMode]}（${playing ? '播放中' : '暂停'}）`;
  el('follow').textContent = `视角：${CAMERA_LABELS[cameraMode]}`;
  if (pakWorld?.isReady) {
    const streamPos = freeCameraState ? navigation.camera.position : posEngine;
    pakWorld.update(streamPos[0], -streamPos[2], pakWorld.renderRadius.hd, pakWorld.renderRadius.lod);
    const busy = pakWorld.loadedCells === 0 && pakWorld.isLoading;
    mapLoading.hidden = !busy;
    if (busy) mapLoadingText.textContent = '载入预烘焙地图…';
  }
}

function updateSceneRender(
  track: FlightTrack,
  pose: ReturnType<typeof sampleTrack>,
  cameraState: CameraStateOut,
): void {
  try {
    engine.particleClock = elapsed;
    if (flightEffects) {
      flightEffects.update(track, pose, elapsed, aircraft);
    }
    engine.frame(cameraState);
    debug.renders += 1;
    debug.phase = 'rendering';
  } catch (error) {
    if (!debug.error) {
      debug.error = error instanceof Error ? `${error.message}` : String(error);
      setStatus(`渲染失败：${debug.error}`);
    }
  }
}

let resources!: PakResources;

/** The page-side contract the exporter drives over CDP (`?videoExport=1`). */
interface FlightVideoExportApi {
  beginEncode(fps: number): Promise<ExportEncodeSupport>;
  encodeFrames(
    startFrame: number,
    count: number,
  ): Promise<{ bytes: number; chunks: string[]; error: null | string; frames: number }>;
  endEncode(): Promise<{
    bytes: number;
    chunks: string[];
    error: null | string;
    framesEncoded: number;
    totalBytes: number;
    totalChunks: number;
  }>;
  ready(): Promise<{
    compositor: { backend: string; height: number; pixelFormat: string; visible: boolean; width: number };
    duration: number;
  }>;
  /** The offline-synthesized engine audio as a complete RIFF/WAVE file, for the exporter's AAC mux. */
  renderAudio(): Promise<Uint8Array>;
  renderFrame(seconds: number): Promise<Uint8Array>;
}

function bindUi(): void {
  navigation.mountEndpointList(el('endpoint-list'));
  navigation.attachCameraInput(canvas);
  // 3D marker picking: debug lines are not pickable, so a click is projected against the live camera.
  let markerPointerDown: null | { x: number; y: number } = null;
  canvas.addEventListener('pointerdown', (event) => {
    markerPointerDown = event.button === 0 ? { x: event.clientX, y: event.clientY } : null;
  });
  canvas.addEventListener('click', (event) => {
    const down = markerPointerDown;
    markerPointerDown = null;
    if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > MARKER_CLICK_DRAG_PX) {
      return; // the press was a free-camera drag, not a marker pick
    }
    pickMarkerAt(event.clientX, event.clientY);
  });
  if (VIDEO_EXPORT) {
    document.body.classList.add('video-export-mode');
    // The endpoint list carries data-capture="exclude", so video-export-mode hides it with the other controls.
  }
  if (MAP_PAK_BASE.startsWith('/route-pak/')) {
    el('bakeStatus').textContent = '当前使用航迹包；远景范围为 1200 单位。';
  }
  const drop = el<HTMLDivElement>('drop');
  const picker = el<HTMLInputElement>('picker');
  picker.accept = '.csv,.wav,text/csv,audio/wav';
  const audioButton = document.createElement('button');
  audioButton.type = 'button';
  audioButton.title = '静音全部音频（Web Audio 合成与录制的游戏原声 WAV）';
  audioButton.textContent = '音频：开';
  audioButton.onclick = () => {
    replayAudio.muted = !replayAudio.muted;
    webAudio?.setMuted(replayAudio.muted);
    audioButton.textContent = replayAudio.muted ? '音频：关' : '音频：开';
  };
  el<HTMLSelectElement>('speed').insertAdjacentElement('afterend', audioButton);
  // Audio source selector (todo 18): Web Audio synthesis, the recorded WAV comparison, or both.
  const audioSource = document.createElement('select');
  audioSource.id = 'audioSource';
  audioSource.title = '音频来源：pak 样本的 Web Audio 合成 / 录制的游戏原声 WAV / 两者同时（对比）';
  for (const [value, label] of [
    ['synth', '合成音频'],
    ['wav', '录制 WAV'],
    ['both', '合成+WAV'],
  ] as const) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    audioSource.append(option);
  }
  audioSource.value = audioSourceMode;
  audioSource.onchange = () => {
    const value = audioSource.value;
    setAudioSourceMode(value === 'wav' || value === 'both' ? value : 'synth');
    frameOnce();
  };
  audioSourceSelect = audioSource;
  audioButton.after(audioSource);
  audioMixer = new AudioMixer(el('audioMixer'), (model, tuning) => {
    if (activeTrack()?.model === model) webAudio?.setTuning(tuning);
  });
  const mixerButton = document.createElement('button');
  mixerButton.id = 'audioMixerToggle';
  mixerButton.type = 'button';
  mixerButton.textContent = '调音台';
  mixerButton.title = '调整当前载具的合成音频声层、音高和中频厚度';
  mixerButton.onclick = () => audioMixer?.toggle();
  audioSource.after(mixerButton);
  const audioStatus = document.createElement('span');
  audioStatus.id = 'audioStatus';
  audioStatus.className = 'small';
  audioStatus.textContent = '合成音频：准备中…';
  audioStatusEl = audioStatus;
  mixerButton.after(audioStatus);
  const freeButton = document.createElement('button');
  freeButton.type = 'button';
  freeButton.id = 'freeView';
  freeButton.textContent = '自由视角';
  freeButton.title = 'WASD 水平移动，空格上升，Shift 下降，Ctrl 切换极慢/慢/中/快；拖动旋转，滚轮按当前档位前后移动';
  freeButton.onclick = () => {
    if (cockpitLook) {
      cockpitLook = null;
      if (lastRenderedCameraState) navigation.camera.lookAt(lastRenderedCameraState.target);
      freeButton.textContent = '退出自由视角';
      frameOnce();

      return;
    }
    if (navigation.isFreeMode()) {
      navigation.setFreeMode(false);
      freeButton.textContent = '自由视角';
      camera.reset();
      snapCamera = true;
    } else {
      if (lastRenderedCameraState) {
        navigation.camera.setPose({ position: lastRenderedCameraState.eye });
        navigation.camera.lookAt(lastRenderedCameraState.target);
        navigation.camera.focusDistance = Math.hypot(
          lastRenderedCameraState.target[0] - lastRenderedCameraState.eye[0],
          lastRenderedCameraState.target[1] - lastRenderedCameraState.eye[1],
          lastRenderedCameraState.target[2] - lastRenderedCameraState.eye[2],
        );
      }
      navigation.setFreeMode(true);
      freeButton.textContent = '退出自由视角';
    }
    frameOnce();
  };
  el('follow').insertAdjacentElement('afterend', freeButton);
  const cockpitLookButton = document.createElement('button');
  cockpitLookButton.type = 'button';
  cockpitLookButton.id = 'cockpitLook';
  cockpitLookButton.textContent = '机舱观察';
  cockpitLookButton.title =
    '从驾驶员位置观察机舱；回头时自动轻微前探。拖动旋转，WASD/空格/Shift 小幅微调，Ctrl 切换速度';
  cockpitLookButton.onclick = () => {
    if (cockpitLook) {
      cockpitLook = null;
      navigation.setFreeMode(false);
      freeButton.textContent = '自由视角';
    } else {
      cameraMode = 'cockpit';
      camera.mode = cameraMode;
      cockpitLook = new CockpitLookCamera(navigation.camera);
      navigation.setFreeMode(true);
      freeButton.textContent = '切到自由视角';
    }
    camera.reset();
    snapCamera = true;
    frameOnce();
  };
  freeButton.after(cockpitLookButton);
  const rawButton = document.createElement('button');
  rawButton.type = 'button';
  rawButton.textContent = '原始数据';
  rawButton.onclick = () => {
    const panel = el<HTMLElement>('right');
    panel.hidden = !panel.hidden;
  };
  cockpitLookButton.after(rawButton);
  const videoButton = document.createElement('button');
  videoButton.type = 'button';
  videoButton.textContent = '导出 MP4';
  // Export frame rate (todo 30): exactly the backend's SUPPORTED_FPS, default 30. The transport panel already
  // carries `data-capture="exclude"`; the label repeats it so the control can never be framed by an export.
  const fpsLabel = document.createElement('label');
  fpsLabel.className = 'small';
  fpsLabel.dataset.capture = 'exclude';
  fpsLabel.title = '导出帧率：30 / 60 / 120；120 fps 只改善节奏，不能恢复超过 25 Hz 录制极限的运动';
  fpsLabel.append('帧率 ');
  const fpsSelect = document.createElement('select');
  fpsSelect.id = 'exportFps';
  fpsSelect.title = fpsLabel.title;
  for (const fps of EXPORT_FPS_CHOICES) {
    const option = document.createElement('option');
    option.value = String(fps);
    option.textContent = `${fps} fps`;
    fpsSelect.append(option);
  }
  fpsSelect.value = String(DEFAULT_EXPORT_FPS);
  fpsLabel.append(fpsSelect);
  exportFpsSelect = fpsSelect;
  const cancelVideo = document.createElement('button');
  cancelVideo.type = 'button';
  cancelVideo.textContent = '取消导出';
  cancelVideo.hidden = true;
  const videoNote = document.createElement('span');
  videoNote.id = 'exportNote';
  videoNote.className = 'small';
  videoButton.onclick = () => {
    void exportActiveVideo(videoButton, cancelVideo, videoNote);
  };
  rawButton.after(fpsLabel);
  fpsLabel.after(videoButton);
  videoButton.after(cancelVideo);
  cancelVideo.after(videoNote);
  drop.onclick = () => picker.click();
  drop.onkeydown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      picker.click();
    }
  };
  ['dragenter', 'dragover'].forEach((type) =>
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.add('drag');
    }),
  );
  ['dragleave', 'drop'].forEach((type) =>
    drop.addEventListener(type, (event) => {
      event.preventDefault();
      drop.classList.remove('drag');
    }),
  );
  drop.addEventListener('drop', (event) => {
    const files = [...(event.dataTransfer?.files ?? [])].filter((file) => /\.(?:csv|wav)$/i.test(file.name));
    void addFiles(files);
  });
  picker.onchange = () => {
    void addFiles([...(picker.files ?? [])]);
  };
  el<HTMLButtonElement>('bakeRoute').onclick = () => {
    void bakeActiveRoute();
  };
  playButton.onclick = () => {
    if (!activeTrack()) {
      return;
    }
    playing = !playing;
    playButton.textContent = playing ? 'Ⅱ' : '▶';
  };
  el('restart').onclick = () => {
    elapsed = 0;
    snapCamera = true;
    frameOnce();
  };
  el('back').onclick = () => {
    elapsed = Math.max(0, elapsed - 0.04);
    playing = false;
    snapCamera = true;
    frameOnce();
  };
  el('forward').onclick = () => {
    const track = activeTrack();
    if (track) {
      elapsed = Math.min(track.duration, elapsed + 0.04);
    }
    playing = false;
    snapCamera = true;
    frameOnce();
  };
  scrub.oninput = () => {
    elapsed = Number(scrub.value);
    playing = false;
    snapCamera = true;
    debug.seeks += 1;
    frameOnce();
  };
  el('follow').onclick = cycleCamera;
  el('resetView').onclick = () => {
    cockpitLook = null;
    navigation.setFreeMode(false);
    freeButton.textContent = '自由视角';
    cameraMode = 'chase-mid';
    camera.mode = cameraMode;
    camera.reset();
    chaseTransition = null;
    snapCamera = true;
    frameOnce();
  };
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'KeyV' || event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      return;
    }
    event.preventDefault();
    cycleCamera();
  });
  scrub.max = '0';
  window.addEventListener('beforeunload', () => {
    webAudio?.dispose();
    audioObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  });

  const weatherSlider = el<HTMLInputElement>('weatherSlider');
  const hourSlider = el<HTMLInputElement>('hourSlider');
  const followEnv = el<HTMLInputElement>('followEnv');
  weatherSlider.oninput = () => {
    hudWeather = Number(weatherSlider.value);
    followEnv.checked = false;
    frameOnce();
  };
  hourSlider.oninput = () => {
    hudHour = Number(hourSlider.value);
    followEnv.checked = false;
    frameOnce();
  };
  followEnv.onchange = () => {
    if (followEnv.checked) {
      hudWeather = null;
      hudHour = null;
    } else {
      // Freeze at the current effective environment, then let the sliders take over.
      hudWeather = Math.round(lastEnv.weather);
      hudHour = lastEnv.hour;
    }
    frameOnce();
  };

  el<HTMLInputElement>('axesToggle').onchange = (event) => {
    SHOW_AXES = (event.target as HTMLInputElement).checked;
    if (SHOW_AXES) ensureAxes();
    frameOnce();
  };
}

async function boot(): Promise<void> {
  const bootId = crypto.randomUUID();
  let bootStage = 'engine-init';
  let pakDownloads = 0;
  const report = async (payload: Record<string, unknown>): Promise<void> => {
    // Best-effort boot traceback: if the local server exposes /webgpu-report it records one line, which is
    // how a remote run is told apart from "the page never started".
    try {
      await fetch('/webgpu-report', {
        body: JSON.stringify({ bootId, source: 'flight-replay', stage: bootStage, ...payload }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
    } catch {
      /* no report route, or offline — not fatal */
    }
  };
  if (!('gpu' in navigator)) {
    setStatus('此浏览器不支持 WebGPU，无法使用 OpenSA 引擎回放。');
    void report({ phase: 'no-webgpu' });

    return;
  }
  engine = new Engine();
  try {
    await engine.init(canvas);
  } catch (error) {
    setStatus(
      `WebGPU 初始化失败：${error instanceof Error ? error.message : String(error)} 诊断页：/opensa/webgpu-check.html`,
    );
    mapLoading.hidden = true;
    void report({ error: error instanceof Error ? error.message : String(error), phase: 'engine-failed' });

    return;
  }
  void report({ phase: 'engine-ready' });
  // Diagnostics: which GPU, and a loud message if the device is reset (that is the "everything turns black"
  // failure that is NOT a data bug — the page keeps its DOM but the canvas stops presenting).
  try {
    const adapter = await navigator.gpu.requestAdapter();
    debug.gpu = adapter ? `${adapter.info?.vendor ?? '?'} ${adapter.info?.architecture ?? ''}`.trim() : 'none';
  } catch {
    debug.gpu = 'error';
  }
  engine.device.lost
    .then((info) => {
      debug.phase = 'device-lost';
      debug.error = `device-lost:${info.reason}`;
      void report({
        canvas: `${canvas.width}x${canvas.height}`,
        gpu: debug.gpu,
        loadedCells: pakWorld?.loadedCells ?? 0,
        pakDownloads,
        pakReady: pakWorld?.isReady ?? false,
        phase: 'device-lost',
        reason: info.reason,
        renders: debug.renders,
        uploadedArrays: pakWorld?.uploadedArrays ?? 0,
      });
      // The Intel Arc driver occasionally resets under load; that shows as a black canvas with the DOM
      // still alive. Recover automatically (once per minute) instead of leaving the user on a dead canvas.
      const key = 'gtasaGpuReloadAt';
      const last = Number(sessionStorage.getItem(key) ?? 0);
      if (Date.now() - last > 60000) {
        sessionStorage.setItem(key, String(Date.now()));
        setStatus(`GPU 设备丢失（${info.reason}），1 秒后自动重启渲染…`);
        window.setTimeout(() => location.reload(), 1000);
      } else {
        setStatus(`GPU 设备丢失（${info.reason}）且刚刚已重启过：请刷新页面，或用「启动回放-强制GPU.cmd」/换 Edge。`);
      }
    })
    .catch(() => {
      /* lost promise rejection is not actionable */
    });
  ensureAxes();
  ensureEndpointMarkers();
  engine.renderScale = 1;
  engine.environment.windStrength = 0;
  engine.waterEnabled = true;
  camera = new ReplayCamera();
  camera.mode = cameraMode;
  setStatus('正在读取预烘焙回放包…');
  // The pak holds both map cells and the two supported aircraft. No GTA install scan happens at replay time.
  bootStage = 'pak-check';
  if (!(await PakWorld.probe(MAP_PAK_BASE))) {
    mapLoading.hidden = false;
    mapLoadingText.textContent =
      '未找到预烘焙地图（/map-pak/index.json）。请先运行：cd tools\\opensa && npx tsx scripts\\bake-map.mts map-pak';
    setStatus('缺少预烘焙地图 pak，无法回放。请先烘焙（见 HANDOFF）。');
    void report({ phase: 'no-pak' });

    return;
  }
  bootStage = 'pak-resources';
  resources = await PakResources.load(MAP_PAK_BASE);
  // Live Web Audio synthesis (todo 18): decoding starts now (async, never awaited) and no AudioContext is
  // created until the first play, so the render loop is never blocked and no autoplay warning is logged.
  if (!VIDEO_EXPORT) {
    webAudio = new WebAudioReplay(resources);
  }
  flightEffects = setupFlightEffects(engine, resources.getFxpText(), resources.getFxTxdBytes());
  timecycText = resources.getText('data/timecyc.dat') ?? '';
  installWater(engine, resources.getText('data/water.dat'));
  const pak = new PakWorld(engine, MAP_PAK_BASE);
  mapLoading.hidden = false;
  mapLoadingText.textContent = '读取预烘焙地图索引…';
  bootStage = 'pak-textures';
  await pak.load((done, total) => {
    pakDownloads = done;
    mapLoadingText.textContent = `读取预烘焙纹理 ${done}/${total}…`;
  });
  debug.cells = pak.indexedCells;
  bootStage = 'render-loop';
  pakWorld = pak;
  debug.worldReady = true;
  for (const node of document.querySelectorAll<HTMLElement>('.raw-only')) {
    node.style.display = 'none';
  }
  setStatus(`预烘焙地图就绪：${pak.indexedCells} 个单元`);
  void report({ cells: pak.indexedCells, phase: 'world-indexed' });
  // No URL parameters required: with nothing loaded, pull the newest local recording automatically.
  if (plays.length === 0) {
    await loadLatest();
  }
  window.addEventListener('resize', resize);
  resize();
  loop();
  void report({ phase: 'loop-started' });
}

function cycleCamera(): void {
  cockpitLook = null;
  navigation.setFreeMode(false);
  const freeButton = document.getElementById('freeView');
  if (freeButton) freeButton.textContent = '自由视角';
  const previous = cameraMode;
  cameraMode = CAMERA_MODES[(CAMERA_MODES.indexOf(cameraMode) + 1) % CAMERA_MODES.length];
  camera.mode = cameraMode;
  const changingFamily = !isChaseMode(previous) || !isChaseMode(cameraMode);
  chaseTransition = !changingFamily && isChaseMode(previous) ? { from: previous, started: performance.now() } : null;
  if (changingFamily) camera.reset();
  snapCamera = changingFamily;
  frameOnce();
}

async function exportActiveVideo(
  button: HTMLButtonElement,
  cancel: HTMLButtonElement,
  note: HTMLElement,
): Promise<void> {
  const track = activeTrack();
  const csv = track && trackSources.get(track);
  if (!track || !csv) return;
  button.disabled = true;
  cancel.hidden = true;
  const fps = selectedExportFps();
  note.textContent = `准备导出（${fps} fps）…`;
  let jobId = '';
  try {
    const filename = trackFilenames.get(track);
    const view = cockpitLook
      ? { audioTuning: audioMixer?.get(track.model), cockpitLookPose: cockpitLook.pose, mode: 'cockpit-look' }
      : navigation.isFreeMode()
        ? {
            audioTuning: audioMixer?.get(track.model),
            mode: 'free',
            pitch: navigation.camera.pitch,
            position: navigation.camera.position,
            yaw: navigation.camera.yaw,
          }
        : { audioTuning: audioMixer?.get(track.model), mode: cameraMode };
    // The user wants the SYNTHESIZED engine audio in the export, never the recorded game WAV: the request asks
    // for `audioMode: 'synth'` and uploads no recorded track. The exporter fails loudly if synthesis is
    // unavailable rather than silently muxing the recording.
    const response = await fetch('/video-export', {
      body: JSON.stringify({
        audioMode: 'synth',
        csv,
        filename: filename && /^flight_[\w.-]+\.csv$/i.test(filename) ? filename : undefined,
        fps,
        pakBase: MAP_PAK_BASE,
        view,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) throw new Error(await exportRequestError(response, '导出请求失败'));
    jobId = ((await response.json()) as { id: string }).id;
    cancel.hidden = false;
    cancel.onclick = () => {
      void fetch(`/video-export/${jobId}/cancel`, { method: 'POST' });
    };
    await waitForExportJob(jobId, note);
  } catch (error) {
    note.textContent = error instanceof Error ? error.message : `导出失败：${String(error)}`;
  } finally {
    button.disabled = false;
    cancel.hidden = true;
  }
}

/** A failed HTTP response as a UI message: the server's own reason plus its status, never a bare code. */
async function exportRequestError(response: Response, prefix: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as null | { error?: string; message?: string };
  const detail = body?.error ?? body?.message;

  return detail ? `${prefix}：${detail}（HTTP ${response.status}）` : `${prefix}：HTTP ${response.status}`;
}

function loop(): void {
  requestAnimationFrame(loop);
  // Pak texture arrays upload a slice per frame (a single synchronous burst is what TDRs).
  if (pakWorld) {
    pakWorld.pumpCameraCollision(2);
    if (!pakWorld.isReady) {
      pakWorld.pump(1);
      mapLoading.hidden = false;
      mapLoadingText.textContent = '上传预烘焙纹理数组…';
    } else {
      mapLoading.hidden = true;
    }
  }
  // During a video export the frame stream is driven by `renderFrame` only: the loop keeps pumping texture
  // uploads but must not render, or a rAF frame would race the readback and use a wall-clock camera step.
  if (videoExportDriving) {
    lastFrame = performance.now();

    return;
  }
  const now = performance.now();
  const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
  const track = activeTrack();
  if (!track) {
    // Idle: keep the world drawing so the loading overlay can clear.
    if (engine && camera) {
      engine.frame(
        camera.state({
          aspect: canvas.width / Math.max(1, canvas.height),
          dt: 0.016,
          forward: [0, 0, -1],
          model: 520,
          modelLength,
          modelTop,
          position: [0, 40, 0],
          snap: false,
          up: [0, 1, 0],
          velocity: [0, 0, 0],
        }),
      );
      engine.updateVehicles();
    }
    lastFrame = now;

    return;
  }
  if (playing) {
    elapsed += dt * Number(el<HTMLSelectElement>('speed').value);
    // Frame-time spikes (the periodic streaming hitch) — measured only while playing.
    const frameMs = dt * 1000;
    if (frameMs > debug.maxFrameMs) {
      debug.maxFrameMs = frameMs;
    }
    if (frameMs > 30) {
      debug.slowFrames += 1;
    }
    if (elapsed >= track.duration) {
      elapsed = track.duration;
      playing = false;
      playButton.textContent = '▶';
    }
  }
  navigation.updateInput(dt);
  if (navigation.isFreeMode()) {
    const freeButton = el<HTMLButtonElement>('freeView');
    freeButton.textContent = cockpitLook ? '切到自由视角' : `退出自由视角（${navigation.input.speedLabel}）`;
  }
  el<HTMLButtonElement>('cockpitLook').textContent = cockpitLook
    ? `退出机舱观察（${navigation.input.speedLabel}）`
    : '机舱观察';
  update(track, false);
  lastFrame = now;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(2, Math.floor(canvas.clientWidth * dpr));
  canvas.height = Math.max(2, Math.floor(canvas.clientHeight * dpr));
}

/** The export rate the HUD is set to; exactly the backend's supported set, with the 30 fps default. */
function selectedExportFps(): number {
  const value = exportFpsSelect ? Number(exportFpsSelect.value) : DEFAULT_EXPORT_FPS;

  return EXPORT_FPS_CHOICES.includes(value) ? value : DEFAULT_EXPORT_FPS;
}

async function waitForExportJob(jobId: string, note: HTMLElement): Promise<void> {
  for (;;) {
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    const progress = await fetch(`/video-export/${jobId}`);
    if (!progress.ok) throw new Error(`导出状态不可用：HTTP ${progress.status}`);
    const job = (await progress.json()) as {
      audio: boolean;
      audioSource: null | string;
      downloadUrl: null | string;
      fps: number;
      message: string;
      progress: number;
      state: string;
    };
    // The rate in the line is the one the SERVER reports, so a selector that never reached the backend shows.
    note.textContent = `${job.message} · ${job.fps} fps · ${job.progress}%`;
    if (job.state === 'failed') throw new Error(`导出失败（${job.fps} fps）：${job.message}`);
    if (job.state === 'cancelled') throw new Error(`已取消导出（${job.fps} fps）`);
    if (job.state === 'ready' && job.downloadUrl) {
      const link = document.createElement('a');
      link.href = job.downloadUrl;
      const audioLabel = job.audio
        ? job.audioSource === 'synthesized'
          ? '（含合成音频）'
          : '（含录制音频）'
        : '（无音频）';
      link.textContent = `下载 MP4${audioLabel}`;
      link.style.color = 'var(--accent)';
      note.replaceChildren(link);
      break;
    }
  }
}

if (VIDEO_EXPORT) {
  (window as unknown as { __flightVideoExport: FlightVideoExportApi }).__flightVideoExport = {
    beginEncode(fps) {
      return beginExportEncode(fps);
    },
    encodeFrames(startFrame, count) {
      return encodeExportFrames(startFrame, count);
    },
    endEncode() {
      return finishExportEncode();
    },
    async ready() {
      await bootPromise;
      const track = activeTrack();
      if (!track || !engine || !pakWorld) throw new Error('回放或地图未就绪');
      const readyDeadline = performance.now() + 180_000;
      while (!pakWorld.isReady && performance.now() < readyDeadline) await nextFrame();
      if (!pakWorld.isReady) throw new Error('地图纹理上传超时');
      await ensureAircraft();
      if (!aircraft) throw new Error('飞机模型未就绪');
      if (
        exportView?.mode === 'free' &&
        exportView.position &&
        exportView.yaw !== undefined &&
        exportView.pitch !== undefined
      ) {
        navigation.camera.setPose({ pitch: exportView.pitch, position: exportView.position, yaw: exportView.yaw });
        navigation.setFreeMode(true);
      }
      if (exportView?.mode === 'cockpit-look' && exportView.cockpitLookPose) {
        cameraMode = 'cockpit';
        camera.mode = cameraMode;
        cockpitLook = new CockpitLookCamera(navigation.camera, exportView.cockpitLookPose);
        navigation.setFreeMode(true);
      }
      const deadline = performance.now() + 120_000;
      while (pakWorld.loadedCells === 0 && pakWorld.isLoading && performance.now() < deadline) await nextFrame();
      if (debug.error) throw new Error(debug.error);
      setupExportCompositor();
      videoExportDriving = true;

      return {
        compositor: {
          backend: 'browser-gpu-compositor',
          height: EXPORT_FRAME_HEIGHT,
          pixelFormat: EXPORT_PIXEL_FORMAT,
          visible: false,
          width: EXPORT_FRAME_WIDTH,
        },
        duration: track.duration,
      };
    },
    renderAudio() {
      return renderExportAudio();
    },
    renderFrame(seconds) {
      return renderExportFrame(seconds);
    },
  };
}

bindUi();
const bootPromise = boot();
void bootPromise.catch((error) => {
  setStatus(`启动失败：${error instanceof Error ? error.message : String(error)}`);
});
