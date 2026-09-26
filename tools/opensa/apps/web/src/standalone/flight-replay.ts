/**
 * GTASA flight replay — OpenSA renders the user's locally baked pak, driven by recorder CSV files.
 * `?local=latest` loads the newest local recording. The GTA install is needed to bake, not to replay.
 */
import { Engine } from '@opensa/engine';
import type { DebugLineSetId } from '@opensa/engine';
import { createEngineEnvironmentDriver } from '@opensa/game/adapters/engine-environment-driver';
import { WEATHER_NAMES } from '@opensa/renderware/parsers/text/timecyc.parser';

import type { AircraftHandle } from '../flight/aircraft';
import type { FlightTrack } from '../flight/csv';

import { loadAircraft } from '../flight/aircraft';
import { FlightAnalysisOverlay } from '../flight/analysis-overlay';
import { setupFlightEffects, type FlightEffects } from '../flight/fx';
import { ReplayCamera, type CameraMode, type CameraStateOut } from '../flight/camera';
import { ChaseCameraTimeline, isChaseMode, type ChaseMode } from '../flight/camera-track';
import { PakWorld } from '../flight/pak-world';
import { NODE_NAMES, parseFlightCsv, sampleTrack } from '../flight/csv';
import { gtaDirToEngine, rotateVec, type Vec3 } from '../flight/math';
import { PakResources } from '../flight/pak-resources';
import { ReplayAudio } from '../flight/replay-audio';
import { installWater } from '../flight/water';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character] ?? character);

/** Live diagnostic state, readable from a CDP/automation session (`window.__flight`). */
interface FlightDebug {
  aircraft: string;
  cameraMode: string;
  cameraDistance: number;
  cameraTravelDot: number;
  cells: number;
  error: null | string;
  gpu: string;
  maxFrameMs: number;
  maxUpStepDeg: number;
  parts: string;
  phase: string;
  seatSource: string;
  envHud: string;
  renders: number;
  seeks: number;
  slowFrames: number;
  status: string;
  worldReady: boolean;
}
const debug: FlightDebug = { aircraft: 'none', cameraDistance: 0, cameraMode: 'chase-mid', cameraTravelDot: 0, cells: 0, envHud: '', error: null, gpu: '', maxFrameMs: 0, maxUpStepDeg: 0, parts: '', phase: 'boot', renders: 0, seatSource: 'none', seeks: 0, slowFrames: 0, status: '', worldReady: false };
/** Camera-up from the previous frame, for the jitter metric (`maxUpStepDeg`). */
let lastCameraUp: Vec3 | null = null;
(window as unknown as { __flight: FlightDebug }).__flight = debug;

