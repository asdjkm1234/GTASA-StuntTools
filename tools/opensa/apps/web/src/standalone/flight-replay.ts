import { Engine } from '@opensa/engine';
import { createEngineEnvironmentDriver } from '@opensa/game/adapters/engine-environment-driver';
import { WEATHER_NAMES } from '@opensa/renderware/parsers/text/timecyc.parser';

import type { AircraftHandle } from '../flight/aircraft';
import type { FlightTrack } from '../flight/csv';

import { loadAircraft } from '../flight/aircraft';
import { type WebAudioListenerPose, WebAudioReplay } from '../flight/audio-engine-web';
import { aircraftVelocityAt, audioCameraCuts, cameraAudioListenerAt } from '../flight/audio-listener';
import { renderOfflineWav } from '../flight/audio-offline';
import { coreManifestFromPak, createOfflineSampleBank } from '../flight/audio-sample-bank';
import {
  browserMp4,
  BrowserVideoDownloads,
  CLIENT_AUDIO_BYTES,
  CLIENT_EXPORT_BYTES,
} from '../flight/browser-video-export';
import { type CameraMode, type CameraStateOut, ReplayCamera, saChaseFovY } from '../flight/camera';
import { ChaseCameraTimeline, type ChaseMode, isChaseMode } from '../flight/camera-track';
import { cockpitInstrumentState, type CockpitInstrumentState } from '../flight/cockpit-instrument-data';
import { CockpitLookCamera, type CockpitLookFrame, type CockpitLookPose } from '../flight/cockpit-look';
import { parseFlightCsv, sampleTrack } from '../flight/csv';
import { EndpointMarkers } from '../flight/endpoint-markers';
import { type MarkerProjection, pickEndpointMarker, projectMarkerEndpoints } from '../flight/endpoint-picking';
import {
  EXPLOSION_REPLAY_SECONDS,
  ExplosionAnimationClock,
  explosionExportDuration,
  prepareExplosionReplay,
} from '../flight/flight-explosion';
import {
  blendFlightHud,
  drawFlightInstrumentHud,
  FLIGHT_INSTRUMENT_HEIGHT,
  FLIGHT_INSTRUMENT_WIDTH,
  flightHudLayout,
  type FlightHudLayout,
} from '../flight/flight-instrument-hud';
import { FlightRoute } from '../flight/flight-route';
import { FreeCamera, type FreeCameraPose } from '../flight/free-camera';
import { type FlightEffects, setupFlightEffects } from '../flight/fx';
import { initializeMapPakCache, type MapCacheState, type MapPakCache } from '../flight/map-pak-cache';
import { gtaDirToEngine, gtaToEngine, rotateVec, type Vec3 } from '../flight/math';
import { PakResources } from '../flight/pak-resources';
import { PakWorld } from '../flight/pak-world';
import { visualPropellerMotion } from '../flight/propeller';
import { ReplayNavigation } from '../flight/replay-navigation';
import {
  flowingGameHour,
  formatGameHour,
  isReplayEnvironment,
  normalizeGameHour,
  type ReplayEnvironment,
  type ReplayTimeFlow,
} from '../flight/replay-time-flow';
import { RouteAutoplay } from '../flight/route-autoplay';
import { pickFlightRoute, type RoutePick } from '../flight/route-picking';
import { analyzeShortFlights } from '../flight/short-flights';
import { cropShotAudio } from '../flight/shot-audio';
import {
  captureExteriorShot,
  shotCameraState,
  type ShotKind,
  type ShotRange,
  type ShotView,
  validShotRange,
} from '../flight/shot-camera';
import { diagramSegmentsOverview, ShotCameraDiagram } from '../flight/shot-camera-diagram';
import { ShotPanel } from '../flight/shot-panel';
/**
 * GTASA flight replay — OpenSA renders the user's locally baked pak, driven by recorder CSV files.
 * `?local=latest` loads the newest local recording. The GTA install is needed to bake, not to replay.
 */
import { programLabel, programShotAt, type ShotProgram } from '../flight/shot-sequence';
import {
  drawSurfaceFeedback,
  FEEDBACK_HEIGHT,
  FEEDBACK_WIDTH,
  showSurfaceFeedback,
} from '../flight/surface-feedback-hud';
import { installWater } from '../flight/water';
import { setupRecorderGuide } from './recorder-guide';

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
  /** Active track position in the current import list. */
  activeTrackIndex: number;
  aircraft: string;
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
  controls: AircraftHandle['controls'] | null;
  controlsVisible: boolean;
  densityMax: number;
  envHud: string;
  error: null | string;
  explosionAge: null | number;
  explosionAnimating: boolean;
  /** Free-camera fly-to state (numeric, so a test asserts the tween itself, never a screenshot). */
  flyActive: boolean;
  flyProgress: number;
  gpu: string;
  hudExportLayout: FlightHudLayout | null;
  hudLayout: FlightHudLayout | null;
  instrumentState: CockpitInstrumentState | null;
  instrumentUploads: number;
  markerActiveTrackId: number;
  markerAnimationSeconds: null | number;
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
  markerVisible: boolean;
  maxFrameMs: number;
  maxUpStepDeg: number;
  parts: string;
  pedalMotion: NonNullable<AircraftHandle['pedals']>['state'];
  phase: string;
  renders: number;
  routeAutoplayPhase: string;
  routeAutoplayProgress: number;
  routePickedSeconds: null | number;
  routeSegments: FlightRoute['counts'];
  routeVisible: boolean;
  seatSource: string;
  seeks: number;
  shotDiagramActiveSegment: number;
  shotDiagramCamera: CameraStateOut | null;
  shotDiagramKind: null | ShotKind;
  shotDiagramSegments: { camera: CameraStateOut; end: number; index: number; seconds: number; start: number }[];
  shotDiagramVisible: boolean;
  skippedFrames: number;
  slowFrames: number;
  status: string;
  stickMotion: AircraftHandle['stickMotion'];
  worldReady: boolean;
}
const debug: FlightDebug = {
  activeTrackIndex: 0,
  aircraft: 'none',
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
  controls: null,
  controlsVisible: false,
  densityMax: 0,
  envHud: '',
  error: null,
  explosionAge: null,
  explosionAnimating: false,
  flyActive: false,
  flyProgress: 1,
  gpu: '',
  hudExportLayout: null,
  hudLayout: null,
  instrumentState: null,
  instrumentUploads: 0,
  markerActiveTrackId: -1,
  markerAnimationSeconds: null,
  markerCapacity: 0,
  markerCount: 0,
  markerHalos: 0,
  markerPickedTrackId: -1,
  markerPickRadius: MARKER_PICK_RADIUS_PX,
  markerRecreates: 0,
  markerScreenPositions: [],
  markerTrackIds: [],
  markerVisible: false,
  maxFrameMs: 0,
  maxUpStepDeg: 0,
  parts: '',
  pedalMotion: null,
  phase: 'boot',
  renders: 0,
  routeAutoplayPhase: 'idle',
  routeAutoplayProgress: 0,
  routePickedSeconds: null,
  routeSegments: { green: 0, red: 0, unknown: 0, yellow: 0 },
  routeVisible: false,
  seatSource: 'none',
  seeks: 0,
  shotDiagramActiveSegment: 0,
  shotDiagramCamera: null,
  shotDiagramKind: null,
  shotDiagramSegments: [],
  shotDiagramVisible: false,
  skippedFrames: 0,
  slowFrames: 0,
  status: '',
  stickMotion: null,
  worldReady: false,
};
/** Camera-up from the previous frame, for the jitter metric (`maxUpStepDeg`). */
let lastCameraUp: null | Vec3 = null;
(window as unknown as { __flight: FlightDebug }).__flight = debug;

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

/** Pick the 3D marker under a pointer and select its recording's endpoint. */
function pickMarkerAt(clientX: number, clientY: number, radiusPx = MARKER_PICK_RADIUS_PX): boolean {
  const cameraState = lastRenderedCameraState;
  if (!endpointMarkers || !cameraState || debug.cameraMode !== 'free') {
    return false;
  }
  // Project from the LIVE camera state every click — debug lines are not pickable, so this is the only test.
  const rect = canvas.getBoundingClientRect();
  const picked = pickEndpointMarker(
    projectMarkers(cameraState),
    clientX - rect.left,
    clientY - rect.top,
    radiusPx,
    debug.markerActiveTrackId,
  );
  debug.markerPickedTrackId = picked?.trackIndex ?? -1;
  if (!picked) {
    return false;
  }

  return navigation.focusTrack(picked.trackIndex);
}

