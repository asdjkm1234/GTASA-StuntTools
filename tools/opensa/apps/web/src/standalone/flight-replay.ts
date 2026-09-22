/**
 * GTASA flight replay — the OpenSA WebGPU engine rendering the user's own GTA SA install, driven by the
 * recorder's CSV. Boot: `?src=/game-src` (default) points the raw-install loader at the local server, and
 * `?local=latest` loads the newest recording from `flight_recordings/`. Everything runs on this machine.
 */
import { CELL_SIZE } from '@opensa/cell-weld/cell-size';
import { Engine } from '@opensa/engine';
import type { DebugLineSetId } from '@opensa/engine';
import { createEngineEnvironmentDriver } from '@opensa/game/adapters/engine-environment-driver';
import { WEATHER_NAMES } from '@opensa/renderware/parsers/text/timecyc.parser';

import type { AircraftHandle } from '../flight/aircraft';
import type { FlightTrack } from '../flight/csv';

import { loadAircraft } from '../flight/aircraft';
import { ReplayCamera } from '../flight/camera';
import { CellRenderer, mapCenterGta, type CellTarget } from '../flight/cell-renderer';
import { PakWorld } from '../flight/pak-world';
import { NODE_NAMES, parseFlightCsv, sampleTrack } from '../flight/csv';
import { rotateVec, type Vec3 } from '../flight/math';
import { loadMapSource } from '../flight/map-source';
import { installWater } from '../flight/water';

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

/** Live diagnostic state, readable from a CDP/automation session (`window.__flight`). */
interface FlightDebug {
  aircraft: string;
  cells: number;
  error: null | string;
  maxFrameMs: number;
  maxUpStepDeg: number;
  parts: string;
  phase: string;
  envHud: string;
  renders: number;
  seeks: number;
  slowFrames: number;
  status: string;
}
const debug: FlightDebug = { aircraft: 'none', cells: 0, envHud: '', error: null, maxFrameMs: 0, maxUpStepDeg: 0, parts: '', phase: 'boot', renders: 0, seeks: 0, slowFrames: 0, status: '' };
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
// Streaming radii are URL-tunable: the Arc-class GPUs hung (DXGI_ERROR_DEVICE_HUNG) when ~450 cells
// (HD 1100 m + LOD 3200 m) welded and uploaded at once, so the defaults stay conservative.
// Tunables are HUD-driven; the URL is only an optional override (kept for scripted tests). Defaults are
// deliberately conservative for older machines.
let HD_RADIUS = Number(params.get('hd') ?? 400);
let LOD_RADIUS = Number(params.get('lod') ?? 1000);
const SRC = params.get('src') ?? '/game-src';
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
let active = 0;
let playing = false;
let elapsed = 0;
let lastFrame = performance.now();
let cameraMode: 'chase' | 'cockpit' = 'chase';
let aircraft: AircraftHandle | null = null;
let aircraftModel = -1;
/** Part index of the cockpit/canopy inside the loaded aircraft, used as the first-person anchor. */
let cockpitPart = -1;
let snapCamera = true;
let lastWeather = -1;
let envDriver: ReturnType<typeof createEngineEnvironmentDriver> | null = null;
let engine: Engine;
let renderer: CellRenderer;
/** Route A: when a baked pak is served, the world streams from it (no welding, no array growth). */
let pakWorld: PakWorld | null = null;
const MAP_PAK_BASE = params.get('pak') ?? '/map-pak';
let camera: ReplayCamera;
let timecycText = '';

interface StreamState {
  busy: boolean;
  pending: null | [number, number];
  lastAt: number;
  last: string;
  firstLoad: boolean;
}
const stream: StreamState = { busy: false, firstLoad: true, last: '', lastAt: 0, pending: null };

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

function buildCellTargets(x: number, y: number): { cx: number; cy: number; lod: boolean }[] {
  const hd: { cx: number; cy: number; lod: boolean }[] = [];
  const lod: { cx: number; cy: number; lod: boolean }[] = [];
  for (const cell of gtaGrid) {
    const dx = (cell.cx + 0.5) * CELL_SIZE - x;
    const dy = (cell.cy + 0.5) * CELL_SIZE - y;
    const distance = Math.hypot(dx, dy);
    if (distance <= HD_RADIUS) {
      hd.push({ cx: cell.cx, cy: cell.cy, lod: false });
    } else if (distance <= LOD_RADIUS) {
      lod.push({ cx: cell.cx, cy: cell.cy, lod: true });
    }
  }

  return [...hd, ...lod];
}