/** Debug axes overlay (`?axes=1`): green = recorded forward, blue = up, red = right. */
let axisForward: DebugLineSetId | null = null;
let axisRight: DebugLineSetId | null = null;
let axisUp: DebugLineSetId | null = null;
function ensureAxes(): void {
  if (!SHOW_AXES || axisForward !== null) {
    return;
  }
  axisForward = engine.createDebugLines(new Float32Array(6), [0.1, 1, 0.1, 1]);
  axisRight = engine.createDebugLines(new Float32Array(6), [1, 0.2, 0.2, 1]);
  axisUp = engine.createDebugLines(new Float32Array(6), [0.3, 0.5, 1, 1]);
}
function drawAxes(p: Vec3, forward: Vec3, right: Vec3, up: Vec3): void {
  if (!SHOW_AXES || axisForward === null || axisRight === null || axisUp === null) {
    return;
  }
  const seg = (v: Vec3, length: number) => new Float32Array([p[0], p[1], p[2], p[0] + v[0] * length, p[1] + v[1] * length, p[2] + v[2] * length]);
  engine.updateDebugLines(axisForward, seg(forward, 30));
  engine.updateDebugLines(axisRight, seg(right, 15));
  engine.updateDebugLines(axisUp, seg(up, 15));
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
let hudWeather: number | null = null;
let hudHour: number | null = null;
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
const trackAudioFiles = new WeakMap<FlightTrack, File>();
const replayAudio = new ReplayAudio();
const audioObjectUrls: string[] = [];
const analysis = new FlightAnalysisOverlay({
  onEndpointFocus: (endpoint) => {
    active = endpoint.index;
    elapsed = endpoint.time;
    playing = false;
    playButton.textContent = '▶';
    replayAudio.select(endpoint.track, elapsed);
    analysis.setTrack(endpoint.track);
    analysis.heatmap.setActive(active);
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
  'chase-near': '原版跟随·近',
  'chase-mid': '原版跟随·中',
  'chase-far': '原版跟随·远',
  'first-person': '原版第一人称',
  cockpit: '机舱第一人称',
};
let cameraMode: CameraMode = 'chase-mid';
type ExportView = { mode: CameraMode | 'free'; position?: Vec3; yaw?: number; pitch?: number };
let exportView: ExportView | null = null;
if (VIDEO_EXPORT && params.has('exportView')) {
  try {
    const view = JSON.parse(params.get('exportView') ?? '') as ExportView;
    if (view && (view.mode === 'free' || CAMERA_MODES.includes(view.mode))) {
      exportView = view;
      if (view.mode !== 'free') cameraMode = view.mode;
    }
  } catch { /* malformed export view falls back to chase camera */ }
}
let aircraft: AircraftHandle | null = null;
let aircraftModel = -1;
/** Part index of the cockpit/canopy inside the loaded aircraft, used as the first-person anchor. */
let cockpitPart = -1;
let seatLocal: Vec3 | null = null;
let modelLength = 14;
let modelTop = 3;
let snapCamera = true;
let lastWeather = -1;
let envDriver: ReturnType<typeof createEngineEnvironmentDriver> | null = null;
let engine: Engine;
let flightEffects: FlightEffects | null = null;
/** Route A only: the world streams from a locally baked pak (no welding, no texture-array growth). */
let pakWorld: PakWorld | null = null;
const MAP_PAK_BASE = params.get('pak') ?? '/map-pak';
let camera: ReplayCamera;
let lastRenderedCameraState: CameraStateOut | null = null;
let chaseTimeline: ChaseCameraTimeline | null = null;
let chaseTrack: FlightTrack | null = null;
let chaseSize = '';
let chaseTransition: { from: ChaseMode; started: number } | null = null;
let timecycText = '';

function timelineFor(track: FlightTrack): ChaseCameraTimeline {
  const size = `${modelLength},${modelTop}`;
  if (!chaseTimeline || chaseTrack !== track || chaseSize !== size) {
    chaseTimeline = new ChaseCameraTimeline(track, modelLength, modelTop);
    chaseTrack = track;
    chaseSize = size;
  }
  return chaseTimeline;
}

function fmt(s: number): string {
  const safe = Number.isFinite(s) ? Math.max(0, s) : 0;

  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${(safe % 60).toFixed(3).padStart(6, '0')}`;
}

function activeTrack(): FlightTrack | null {
  return plays[active] ?? null;
}

function setStatus(text: string): void {
  status.textContent = text;
  debug.status = text;
}

/** Apply the recorded (or curated) environment: real game hour + weather from the CSV, never the PC clock. */
function applyEnvironment(row: { gameHour: number | null; gameMinute: number | null; weatherNew: number | null } | null): void {
  const recordedHour = row?.gameHour !== null && row?.gameHour !== undefined ? row.gameHour + (row.gameMinute ?? 0) / 60 : 12;
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

function updateReadout(track: FlightTrack, pose: ReturnType<typeof sampleTrack>): void {
  const row = pose.row;
  const speed = pose.speed;
  const colors = row.colors.every(Number.isFinite) ? row.colors.join(' / ') : '未采集';
  const source = row.nodeStatus === 0 ? '按键推测（inferred）' : row.nodeStatus >= 0x1f ? '真实节点（real）' : '部分真实（partial）';
  const nodeText = NODE_NAMES.map((name, index) => `${name}:${row.nodes[index] ? 'R' : '—'}`).join(' ');
  const gear = Number.isFinite(row.gear) ? row.gear.toFixed(3) : '—';
  const items: [string, string][] = [
    ['文件', track.name],
    ['模型', String(row.model)],
    ['本地时间', new Date(row.timeMs).toLocaleTimeString('zh-CN', { hour12: false })],
    ['游戏时间', `${row.gameHour ?? '—'}:${String(row.gameMinute ?? 0).padStart(2, '0')}（天气 ${row.weatherNew ?? '—'}）`],
    ['环境(显示)', `${Math.round(lastEnv.weather)} ${WEATHER_NAMES[Math.round(lastEnv.weather)] ?? ''} @ ${formatHour(lastEnv.hour)} · ${isFollowingEnv() ? '跟随录制' : '手动'}`],
    ['地图来源', pakWorld ? `预烘焙 pak${pakWorld.note()}` : '预烘焙 pak 未加载'],
    ['显卡', `${debug.gpu || '—'}${debug.phase === 'device-lost' ? ' · 设备已丢失!' : ''}`],
    ['坐标', `${row.pos[0].toFixed(2)}, ${row.pos[1].toFixed(2)}, ${row.pos[2].toFixed(2)}`],
    ['航向', `${row.heading.toFixed(2)}°`],
    ['速度', `${speed.toFixed(2)} 单位/秒`],
    ['血量', row.health.toFixed(1)],
    ['颜色 ID', colors],
    ['姿态', track.axesNote],
    ['起落架原始值', gear],
    ['Hydra 喷口控制', row.nozzleRotation === null ? '未采集' : `${Math.round(row.nozzleRotation)} / 5000`],
    ['冒烟', row.smokeActive === null ? '未采集' : row.smokeActive ? '是' : '否'],
    ['动画节点来源', source],
    ['节点', nodeText],
  ];
  readout.innerHTML = items.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join('');
  const keyItems: [string, number][] = [
    ['Q', row.keyQ], ['A', row.keyA], ['E', row.keyE], ['D', row.keyD], ['↑', row.keyUp], ['↓', row.keyDown],
  ];
  keys.innerHTML = keyItems.map(([label, value]) => `<div class="key ${value ? 'on' : ''}">${label}</div>`).join('');
  const note = `${track.name} · 采样 ${track.rows.length} · ${source}`;
  setStatus(note);
  segmentChip.textContent = track.name;
}

function update(track: FlightTrack, forceSnap: boolean): void {
  const pose = sampleTrack(track, elapsed);
  applyEnvironment(pose.row);
  const posEngine: Vec3 = [pose.pos[0], pose.pos[2], -pose.pos[1]];
  if (aircraft) {
    aircraft.setVisible(cameraMode !== 'first-person');
    aircraft.applyPose(pose.pos, pose.orientation);
    aircraft.applyPaint(pose.row.colors);
    const keysInferred = {
      pitch: ((pose.row.keyUp || 0) - (pose.row.keyDown || 0)) * 0.30,
      roll: ((pose.row.keyD || 0) - (pose.row.keyA || 0)) * 0.38,
      yaw: ((pose.row.keyE || 0) - (pose.row.keyQ || 0)) * 0.28,
    };
    aircraft.applyNodes(pose.nodes, pose.row.gear, keysInferred);
    aircraft.applyProps({ nodes: pose.row.propNodes, nozzleRotation: pose.row.nozzleRotation });
  }
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
  // Flatten BEFORE the camera: the cockpit anchor is a part world matrix, only valid for this frame.
  engine.updateVehicles();
  let cockpitPosition: Vec3 | undefined;
  if (aircraft && cockpitPart >= 0) {
    const matrices = aircraft.instance.entity.matrices;
    const offset = cockpitPart * 16;
    cockpitPosition = [matrices[offset + 12], matrices[offset + 13], matrices[offset + 14]];
  }
  const firstPersonPosition: Vec3 | undefined = seatLocal ? [
    posEngine[0] + right[0] * seatLocal[0] + forward[0] * seatLocal[1] + up[0] * seatLocal[2],
    posEngine[1] + right[1] * seatLocal[0] + forward[1] * seatLocal[1] + up[1] * seatLocal[2],
    posEngine[2] + right[2] * seatLocal[0] + forward[2] * seatLocal[1] + up[2] * seatLocal[2],
  ] : undefined;
  const dt = Math.min(0.1, Math.max(0.0001, (performance.now() - lastFrame) / 1000));
  const velocity = gtaDirToEngine(pose.velocity);
  const aspect = canvas.width / Math.max(1, canvas.height);
  const gameAspect = window.screen.width / Math.max(1, window.screen.height);
  let cameraState = isChaseMode(cameraMode)
    ? timelineFor(track).state(elapsed, cameraMode, aspect, gameAspect)
    : camera.state({
      aspect, gameAspect, cockpitPosition, dt, firstPersonPosition, forward,
      model: pose.row.model, modelLength, modelTop,
      position: posEngine, snap: forceSnap || snapCamera, up, velocity,
    });
  const freeCameraState = analysis.cameraState(aspect);
  if (freeCameraState) cameraState = freeCameraState;
  if (!freeCameraState && chaseTransition && isChaseMode(cameraMode)) {
    const blend = Math.min(1, (performance.now() - chaseTransition.started) / 250);
    if (blend < 1) {
      const previous = timelineFor(track).state(elapsed, chaseTransition.from, aspect, gameAspect);
      cameraState.eye = [0, 1, 2].map((axis) => previous.eye[axis] + (cameraState.eye[axis] - previous.eye[axis]) * blend) as Vec3;
    } else {
      chaseTransition = null;
    }
  }
  if (!freeCameraState && isChaseMode(cameraMode) && pakWorld?.isReady) {
    cameraState = pakWorld.resolveCamera(cameraState, cameraMode, dt, forceSnap || snapCamera);
  }
  debug.cameraMode = freeCameraState ? 'free' : cameraMode;
  const view = [cameraState.target[0] - cameraState.eye[0], cameraState.target[1] - cameraState.eye[1], cameraState.target[2] - cameraState.eye[2]];
  debug.cameraDistance = Math.hypot(...view);
  debug.cameraTravelDot = view.reduce((sum, component, index) => sum + component * velocity[index], 0) / Math.max(1e-6, Math.hypot(...view) * Math.hypot(...velocity));
  snapCamera = false;
  lastRenderedCameraState = cameraState;
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
  updateReadout(track, pose);
  analysis.update(elapsed, { trackName: track.name, model: track.model, playing });
  replayAudio.sync(playing, Number(el<HTMLSelectElement>('speed').value), elapsed);
  clock.textContent = `${fmt(elapsed)} / ${fmt(track.duration)}`;
  // The scrubber's range must track the ACTIVE recording, or dragging it clamps every value to 0.
  if (scrub.max !== String(track.duration)) {
    scrub.max = String(track.duration);
  }
  scrub.value = String(elapsed);
  modeChip.textContent = `${freeCameraState ? '自由视角' : CAMERA_LABELS[cameraMode]}（${playing ? '播放中' : '暂停'}）`;
  el('follow').textContent = `视角：${CAMERA_LABELS[cameraMode]}`;
  if (pakWorld?.isReady) {
    const streamPos = freeCameraState ? analysis.camera.position : posEngine;
    pakWorld.update(streamPos[0], -streamPos[2], pakWorld.renderRadius.hd, pakWorld.renderRadius.lod);
    const busy = pakWorld.loadedCells === 0 && pakWorld.isLoading;
    mapLoading.hidden = !busy;
    if (busy) mapLoadingText.textContent = '载入预烘焙地图…';
  }
}

async function selectTrack(index: number): Promise<void> {
  active = Math.max(0, Math.min(plays.length - 1, index));
  elapsed = 0;
  replayAudio.select(plays[active], elapsed);
  analysis.setTrack(plays[active]);
  analysis.heatmap.setActive(active);
  snapCamera = true;
  chaseTransition = null;
  void ensureAircraft();
  renderTrackList();
  frameOnce();
}

function renderTrackList(): void {
  el<HTMLButtonElement>('bakeRoute').disabled = !activeTrack() || routeBakeRunning;
  tracksEl.innerHTML = plays.map((track, index) => (
    `<div class="track ${index === active ? 'active' : ''}" data-i="${index}">` +
    `<span class="track-name">${escapeHtml(track.name)}</span><span class="badge">${track.rows.length}</span>` +
    `<span class="track-meta">${fmt(track.duration)} · 模型 ${track.model}</span></div>`
  )).join('');
  tracksEl.querySelectorAll<HTMLElement>('.track').forEach((node) => {
    node.onclick = () => void selectTrack(Number(node.dataset.i));
  });
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

function frameOnce(): void {
  const track = activeTrack();
  if (track) {
    update(track, snapCamera);
  }
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
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }
  for (const file of wavFiles) {
    const stem = file.name.replace(/\.wav$/i, '').toLowerCase();
    const track = [...plays].reverse().find((item) => item.name.replace(/\.csv$/i, '').toLowerCase() === stem);
    if (track) {
      const url = URL.createObjectURL(file);
      audioObjectUrls.push(url);
      trackAudioFiles.set(track, file);
      replayAudio.attach(track, url);
    }
  }
  analysis.setTracks(plays, active);
  if (plays.length) {
    renderTrackList();
    await ensureAircraft();
    await selectTrack(plays.length - 1);
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
    const track = parseFlightCsv(csv, recording === '/local-recording/latest.csv' ? '最新本地记录.csv' : '航迹包录像.csv');
    trackSources.set(track, csv);
    const originalName = response.headers.get('X-Recording-Name');
    if (originalName) trackFilenames.set(track, originalName);
    const audioUrl = response.headers.get('X-Recording-Audio')
      ?? (recording !== '/local-recording/latest.csv' && recording.endsWith('.csv') ? `${recording.slice(0, -4)}.wav` : '');
    if (audioUrl && !VIDEO_EXPORT) replayAudio.attach(track, audioUrl);
    plays.push(track);
    analysis.setTracks(plays, active);
    renderTrackList();
    await ensureAircraft();
    await selectTrack(plays.length - 1);
  } catch (error) {
    setStatus(`本地记录载入失败：${error instanceof Error ? error.message : String(error)}`);
  }
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
    const response = await fetch('/route-bake', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv }) });
    if (!response.ok) throw new Error(await response.text());
    const { id } = await response.json() as { id: string };
    for (;;) {
      await new Promise((resolve) => window.setTimeout(resolve, 1000));
      const progress = await fetch(`/route-bake/${id}`);
      if (!progress.ok) throw new Error('烘焙状态不可用');
      const job = await progress.json() as { state: string; message: string };
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

let resources!: PakResources;

async function exportActiveVideo(button: HTMLButtonElement, cancel: HTMLButtonElement, note: HTMLElement): Promise<void> {
  const track = activeTrack();
  const csv = track && trackSources.get(track);
  if (!track || !csv) return;
  button.disabled = true;
  cancel.hidden = true;
  note.textContent = '准备导出…';
  let jobId = '';
  try {
    const filename = trackFilenames.get(track);
    const audioFile = trackAudioFiles.get(track);
    let audioToken: string | undefined;
    if (audioFile) {
      note.textContent = '上传录制音频…';
      const upload = await fetch('/video-export/audio', {
        method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: audioFile,
      });
      if (!upload.ok) throw new Error((await upload.json() as { error?: string }).error ?? '音频上传失败');
      audioToken = (await upload.json() as { token: string }).token;
    }
    const view = analysis.isFreeMode()
      ? { mode: 'free', position: analysis.camera.position, yaw: analysis.camera.yaw, pitch: analysis.camera.pitch }
      : { mode: cameraMode };
    const response = await fetch('/video-export', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ csv, filename: filename && /^flight_[A-Za-z0-9._-]+\.csv$/i.test(filename) ? filename : undefined,
        pakBase: MAP_PAK_BASE, view, audioToken }),
    });
    if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? '导出请求失败');
    jobId = (await response.json() as { id: string }).id;
    cancel.hidden = false;
    cancel.onclick = () => { void fetch(`/video-export/${jobId}/cancel`, { method: 'POST' }); };
    for (;;) {
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      const progress = await fetch(`/video-export/${jobId}`);
      if (!progress.ok) throw new Error('导出状态不可用');
      const job = await progress.json() as { state: string; message: string; progress: number; audio: boolean; downloadUrl: string | null };
      note.textContent = `${job.message} · ${job.progress}%`;
      if (job.state === 'failed' || job.state === 'cancelled') throw new Error(job.message);
      if (job.state === 'ready' && job.downloadUrl) {
        const link = document.createElement('a');
        link.href = job.downloadUrl;
        link.textContent = `下载 MP4${job.audio ? '（含游戏原声）' : '（无录制音频）'}`;
        link.style.color = 'var(--accent)';
        note.replaceChildren(link);
        break;
      }
    }
  } catch (error) {
    note.textContent = `导出失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    button.disabled = false;
    cancel.hidden = true;
  }
}

async function boot(): Promise<void> {
  const bootId = crypto.randomUUID();
  let bootStage = 'engine-init';
  let pakDownloads = 0;
  const report = async (payload: Record<string, unknown>): Promise<void> => {
    // Best-effort boot traceback: if the local server exposes /webgpu-report it records one line, which is
    // how a remote run is told apart from "the page never started".
    try {
      await fetch('/webgpu-report', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'flight-replay', bootId, stage: bootStage, ...payload }) });
    } catch { /* no report route, or offline — not fatal */ }
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
    setStatus(`WebGPU 初始化失败：${error instanceof Error ? error.message : String(error)} 诊断页：/opensa/webgpu-check.html`);
    mapLoading.hidden = true;
    void report({ phase: 'engine-failed', error: error instanceof Error ? error.message : String(error) });

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
      void report({ gpu: debug.gpu, phase: 'device-lost', reason: info.reason,
        pakDownloads, uploadedArrays: pakWorld?.uploadedArrays ?? 0,
        pakReady: pakWorld?.isReady ?? false, loadedCells: pakWorld?.loadedCells ?? 0,
        renders: debug.renders, canvas: `${canvas.width}x${canvas.height}` });
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
    .catch(() => { /* lost promise rejection is not actionable */ });
  ensureAxes();
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
    mapLoadingText.textContent = '未找到预烘焙地图（/map-pak/index.json）。请先运行：cd tools\\opensa && npx tsx scripts\\bake-map.mts map-pak';
    setStatus('缺少预烘焙地图 pak，无法回放。请先烘焙（见 HANDOFF）。');
    void report({ phase: 'no-pak' });

    return;
  }
  bootStage = 'pak-resources';
  resources = await PakResources.load(MAP_PAK_BASE);
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

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(2, Math.floor(canvas.clientWidth * dpr));
  canvas.height = Math.max(2, Math.floor(canvas.clientHeight * dpr));
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
  const now = performance.now();
  const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000));
  const track = activeTrack();
  if (!track) {
    // Idle: keep the world drawing so the loading overlay can clear.
    if (engine && camera) {
      engine.frame(camera.state({
        aspect: canvas.width / Math.max(1, canvas.height), dt: 0.016, forward: [0, 0, -1],
        model: 520, modelLength, modelTop, position: [0, 40, 0], snap: false, up: [0, 1, 0], velocity: [0, 0, 0],
      }));
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
  analysis.updateInput(dt);
  update(track, false);
  lastFrame = now;
}

function cycleCamera(): void {
  analysis.setFreeMode(false);
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

function bindUi(): void {
  analysis.mountHud(el('analysis-hud'));
  analysis.mountHeatmap(el('analysis-heatmap'));
  analysis.attachCameraInput(canvas);
  if (VIDEO_EXPORT) {
    document.body.classList.add('video-export-mode');
    analysis.setHudVisible(true);
    analysis.setHudCollapsed(false);
    analysis.setHeatmapVisible(false);
  }
  if (MAP_PAK_BASE.startsWith('/route-pak/')) {
    el('bakeStatus').textContent = '当前使用航迹包；远景范围为 1200 单位。';
  }
  const drop = el<HTMLDivElement>('drop');
  const picker = el<HTMLInputElement>('picker');
  picker.accept = '.csv,.wav,text/csv,audio/wav';
  const audioButton = document.createElement('button');
  audioButton.type = 'button';
  audioButton.title = '切换录制的游戏原声音频；旧录像可以没有 WAV';
  audioButton.textContent = '音频：开';
  audioButton.onclick = () => {
    replayAudio.muted = !replayAudio.muted;
    audioButton.textContent = replayAudio.muted ? '音频：关' : '音频：开';
  };
  el<HTMLSelectElement>('speed').insertAdjacentElement('afterend', audioButton);
  const freeButton = document.createElement('button');
  freeButton.type = 'button';
  freeButton.id = 'freeView';
  freeButton.textContent = '自由视角';
  freeButton.title = 'WASD 移动，QE 升降，拖动画面旋转，滚轮前后移动；Shift 加速';
  freeButton.onclick = () => {
    if (analysis.isFreeMode()) {
      analysis.setFreeMode(false);
      freeButton.textContent = '自由视角';
      camera.reset();
      snapCamera = true;
    } else {
      if (lastRenderedCameraState) {
        analysis.camera.setPose({ position: lastRenderedCameraState.eye });
        analysis.camera.lookAt(lastRenderedCameraState.target);
        analysis.camera.focusDistance = Math.hypot(
          lastRenderedCameraState.target[0] - lastRenderedCameraState.eye[0],
          lastRenderedCameraState.target[1] - lastRenderedCameraState.eye[1],
          lastRenderedCameraState.target[2] - lastRenderedCameraState.eye[2],
        );
      }
      analysis.setFreeMode(true);
      freeButton.textContent = '退出自由视角';
    }
    frameOnce();
  };
  el('follow').insertAdjacentElement('afterend', freeButton);
  const heatmapButton = document.createElement('button');
  heatmapButton.type = 'button';
  heatmapButton.textContent = '终点热力图';
  heatmapButton.onclick = () => {
    analysis.toggleHeatmap();
    if (analysis.heatmap.isVisible()) el<HTMLElement>('right').hidden = true;
  };
  freeButton.insertAdjacentElement('afterend', heatmapButton);
  const rawButton = document.createElement('button');
  rawButton.type = 'button';
  rawButton.textContent = '原始数据';
  rawButton.onclick = () => {
    const panel = el<HTMLElement>('right');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) analysis.setHeatmapVisible(false);
  };
  heatmapButton.insertAdjacentElement('afterend', rawButton);
  const videoButton = document.createElement('button');
  videoButton.type = 'button';
  videoButton.textContent = '导出 MP4';
  const cancelVideo = document.createElement('button');
  cancelVideo.type = 'button';
  cancelVideo.textContent = '取消导出';
  cancelVideo.hidden = true;
  const videoNote = document.createElement('span');
  videoNote.className = 'small';
  videoButton.onclick = () => { void exportActiveVideo(videoButton, cancelVideo, videoNote); };
  rawButton.insertAdjacentElement('afterend', videoButton);
  videoButton.insertAdjacentElement('afterend', cancelVideo);
  cancelVideo.insertAdjacentElement('afterend', videoNote);
  drop.onclick = () => picker.click();
  drop.onkeydown = (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      picker.click();
    }
  };
  ['dragenter', 'dragover'].forEach((type) => drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.add('drag');
  }));
  ['dragleave', 'drop'].forEach((type) => drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.remove('drag');
  }));
  drop.addEventListener('drop', (event) => {
    const files = [...(event.dataTransfer?.files ?? [])].filter((file) => /\.(csv|wav)$/i.test(file.name));
    void addFiles(files);
  });
  picker.onchange = () => {
    void addFiles([...picker.files ?? []]);
  };
  el<HTMLButtonElement>('bakeRoute').onclick = () => { void bakeActiveRoute(); };
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
    analysis.setFreeMode(false);
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
  window.addEventListener('beforeunload', () => audioObjectUrls.forEach((url) => URL.revokeObjectURL(url)));

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

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