/** Project the marker layer's own anchors with `cameraState`; empty until the layer exists. */
function projectMarkers(cameraState: CameraStateOut): MarkerProjection[] {
  const markers = endpointMarkers;
  if (!markers || debug.cameraMode !== 'free') {
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

function routeAtPointer(clientX: number, clientY: number): null | RoutePick {
  const cameraState = lastRenderedCameraState,
    track = activeTrack();
  if (!track || !cameraState || !debug.worldReady || debug.error || !debug.routeVisible || debug.cameraMode !== 'free')
    return null;
  const rect = canvas.getBoundingClientRect();

  return pickFlightRoute(track, cameraState, {
    currentSeconds: elapsed,
    height: rect.height,
    width: rect.width,
    x: clientX - rect.left,
    y: clientY - rect.top,
  });
}

function seekRoute(picked: RoutePick): void {
  cancelRouteTravel();
  const track = activeTrack();
  if (!track) return;
  elapsed = Math.max(0, Math.min(track.duration, picked.seconds));
  playing = false;
  playButton.textContent = '▶';
  explosionAnimation.reset();
  navigation.camera.cancelFlyTo();
  debug.routePickedSeconds = elapsed;
  debug.seeks += 1;
  frameOnce();
}

const params = new URLSearchParams(location.search);
const VIDEO_EXPORT = params.get('videoExport') === '1';
const controlsCanvas = document.createElement('canvas');
controlsCanvas.id = 'surface-feedback';
controlsCanvas.width = FEEDBACK_WIDTH;
controlsCanvas.height = FEEDBACK_HEIGHT;
controlsCanvas.hidden = true;
controlsCanvas.setAttribute('aria-label', '真实舵面反馈：机体方向的操纵杆和偏航踏板');
Object.assign(controlsCanvas.style, {
  height: `${FEEDBACK_HEIGHT}px`,
  pointerEvents: 'none',
  position: 'fixed',
  width: `${FEEDBACK_WIDTH}px`,
  zIndex: '4',
});
document.body.append(controlsCanvas);
const controlsContext = controlsCanvas.getContext('2d', { willReadFrequently: true })!;
const instrumentCanvas = document.createElement('canvas');
instrumentCanvas.id = 'flight-instruments';
instrumentCanvas.width = FLIGHT_INSTRUMENT_WIDTH;
instrumentCanvas.height = FLIGHT_INSTRUMENT_HEIGHT;
instrumentCanvas.hidden = true;
instrumentCanvas.setAttribute('aria-label', '飞行仪表：速度、姿态、海拔、航向、血量、舵面损伤、油门、喷口与起落架');
Object.assign(instrumentCanvas.style, { pointerEvents: 'none', position: 'fixed', zIndex: '4' });
document.body.append(instrumentCanvas);
const instrumentContext = instrumentCanvas.getContext('2d', { willReadFrequently: true })!;
const exportHudCanvas = document.createElement('canvas');
const exportHudContext = exportHudCanvas.getContext('2d', { willReadFrequently: true })!;
// Debug overrides for the environment: `?weather=N` and `?hour=H` ignore the recorded value (which is how a
// bad timecyc column for one weather is told apart from a bad frame).
const FORCE_WEATHER = params.has('weather') ? Number(params.get('weather')) : null;
const FORCE_HOUR = params.has('hour') ? Number(params.get('hour')) : null;

/** HUD environment overrides. `null` = follow the recorded value (the `跟随录制` checkbox). */
let hudWeather: null | number = null;
let hudHour: null | number = null;
let timeFlow: null | ReplayTimeFlow = null;
let lastEnv = { hour: 12, weather: 0 };
const isFollowingEnv = (): boolean => hudWeather === null && hudHour === null;

function formatHour(hour: number): string {
  return formatGameHour(hour);
}

/** Keep the sliders/labels in step with the effective environment (and follow the recording when asked). */
function syncEnvControls(hour: number, weather: number): void {
  const id = Math.max(0, Math.min(WEATHER_NAMES.length - 1, Math.round(weather)));
  el('weatherLabel').textContent = `${id} ${WEATHER_NAMES[id] ?? '?'}`;
  el('hourLabel').textContent = formatHour(hour);
  if (isFollowingEnv() || timeFlow) {
    const weatherSlider = el<HTMLInputElement>('weatherSlider');
    const hourSlider = el<HTMLInputElement>('hourSlider');
    if (document.activeElement !== weatherSlider) weatherSlider.value = String(id);
    if (document.activeElement !== hourSlider) hourSlider.value = String(Math.round(hour * 4) / 4);
  }
}

const canvas = el<HTMLCanvasElement>('canvas');
const clock = el<HTMLSpanElement>('clock');
const scrub = el<HTMLInputElement>('scrub');
const playButton = el<HTMLButtonElement>('play');

const tracksEl = el<HTMLDivElement>('tracks');
const mapLoading = el<HTMLDivElement>('mapLoading');
const mapLoadingText = el<HTMLSpanElement>('mapLoadingText');
const modeChip = el<HTMLElement>('mode');
const segmentChip = el<HTMLElement>('segment');

const plays: FlightTrack[] = [];
const trackSources = new WeakMap<FlightTrack, string>();
const trackFilenames = new WeakMap<FlightTrack, string>();
let audioMuted = false;
let webAudio: null | WebAudioReplay = null;
const removalHistory: { index: number; track: FlightTrack }[][] = [];
let importQueue: Promise<void> = Promise.resolve();
// SA-MP 0.3.7-R5's connecting-screen camera, confirmed in the local samp.dll.
// https://github.com/4x11/build69/blob/master/jni/net/netgame.cpp
const startupEye = gtaToEngine(1093, -2036, 90);
const startupTarget = gtaToEngine(384, -1557, 20);
const navigation = new ReplayNavigation({
  camera: {
    focusDistance: Math.hypot(...startupTarget.map((value, axis) => value - startupEye[axis])),
    fovYDeg: (saChaseFovY(4 / 3, 4 / 3) * 180) / Math.PI,
    position: startupEye,
  },
  onEndpointFocus: (endpoint) => {
    debug.routePickedSeconds = null;
    explosionAnimation.reset();
    cockpitLook = null;
    if (endpoint.trackIndex !== active && timeFlow) timeFlow = { hour: lastEnv.hour, seconds: endpoint.time };
    active = endpoint.trackIndex;
    debug.activeTrackIndex = active;
    elapsed = endpoint.time;
    playing = false;
    playButton.textContent = '▶';
    navigation.setTrack(endpoint.track);
    endpointMarkers?.setActive(active);
    renderTrackList();
    void ensureAircraft();
    frameOnce();
  },
});
navigation.camera.lookAt(startupTarget);
// Diagnostic exports retain their existing default follow camera and explicit exportView handling.
navigation.setFreeMode(!VIDEO_EXPORT);
let guideInputEnabled = false;
setupRecorderGuide((open) => {
  if (open) {
    guideInputEnabled = navigation.input.enabled;
    navigation.input.setEnabled(false);
  } else {
    navigation.input.setEnabled(guideInputEnabled);
  }
});
let active = 0;
let playing = false;
let elapsed = 0;
let lastFrame = performance.now();
const routeAutoplay = new RouteAutoplay();
let routeTravelController: AbortController | null = null;
let routeDestinationCamera: CameraStateOut | null = null;
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
let lastCockpitFrame: CockpitLookFrame | null = null;
interface ExportView {
  cockpitLookPose?: CockpitLookPose;
  environment?: ReplayEnvironment;
  fovYDeg?: number;
  mode: 'cockpit-look' | 'free' | 'shot' | CameraMode;
  pitch?: number;
  position?: Vec3;
  routeVisible?: boolean;
  shot?: ShotProgram;
  yaw?: number;
}
let exportView: ExportView | null = null;
if (VIDEO_EXPORT && params.has('exportView')) {
  try {
    const view = JSON.parse(params.get('exportView') ?? '') as ExportView;
    if (
      view &&
      (view.mode === 'shot' || view.mode === 'free' || view.mode === 'cockpit-look' || CAMERA_MODES.includes(view.mode))
    ) {
      exportView = view;
      if (view.mode === 'cockpit-look') cameraMode = 'cockpit';
      else if (view.mode !== 'free' && view.mode !== 'shot') cameraMode = view.mode;
    }
  } catch {
    /* malformed export view falls back to chase camera */
  }
}
let exportRange: null | ShotRange = null;
if (VIDEO_EXPORT && params.has('exportRange')) {
  try {
    exportRange = JSON.parse(params.get('exportRange')!) as ShotRange;
  } catch {
    /* ready reports the invalid range */
  }
}
let shotPanel: null | ShotPanel = null;
let activeShot: null | ShotProgram = null;
let shotDiagram: null | ShotCameraDiagram = null;
let diagramCameraState: CameraStateOut | null = null;
let exportUiBusy = false;
let clientExportSignal: AbortSignal | null = null;
const clientDownloads = new BrowserVideoDownloads();
let shotPreview: null | {
  end?: number;
  saved: {
    cockpit: CockpitLookPose | null;
    focusDistance: number;
    free: boolean;
    mode: CameraMode;
    playing: boolean;
    pose: FreeCameraPose;
    seconds: number;
  };
  track: FlightTrack;
} = null;

function stopShotPreview(): void {
  if (!shotPreview) return;
  const { saved, track } = shotPreview;
  shotPreview = null;
  shotPanel?.setPreview(null);
  activeShot = null;
  navigation.camera.setPose(saved.pose);
  navigation.camera.focusDistance = saved.focusDistance;
  navigation.setFreeMode(saved.free);
  cameraMode = saved.mode;
  camera.mode = cameraMode;
  cockpitLook = saved.cockpit ? new CockpitLookCamera(navigation.camera, saved.cockpit) : null;
  if (activeTrack() === track) {
    elapsed = saved.seconds;
    playing = saved.playing;
  }
  playButton.textContent = playing ? 'Ⅱ' : '▶';
  camera.reset();
  snapCamera = true;
  explosionAnimation.reset();
  frameOnce();
}

let resolvedShot: null | ShotView = null;
function applyResolvedShot(view: ShotView): void {
  resolvedShot = view;
  cockpitLook = null;
  chaseTransition = null;
  navigation.camera.cancelFlyTo();
  if (view.kind === 'cockpit') {
    cameraMode = 'cockpit';
    camera.mode = cameraMode;
    navigation.camera.fovYDeg = view.fovYDeg;
    cockpitLook = new CockpitLookCamera(navigation.camera, view.cockpitLookPose);
    navigation.setFreeMode(true);
  } else {
    cameraMode = 'chase-mid';
    camera.mode = cameraMode;
    navigation.setFreeMode(false);
  }
  navigation.input.setEnabled(false);
  camera.reset();
  snapCamera = true;
}
function applyShot(program: ShotProgram): void {
  activeShot = program;
  applyResolvedShot(programShotAt(program, elapsed));
}
function captureShot(kind: ShotKind): ShotView {
  const track = activeTrack();
  if (!track || !lastRenderedCameraState || shotPreview) throw new Error('请先结束预览，再布置并保存机位。');
  if (kind === 'cockpit') {
    if (!cockpitLook) throw new Error('请先点座舱镜头的“布置”，调整舱内视角后再保存。');

    return { cockpitLookPose: cockpitLook.pose, fovYDeg: navigation.camera.fovYDeg, kind };
  }
  if (!navigation.isFreeMode() || cockpitLook) throw new Error('请先点此镜头的“布置”，在自由视角中调整机位后再保存。');

  return captureExteriorShot(kind, lastRenderedCameraState, track, elapsed);
}

function currentShot(): null | ShotView {
  return activeShot ? programShotAt(activeShot, elapsed) : null;
}

function inspectShotDiagram(): void {
  if (!activeTrack() || !debug.worldReady || debug.error) return;
  cancelRouteTravel();
  stopShotPreview();
  playing = false;
  playButton.textContent = '▶';
  activeShot = null;
  cockpitLook = null;
  cameraMode = 'chase-mid';
  camera.mode = cameraMode;
  navigation.setFreeMode(true);
  frameOnce();
  if (!diagramCameraState) return;
  const observer = diagramSegmentsOverview(diagramCameraState, shotDiagram?.segments ?? []);
  navigation.camera.setPose({ fovYDeg: 60, position: observer.eye });
  navigation.camera.lookAt(observer.target);
  navigation.camera.focusDistance = Math.hypot(...observer.eye.map((n, i) => n - observer.target[i]));
  frameOnce();
}

function placeShot(view: ShotView): void {
  const track = activeTrack();
  if (!track || !debug.worldReady || debug.error) return;
  stopShotPreview();
  activeShot = null;
  playing = false;
  navigation.camera.fovYDeg = view.fovYDeg;
  if (view.kind === 'cockpit') {
    cameraMode = 'cockpit';
    camera.mode = cameraMode;
    cockpitLook = new CockpitLookCamera(navigation.camera, view.cockpitLookPose);
  } else {
    cockpitLook = null;
    cameraMode = 'chase-mid';
    camera.mode = cameraMode;
    const state = shotCameraState(view, track, elapsed, canvas.width / Math.max(1, canvas.height))!;
    navigation.camera.setPose({ fovYDeg: (state.fovYRad * 180) / Math.PI, position: state.eye });
    navigation.camera.lookAt(state.target);
  }
  navigation.setFreeMode(true);
  navigation.camera.cancelFlyTo();
  snapCamera = true;
  frameOnce();
}

function prepareShotSelection(): void {
  cancelRouteTravel();
  if (!debug.worldReady || debug.error) return;
  stopShotPreview();
  if (!navigation.isFreeMode() || cockpitLook) {
    if (lastRenderedCameraState) {
      navigation.camera.setPose({
        fovYDeg: (lastRenderedCameraState.fovYRad * 180) / Math.PI,
        position: [...lastRenderedCameraState.eye],
      });
      navigation.camera.lookAt(lastRenderedCameraState.target);
    }
    cockpitLook = null;
    if (cameraMode === 'first-person') {
      cameraMode = 'chase-mid';
      camera.mode = cameraMode;
    }
    navigation.setFreeMode(true);
  }
  routeEnabled = true;
  el('flightRoute').textContent = '路线动线：开';
  el('flightRoute').setAttribute('aria-pressed', 'true');
  frameOnce();
}

function previewShot(view: ShotProgram, seconds: number, end?: number): void {
  cancelRouteTravel();
  const track = activeTrack();
  if (!track || !debug.worldReady || debug.error) return;
  if (!shotPreview)
    shotPreview = {
      saved: {
        cockpit: cockpitLook?.pose ?? null,
        focusDistance: navigation.camera.focusDistance,
        free: navigation.isFreeMode(),
        mode: cameraMode,
        playing,
        pose: navigation.camera.pose,
        seconds: elapsed,
      },
      track,
    };
  shotPreview.end = end;
  elapsed = seconds;
  playing = end !== undefined;
  playButton.textContent = playing ? 'Ⅱ' : '▶';
  shotPanel?.setPreview(view.kind);
  explosionAnimation.reset();
  applyShot(view);
  frameOnce();
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

/** Sample the saved observer without mutating the editor, GPU scene or clock per PCM sample. */
function exportAudioListener(track: FlightTrack, duration: number) {
  const view = exportView;
  const freeState = navigation.camera.state(16 / 9);
  const anchorPose = sampleTrack(track, elapsed);
  const anchorPos = gtaToEngine(...anchorPose.pos);
  const anchorAxes = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ].map((v) => rotateVec(anchorPose.orientation, v as Vec3));
  const cockpitTemplate = lastCockpitFrame;
  const localEye = cockpitTemplate
    ? anchorAxes.map((axis) => axis.reduce((sum, n, i) => sum + n * (cockpitTemplate.eye[i] - anchorPos[i]), 0))
    : null;
  const chase = new ChaseCameraTimeline(track, modelLength, modelTop);
  const mode = cameraMode;
  const cameraAt = (seconds: number): CameraStateOut => {
    const at = Math.min(track.duration, seconds);
    const shot = view?.shot ? programShotAt(view.shot, at) : null;
    if (shot && shot.kind !== 'cockpit') return shotCameraState(shot, track, at, 16 / 9)!;
    if (!shot && (view?.mode === 'free' || (!view && navigation.isFreeMode() && !cockpitLook))) return freeState;
    const pose = sampleTrack(track, at),
      position = gtaToEngine(...pose.pos);
    const forward = rotateVec(pose.orientation, [0, 1, 0]),
      right = rotateVec(pose.orientation, [1, 0, 0]);
    const up = rotateVec(pose.orientation, [0, 0, 1]);
    const eye = localEye
      ? (position.map((n, i) => n + right[i] * localEye[0] + forward[i] * localEye[1] + up[i] * localEye[2]) as Vec3)
      : undefined;
    const lookPose = shot?.kind === 'cockpit' ? shot.cockpitLookPose : (view?.cockpitLookPose ?? cockpitLook?.pose);
    if (lookPose && eye && cockpitTemplate) {
      const input = new FreeCamera({ fovYDeg: shot?.fovYDeg ?? view?.fovYDeg ?? navigation.camera.fovYDeg });

      return new CockpitLookCamera(input, lookPose).state({
        ...cockpitTemplate,
        aspect: 16 / 9,
        eye,
        forward,
        right,
        up,
      });
    }
    if (isChaseMode(mode))
      return chase.state(at, mode, 16 / 9, window.screen.width / Math.max(1, window.screen.height));
    const replay = new ReplayCamera();
    replay.mode = mode;
    const pitch = mode === 'cockpit' && track.model === 520 ? HYDRA_COCKPIT_PITCH : 0;
    const firstPersonPosition = seatLocal
      ? (position.map(
          (n, i) => n + right[i] * seatLocal![0] + forward[i] * seatLocal![1] + up[i] * seatLocal![2],
        ) as Vec3)
      : undefined;

    return replay.state({
      aspect: 16 / 9,
      cockpitPosition: eye,
      dt: 0.01,
      firstPersonPosition,
      forward: forward.map((n, i) => n * Math.cos(pitch) + up[i] * Math.sin(pitch)) as Vec3,
      model: track.model,
      modelLength,
      modelTop,
      position,
      snap: true,
      up: up.map((n, i) => n * Math.cos(pitch) - forward[i] * Math.sin(pitch)) as Vec3,
      velocity: gtaDirToEngine(pose.velocity),
    });
  };

  return cameraAudioListenerAt(duration, cameraAt, audioCameraCuts(view?.shot));
}

async function prepareExportScene(track: FlightTrack): Promise<void> {
  // Establish the exact requested capture-time camera and its streaming ring. The preliminary render
  // is discarded; only the redraw after ALL wanted cells and camera colliders settle is read back.
  const beforeStream = pakWorld?.sceneRevision;
  update(track, true);
  await pakWorld?.waitForExport(30_000, clientExportSignal ?? undefined);
  if (pakWorld?.sceneRevision !== beforeStream) update(track, true);
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
 * half of the export audio bridge: the exporter asks for it and muxes the synthesized track.
 * Each saved observer gets its own deterministic capture-time mix from the track and pak samples.
 * A missing audio lane or a malformed sample throws (loudly) rather
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
  await ensureAircraft();
  update(track, true);
  const duration = exportRange?.end ?? explosionExportDuration(track);
  const listenerAt = exportAudioListener(track, duration);
  const result = renderOfflineWav(track, coreManifestFromPak(pakManifest), bank, {
    duration,
    listenerAt,
  });

  if (!exportRange) return result.wav;

  return cropShotAudio(result, exportRange);
}

/** One composited RAW frame for `seconds`, returned as RGBA bytes (the explicit fallback path). */
async function renderExportFrame(seconds: number): Promise<Uint8Array> {
  return renderExportPixels(seconds + (exportRange?.start ?? 0));
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
  exportParticleSeconds = Math.max(0, Math.min(explosionExportDuration(track), seconds));
  playing = false;
  elapsed = time;
  snapCamera = true;
  exportClockMs = time * 1000;
  await prepareExportScene(track);
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

  debug.hudExportLayout = null;
  if (debug.controlsVisible) {
    // Export uses output dimensions and no transport reserve, independent of the live window size/DPR.
    const layout = flightHudLayout(EXPORT_FRAME_WIDTH, EXPORT_FRAME_HEIGHT);
    debug.hudExportLayout = layout;
    exportHudCanvas.width = Math.ceil(layout.width);
    exportHudCanvas.height = Math.ceil(layout.height);
    exportHudContext.drawImage(instrumentCanvas, 0, 0, layout.instruments.width, layout.height);
    exportHudContext.drawImage(
      controlsCanvas,
      layout.controls.left - layout.left,
      0,
      layout.controls.width,
      layout.height,
    );
    blendFlightHud(
      pixels,
      EXPORT_FRAME_WIDTH,
      EXPORT_FRAME_HEIGHT,
      exportHudContext.getImageData(0, 0, exportHudCanvas.width, exportHudCanvas.height),
      layout.left,
      layout.top,
    );
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
    const pixels = await renderExportPixels(frameIndex / state.fps + (exportRange?.start ?? 0));
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
let aircraftLoadEpoch = 0;
let aircraftLoading = false;
/** Part index of the cockpit/canopy, used only when the pilot seat dummy is absent. */
const COCKPIT_EYE_AFT = 0.2;
const HYDRA_COCKPIT_EYE_AFT = 0.06;
const HYDRA_COCKPIT_EYE_DOWN = 0.07;
const HYDRA_COCKPIT_PITCH = (-8 * Math.PI) / 180;
let cockpitPart = -1;
let seatLocal: null | Vec3 = null;
let modelLength = 14;
let modelTop = 3;
let snapCamera = true;
let lastWeather = -1;
let envDriver: null | ReturnType<typeof createEngineEnvironmentDriver> = null;
let engine: Engine;
let flightEffects: FlightEffects | null = null;
let flightRoute: FlightRoute | null = null;
let routeEnabled = exportView?.routeVisible === true;
const explosionAnimation = new ExplosionAnimationClock();
let exportParticleSeconds = 0;
/** Compact spherical endpoint markers, with one density halo per local group; free view only. */
let endpointMarkers: EndpointMarkers | null = null;
/** Route A only: the world streams from a locally baked pak (no welding, no texture-array growth). */
let pakWorld: null | PakWorld = null;
let mapCache: MapPakCache | null = null;
function updateMapCache(state: MapCacheState): void {
  Object.assign(debug, { mapCache: state });
  const panel = el('mapCache');
  panel.hidden = false;
  const percent = state.bytes ? Math.floor((state.savedBytes * 100) / state.bytes) : 0;
  const size = `${Math.round(state.savedBytes / 1048576)} / ${Math.round(state.bytes / 1048576)} MiB`;
  const message =
    state.phase === 'ready'
      ? `地图已保存在此浏览器 · ${size}，下次直接使用`
      : state.phase === 'unavailable'
        ? '当前无法保存地图缓存，仍可按需回放'
        : state.phase === 'limited'
          ? `本机存储空间不足，已保存 ${percent}% · ${size}`
          : state.phase === 'interrupted'
            ? `保存中断，可继续下载 · ${percent}% · ${size}`
            : `${state.phase === 'saving' ? '正在后台保存地图' : '地图缓存'} ${percent}% · ${size}`;
  setText(el('mapCacheText'), message);
  const pause = el<HTMLButtonElement>('mapCachePause');
  pause.hidden = state.phase === 'ready' || state.phase === 'unavailable' || state.phase === 'limited';
  setText(pause, state.phase === 'saving' ? '暂停保存' : '继续保存');
  el('mapCacheClear').hidden = state.phase === 'unavailable';
}
el('mapCachePause').onclick = () => {
  if (mapCache?.state.phase === 'saving') mapCache.pause();
  else mapCache?.resume();
};
el('mapCacheClear').onclick = () => {
  void mapCache?.clear().catch(() => setText(el('mapCacheText'), '缓存暂时无法清理，请稍后重试。'));
};
window.addEventListener('online', () => {
  if (mapCache?.state.phase === 'interrupted') mapCache.resume();
});
const MAP_PAK_BASE = '/map-pak';
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

function addFiles(files: File[]): Promise<void> {
  importQueue = importQueue
    .then(() => importFiles(files))
    .catch((error) => {
      setText(el('trackNotice'), `导入失败：${error instanceof Error ? error.message : String(error)}`);
    });

  return importQueue;
}

/** Apply recorded/manual settings or the capture-time clock, never the PC clock. */
function applyEnvironment(
  row: null | { gameHour: null | number; gameMinute: null | number; weatherNew: null | number },
): void {
  const recordedHour =
    row?.gameHour !== null && row?.gameHour !== undefined ? row.gameHour + (row.gameMinute ?? 0) / 60 : 12;
  const recordedWeather = row?.weatherNew ?? 0;
  const hour = timeFlow ? flowingGameHour(timeFlow, elapsed) : (hudHour ?? FORCE_HOUR ?? recordedHour);
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

async function beginRouteTravel(): Promise<void> {
  const next = plays[active + 1],
    previous = activeTrack();
  if (!previous || !next || !pakWorld || !lastRenderedCameraState) {
    cancelRouteTravel();

    return;
  }
  const controller = new AbortController();
  routeTravelController = controller;
  const free = navigation.isFreeMode() && !cockpitLook;
  const cockpitPose = cockpitLook?.pose ?? null;
  const mode = cameraMode;
  const from = structuredClone(lastRenderedCameraState);
  navigation.camera.cancelFlyTo();
  const end = previous.rows[previous.rows.length - 1].pos;
  const delta = gtaToEngine(...next.rows[0].pos).map((n, i) => n - gtaToEngine(...end)[i]);
  pakWorld.retainForTravel(true);
  playing = false;
  selectTrack(active + 1, true);
  cameraMode = mode;
  camera.mode = mode;
  if (free) {
    navigation.camera.setPose({ position: from.eye.map((n, i) => n + delta[i]) as Vec3 });
    navigation.camera.lookAt(from.target.map((n, i) => n + delta[i]) as Vec3);
    navigation.setFreeMode(true);
  } else if (cockpitPose) {
    cockpitLook = new CockpitLookCamera(navigation.camera, cockpitPose);
    navigation.setFreeMode(true);
  }
  try {
    await ensureAircraft();
    const deadline = performance.now() + 30_000;
    while (aircraftLoading && performance.now() < deadline) {
      controller.signal.throwIfAborted();
      await nextFrame();
    }
    controller.signal.throwIfAborted();
    if (activeTrack() !== next || !aircraft) throw new Error('下一条路线的飞机未就绪');
    update(next, true);
    await pakWorld.waitForExport(30_000, controller.signal);
    controller.signal.throwIfAborted();
    update(next, true);
    if (!routeDestinationCamera) throw new Error('下一条路线的相机未就绪');
    routeAutoplay.travel(routeDestinationCamera, performance.now());
  } catch (error) {
    if (!controller.signal.aborted) {
      cancelRouteTravel();
      setText(el('routeAutoplayStatus'), `连播停止：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function cancelRouteTravel(): void {
  const moving = routeAutoplay.phase === 'moving';
  routeTravelController?.abort();
  routeTravelController = null;
  routeAutoplay.cancel();
  routeDestinationCamera = null;
  pakWorld?.retainForTravel(false);
  if (moving && lastRenderedCameraState) {
    const state = lastRenderedCameraState;
    navigation.camera.setPose({ fovYDeg: (state.fovYRad * 180) / Math.PI, position: state.eye });
    navigation.camera.lookAt(state.target);
    cockpitLook = null;
    navigation.setFreeMode(true);
    playing = false;
    playButton.textContent = '▶';
  }
}

function clearActiveReplay(): void {
  stopShotPreview();
  shotPanel?.sync(null);
  activeShot = null;
  playing = false;
  elapsed = 0;
  active = -1;
  debug.activeTrackIndex = -1;
  playButton.textContent = '▶';
  webAudio?.detachTrack();
  navigation.setTrack(null);
  navigation.camera.cancelFlyTo();
  cockpitLook = null;
  explosionAnimation.reset();
  aircraftLoadEpoch++;
  aircraftLoading = false;
  aircraft?.dispose();
  aircraft = null;
  aircraftModel = -1;
  instrumentTrack = null;
  chaseTrack = null;
  chaseTimeline = null;
  lastAppliedTrack = null;
  lastRenderedTrack = null;
  lastRenderedAircraft = null;
  flightRoute?.dispose();
  flightRoute = null;
  shotDiagram?.dispose();
  shotDiagram = null;
  diagramCameraState = null;
  debug.shotDiagramVisible = false;
  debug.shotDiagramCamera = null;
  debug.shotDiagramKind = null;
  debug.shotDiagramSegments = [];
  debug.shotDiagramActiveSegment = 0;
  debug.routeVisible = false;
  debug.routePickedSeconds = null;
  debug.routeSegments = { green: 0, red: 0, unknown: 0, yellow: 0 };
  debug.markerVisible = false;
  debug.markerPickedTrackId = -1;
  debug.markerScreenPositions = [];
  debug.explosionAge = null;
  debug.explosionAnimating = false;
  debug.controls = null;
  debug.instrumentState = null;
  debug.audioWebPlaying = false;
  if (debug.worldReady && !debug.error) {
    engine.clearParticles();
    engine.updateVehicles();
  }
  updateScreenFlightHud();
  el('flightRoute').hidden = true;
  el('flightRouteLegend').hidden = true;
  scrub.max = '0';
  scrub.value = '0';
  setText(clock, `${fmt(0)} / ${fmt(0)}`);
  setText(segmentChip, '—');
  setText(modeChip, '等待文件');
  setStatus('没有已导入记录，可导入文件或撤销移除。');
  renderTrackList();
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
  if (!debug.worldReady || debug.error) return;
  const track = activeTrack();
  if (!track) {
    return;
  }
  if (aircraftModel === track.model && (aircraft || aircraftLoading)) {
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
  const epoch = ++aircraftLoadEpoch;
  aircraftLoading = true;
  try {
    const loaded = await loadAircraft(engine, resources, track.model);
    // Deleting the last recording or switching models can happen while its assets are being loaded.
    if (epoch !== aircraftLoadEpoch || activeTrack()?.model !== track.model) {
      loaded.dispose();

      return;
    }
    aircraft = loaded;
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
    if (epoch !== aircraftLoadEpoch) return;
    debug.aircraft = `failed: ${error instanceof Error ? error.message : String(error)}`;
    setStatus(`原版飞机加载失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (epoch === aircraftLoadEpoch) aircraftLoading = false;
  }
}

function filterImportedShortFlights(): void {
  const analysis = analyzeShortFlights(plays);
  if (analysis.thresholdFrames === null) {
    setText(el('trackNotice'), '至少需要 3 条有效记录才能比较帧数。');

    return;
  }
  const message = `过滤 ${analysis.removed.length} 条；中位数 ${formatFrames(analysis.medianFrames)} 帧，少于 ${formatFrames(analysis.thresholdFrames)} 帧剔除。`;
  if (analysis.removed.length) removeImportedTracks(new Set(analysis.removed), message);
  else setText(el('trackNotice'), message);
}

function fmt(s: number): string {
  const safe = Number.isFinite(s) ? Math.max(0, s) : 0;

  const milliseconds = Math.round(safe * 1000);

  return `${String(Math.floor(milliseconds / 60000)).padStart(2, '0')}:${String(Math.floor((milliseconds % 60000) / 1000)).padStart(2, '0')}.${String(milliseconds % 1000).padStart(3, '0')}`;
}

function formatFrames(frames: null | number): string {
  return frames === null ? '未知' : frames.toLocaleString('zh-CN', { maximumFractionDigits: 1 });
}

function frameOnce(): void {
  if (!debug.worldReady || !pakWorld?.isReady || debug.error) return;
  const track = activeTrack();
  if (track) {
    update(track, snapCamera);
  } else {
    renderIdleWorld(true);
  }
}

async function importFiles(files: File[]): Promise<void> {
  const csvFiles = files.filter((file) => /\.csv$/i.test(file.name));
  const imported: FlightTrack[] = [];
  const failures: string[] = [];
  for (const file of csvFiles) {
    try {
      const csv = await file.text();
      const track = prepareExplosionReplay(parseFlightCsv(csv, file.name));
      trackSources.set(track, csv);
      trackFilenames.set(track, file.name);
      imported.push(track);
    } catch (error) {
      failures.push(`${file.name}：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const previous = activeTrack();
  plays.push(...imported);
  if (previous) active = plays.indexOf(previous);
  const analysis = el<HTMLInputElement>('autoFilterShort').checked ? analyzeShortFlights(imported) : null;
  const removed = new Set(analysis?.removed ?? []);
  if (removed.size) removeImportedTracks(removed, '');
  const kept = imported.filter((track) => !removed.has(track));
  syncImportedTracks();
  const latest = kept[kept.length - 1];
  if (latest) {
    selectTrack(plays.indexOf(latest));
    // Explicit CSV import brings the newly selected aircraft into view.
    // Startup auto-loading and failed CSV imports retain their camera.
    navigation.setFreeMode(false);
    cameraMode = 'chase-mid';
    if (camera) {
      camera.mode = cameraMode;
      camera.reset();
    }
    setText(el('freeView'), '自由视角');
  }
  const notice = imported.length
    ? `已导入 ${kept.length}/${imported.length} 条。` +
      (analysis?.thresholdFrames !== null && analysis?.thresholdFrames !== undefined
        ? `过滤 ${removed.size} 条；中位数 ${formatFrames(analysis.medianFrames)} 帧，少于 ${formatFrames(analysis.thresholdFrames)} 帧剔除。`
        : el<HTMLInputElement>('autoFilterShort').checked
          ? '不足 3 条有效记录，保留全部。'
          : '自动过滤已关闭。')
    : '';
  setText(
    el('trackNotice'),
    notice + (failures.length ? `导入失败 ${failures.length} 条：${failures.join('；')}` : ''),
  );
  frameOnce();
}

async function loadLatest(): Promise<void> {
  try {
    const recording = params.get('recording') ?? '/local-recording/latest.csv';
    const response = await fetch(recording);
    if (!response.ok) {
      throw new Error('没有找到本地录制文件');
    }
    const csv = await response.text();
    const track = prepareExplosionReplay(
      parseFlightCsv(csv, recording === '/local-recording/latest.csv' ? '最新本地记录.csv' : '指定录像.csv'),
    );
    trackSources.set(track, csv);
    const originalName = response.headers.get('X-Recording-Name');
    if (originalName) trackFilenames.set(track, originalName);
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
function publishAudioStats(): void {
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
  }
}

/** Session-only removal: keep original track/CSV associations and insertion slots for undo. */
function removeImportedTracks(removing: ReadonlySet<FlightTrack>, message: string): void {
  cancelRouteTravel();
  const previous = activeTrack();
  const previousIndex = active;
  const entries = plays.flatMap((track, index) => (removing.has(track) ? [{ index, track }] : []));
  if (!entries.length) return;
  removalHistory.push(entries);
  for (const entry of [...entries].reverse()) plays.splice(entry.index, 1);
  active = previous ? plays.indexOf(previous) : -1;
  if (active < 0) active = Math.min(Math.max(0, previousIndex), plays.length - 1);
  syncImportedTracks();
  if (!plays.length) {
    clearActiveReplay();
  } else if (previous && !removing.has(previous)) {
    frameOnce();
  } else {
    playing = false;
    playButton.textContent = '▶';
    selectTrack(active);
  }
  setText(el('trackNotice'), message);
}

/** Draw and stream the startup overview even when no local CSV exists. */
function renderIdleWorld(force = false): void {
  try {
    applyEnvironment(null);
    const aspect = canvas.width / Math.max(1, canvas.height);
    const state = navigation.cameraState(aspect) ?? lastRenderedCameraState ?? navigation.camera.state(aspect);
    pakWorld?.update(state.eye[0], -state.eye[2], pakWorld.renderRadius.hd, pakWorld.renderRadius.lod);
    lastRenderedCameraState = { ...state, aspect };
    debug.cameraState = lastRenderedCameraState;
    debug.cameraMode = navigation.isFreeMode() ? 'free' : cameraMode;
    setText(el('freeView'), navigation.isFreeMode() ? `退出自由视角（${navigation.input.speedLabel}）` : '自由视角');
    setText(modeChip, navigation.isFreeMode() ? '自由视角（等待录像）' : '等待录像');
    const busy = pakWorld?.loadedCells === 0 && pakWorld.isLoading;
    mapLoading.hidden = !busy;
    if (busy) mapLoadingText.textContent = '载入预烘焙地图…';
    const key = JSON.stringify([
      'idle',
      lastRenderedCameraState,
      canvas.width,
      canvas.height,
      lastEnv,
      pakWorld?.sceneRevision,
    ]);
    if (!force && key === lastRenderedKey && lastRenderedTrack === null) {
      debug.skippedFrames++;

      return;
    }
    engine.updateVehicles();
    engine.frame(lastRenderedCameraState);
    lastRenderedKey = key;
    lastRenderedTrack = null;
    lastRenderedAircraft = null;
    debug.renders++;
    debug.phase = 'rendering';
  } catch (error) {
    showRenderFailure(
      '地图渲染失败。请查看下方原因。',
      error instanceof Error ? error.message : String(error),
      'render-failed',
    );
  }
}

function renderTrackList(): void {
  el<HTMLButtonElement>('filterShort').disabled = plays.length < 3;
  el<HTMLButtonElement>('undoTrackRemoval').disabled = removalHistory.length === 0;
  tracksEl.innerHTML =
    plays
      .map(
        (track, index) =>
          `<div class="track ${index === active ? 'active' : ''}" data-i="${index}">` +
          `<button type="button" class="track-select" title="选择 ${escapeHtml(track.name)}"><span class="track-name">${escapeHtml(track.name)}</span></button>` +
          `<button type="button" class="track-delete" title="从已导入列表删除 ${escapeHtml(track.name)}" aria-label="删除 ${escapeHtml(track.name)}">×</button>` +
          `<span class="track-meta">${track.rows.length} 帧 · ${fmt(track.duration)} · 模型 ${track.model}${track.explosionReplay ? ' · 爆炸定格' : ''}</span></div>`,
      )
      .join('') || '<div class="empty">没有已导入记录。可导入文件或撤销移除。</div>';
  tracksEl.querySelectorAll<HTMLElement>('.track').forEach((node) => {
    const index = Number(node.dataset.i);
    node.onclick = () => selectTrack(index);
    node.querySelector<HTMLButtonElement>('.track-delete')!.onclick = (event) => {
      event.stopPropagation();
      const track = plays[index];
      if (track) removeImportedTracks(new Set([track]), `已删除 ${track.name}`);
    };
  });
}

function reportBootFailure(error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  mapLoading.hidden = true;
  showRenderFailure('回放启动失败。请查看下方原因。', detail, 'boot-failed');
}

function selectTrack(index: number, automatic = false): void {
  if (!plays.length) return;
  clock.style.setProperty(
    '--clock-width',
    `${Math.max(21, ...plays.map((track) => fmt(track.duration).length * 2 + 3))}ch`,
  );
  if (!automatic) cancelRouteTravel();
  stopShotPreview();
  activeShot = null;
  explosionAnimation.reset();
  if (cockpitLook) navigation.setFreeMode(false);
  cockpitLook = null;
  const next = Math.max(0, Math.min(plays.length - 1, index));
  if (next !== active && timeFlow) timeFlow = { hour: lastEnv.hour, seconds: 0 };
  active = next;
  shotPanel?.sync(plays[active]);
  debug.activeTrackIndex = active;
  elapsed = 0;
  scrub.max = String(plays[active].duration);
  scrub.value = '0';
  setText(clock, `${fmt(elapsed)} / ${fmt(plays[active].duration)}`);
  setText(segmentChip, plays[active].name);
  webAudio?.attachTrack(plays[active]);
  navigation.setTrack(plays[active]);
  endpointMarkers?.setActive(active);
  snapCamera = true;
  chaseTransition = null;
  void ensureAircraft();
  renderTrackList();
  frameOnce();
}

function setStatus(text: string): void {
  // A normal diagnostic update must not replace the renderer's fatal failure.
  if (debug.error) return;
  debug.status = text;
}

function setText(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

function showRenderFailure(message: string, detail: string, phase: string, canRetryInit = false): void {
  debug.error = detail;
  debug.phase = phase;
  debug.status = message;
  playing = false;
  webAudio?.dispose();
  webAudio = null;
  playButton.textContent = '▶';
  setText(el('renderErrorMessage'), message);
  setText(el('renderErrorDetail'), detail);
  el('insecureContextHelp').hidden = phase !== 'insecure-context';
  if (phase === 'insecure-context') setText(el('insecureContextOrigin'), location.origin);
  const retry = el<HTMLButtonElement>('retryRenderer');
  retry.textContent = canRetryInit ? '重试初始化' : '刷新回放';
  retry.onclick = () => {
    if (!canRetryInit) {
      location.reload();

      return;
    }
    bootPromise = boot();
    void bootPromise.catch(reportBootFailure);
  };
  el('renderError').hidden = false;
}

let previousAudioObserver: null | { eye: Vec3; mode: string; seconds: number; track: FlightTrack } = null;
/** Synthesis follows capture time and the actual camera, including stationary observers. */
function syncAudio(pose: ReturnType<typeof sampleTrack>): void {
  const speed = Number(el<HTMLSelectElement>('speed').value);
  const renderer = webAudio;
  const cameraState = lastRenderedCameraState;
  const track = activeTrack();
  if (renderer && cameraState && track) {
    const previous = previousAudioObserver;
    const dt = previous ? elapsed - previous.seconds : 0;
    const cut = audioCameraCuts(activeShot ?? undefined).some((s) => previous && s > previous.seconds && s <= elapsed);
    const stationary =
      (navigation.isFreeMode() && !cockpitLook) ||
      currentShot()?.kind === 'fixed' ||
      currentShot()?.kind === 'tracking';
    let velocity: Vec3 = stationary ? [0, 0, 0] : gtaDirToEngine(aircraftVelocityAt(track, elapsed));
    if (playing && previous?.track === track && previous.mode === debug.cameraMode && dt > 0 && dt <= 0.2 && !cut) {
      velocity = cameraState.eye.map((n, i) => (n - previous.eye[i]) / dt) as Vec3;
    } else if (!playing || cut) velocity = [0, 0, 0];
    previousAudioObserver = { eye: [...cameraState.eye], mode: debug.cameraMode, seconds: elapsed, track };
    const listener: WebAudioListenerPose = {
      forward: [
        cameraState.target[0] - cameraState.eye[0],
        cameraState.target[1] - cameraState.eye[1],
        cameraState.target[2] - cameraState.eye[2],
      ],
      position: cameraState.eye,
      up: cameraState.up,
      velocity,
    };
    renderer.sync(playing, speed, elapsed, listener, pose.pos);
  }
  publishAudioStats();
}

function syncImportedTracks(): void {
  if (!plays.length) previousAudioObserver = null;
  clock.style.setProperty(
    '--clock-width',
    `${Math.max(21, ...plays.map((track) => fmt(track.duration).length * 2 + 3))}ch`,
  );
  navigation.setTracks(plays, active);
  endpointMarkers?.setTracks(plays, active);
  debug.activeTrackIndex = plays.length ? active : -1;
  lastRenderedKey = '';
  renderTrackList();
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

function undoTrackRemoval(): void {
  cancelRouteTravel();
  const entries = removalHistory.pop();
  if (!entries) return;
  const previous = activeTrack();
  for (const entry of entries) plays.splice(Math.min(entry.index, plays.length), 0, entry.track);
  active = previous ? plays.indexOf(previous) : Math.min(entries[0].index, plays.length - 1);
  syncImportedTracks();
  if (previous) frameOnce();
  else selectTrack(active);
  setText(el('trackNotice'), `已恢复 ${entries.length} 条记录及其音频。`);
}

function update(track: FlightTrack, forceSnap: boolean): void {
  const shot = currentShot();
  if (activeShot?.kind === 'sequence' && shot && shot !== resolvedShot) {
    applyResolvedShot(shot);
    forceSnap = true;
  }
  const pose = sampleTrack(track, elapsed);
  applyEnvironment(pose.row);
  const posEngine: Vec3 = [pose.pos[0], pose.pos[2], -pose.pos[1]];
  const aircraftChanged = updateSceneAircraft(track, pose);
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
  // Flatten BEFORE the camera: the fallback cockpit part matrix is only valid for this frame.
  if (aircraftChanged) engine.updateVehicles();
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
    cockpitPosition = cockpitPosition.map(
      (value, axis) => value - forward[axis] * HYDRA_COCKPIT_EYE_AFT - up[axis] * HYDRA_COCKPIT_EYE_DOWN,
    ) as Vec3;
  }
  const dt = Math.min(0.1, Math.max(0.0001, (performance.now() - lastFrame) / 1000));
  const velocity = gtaDirToEngine(pose.velocity);
  const aspect = exportCompositor
    ? EXPORT_FRAME_WIDTH / EXPORT_FRAME_HEIGHT
    : canvas.width / Math.max(1, canvas.height);
  const gameAspect = window.screen.width / Math.max(1, window.screen.height);
  const cockpitFrame: CockpitLookFrame | null = cockpitPosition
    ? {
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
      }
    : null;
  const freeCameraState =
    cockpitLook && navigation.isFreeMode() && cockpitFrame
      ? cockpitLook.state(cockpitFrame)
      : navigation.cameraState(aspect);
  lastCockpitFrame = cockpitFrame;
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
  debug.cameraMode =
    routeAutoplay.phase === 'moving' || routeAutoplay.phase === 'loading'
      ? 'route-transition'
      : currentShot() && currentShot()!.kind !== 'cockpit'
        ? `shot-${currentShot()!.kind}`
        : cockpitLook
          ? 'cockpit-look'
          : freeCameraState
            ? 'free'
            : cameraMode;
  aircraft?.setCockpitLook(debug.cameraMode === 'cockpit-look');
  debug.controls = aircraft?.controls ?? null;
  updateScreenFlightHud();
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
  updateShotDiagram(track, cockpitFrame);
  updateSceneRender(track, pose, cameraState, forceSnap);
  updateScenePanels(track, pose, freeCameraState, posEngine);
  shotPanel?.sync(track);
  shotPanel?.drawRange(
    cameraState,
    debug.cameraMode === 'free' && routeEnabled,
    canvas.clientWidth,
    canvas.clientHeight,
  );
  shotDiagram?.drawLabel(cameraState, canvas.clientWidth, canvas.clientHeight);
}

function updateShotDiagram(track: FlightTrack, cockpitFrame: CockpitLookFrame | null): void {
  const program = shotPanel?.diagramView;
  const view = program ? programShotAt(program, elapsed) : null;
  const stateAt = (shot: ShotView, seconds: number): CameraStateOut | null => {
    if (shot.kind !== 'cockpit') return shotCameraState(shot, track, seconds, 16 / 9);
    if (!cockpitFrame) return null;
    const current = sampleTrack(track, elapsed),
      currentPos = gtaToEngine(...current.pos),
      sample = sampleTrack(track, seconds),
      nextAxes = [
        rotateVec(sample.orientation, [1, 0, 0]),
        rotateVec(sample.orientation, [0, 1, 0]),
        rotateVec(sample.orientation, [0, 0, 1]),
      ],
      nextPos = gtaToEngine(...sample.pos);
    const axes = [cockpitFrame.right, cockpitFrame.forward, cockpitFrame.up];
    const anchor = axes.map((axis) => axis.reduce((sum, n, i) => sum + n * (cockpitFrame.eye[i] - currentPos[i]), 0));
    const eye = nextPos.map((n, i) => n + nextAxes.reduce((sum, axis, j) => sum + axis[i] * anchor[j], 0)) as Vec3;
    const input = new FreeCamera({ fovYDeg: shot.fovYDeg });

    return new CockpitLookCamera(input, shot.cockpitLookPose).state({
      ...cockpitFrame,
      aspect: 16 / 9,
      eye,
      forward: nextAxes[1],
      right: nextAxes[0],
      up: nextAxes[2],
    });
  };
  diagramCameraState = null;
  if (view && !VIDEO_EXPORT && !videoExportDriving) {
    diagramCameraState = shotCameraState(view, track, elapsed, 16 / 9);
    if (view.kind === 'cockpit' && cockpitFrame) {
      const input = new FreeCamera({ fovYDeg: view.fovYDeg });
      diagramCameraState = new CockpitLookCamera(input, view.cockpitLookPose).state({
        ...cockpitFrame,
        aspect: 16 / 9,
      });
    }
  }
  if (diagramCameraState) shotDiagram ??= new ShotCameraDiagram(engine);
  shotDiagram?.update(
    debug.cameraMode === 'free' ? diagramCameraState : null,
    view?.kind,
    program ?? undefined,
    track,
    elapsed,
    stateAt,
  );
  Object.assign(debug, {
    shotDiagramActiveSegment: shotDiagram?.activeIndex ?? 0,
    shotDiagramCamera: diagramCameraState,
    shotDiagramKind: view?.kind ?? null,
    shotDiagramSegments: shotDiagram?.state
      ? shotDiagram.segments.map((part) => ({
          camera: part.index === shotDiagram!.activeIndex ? shotDiagram!.state! : part.state,
          end: part.end,
          index: part.index,
          seconds: part.seconds,
          start: part.start,
        }))
      : [],
    shotDiagramVisible: !!shotDiagram?.state,
  });
}

let lastScreenHudKey = '';
let lastScreenHudLayoutKey = '';
function updateScreenFlightHud(): void {
  const visible =
    !!activeTrack() && !!debug.controls && !!debug.instrumentState && showSurfaceFeedback(debug.cameraMode);
  debug.controlsVisible = visible;
  controlsCanvas.hidden = !visible;
  instrumentCanvas.hidden = !visible;
  document.body.classList.toggle('flight-hud-visible', visible);
  if (!visible || !debug.controls || !debug.instrumentState) {
    debug.hudLayout = null;

    return;
  }
  const transportRect = el('transport').getBoundingClientRect();
  const layout = flightHudLayout(
    window.innerWidth,
    window.innerHeight,
    transportRect.height > 0 ? transportRect.top : undefined,
  );
  debug.hudLayout = layout;
  const layoutKey = JSON.stringify(layout);
  if (layoutKey !== lastScreenHudLayoutKey) {
    document.body.style.setProperty('--flight-hud-height', `${layout.height}px`);
    document.body.style.setProperty('--flight-hud-top', `${layout.top}px`);
    for (const [target, rect] of [
      [instrumentCanvas, layout.instruments],
      [controlsCanvas, layout.controls],
    ] as const) {
      Object.assign(target.style, {
        height: `${rect.height}px`,
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
      });
    }
    lastScreenHudLayoutKey = layoutKey;
  }
  const key = JSON.stringify([debug.instrumentState, debug.controls]);
  if (key !== lastScreenHudKey) {
    drawFlightInstrumentHud(instrumentContext, debug.instrumentState);
    drawSurfaceFeedback(controlsContext, debug.controls);
    lastScreenHudKey = key;
  }
}

let instrumentTrack: FlightTrack | null = null;
let lastAppliedAircraft: AircraftHandle | null = null;
let lastAppliedTrack: FlightTrack | null = null;
let lastAppliedSeconds = NaN;
let lastAppliedCameraMode: CameraMode | null = null;
function updateSceneAircraft(track: FlightTrack, pose: ReturnType<typeof sampleTrack>): boolean {
  if (
    aircraft === lastAppliedAircraft &&
    track === lastAppliedTrack &&
    elapsed === lastAppliedSeconds &&
    cameraMode === lastAppliedCameraMode
  )
    return false;
  if (aircraft) {
    aircraft.setVisible(cameraMode !== 'first-person');
    aircraft.applyPose(pose.pos, pose.orientation);
    aircraft.applyPaint(pose.row.colors);
    aircraft.applyNodes(pose.nodes, pose.row.gear, pose.row.surfaceDamage.states);
    debug.stickMotion = aircraft.stickMotion;
    debug.pedalMotion = aircraft.pedals?.state ?? null;
    aircraft.applyProps({
      nodes: pose.row.propNodes,
      nozzleRotation: pose.row.nozzleRotation,
      propeller: visualPropellerMotion(track, elapsed),
    });
    const state = cockpitInstrumentState(track, pose, elapsed);
    aircraft.instruments?.update(state, instrumentTrack !== track);
    instrumentTrack = track;
    debug.instrumentState = state;
    debug.instrumentUploads = aircraft.instruments?.uploads ?? 0;
  }
  lastAppliedAircraft = aircraft;
  lastAppliedTrack = track;
  lastAppliedSeconds = elapsed;
  lastAppliedCameraMode = cameraMode;

  return true;
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
  if (currentShot() && currentShot()!.kind !== 'cockpit')
    return shotCameraState(currentShot()!, track, elapsed, aspect)!;
  const pitch = cameraMode === 'cockpit' && pose.row.model === 520 ? HYDRA_COCKPIT_PITCH : 0;
  let cameraState = isChaseMode(cameraMode)
    ? timelineFor(track).state(elapsed, cameraMode, aspect, gameAspect)
    : camera.state({
        aspect,
        cockpitPosition,
        dt,
        firstPersonPosition,
        forward: forward.map((value, axis) => value * Math.cos(pitch) + up[axis] * Math.sin(pitch)) as Vec3,
        gameAspect,
        model: pose.row.model,
        modelLength,
        modelTop,
        position: posEngine,
        snap: forceSnap || snapCamera,
        up: up.map((value, axis) => value * Math.cos(pitch) - forward[axis] * Math.sin(pitch)) as Vec3,
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

  if (routeAutoplay.phase === 'loading') routeDestinationCamera = structuredClone(cameraState);
  const travel = routeAutoplay.camera(performance.now());

  return travel ? { ...travel, aspect } : cameraState;
}

function updateScenePanels(
  track: FlightTrack,
  pose: ReturnType<typeof sampleTrack>,
  freeCameraState: CameraStateOut | null,
  posEngine: Vec3,
): void {
  syncAudio(pose);
  setText(clock, `${fmt(elapsed)} / ${fmt(track.duration)}`);
  // The scrubber's range must track the ACTIVE recording, or dragging it clamps every value to 0.
  if (scrub.max !== String(track.duration)) {
    scrub.max = String(track.duration);
  }
  if (scrub.value !== String(elapsed)) scrub.value = String(elapsed);
  setText(
    modeChip,
    `${activeShot ? programLabel(activeShot) + '预览' : cockpitLook ? '机舱观察' : freeCameraState ? '自由视角' : CAMERA_LABELS[cameraMode]}（${playing ? '播放中' : '暂停'}）`,
  );
  setText(el('follow'), `视角：${CAMERA_LABELS[cameraMode]}`);
  el('flightRoute').hidden = debug.cameraMode !== 'free';
  el('flightRouteLegend').hidden = debug.cameraMode !== 'free' || !routeEnabled;
  if (pakWorld?.isReady) {
    const streamPos =
      routeAutoplay.phase === 'loading' && routeDestinationCamera
        ? routeDestinationCamera.eye
        : routeAutoplay.phase === 'moving' && lastRenderedCameraState
          ? lastRenderedCameraState.eye
          : activeShot && lastRenderedCameraState
            ? lastRenderedCameraState.eye
            : freeCameraState
              ? navigation.camera.position
              : posEngine;
    pakWorld.update(streamPos[0], -streamPos[2], pakWorld.renderRadius.hd, pakWorld.renderRadius.lod);
    const busy = pakWorld.loadedCells === 0 && pakWorld.isLoading;
    mapLoading.hidden = !busy;
    if (busy) mapLoadingText.textContent = '载入预烘焙地图…';
  }
}

let lastRenderedKey = '';
let lastRenderedTrack: FlightTrack | null = null;
let lastRenderedAircraft: AircraftHandle | null = null;
function updateSceneRender(
  track: FlightTrack,
  pose: ReturnType<typeof sampleTrack>,
  cameraState: CameraStateOut,
  force: boolean,
): void {
  try {
    const markersVisible = debug.cameraMode === 'free' && debug.markerCount > 0;
    const routeVisible = debug.cameraMode === 'free' && routeEnabled;
    if (routeVisible) {
      flightRoute ??= new FlightRoute(engine);
      flightRoute.setTrack(track);
    }
    flightRoute?.setVisible(routeVisible);
    debug.routeVisible = routeVisible;
    if (flightRoute) debug.routeSegments = { ...flightRoute.counts };
    endpointMarkers?.setVisible(markersVisible);
    // A modest real-time cadence keeps free-view beacons alive while the recording is paused.
    // Other views retain the unchanged paused-frame cache and never animate hidden geometry.
    const markerTick = markersVisible ? Math.floor((performance.now() * 30) / 1000) : null;
    debug.markerVisible = markersVisible;
    debug.markerAnimationSeconds = markerTick === null ? null : markerTick / 30;
    const burst = videoExportDriving
      ? {
          age: track.explosionReplay && elapsed >= track.duration ? exportParticleSeconds - track.duration : null,
          seconds: exportParticleSeconds,
        }
      : explosionAnimation.sample(track, elapsed, performance.now());
    const burstAge = burst.age === null || videoExportDriving ? burst.age : Math.floor(burst.age * 30) / 30;
    const particleSeconds = burstAge === null ? elapsed : track.duration + burstAge;
    debug.explosionAge = burstAge;
    debug.explosionAnimating = burstAge !== null && burstAge < EXPLOSION_REPLAY_SECONDS;
    const key = JSON.stringify([
      elapsed,
      cameraState,
      canvas.width,
      canvas.height,
      lastEnv,
      !!engine.renderTarget,
      videoExportDriving,
      pakWorld?.sceneRevision,
      debug.markerCount,
      debug.markerActiveTrackId,
      debug.cameraMode,
      markerTick,
      routeVisible,
      shotDiagram?.key,
      burstAge,
    ]);
    // Paused capture effects retain their frame; the independent endpoint burst invalidates until it fades.
    // Camera easing/input and asynchronous cells/colliders change the key. Export always renders.
    if (
      !force &&
      !playing &&
      !videoExportDriving &&
      !engine.renderTarget &&
      key === lastRenderedKey &&
      track === lastRenderedTrack &&
      aircraft === lastRenderedAircraft
    ) {
      debug.skippedFrames++;

      return;
    }
    if (markerTick !== null) endpointMarkers?.update(markerTick / 30);
    engine.particleClock = particleSeconds;
    if (flightEffects) {
      flightEffects.update(track, pose, particleSeconds, aircraft);
    }
    engine.frame(cameraState);
    lastRenderedKey = key;
    lastRenderedTrack = track;
    lastRenderedAircraft = aircraft;
    debug.renders += 1;
    debug.phase = 'rendering';
  } catch (error) {
    if (!debug.error) {
      showRenderFailure(
        '回放渲染失败。请查看下方原因。',
        error instanceof Error ? error.message : String(error),
        'render-failed',
      );
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
  const fullscreenButton = el<HTMLButtonElement>('fullscreen');
  const fullscreenStatus = el('fullscreenStatus');
  fullscreenButton.disabled = !document.fullscreenEnabled;
  if (!document.fullscreenEnabled) fullscreenButton.title = '当前浏览器不支持页面全屏';
  fullscreenButton.onclick = async (): Promise<void> => {
    fullscreenButton.disabled = true;
    fullscreenStatus.hidden = true;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        // Fullscreen the entire document, so the separate instrument canvases remain above the scene.
        await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
      }
      fullscreenButton.blur();
    } catch {
      fullscreenStatus.textContent = '未能进入全屏，请再次点击“全屏”或检查浏览器权限。';
      fullscreenStatus.hidden = false;
    } finally {
      fullscreenButton.disabled = !document.fullscreenEnabled;
    }
  };
  document.addEventListener('fullscreenchange', () => {
    const fullscreen = document.fullscreenElement === document.documentElement;
    // CSS preserves each panel's previous hidden/open state for Esc or a browser-initiated exit.
    document.body.classList.toggle('replay-fullscreen', fullscreen);
    fullscreenButton.setAttribute('aria-pressed', String(fullscreen));
    resize();
    updateScreenFlightHud();
    frameOnce();
  });
  navigation.attachCameraInput(canvas);
  // 3D marker picking: debug lines are not pickable, so a click is projected against the live camera.
  let markerPointerDown: null | { moved: boolean; x: number; y: number } = null;
  canvas.addEventListener('pointerdown', (event) => {
    markerPointerDown = event.button === 0 ? { moved: false, x: event.clientX, y: event.clientY } : null;
  });
  window.addEventListener('pointermove', (event) => {
    if (
      markerPointerDown &&
      Math.hypot(event.clientX - markerPointerDown.x, event.clientY - markerPointerDown.y) > MARKER_CLICK_DRAG_PX
    )
      markerPointerDown.moved = true;
  });
  canvas.addEventListener('pointercancel', () => {
    markerPointerDown = null;
  });
  canvas.addEventListener('click', (event) => {
    const down = markerPointerDown;
    markerPointerDown = null;
    if (
      event.button !== 0 ||
      (down && (down.moved || Math.hypot(event.clientX - down.x, event.clientY - down.y) > MARKER_CLICK_DRAG_PX))
    ) {
      return; // the press was a free-camera drag, not a marker pick
    }
    debug.routePickedSeconds = null;
    const picked = routeAtPointer(event.clientX, event.clientY);
    if (picked && shotPanel?.picking) {
      seekRoute(picked);
      shotPanel.pick(picked.seconds);
      frameOnce();

      return;
    }
    // A beacon actually under the click keeps its selection behavior, but its
    // generous 26 px hit area must not swallow clicks on a nearby route segment.
    if (
      !pickMarkerAt(
        event.clientX,
        event.clientY,
        picked ? Math.min(MARKER_PICK_RADIUS_PX, picked.distancePx + 3) : MARKER_PICK_RADIUS_PX,
      ) &&
      picked
    )
      seekRoute(picked);
  });
  if (VIDEO_EXPORT) {
    document.body.classList.add('video-export-mode');
  }
  const drop = el<HTMLDivElement>('drop');
  const picker = el<HTMLInputElement>('picker');
  picker.accept = '.csv,text/csv';
  el<HTMLButtonElement>('filterShort').onclick = filterImportedShortFlights;
  el<HTMLButtonElement>('undoTrackRemoval').onclick = undoTrackRemoval;
  const audioButton = document.createElement('button');
  audioButton.type = 'button';
  audioButton.id = 'audioToggle';
  audioButton.title = '开启或关闭回放声音';
  audioButton.textContent = '音频：开';
  audioButton.onclick = () => {
    audioMuted = !audioMuted;
    webAudio?.setMuted(audioMuted);
    audioButton.textContent = audioMuted ? '音频：关' : '音频：开';
    publishAudioStats();
  };
  el<HTMLSelectElement>('speed').insertAdjacentElement('afterend', audioButton);
  const freeButton = document.createElement('button');
  freeButton.type = 'button';
  freeButton.id = 'freeView';
  freeButton.textContent = '自由视角';
  freeButton.title =
    'WASD 水平移动，空格上升，Shift 下降，E 加速 / Q 减速（极慢/慢/中/快）；拖动旋转，滚轮按当前档位前后移动';
  freeButton.onclick = () => {
    if (!debug.worldReady || debug.error) return;
    stopShotPreview();
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
    '从驾驶员位置观察机舱；回头时自动轻微前探。拖动旋转，WASD/空格/Shift 小幅微调，E 加速 / Q 减速';
  cockpitLookButton.onclick = () => {
    if (!debug.worldReady || debug.error) return;
    stopShotPreview();
    if (cockpitLook) {
      cockpitLook = null;
      navigation.setFreeMode(false);
      freeButton.textContent = '自由视角';
    } else {
      cameraMode = 'cockpit';
      camera.mode = cameraMode;
      cockpitLook = new CockpitLookCamera(navigation.camera, {
        pitch: activeTrack()?.model === 520 ? HYDRA_COCKPIT_PITCH : 0,
      });
      navigation.setFreeMode(true);
      freeButton.textContent = '切到自由视角';
    }
    camera.reset();
    snapCamera = true;
    frameOnce();
  };
  freeButton.after(cockpitLookButton);
  const routeButton = document.createElement('button');
  routeButton.type = 'button';
  routeButton.id = 'flightRoute';
  routeButton.hidden = true;
  routeButton.textContent = `路线动线：${routeEnabled ? '开' : '关'}`;
  routeButton.setAttribute('aria-pressed', String(routeEnabled));
  routeButton.title =
    '当前录像完整路线及方向箭头；点击迹线定位并暂停回放；绿：五舵面完好，黄：舵面受损，红：机体健康低于25%，灰：舵面未采集';
  routeButton.onclick = () => {
    routeEnabled = !routeEnabled;
    routeButton.textContent = `路线动线：${routeEnabled ? '开' : '关'}`;
    routeButton.setAttribute('aria-pressed', String(routeEnabled));
    frameOnce();
  };
  const routeLegend = document.createElement('span');
  routeLegend.id = 'flightRouteLegend';
  routeLegend.className = 'small';
  routeLegend.hidden = true;
  routeLegend.innerHTML =
    '<span style="color:#1fff59">● 完好</span> · <span style="color:#ffcc14">● 受损</span> · <span style="color:#ff1f1a">● 健康&lt;25%</span> · <span style="color:#a6b8cc">● 未采集</span>';
  cockpitLookButton.after(routeButton, routeLegend);
  const videoButton = document.createElement('button');
  videoButton.type = 'button';
  videoButton.id = 'singleVideoExport';
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
  cockpitLookButton.after(fpsLabel);
  fpsLabel.after(videoButton);
  videoButton.after(cancelVideo);
  cancelVideo.after(videoNote);
  const clearVideos = document.createElement('button');
  clearVideos.id = 'clearClientVideos';
  clearVideos.textContent = '清理已生成视频';
  clearVideos.title = '释放浏览器中的导出视频缓存；已下载到电脑的文件不受影响';
  clearVideos.onclick = () => {
    if (!exportUiBusy) clientDownloads.clear();
  };
  videoNote.after(clearVideos);
  shotPanel = new ShotPanel({
    capture: captureShot,
    export: exportShotBatch,
    inspect: inspectShotDiagram,
    place: placeShot,
    prepare: prepareShotSelection,
    preview: previewShot,
    seconds: () => elapsed,
    seek: (seconds) => {
      cancelRouteTravel();
      navigation.camera.cancelFlyTo();
      elapsed = seconds;
      playing = false;
      playButton.textContent = '▶';
      frameOnce();
    },
    stopPreview: stopShotPreview,
  });
  const shotsButton = document.createElement('button');
  shotsButton.id = 'batchShots';
  shotsButton.type = 'button';
  shotsButton.textContent = '多机位片段导出';
  shotsButton.onclick = () => {
    if (!debug.worldReady || debug.error) return;
    shotPanel?.sync(activeTrack());
    shotPanel?.toggle();
    frameOnce();
  };
  videoButton.before(shotsButton);
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
    const files = [...(event.dataTransfer?.files ?? [])].filter((file) => /\.csv$/i.test(file.name));
    void addFiles(files);
  });
  picker.onchange = () => {
    void addFiles([...(picker.files ?? [])]);
  };
  playButton.onclick = () => {
    if (routeAutoplay.phase !== 'idle') {
      cancelRouteTravel();
      playing = false;
      playButton.textContent = '▶';
      frameOnce();

      return;
    }
    const track = activeTrack();
    if (!track || !debug.worldReady || debug.error) {
      return;
    }
    if (track.explosionReplay && elapsed >= track.duration) explosionAnimation.reset();
    playing = !playing;
    playButton.textContent = playing ? 'Ⅱ' : '▶';
  };
  el<HTMLInputElement>('routeAutoplay').onchange = (event) => {
    routeAutoplay.enabled = (event.target as HTMLInputElement).checked;
    if (!routeAutoplay.enabled) cancelRouteTravel();
    setText(
      el('routeAutoplayStatus'),
      routeAutoplay.enabled ? '每条结束后停留 2 秒，再平滑移动到下一条起点。' : '连续播放已关闭。',
    );
  };
  window.addEventListener(
    'pointerdown',
    (event) => {
      if (routeAutoplay.phase !== 'idle' && event.target !== playButton) cancelRouteTravel();
    },
    true,
  );
  window.addEventListener(
    'keydown',
    (event) => {
      if (routeAutoplay.phase !== 'idle' && !event.repeat) {
        cancelRouteTravel();
        if (event.code === 'KeyP') {
          playing = false;
          playButton.textContent = '▶';
          event.preventDefault();
          event.stopImmediatePropagation();
          frameOnce();
        }
      }
    },
    true,
  );
  el('restart').onclick = () => {
    explosionAnimation.reset();
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
    cancelRouteTravel();
    elapsed = Number(scrub.value);
    const track = activeTrack();
    if (track && elapsed >= Math.floor(track.duration * 1000) / 1000) elapsed = track.duration;
    explosionAnimation.reset();
    playing = false;
    snapCamera = true;
    debug.seeks += 1;
    frameOnce();
  };
  el('follow').onclick = cycleCamera;
  el('resetView').onclick = () => {
    if (!debug.worldReady || debug.error) return;
    stopShotPreview();
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
    if (
      (event.code !== 'KeyV' && event.code !== 'KeyP') ||
      event.repeat ||
      event.isComposing ||
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey
    ) {
      return;
    }
    const focused = document.activeElement;
    const tag = focused?.tagName;
    if (
      tag === 'INPUT' ||
      tag === 'TEXTAREA' ||
      tag === 'SELECT' ||
      (focused instanceof HTMLElement && focused.isContentEditable)
    ) {
      return;
    }
    event.preventDefault();
    if (event.code === 'KeyP') {
      // Use the same guarded action even while fullscreen CSS hides the transport/button.
      playButton.click();
    } else {
      cycleCamera();
    }
  });
  scrub.max = '0';
  window.addEventListener('beforeunload', () => {
    webAudio?.dispose();
  });

  const weatherSlider = el<HTMLInputElement>('weatherSlider');
  const hourSlider = el<HTMLInputElement>('hourSlider');
  const followEnv = el<HTMLInputElement>('followEnv');
  const timeFlowToggle = el<HTMLInputElement>('timeFlow');
  timeFlowToggle.onchange = (): void => {
    hudHour = normalizeGameHour(lastEnv.hour);
    timeFlow = timeFlowToggle.checked ? { hour: hudHour, seconds: elapsed } : null;
    followEnv.checked = false;
    frameOnce();
  };
  weatherSlider.oninput = () => {
    hudWeather = Number(weatherSlider.value);
    followEnv.checked = false;
    frameOnce();
  };
  hourSlider.oninput = () => {
    hudHour = normalizeGameHour(Number(hourSlider.value));
    if (timeFlow) timeFlow = { hour: hudHour, seconds: elapsed };
    followEnv.checked = false;
    frameOnce();
  };
  followEnv.onchange = () => {
    if (followEnv.checked) {
      timeFlow = null;
      timeFlowToggle.checked = false;
      hudWeather = null;
      hudHour = null;
    } else {
      // Freeze at the current effective environment, then let the sliders take over.
      hudWeather = Math.round(lastEnv.weather);
      hudHour = lastEnv.hour;
    }
    frameOnce();
  };
}

async function boot(): Promise<void> {
  debug.error = null;
  debug.phase = 'boot';
  debug.worldReady = false;
  el('renderError').hidden = true;
  el('insecureContextHelp').hidden = true;
  // This ID only correlates diagnostic reports; HTTP pages may not expose randomUUID.
  const bootId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
  if (!window.isSecureContext) {
    showRenderFailure(
      '当前地址使用公网 HTTP，浏览器未开放 WebGPU。请使用 HTTPS 或 localhost 地址打开回放；渲染使用你电脑的显卡，服务器不需要显卡。',
      'WebGPU requires a secure context (HTTPS or localhost).',
      'insecure-context',
    );
    void report({ phase: 'insecure-context', secureContext: false });

    return;
  }
  if (!navigator.gpu) {
    showRenderFailure(
      '此浏览器无法使用 WebGPU。请用支持 WebGPU 的 Chrome 或 Edge 打开回放。',
      'WebGPU is not available',
      'no-webgpu',
    );
    void report({ phase: 'no-webgpu' });

    return;
  }
  engine = new Engine();
  try {
    await engine.init(canvas);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const adapterUnavailable = detail.startsWith('WebGPU adapter request failed');
    showRenderFailure(
      adapterUnavailable
        ? '浏览器未能连接显卡，回放画面无法启动。可先重试；若显卡诊断也失败，请保存工作后正常重启浏览器。'
        : 'WebGPU 初始化失败。请查看下方原因或打开显卡诊断。',
      detail,
      'engine-failed',
      adapterUnavailable,
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
      showRenderFailure('显卡渲染设备已断开，正在尝试恢复回放。', `device-lost:${info.reason}`, 'device-lost');
      void report({
        canvas: `${canvas.width}x${canvas.height}`,
        gpu: debug.gpu,
        loadedCells: pakWorld?.loadedCells ?? 0,
        message: info.message,
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
        setText(el('renderErrorMessage'), `显卡渲染设备已断开（${info.reason}），1 秒后自动重启回放…`);
        window.setTimeout(() => location.reload(), 1000);
      } else {
        setText(el('renderErrorMessage'), '显卡渲染设备再次断开。请保存工作后正常重启浏览器，再打开本机回放地址。');
      }
    })
    .catch(() => {
      /* lost promise rejection is not actionable */
    });
  ensureEndpointMarkers();
  engine.renderScale = 1;
  engine.environment.windStrength = 0;
  engine.waterEnabled = true;
  camera = new ReplayCamera();
  camera.mode = cameraMode;
  setStatus('正在读取预烘焙回放包…');
  // The pak holds both map cells and the two supported aircraft. No GTA install scan happens at replay time.
  bootStage = 'pak-check';
  if (!mapCache) mapCache = await initializeMapPakCache(MAP_PAK_BASE, updateMapCache);
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
    webAudio.setMuted(audioMuted);
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
  setStatus(`预烘焙地图就绪：${pak.indexedCells} 个单元`);
  void report({ cells: pak.indexedCells, phase: 'world-indexed' });
  // No URL parameters required: with nothing loaded, pull the newest local recording automatically.
  if (plays.length === 0) {
    await loadLatest();
  } else {
    // Files imported while requestAdapter was unavailable stay in memory through initialization retry.
    await ensureAircraft();
    const track = activeTrack();
    if (track) {
      webAudio?.attachTrack(track);
    }
  }
  window.addEventListener('resize', resize);
  resize();
  publishAudioStats();
  loop();
  if (!VIDEO_EXPORT) {
    void mapCache.requestPersistence();
    mapCache.resume();
  }
  void report({ phase: 'loop-started' });
}

function continueReplayLoop(): void {
  if (!debug.error) loop();
}

function cycleCamera(): void {
  if (!debug.worldReady || debug.error) return;
  stopShotPreview();
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
  const view: ExportView = activeShot
    ? { mode: 'shot', shot: structuredClone(activeShot) }
    : cockpitLook
      ? { cockpitLookPose: cockpitLook.pose, fovYDeg: navigation.camera.fovYDeg, mode: 'cockpit-look' }
      : navigation.isFreeMode()
        ? { mode: 'free', ...navigation.camera.pose, routeVisible: routeEnabled }
        : { mode: cameraMode };
  button.disabled = true;
  try {
    await exportClientVideos([view], null, note, note, cancel);
  } catch (error) {
    note.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    button.disabled = false;
  }
}

async function exportClientVideos(
  views: ExportView[],
  range: null | ShotRange,
  note: HTMLElement,
  results: HTMLElement,
  cancel: HTMLButtonElement,
): Promise<void> {
  cancelRouteTravel();
  const track = activeTrack();
  if (!track || !debug.worldReady || !engine || !pakWorld || debug.error) throw new Error('回放尚未就绪');
  if (exportUiBusy) throw new Error('已有导出正在运行，请等待完成或取消。');
  if (range && !validShotRange(range, track.duration)) throw new Error('导出时间范围无效');
  const duration = range ? range.end - range.start : explosionExportDuration(track);
  if ((range?.end ?? duration) * 48000 * 4 > CLIENT_AUDIO_BYTES)
    throw new Error('音频合成范围超过浏览器内存预算，请选取较短录像后导出。');
  const saved = {
    cockpit: cockpitLook?.pose ?? null,
    focus: navigation.camera.focusDistance,
    free: navigation.isFreeMode(),
    mode: cameraMode,
    playing,
    pose: navigation.camera.pose,
    range: exportRange,
    seconds: elapsed,
    shot: activeShot,
    timeSource: engine.timeSource,
    transition: chaseTransition,
    view: exportView,
  };
  const controller = new AbortController();
  exportUiBusy = true;
  clientExportSignal = controller.signal;
  playing = false;
  videoExportDriving = true;
  syncAudio(sampleTrack(track, elapsed));
  navigation.camera.cancelFlyTo();
  const inert = [...document.body.children]
    .filter((node): node is HTMLElement => node instanceof HTMLElement)
    .map((node) => ({ node, previous: node.inert }));
  for (const { node } of inert) node.inert = true;
  const overlay = document.createElement('div');
  overlay.id = 'clientExportProgress';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', '浏览器视频导出');
  Object.assign(overlay.style, {
    background: 'rgba(0,0,0,.65)',
    color: '#eef5ff',
    display: 'grid',
    inset: '0',
    placeItems: 'center',
    position: 'fixed',
    zIndex: '100',
  });
  const abort = document.createElement('button'),
    box = document.createElement('div'),
    status = document.createElement('p');
  Object.assign(box.style, { background: '#132233', borderRadius: '10px', padding: '24px' });
  abort.textContent = '取消导出';
  abort.id = 'clientExportCancel';
  abort.onclick = () => {
    controller.abort();
    status.textContent = '正在取消…';
  };
  const key = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') controller.abort();
    if (event.key !== 'Tab') {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  window.addEventListener('keydown', key, true);
  box.append(status, abort);
  overlay.append(box);
  document.body.append(overlay);
  abort.focus();
  cancel.hidden = false;
  cancel.onclick = () => controller.abort();
  const fps = selectedExportFps();
  const filename =
    (trackFilenames.get(track) ?? track.name).replace(/\.csv$/i, '').replace(/[^\p{L}\p{N}._-]/gu, '_') || 'flight';
  const rows = views.map((view) => {
    const row = document.createElement('p');
    row.className = 'small';
    row.textContent = `${view.shot ? programLabel(view.shot) : '当前机位'} · 等待导出`;

    return row;
  });
  results.replaceChildren(...rows);
  let completed = 0,
    failed = 0;
  try {
    status.textContent = '浏览器正在准备地图和合成音频…';
    exportRange = range;
    exportView = { ...views[0] };
    elapsed = range?.start ?? 0;
    exportClockMs = elapsed * 1000;
    setupExportCompositor();
    for (let index = 0; index < views.length; index++) {
      controller.signal.throwIfAborted();
      const view = views[index],
        label = view.shot ? programLabel(view.shot) : '当前机位';
      activeShot = null;
      cockpitLook = null;
      chaseTransition = null;
      navigation.setFreeMode(false);
      cameraMode = CAMERA_MODES.includes(view.mode as CameraMode) ? (view.mode as CameraMode) : 'chase-mid';
      camera.mode = cameraMode;
      navigation.camera.setPose(saved.pose);
      if (view.mode === 'free' && view.position) {
        navigation.camera.setPose({ fovYDeg: view.fovYDeg, pitch: view.pitch, position: view.position, yaw: view.yaw });
        navigation.setFreeMode(true);
      } else if (view.mode === 'cockpit-look' && view.cockpitLookPose) {
        cameraMode = 'cockpit';
        camera.mode = cameraMode;
        cockpitLook = new CockpitLookCamera(navigation.camera, view.cockpitLookPose);
        navigation.setFreeMode(true);
      } else if (view.mode === 'shot' && view.shot) applyShot(view.shot);
      exportView = { ...view };
      try {
        elapsed = range?.start ?? 0;
        const audio = await renderExportAudio();
        controller.signal.throwIfAborted();
        const blob = await browserMp4({
          audio,
          duration,
          fps,
          maxBytes: Math.min(256 * 1024 * 1024, CLIENT_EXPORT_BYTES - clientDownloads.bytes),
          progress: (done, total) => {
            const text = `${index + 1}/${views.length} · ${label} · ${Math.round((done / total) * 100)}%`;
            status.textContent = text;
            if (note !== results) note.textContent = text;
            rows[index].textContent = `${label} · ${done}/${total} 帧`;
          },
          render: renderExportFrame,
          signal: controller.signal,
        });
        const suffix = `${range ? `_${Math.round(range.start * 1000)}-${Math.round(range.end * 1000)}ms` : ''}${view.shot ? `_${view.shot.kind}` : ''}`;
        const link = clientDownloads.add(blob, `${filename}${suffix}.mp4`);
        rows[index].replaceChildren(`${label} · `, link);
        completed++;
      } catch (error) {
        if (controller.signal.aborted) throw error;
        failed++;
        rows[index].textContent = `${label} · 失败：${error instanceof Error ? error.message : String(error)}`;
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    for (let index = completed + failed; index < rows.length; index++) rows[index].textContent += ' · 已取消';
  } finally {
    engine.renderTarget = null;
    await engine.device.queue.onSubmittedWorkDone().catch(() => {});
    exportCompositor?.surface.destroy();
    exportCompositor = null;
    engine.setTimeSource(saved.timeSource);
    videoExportDriving = false;
    clientExportSignal = null;
    exportRange = saved.range;
    exportView = saved.view;
    elapsed = saved.seconds;
    playing = saved.playing;
    activeShot = saved.shot;
    cameraMode = saved.mode;
    camera.mode = saved.mode;
    navigation.camera.setPose(saved.pose);
    navigation.camera.focusDistance = saved.focus;
    navigation.setFreeMode(saved.free);
    cockpitLook = saved.cockpit ? new CockpitLookCamera(navigation.camera, saved.cockpit) : null;
    chaseTransition = saved.transition;
    camera.reset();
    snapCamera = true;
    explosionAnimation.reset();
    lastFrame = performance.now();
    window.removeEventListener('keydown', key, true);
    overlay.remove();
    for (const { node, previous } of inert) node.inert = previous;
    cancel.hidden = true;
    exportUiBusy = false;
    frameOnce();
  }
  const message = controller.signal.aborted
    ? `已取消；${completed} 个已完成视频仍可下载。`
    : failed
      ? `${completed} 个视频完成，${failed} 个失败。`
      : `${completed} 个独立 MP4 已生成，点击链接保存到电脑。`;
  if (note === results) {
    const text = document.createElement('span');
    text.textContent = message;
    note.prepend(text);
  } else note.textContent = message;
}

async function exportShotBatch(
  views: ShotProgram[],
  range: ShotRange,
  note: HTMLElement,
  results: HTMLElement,
  cancel: HTMLButtonElement,
): Promise<void> {
  await exportClientVideos(
    views.map((shot) => ({ mode: 'shot', shot })),
    range,
    note,
    results,
    cancel,
  );
}

function loop(): void {
  requestAnimationFrame(continueReplayLoop);
  // Pak texture arrays upload a slice per frame (a single synchronous burst is what TDRs).
  if (pakWorld) {
    pakWorld.pumpCameraCollision(2);
    if (!pakWorld.isReady) {
      pakWorld.pump(1);
      mapLoading.hidden = false;
      mapLoadingText.textContent = '上传预烘焙纹理数组…';
      // Startup copies and the first full-resolution render must not compete in one GPU queue burst.
      // `isReady` flips only after the final upload batch's completion fence. Playback starts there.
      lastFrame = performance.now();

      return;
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
  debug.routeAutoplayPhase = routeAutoplay.phase;
  debug.routeAutoplayProgress = routeAutoplay.progressAt(now);
  if (routeAutoplay.phase !== 'idle')
    setText(
      el('routeAutoplayStatus'),
      routeAutoplay.phase === 'waiting'
        ? '终点停留 2 秒…'
        : routeAutoplay.phase === 'loading'
          ? '准备下一条路线的地图和飞机…'
          : '平滑移动到下一条起点…',
    );
  if (routeAutoplay.phase === 'loading') {
    lastFrame = now;

    return;
  }
  const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
  const track = activeTrack();
  if (!track) {
    shotPanel?.sync(null);
    el<HTMLCanvasElement>('shotRangeOverlay').hidden = true;
    if (engine && camera) {
      navigation.updateInput(dt);
      renderIdleWorld();
    }
    lastFrame = now;

    return;
  }
  let naturalEnd = false;
  if (playing) {
    elapsed += dt * Number(el<HTMLSelectElement>('speed').value);
    if (shotPreview?.end !== undefined && elapsed >= shotPreview.end) {
      elapsed = shotPreview.end;
      playing = false;
      playButton.textContent = '▶';
    }
    // Frame-time spikes (the periodic streaming hitch) — measured only while playing.
    const frameMs = dt * 1000;
    if (frameMs > debug.maxFrameMs) {
      debug.maxFrameMs = frameMs;
    }
    if (frameMs > 30) {
      debug.slowFrames += 1;
    }
    if (elapsed >= track.duration) {
      naturalEnd = !shotPreview;
      elapsed = track.duration;
      playing = false;
      playButton.textContent = '▶';
    }
  }
  navigation.updateInput(dt);
  if (navigation.isFreeMode()) {
    const freeButton = el<HTMLButtonElement>('freeView');
    setText(freeButton, cockpitLook ? '切到自由视角' : `退出自由视角（${navigation.input.speedLabel}）`);
  }
  setText(
    el<HTMLButtonElement>('cockpitLook'),
    cockpitLook ? `退出机舱观察（${navigation.input.speedLabel}）` : '机舱观察',
  );
  update(track, false);
  if (naturalEnd && lastRenderedCameraState) {
    routeAutoplay.end(now, active + 1 < plays.length, lastRenderedCameraState);
    if (routeAutoplay.enabled && active + 1 === plays.length) setText(el('routeAutoplayStatus'), '已到最后一条路线。');
  }
  if (routeAutoplay.prepare(now)) void beginRouteTravel();
  if (routeAutoplay.finish(now)) {
    routeTravelController = null;
    routeDestinationCamera = null;
    pakWorld?.retainForTravel(false);
    playing = true;
    playButton.textContent = 'Ⅱ';
    setText(el('routeAutoplayStatus'), '正在按列表顺序连续播放。');
  }
  lastFrame = now;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(2, Math.floor(canvas.clientWidth * dpr));
  const height = Math.max(2, Math.floor(canvas.clientHeight * dpr));
  // Fullscreen may keep the same viewport size. Reassigning it would clear a retained paused frame.
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

/** The export rate the HUD is set to; exactly the backend's supported set, with the 30 fps default. */
function selectedExportFps(): number {
  const value = exportFpsSelect ? Number(exportFpsSelect.value) : DEFAULT_EXPORT_FPS;

  return EXPORT_FPS_CHOICES.includes(value) ? value : DEFAULT_EXPORT_FPS;
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
      if (params.has('exportRange') && (!exportRange || !validShotRange(exportRange, track.duration)))
        throw new Error('导出起止时间超出录像范围或格式无效');
      const readyDeadline = performance.now() + 180_000;
      while (!pakWorld.isReady && performance.now() < readyDeadline) await nextFrame();
      if (!pakWorld.isReady) throw new Error('地图纹理上传超时');
      await ensureAircraft();
      if (!aircraft) throw new Error('飞机模型未就绪');
      if (isReplayEnvironment(exportView?.environment)) {
        const environment = exportView.environment;
        hudHour = environment.hour;
        hudWeather = environment.weather;
        timeFlow = environment.timeFlow;
        el<HTMLInputElement>('timeFlow').checked = timeFlow !== null;
        el<HTMLInputElement>('followEnv').checked = isFollowingEnv() && !timeFlow;
      }
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
      if (exportView?.fovYDeg) navigation.camera.fovYDeg = exportView.fovYDeg;
      if (exportView?.mode === 'shot' && exportView.shot) applyShot(exportView.shot);
      if (debug.error) throw new Error(debug.error);
      setupExportCompositor();
      videoExportDriving = true;
      playing = false;
      elapsed = exportRange?.start ?? 0;
      exportClockMs = elapsed * 1000;
      exportParticleSeconds = elapsed;
      await prepareExportScene(track);

      return {
        compositor: {
          backend: 'browser-gpu-compositor',
          height: EXPORT_FRAME_HEIGHT,
          pixelFormat: EXPORT_PIXEL_FORMAT,
          visible: false,
          width: EXPORT_FRAME_WIDTH,
        },
        duration: exportRange ? exportRange.end - exportRange.start : explosionExportDuration(track),
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
let bootPromise = boot();
void bootPromise.catch(reportBootFailure);