let gtaGrid: { cx: number; cy: number }[] = [];

async function drainStream(): Promise<void> {
  if (stream.busy) {
    return;
  }
  stream.busy = true;
  try {
    while (stream.pending) {
      const [x, y] = stream.pending;
      stream.pending = null;
      const targets = buildCellTargets(x, y);
      const signature = `${targets.length}:${Math.round(x / 300)}:${Math.round(y / 300)}`;
      if (signature === stream.last) {
        continue;
      }
      stream.last = signature;
      const first = stream.firstLoad;
      if (first) {
        mapLoading.hidden = false;
        mapLoadingText.textContent = `正在拼合原版地图（${targets.length} 个单元）…`;
      }
      await renderer.setTargets(targets, (done, total) => {
        if (first) {
          mapLoadingText.textContent = `正在拼合原版地图 ${Math.round((done / Math.max(1, total)) * 100)}%`;
        }
      });
      if (first) {
        mapLoading.hidden = true;
        stream.firstLoad = false;
      }
    }
  } catch (error) {
    mapLoading.hidden = true;
    setStatus(`地图单元加载失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    stream.busy = false;
  }
}

let lastStreamCell = '';

function requestStream(x: number, y: number, force = false): void {
  // Re-stream only when the aircraft enters a different cell. The old time-based trigger fired every 500 ms
  // regardless of movement, and each tick re-encoded the whole texture atlas — a ~2 Hz hitch.
  const cell = `${Math.floor(x / CELL_SIZE)},${Math.floor(y / CELL_SIZE)}`;
  if (!force && cell === lastStreamCell) {
    return;
  }
  lastStreamCell = cell;
  stream.pending = [x, y];
  void drainStream();
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
    ['航迹准备', `${Math.round(preparedRatio(activeTrack()) * 100)}%${PREPARE_ENABLED ? '' : '（已关闭）'}`],
    ['地图来源', pakWorld ? `预烘焙 pak${pakWorld.note()}` : '原始安装（实时焊接）'],
    ['坐标', `${row.pos[0].toFixed(2)}, ${row.pos[1].toFixed(2)}, ${row.pos[2].toFixed(2)}`],
    ['航向', `${row.heading.toFixed(2)}°`],
    ['速度', `${speed.toFixed(2)} 单位/秒`],
    ['血量', row.health.toFixed(1)],
    ['颜色 ID', colors],
    ['姿态', track.axesNote],
    ['起落架原始值', gear],
    ['动画节点来源', source],
    ['节点', nodeText],
  ];
  readout.innerHTML = items.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join('');
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
    aircraft.applyPose(pose.pos, pose.orientation);
    aircraft.applyPaint(pose.row.colors);
    const keysInferred = {
      pitch: ((pose.row.keyUp || 0) - (pose.row.keyDown || 0)) * 0.30,
      roll: ((pose.row.keyD || 0) - (pose.row.keyA || 0)) * 0.38,
      yaw: ((pose.row.keyE || 0) - (pose.row.keyQ || 0)) * 0.28,
    };
    aircraft.applyNodes(pose.nodes, pose.row.gear, keysInferred);
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
  let camBase = posEngine;
  if (cameraMode === 'cockpit' && aircraft && cockpitPart >= 0) {
    const matrices = aircraft.instance.entity.matrices;
    const offset = cockpitPart * 16;
    camBase = [matrices[offset + 12], matrices[offset + 13], matrices[offset + 14]];
  }
  const dt = Math.min(0.1, Math.max(0.0001, (performance.now() - lastFrame) / 1000));
  const cameraState = camera.state(dt, camBase, forward, up, canvas.width / Math.max(1, canvas.height), pose.speed, forceSnap || snapCamera);
  snapCamera = false;
  try {
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
  clock.textContent = `${fmt(elapsed)} / ${fmt(track.duration)}`;
  // The scrubber's range must track the ACTIVE recording, or dragging it clamps every value to 0.
  if (scrub.max !== String(track.duration)) {
    scrub.max = String(track.duration);
  }
  scrub.value = String(elapsed);
  modeChip.textContent = playing ? (cameraMode === 'cockpit' ? '机舱（播放中）' : '延迟跟随（播放中）') : cameraMode === 'cockpit' ? '机舱（暂停）' : '延迟跟随（暂停）';
  el('follow').textContent = cameraMode === 'cockpit' ? '视角：机舱第一人称' : '视角：延迟跟随';
  if (pakWorld) {
    if (pakWorld.isReady) {
      pakWorld.update(pose.pos[0], pose.pos[1], HD_RADIUS, LOD_RADIUS);
      const busy = pakWorld.loadedCells === 0 && pakWorld.isLoading;
      mapLoading.hidden = !busy;
      if (busy) mapLoadingText.textContent = '载入预烘焙地图…';
    }
  } else {
    requestStream(pose.pos[0], pose.pos[1]);
  }
}

/**
 * Weld every cell the recording's ROUTE will need, once, before playback. The route is known, so this keeps
 * the engine's append-only texture array from growing mid-flight (the growth re-uploads all resident cells and
 * is what tripped GPU TDR / the late black screen).
 */
/**
 * Background route preparation. The whole-route wait is gone: playback starts immediately and this pump
 * welds the route in small batches, IN ROUTE ORDER (start first, later parts lowest priority), a few cells
 * per tick so the frame thread is never held. The ACTIVE recording is prepared first; other open recordings
 * are queued behind it and processed in list order, one at a time.
 *
 * Growth of the engine's texture array is unavoidable when new textures appear; `preloadTargets` recreates
 * the resident cells when that happens (see HANDOFF #13), so a batch never blanks the screen.
 */
interface PrepareState {
  cursor: number;
  targets: CellTarget[];
}
const prepareState = new Map<FlightTrack, PrepareState>();
/**
 * Safe mode (default): the ACTIVE route's texture arrays are resolved and committed ONCE before playback, so
 * no texture array is ever replaced while cells are resident — the only configuration that does not risk
 * `DXGI_ERROR_DEVICE_HUNG` on this GPU. Dynamic mode (experimental, HUD toggle) starts instantly and grows
 * arrays at runtime; that growth is the known TDR source, so it is opt-in.
 */
let DYNAMIC_LOAD = params.get('dynamic') === '1';
let PREPARE_ENABLED = params.get('prepare') !== '0';
let PREPARE_BUDGET = Math.max(4, Number(params.get('budget') ?? 60));
let PREPARE_INTERVAL = Math.max(200, Number(params.get('prepareInterval') ?? 1000));
let prepareBusy = false;

/** Self-scheduling so the HUD's 间隔 slider takes effect immediately. */
function schedulePrepare(): void {
  window.setTimeout(() => {
    pumpPrepare();
    schedulePrepare();
  }, PREPARE_INTERVAL);
}

/** Cells a recording's route needs, ordered by route time (start → end). */
function buildRouteTargets(track: FlightTrack): CellTarget[] {
  const wanted = new Map<string, CellTarget>();
  for (let s = 0; s <= track.duration; s += 1) {
    const p = sampleTrack(track, s).pos;
    for (const cell of gtaGrid) {
      const dx = (cell.cx + 0.5) * CELL_SIZE - p[0];
      const dy = (cell.cy + 0.5) * CELL_SIZE - p[1];
      const distance = Math.hypot(dx, dy);
      if (distance <= HD_RADIUS) {
        wanted.set(`${cell.cx},${cell.cy},hd`, { cx: cell.cx, cy: cell.cy, lod: false });
      } else if (distance <= LOD_RADIUS) {
        wanted.set(`${cell.cx},${cell.cy},lod`, { cx: cell.cx, cy: cell.cy, lod: true });
      }
    }
  }

  return [...wanted.values()];
}

function preparedRatio(track: FlightTrack | null): number {
  if (!track) return 1;
  const state = prepareState.get(track);
  if (!state) return 0;
  return state.targets.length ? state.cursor / state.targets.length : 1;
}

function pumpPrepare(): void {
  if (!DYNAMIC_LOAD || !PREPARE_ENABLED || prepareBusy || !renderer) return;
  const first = activeTrack();
  const order = first ? [first, ...plays.filter((track) => track !== first)] : [...plays];
  for (const track of order) {
    const state = prepareState.get(track) ?? (() => {
      const created: PrepareState = { cursor: 0, targets: buildRouteTargets(track) };
      prepareState.set(track, created);

      return created;
    })();
    if (state.cursor >= state.targets.length) continue;
    const batch = state.targets.slice(state.cursor, state.cursor + PREPARE_BUDGET);
    state.cursor += batch.length;
    prepareBusy = true;
    void renderer.preloadTargets(batch).catch(() => { /* a bad cell must not stop the pump */ }).finally(() => {
      prepareBusy = false;
    });

    return;
  }
}

async function selectTrack(index: number): Promise<void> {
  active = Math.max(0, Math.min(plays.length - 1, index));
  elapsed = 0;
  snapCamera = true;
  void ensureAircraft();
  renderTrackList();
  const track = activeTrack();
  if (track && !DYNAMIC_LOAD && !pakWorld) {
    // SAFE MODE: resolve + commit this route's textures once, before any cell is resident.
    const state = prepareState.get(track) ?? { cursor: 0, targets: buildRouteTargets(track) };
    prepareState.set(track, state);
    if (state.cursor < state.targets.length) {
      mapLoading.hidden = false;
      mapLoadingText.textContent = `准备航迹纹理（${state.targets.length} 个地块）…`;
      await renderer.preloadTargets(state.targets.slice(state.cursor), (done, total) => {
        mapLoadingText.textContent = `准备航迹纹理 ${Math.round((done / Math.max(1, total)) * 100)}%（${done}/${total}）`;
      }, true);
      state.cursor = state.targets.length;
      mapLoading.hidden = true;
    }
  }
  frameOnce();
}

function renderTrackList(): void {
  tracksEl.innerHTML = plays.map((track, index) => (
    `<div class="track ${index === active ? 'active' : ''}" data-i="${index}">` +
    `<span class="track-name">${track.name}</span><span class="badge">${track.rows.length}</span>` +
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
  aircraftModel = track.model;
  try {
    aircraft = await loadAircraft(engine, map, track.model);
    cockpitPart = aircraft.data.parts.findIndex((part) => part.name === 'door_lf');
    if (cockpitPart < 0) {
      cockpitPart = aircraft.data.parts.findIndex((part) => part.name === 'chassis');
    }
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
  for (const file of files) {
    try {
      plays.push(parseFlightCsv(await file.text(), file.name));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : String(error));
    }
  }
  if (plays.length) {
    renderTrackList();
    await ensureAircraft();
    await selectTrack(plays.length - 1);
  }
}

async function loadLatest(): Promise<void> {
  try {
    const response = await fetch('/local-recording/latest.csv');
    if (!response.ok) {
      throw new Error('没有找到本地录制文件');
    }
    plays.push(parseFlightCsv(await response.text(), '最新本地记录.csv'));
    renderTrackList();
    await ensureAircraft();
    await selectTrack(plays.length - 1);
  } catch (error) {
    setStatus(`本地记录载入失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

let map!: Awaited<ReturnType<typeof loadMapSource>>;

async function boot(): Promise<void> {
  const report = async (payload: Record<string, unknown>): Promise<void> => {
    // Best-effort boot traceback: if the local server exposes /webgpu-report it records one line, which is
    // how a remote run is told apart from "the page never started".
    try {
      await fetch('/webgpu-report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'flight-replay', ...payload }) });
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
  ensureAxes();
  const scale = Number(params.get('scale') ?? Number.NaN);
  if (Number.isFinite(scale) && scale > 0.2 && scale <= 1) {
    engine.renderScale = scale;
  }
  engine.environment.windStrength = 0;
  engine.waterEnabled = true;
  camera = new ReplayCamera();
  camera.mode = cameraMode;
  setStatus('正在读取本地 GTA 安装并建立世界索引…');
  map = await loadMapSource({ base: SRC, kind: 'http-dir' });
  timecycText = map.fs.getText('data/timecyc.dat') ?? '';
  gtaGrid = [...map.grid.values()].map((cell) => ({ cx: cell.cx, cy: cell.cy }));
  debug.cells = gtaGrid.length;
  renderer = new CellRenderer(engine, map);
  installWater(engine, map);
  if (await PakWorld.probe(MAP_PAK_BASE)) {
    const pak = new PakWorld(engine, MAP_PAK_BASE);
    mapLoading.hidden = false;
    mapLoadingText.textContent = '读取预烘焙地图索引…';
    try {
      await pak.load((done, total) => {
        mapLoadingText.textContent = `读取预烘焙纹理 ${done}/${total}…`;
      });
      pakWorld = pak;
    } catch { /* fall back to the raw-install path below */ }
  }
  if (!pakWorld) {
    schedulePrepare();
  }
  setStatus(`世界索引就绪：${gtaGrid.length} 个单元`);
  void report({ cells: gtaGrid.length, phase: 'world-indexed' });
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
    if (!pakWorld.isReady) {
      pakWorld.pump(6);
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
      const center = mapCenterGta(map);
      engine.frame(camera.state(0.016, [center[0], 0, -center[1]], [0, 0, -1], [0, 1, 0], canvas.width / Math.max(1, canvas.height), 0, false));
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
  update(track, false);
  lastFrame = now;
}

function cycleCamera(): void {
  cameraMode = cameraMode === 'chase' ? 'cockpit' : 'chase';
  // The ReplayCamera owns its own mode; assigning the module variable alone left it on chase forever
  // (the "both views look the same" bug).
  camera.mode = cameraMode;
  camera.reset();
  snapCamera = true;
  frameOnce();
}

function bindUi(): void {
  const drop = el<HTMLDivElement>('drop');
  const picker = el<HTMLInputElement>('picker');
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
    const files = [...(event.dataTransfer?.files ?? [])].filter((file) => file.name.toLowerCase().endsWith('.csv'));
    void addFiles(files);
  });
  picker.onchange = () => {
    void addFiles([...picker.files ?? []]);
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
    cameraMode = 'chase';
    camera.mode = 'chase';
    camera.reset();
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

  // --- Settings (HUD-driven; the URL is no longer the place to configure anything) ---
  el('loadLatestBtn').onclick = () => void loadLatest();
  const hd = el<HTMLInputElement>('hdSlider');
  const lod = el<HTMLInputElement>('lodSlider');
  const scale = el<HTMLInputElement>('scaleSlider');
  const budget = el<HTMLInputElement>('budgetSlider');
  const interval = el<HTMLInputElement>('intervalSlider');
  hd.value = String(HD_RADIUS);
  lod.value = String(LOD_RADIUS);
  el('hdLabel').textContent = String(HD_RADIUS);
  el('lodLabel').textContent = String(LOD_RADIUS);
  el('scaleLabel').textContent = '1.00';
  el('budgetLabel').textContent = String(PREPARE_BUDGET);
  el('intervalLabel').textContent = `${PREPARE_INTERVAL}ms`;
  hd.oninput = () => {
    HD_RADIUS = Number(hd.value);
    el('hdLabel').textContent = hd.value;
    prepareState.clear(); // routes are re-derived with the new radius
    lastStreamCell = '';
    frameOnce();
  };
  lod.oninput = () => {
    LOD_RADIUS = Number(lod.value);
    el('lodLabel').textContent = lod.value;
    prepareState.clear();
    lastStreamCell = '';
    frameOnce();
  };
  scale.oninput = () => {
    const value = Number(scale.value);
    el('scaleLabel').textContent = value.toFixed(2);
    if (engine) engine.renderScale = value;
  };
  el<HTMLInputElement>('dynamicLoadToggle').onchange = (event) => {
    DYNAMIC_LOAD = (event.target as HTMLInputElement).checked;
    if (DYNAMIC_LOAD) {
      schedulePrepare();
    }
  };
  el<HTMLInputElement>('prepareToggle').onchange = (event) => {
    PREPARE_ENABLED = (event.target as HTMLInputElement).checked;
  };
  budget.oninput = () => {
    PREPARE_BUDGET = Number(budget.value);
    el('budgetLabel').textContent = budget.value;
  };
  interval.oninput = () => {
    PREPARE_INTERVAL = Number(interval.value);
    el('intervalLabel').textContent = `${interval.value}ms`;
  };
  el<HTMLInputElement>('axesToggle').onchange = (event) => {
    SHOW_AXES = (event.target as HTMLInputElement).checked;
    if (SHOW_AXES) ensureAxes();
    frameOnce();
  };
}

bindUi();
void boot().catch((error) => {
  setStatus(`启动失败：${error instanceof Error ? error.message : String(error)}`);
});