let bootPromise: Promise<void>;
if (VIDEO_EXPORT) {
  (window as unknown as { __flightVideoExport: {
    ready(): Promise<{ duration: number }>;
    renderFrame(seconds: number): Promise<void>;
  } }).__flightVideoExport = {
    async ready() {
      await bootPromise;
      const track = activeTrack();
      if (!track || !engine || !pakWorld) throw new Error('回放或地图未就绪');
      const readyDeadline = performance.now() + 180_000;
      while (!pakWorld.isReady && performance.now() < readyDeadline) await nextFrame();
      if (!pakWorld.isReady) throw new Error('地图纹理上传超时');
      await ensureAircraft();
      if (!aircraft) throw new Error('飞机模型未就绪');
      if (exportView?.mode === 'free' && exportView.position && exportView.yaw !== undefined && exportView.pitch !== undefined) {
        analysis.camera.setPose({ position: exportView.position, yaw: exportView.yaw, pitch: exportView.pitch });
        analysis.setFreeMode(true);
      }
      const deadline = performance.now() + 120_000;
      while (pakWorld.loadedCells === 0 && pakWorld.isLoading && performance.now() < deadline) await nextFrame();
      if (debug.error) throw new Error(debug.error);
      return { duration: track.duration };
    },
    async renderFrame(seconds) {
      const track = activeTrack();
      if (!track || !engine) throw new Error('回放未就绪');
      playing = false;
      elapsed = Math.max(0, Math.min(track.duration, seconds));
      snapCamera = true;
      update(track, true);
      const deadline = performance.now() + 30_000;
      while (pakWorld?.isLoading && performance.now() < deadline) await nextFrame();
      if (pakWorld?.isLoading) throw new Error('地图地块载入超时');
      await engine.device.queue.onSubmittedWorkDone();
      await nextFrame();
      await nextFrame();
      if (debug.error) throw new Error(debug.error);
    },
  };
}

bindUi();
bootPromise = boot();
void bootPromise.catch((error) => {
  setStatus(`启动失败：${error instanceof Error ? error.message : String(error)}`);
});
