/**
 * Engine lab entry (plan 074/04). M0: the synthetic district through the REAL path (formats → upload →
 * bundles → culling → MSAA+A2C pass), orbiting camera, the gate HUD. `?cells=N` (grid side, default 8),
 * `?boxes=N` (boxes per cell side, default 12), `?freeze=1` stops the orbit.
 */
import {
  type CameraState,
  Engine,
  type EngineStats,
  setupStreaming,
  type StreamingDriver,
  type StreamStats,
} from '@opensa/engine';
import { describeTimecycSource } from '@opensa/renderware/parsers/text/timecyc-source';

import {
  BENCH_SCENE_MEASURE,
  BENCH_SCENES,
  BenchCollector,
  downloadRecord,
  fetchConverterMetrics,
  formatRecord,
} from './bench';
import { type DebugPanelState, mountDebugPanel } from './debug-panel';
import { type EnvironmentDriver, FOG_RING_MARGIN, parametricDriver, timecycDriver } from './environment';
import { type LabTimecyc, loadLabTimecyc, resolvePakSource } from './pak-source';
import { loadPedProbe } from './ped';
import { syntheticCell, syntheticTextureArray } from './synthetic';
import { loadVehicleProbe } from './vehicle';
import { labInstallSource, readModelBytes } from './vfs';

const CELL_SIZE = 250;
/** Where `?pak=1` opens when no `?at` is given — Grove Street, Los Santos (engine coords: GTA 2495,-1687,13 →
 *  x, z, -y), with a street-level orbit, so the whole-map build's empty centre (GTA 0,0) is never the default. */
const LS_STREAM_FOCUS: [number, number, number] = [2495, 13, 1687];
const LS_STREAM_ORBIT = 450;

/** `?ao=` / `?sunvis=` / `?wind=` / `?stoch=` / `?scale=` / `?sky=` A/B overrides (074/07, 06 rows 4+10, 074/12, 074/09). */
function applyEnvironmentOverrides(engine: Engine, params: URLSearchParams): void {
  const aoParam = Number(params.get('ao') ?? Number.NaN);
  if (Number.isFinite(aoParam)) {
    engine.environment.aoStrength = aoParam;
  }
  const scaleParam = Number(params.get('scale') ?? Number.NaN);
  if (Number.isFinite(scaleParam)) {
    engine.renderScale = scaleParam;
  }
  const sunVisParam = Number(params.get('sunvis') ?? Number.NaN);
  if (Number.isFinite(sunVisParam)) {
    engine.environment.sunVisStrength = sunVisParam;
  }
  const windParam = Number(params.get('wind') ?? Number.NaN);
  if (Number.isFinite(windParam)) {
    engine.environment.windStrength = windParam;
  }
  const stochParam = Number(params.get('stoch') ?? Number.NaN);
  if (Number.isFinite(stochParam)) {
    engine.environment.stochastic = stochParam;
  }
  // `?sky=preetham` — the 074/06 row-4 day-sky A/B (Hosek-Wilkie is the default).
  if (params.get('sky') === 'preetham') {
    engine.environment.skyModel = 'preetham';
  }
  // `?clouds=N` — cloud-layer opacity override (0 = the naked dome, kills cirrus+cumulus too).
  const cloudsParam = Number(params.get('clouds') ?? Number.NaN);
  if (Number.isFinite(cloudsParam)) {
    engine.environment.cloudAlpha = cloudsParam;
  }
}

/** Bench/leak runs own the HUD and the camera — the debug panel would fight them. */
function benchRequested(params: URLSearchParams): boolean {
  return params.get('bench') !== null || params.get('test') === 'leak';
}

/** '[' / ']' weather cycling — the callback receives the id delta (+1 / +19 ≡ −1 mod 20). */
function bindWeatherKeys(onSwitch: (delta: number) => void): void {
  window.addEventListener('keydown', (event) => {
    if (event.code === 'BracketLeft' || event.code === 'BracketRight') {
      onSwitch(event.code === 'BracketRight' ? 1 : 19);
    }
  });
}

/** The M0 synthetic fixture: a grid of box cells through the real format path; returns recorded draws. */
function buildSyntheticDistrict(engine: Engine, gridSide: number, boxesPerSide: number): number {
  engine.textures.load(0, syntheticTextureArray());
  let recordedDraws = 0;
  for (let cx = 0; cx < gridSide; cx += 1) {
    for (let cy = 0; cy < gridSide; cy += 1) {
      const handle = engine.cells.load(`${cx},${cy},hd`, syntheticCell(cx, cy, CELL_SIZE, boxesPerSide));
      recordedDraws += handle.draws;
    }
  }

  return recordedDraws;
}

/** `?draw=N` (074/21, OPT-IN in the lab — the orbit viewer wants the whole city visible by default):
 *  LOD ring = N, fog capped at N − margin — the game host's fog-masked streaming scheme, reproducible
 *  here. Null = knob absent (historical 1000 ring, uncapped fog). */
function drawDistanceParam(params: URLSearchParams): null | number {
  const raw = Number(params.get('draw') ?? Number.NaN);

  return Number.isFinite(raw) ? Math.max(400, raw) : null;
}

/** `?at=gtaX,gtaY,gtaZ` moves the orbit focus to a GTA-coordinate spot (the web host's `?spawn` twin) —
 *  the vehicle bench wants a street corner, not the pak's geometric centre (downtown canyon walls). */
function focusOverride(params: URLSearchParams): [number, number, number] | null {
  const at = (params.get('at') ?? '').split(',').map(Number);

  // GTA (x, y, z-up) → engine (x, y-up, z).
  return at.length === 3 && at.every(Number.isFinite) ? [at[0], at[2], -at[1]] : null;
}

/** The steady-state HUD block (bench/leak modes replace it wholesale). */
function hudText(input: {
  buildMs: number;
  engineInfo: string;
  frames: readonly number[];
  pedLine: null | { ms: number; position: readonly [number, number, number] };
  stats: EngineStats;
  streamStats: null | StreamStats;
  title: string;
  vehicleMs: null | number;
}): string {
  const frameAvg = input.frames.reduce((sum, value) => sum + value, 0) / Math.max(1, input.frames.length);

  return (
    `engine lab — ${input.title}\n` +
    `device      ${input.engineInfo}\n` +
    `frame       ${frameAvg.toFixed(2)} ms (${(1000 / Math.max(frameAvg, 0.001)).toFixed(0)} fps), max ${Math.max(...input.frames).toFixed(0)}\n` +
    `submit CPU  ${input.stats.submitMs.toFixed(2)} ms\n` +
    `GPU pass    ${input.stats.gpuPassMs > 0 ? input.stats.gpuPassMs.toFixed(2) : 'n/a'} ms · post ${input.stats.gpuPostMs > 0 ? input.stats.gpuPostMs.toFixed(2) : 'n/a'} ms · probe ${input.stats.gpuProbeMs > 0 ? input.stats.gpuProbeMs.toFixed(2) : 'off'} ms\n` +
    `cells       ${input.stats.cellsVisible}/${input.stats.cellsTotal} visible, draws ${input.stats.drawsRecorded}\n` +
    `residency   ${(input.stats.residencyBytes / (1024 * 1024)).toFixed(1)} MB\n` +
    `build       ${input.buildMs.toFixed(0)} ms (fixture, off the P0 clock)` +
    (input.pedLine
      ? `\nped sampler ${input.pedLine.ms.toFixed(2)} ms @ [${input.pedLine.position.map((value) => value.toFixed(0)).join(', ')}] (074/08 probe)`
      : '') +
    (input.vehicleMs !== null ? `\nvehicle upd ${input.vehicleMs.toFixed(2)} ms (074/08 B2 rigid entity)` : '') +
    (input.streamStats
      ? `\nstream      ${input.streamStats.loadedCells} loaded, ${input.streamStats.pendingCells} pending, ` +
        `${input.streamStats.created} created / ${input.streamStats.evicted} evicted, worst create ${input.streamStats.worstCreateMs.toFixed(1)} ms` +
        `, late ${input.streamStats.lateCreates}`
      : '')
  );
}

/** One frame of the `?test=leak` phases: sweep 600 frames → unloadAll → settle 60 → ledger compare. */
function leakStep(
  leakFrame: number,
  focus: [number, number, number],
  streaming: StreamingDriver,
  engine: Engine,
  leakBaseline: string,
  hud: HTMLPreElement,
): void {
  if (leakFrame < 600) {
    // Phase 1: sweep the focus across the district — load a wide set of cells.
    const t01 = leakFrame / 600;
    focus[0] += Math.sin(t01 * Math.PI * 2) * 6;
    focus[2] += Math.cos(t01 * Math.PI * 3) * 6;
  } else if (leakFrame === 600) {
    streaming.unloadAll();
    // eslint-disable-next-line no-console -- the leak test's phase marker IS its console protocol
    console.log('[leak] unloadAll issued');
  } else if (leakFrame === 660) {
    // Phase 3: settle 60 frames, then compare.
    const now = JSON.stringify(pick(engine.ledger()));
    const pass = now === leakBaseline;
    // eslint-disable-next-line no-console -- the leak verdict prints the ledger diff by design
    console[pass ? 'log' : 'error'](`[leak] ${pass ? 'PASS' : 'FAIL'}\nbaseline ${leakBaseline}\nnow      ${now}`);
    hud.style.background = pass ? 'rgba(10,60,16,0.85)' : 'rgba(80,10,10,0.85)';
  }
}

/**
 * `?vehicle=N` setup (074/16 round 2, plan 079 phase 2): `?vmodel=<name>` names a CONVERTED vehicle model in
 * the served build (default `landstal`), read as `<name>.osm` through the same decode the game uses. The bench
 * default is PARKED at the focus with a close camera — `?drive=1` restores the convoy circle and its wider
 * framing. Needs `?src` pointing at a served game dir (an opensa-pack `--out`).
 */
async function loadVehicleBench(
  engine: Engine,
  params: URLSearchParams,
  focus: readonly [number, number, number],
  vehicleCount: number,
): Promise<{ host: ReturnType<typeof loadVehicleProbe>; startDistance: number }> {
  const vehicleY = Number(params.get('pedy') ?? focus[1]) || focus[1];
  const name = params.get('vmodel') ?? 'landstal';
  const drive = params.get('drive') === '1';
  const source = await labInstallSource(await requireGameDir(params));
  const osm = await readModelBytes(source, `${name}.osm`);
  if (!osm) {
    throw new Error(`vehicle model ${name}.osm not found in the served build — check ?vmodel and ?src`);
  }
  const host = loadVehicleProbe(engine, [focus[0], vehicleY, focus[2]], vehicleCount, name, osm, drive);

  return { host, startDistance: drive ? 55 : 14 };
}

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const gridSide = Number(params.get('cells') ?? 8) || 8;
  const boxesPerSide = Number(params.get('boxes') ?? 12) || 12;
  const freeze = params.get('freeze') === '1';

  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const hud = document.getElementById('hud') as HTMLPreElement;

  const engine = new Engine();
  await engine.init(canvas);
  // `?hour=N` (default 12): a simple parametric day arc drives the environment — real timecyc sampling is
  // effects-ledger row 14. `?daycycle=1` animates the hour for eyeballing the blend.
  const hourParam = Number(params.get('hour') ?? 12);
  const dayCycle = params.get('daycycle') === '1';
  let weather = Number(params.get('weather') ?? 0) || 0;
  let hour = Number.isFinite(hourParam) ? hourParam : 12;
  applyEnvironmentOverrides(engine, params);
  // Row 14: the environment driver — real timecyc when the manifest carries it, parametric fallback else.
  // Swapped in after the pak loads (the manifest arrives there); parametric until then.
  // `?aces=0` / `?bloom=0|N` — the 074/09 post A/Bs (raw output; bloom off or intensity override).
  const aces = params.get('aces') !== '0';
  const bloomParam = Number(params.get('bloom') ?? Number.NaN);
  const bloom = Number.isFinite(bloomParam) ? bloomParam : null;
  let environmentDriver: EnvironmentDriver = parametricDriver(engine, aces, bloom);
  const applyEnvironment = (): void => environmentDriver.apply(hour);
  applyEnvironment();
  // `?pak=1` streams the converted district through the worker pak + LOD rings (plan 079 phase 2 — the old
  // whole-pak `loadPak` shortcut is gone; streaming is the one pak path, and it is what the game runs).
  const usePak = params.get('pak') === '1';
  hud.textContent = `device: ${engine.adapterInfo}\n${usePak ? 'loading pak…' : 'building synthetic district…'}`;

  const buildStart = performance.now();
  let recordedDraws = 0;
  let focus: [number, number, number];
  let orbitRadius: number;
  let title: string;
  let streaming: null | StreamingDriver = null;
  if (usePak) {
    // `?src=` names an opensa-pack `--out` (a game dir with products under `opensa/`) — or, for the older
    // paks under `public/`, the products directory itself. Default /pak.
    const source = await resolvePakSource(params.get('src') ?? 'pak');
    const timecyc = await loadLabTimecyc(source);
    // Boot report (104/02), the same line the game host prints: the choice between two present names is
    // otherwise unobservable.
    // eslint-disable-next-line no-console -- boot report, one line
    console.log(`[timecyc] ${describeTimecycSource(timecyc)}`);
    const setup = await setupStreaming(engine, source.base, streamRadiiParam(params));
    streaming = setup.driver;
    focus = setup.center;
    orbitRadius = setup.radius * 1.4;
    // The canonical whole-map build centres on empty water (GTA 0,0), so `?pak=1` without `?at` would stare
    // into nothing. Default the view to Los Santos (like the game spawns the player in a city, not the map's
    // geometric centre); `?at` / `?orbit` still override below.
    if (focusOverride(params) === null) {
      focus = [...LS_STREAM_FOCUS];
      orbitRadius = LS_STREAM_ORBIT;
    }
    title = 'STREAMING district (worker pak, rings live)';
    const applyWeather = wireWeather(engine, timecyc, params, (driver) => {
      environmentDriver = driver;
      applyEnvironment();
    });
    applyWeather(weather);
    // '[' / ']' cycle the weather at runtime: timecyc mood re-samples live.
    bindWeatherKeys((next) => {
      weather = (weather + next) % 20;
      title = `STREAMING district (worker pak, rings live) — weather ${weather}`;
      applyWeather(weather);
    });
  } else {
    recordedDraws = buildSyntheticDistrict(engine, gridSide, boxesPerSide);
    const half = (gridSide * CELL_SIZE) / 2;
    focus = [half, 0, half];
    orbitRadius = half * 1.7;
    title = `synthetic district (${gridSide}×${gridSide} cells, ${recordedDraws} recorded draws)`;
  }
  focus = focusOverride(params) ?? focus;
  const buildMs = performance.now() - buildStart;
  const frames: number[] = [];
  let previous = performance.now();
  // `?az=DEG` / `?el=N` pin the orbit view — headless look checks reproduce a field angle exactly
  // (074/16 wheel-through-windscreen round); drag still adjusts both live.
  let angle = orbitAngleOverride(params, 'az', 0);
  // `?orbit=N` starts the camera N engine units from the focus (the bench close-up; wheel still zooms).
  let zoom = (orbitOverride(params) ?? orbitRadius) / orbitRadius;
  // Skinning probe (074/08 B1, plan 079 phase 2): `?ped=1` reads the CONVERTED ped at the focus and zooms in
  // (a 1.8-unit ped is subpixel at a full-city orbit radius); wheel out to leave.
  let pedHost: Awaited<ReturnType<typeof loadPedProbe>> | null = null;
  let pedMs = 0;
  let pedPosition: [number, number, number] | null = null;
  if (params.get('ped') === '1') {
    const pedY = Number(params.get('pedy') ?? focus[1]) || focus[1];
    pedPosition = [focus[0], pedY, focus[2]];
    const source = await labInstallSource(await requireGameDir(params));
    pedHost = await loadPedProbe(engine, pedPosition, source, params.get('pedmodel') ?? 'male01');
    zoom = Math.min(1, 14 / orbitRadius);
  }
  // Rigid-entity probe (074/08 B2c → B5): `?vehicle=N` drives N instances of the converted model in a convoy
  // around the focus (N > 1 exercises the multi-instance pool: shared geometry, per-instance matrices).
  let vehicleHost: Awaited<ReturnType<typeof loadVehicleProbe>> | null = null;
  let vehicleMs = 0;
  const vehicleCount = Number(params.get('vehicle') ?? 0) || 0;
  if (vehicleCount > 0) {
    const bench = await loadVehicleBench(engine, params, focus, vehicleCount);
    vehicleHost = bench.host;
    zoom = Math.min(zoom, bench.startDistance / orbitRadius);
  }
  const panelState = mountLookBench(params, vehicleCount, hour, (nextHour) => {
    hour = nextHour;
    applyEnvironment();
  });
  let heightFactor = orbitHeightOverride(params, 'el', 0.9);
  let dragging = false;
  // Wheel = zoom (the alpha-edge inspection needs to get CLOSE to foliage/fences); drag = orbit/height.
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    // The floor is in ENGINE UNITS, not a ratio: on a full-city pak orbitRadius is thousands of units and
    // a ratio floor of 0.02 stopped the wheel ~100 u out — you could never zoom INTO a car (074/16 bench).
    zoom = Math.min(20, Math.max(2.2 / orbitRadius, zoom * (event.deltaY > 0 ? 1.1 : 0.9)));
  });
  canvas.addEventListener('pointerdown', () => (dragging = true));
  window.addEventListener('pointerup', () => (dragging = false));
  window.addEventListener('pointermove', (event) => {
    if (dragging) {
      angle += event.movementX * 0.004;
      heightFactor = Math.min(4, Math.max(0.05, heightFactor + event.movementY * 0.004));
    }
  });
  // WASD pans the orbit FOCUS — the streaming rings follow the focus, so this is how you travel the
  // full-city pak in the lab (the standalone page has the true fly camera).
  const held = new Set<string>();
  window.addEventListener('keydown', (event) => held.add(event.code));
  window.addEventListener('keyup', (event) => held.delete(event.code));

  // Leak assertion (M1 tail, `?test=leak` with streaming): load a sweep of cells, unload ALL, and the
  // residency ledger must return to its post-texture baseline — buffers leak loudly, not silently.
  const leakTest = params.get('test') === 'leak' && streaming !== null;
  const leakBaseline = leakTest ? JSON.stringify(pick(engine.ledger())) : '';
  let leakFrame = 0;

  // Bench mode (074/11): deterministic scene script + warmup/measure collection, then a JSON record.
  const benchScene = params.get('bench');
  if (benchScene && leakTest) {
    throw new Error(
      '`?test=leak` and `?bench=` are mutually exclusive — the leak phases halt streaming and invalidate the bench window',
    );
  }
  const benchScript = benchScene ? BENCH_SCENES[benchScene] : null;
  if (benchScene && !benchScript) {
    throw new Error(`unknown bench scene '${benchScene}' (have: ${Object.keys(BENCH_SCENES).join(', ')})`);
  }
  const collector = new BenchCollector(benchScene ? BENCH_SCENE_MEASURE[benchScene] : undefined);
  let benchDone = false;

  // Env probe (074/16): follows the orbit focus (the vehicle convoy circles it within the reset margin).
  const applyProbeState = (): void => {
    engine.probeCenter = panelState.probe ? [focus[0], focus[1] + 1, focus[2]] : null;
    engine.probeView = panelState.probeView;
  };
  // The vehicle bench holds the camera still (the LOOK is the point — 074/16); drag still orbits, and
  // bench close-ups need a street-level eye where city orbits keep the old 4 u floor.
  const autoSpin = !freeze && vehicleCount === 0;
  const eyeFloor = vehicleCount > 0 ? 1.2 : 4;

  const loop = (): void => {
    const now = performance.now();
    const frameDt = now - previous;
    frames.push(frameDt);
    previous = now;
    if (frames.length > 120) {
      frames.shift();
    }
    if (autoSpin && !dragging) {
      angle += 0.003;
    }
    if (held.size > 0) {
      panFocus(focus, held, angle, Math.min(2000, Math.max(60, orbitRadius * zoom)) * (frameDt / 1000) * 1.2);
    }
    if (dayCycle) {
      hour = (hour + 0.005) % 24;
      applyEnvironment();
    }
    const radius = orbitRadius * zoom;
    const camera: CameraState = benchScript
      ? benchScript(collector.currentFrame, {
          aspect: canvas.width / Math.max(1, canvas.height),
          focus,
          radius: orbitRadius,
        })
      : {
          aspect: canvas.width / Math.max(1, canvas.height),
          eye: [
            focus[0] + Math.cos(angle) * radius,
            focus[1] + Math.max(eyeFloor, radius * heightFactor * 0.45),
            focus[2] + Math.sin(angle) * radius,
          ],
          far: 10000,
          fovYRad: Math.PI / 3,
          near: 0.5,
          target: focus,
          up: [0, 1, 0],
        };
    if (leakTest && streaming) {
      leakFrame += 1;
      leakStep(leakFrame, focus, streaming, engine, leakBaseline, hud);
    }
    let streamStats: null | StreamStats = null;
    if (streaming && !(leakTest && leakFrame >= 600)) {
      // Rings follow the camera TARGET (the ground focus — the "player"), not the eye: an orbiting eye sits
      // outside the LOD ring and would stream nothing. In leak mode the driver STOPS after unloadAll —
      // otherwise it would immediately re-stream the rings and fail the comparison by design.
      streamStats = streaming.update(camera.target);
    }
    if (pedHost) {
      pedMs = pedHost.update(now / 1000);
    }
    if (vehicleHost) {
      vehicleMs = vehicleHost.update(now / 1000);
    }
    applyProbeState();
    const stats = engine.frame(camera);
    if (benchScript && !benchDone) {
      collector.sample(frameDt, stats);
      if (!collector.running) {
        benchDone = true;
        const record = collector.finish(benchScene ?? '?', engine.adapterInfo, canvas);
        // Converter metrics ride the record (074/11) — tool regressions get caught by the same ritual.
        void fetchConverterMetrics(`/${params.get('src') ?? 'pak'}`).then((converter) => {
          if (converter) {
            record.converter = converter;
          }
          downloadRecord(record);
        });
        hud.textContent = formatRecord(record);

        return; // freeze the loop on the summary
      }
    }
    hud.textContent = hudText({
      buildMs,
      engineInfo: engine.adapterInfo,
      frames,
      pedLine: pedHost && pedPosition ? { ms: pedMs, position: pedPosition } : null,
      stats,
      streamStats,
      title,
      vehicleMs: vehicleHost ? vehicleMs : null,
    });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/**
 * The vehicle look bench (074/16 round 2): live time-of-day buttons + the env-probe toggles. The probe
 * defaults ON when a vehicle is present (reflections are what the bench is FOR) — with a streamed pak the
 * cube shows the real city around the focus; without one the analytic sky fallback still exercises the
 * material classes.
 */
function mountLookBench(
  params: URLSearchParams,
  vehicleCount: number,
  hour: number,
  onHour: (hour: number) => void,
): DebugPanelState {
  const panelState: DebugPanelState = {
    hour,
    probe: vehicleCount > 0 ? params.get('probe') !== '0' : params.get('probe') === '1',
    probeView: params.get('probeview') === '1',
  };
  if (!benchRequested(params)) {
    mountDebugPanel(panelState, () => onHour(panelState.hour));
  }

  return panelState;
}

/** `?az=DEG` — pinned starting orbit azimuth (headless look checks reproduce a field angle exactly). */
function orbitAngleOverride(params: URLSearchParams, key: string, fallback: number): number {
  const value = Number(params.get(key) ?? Number.NaN);

  return Number.isFinite(value) ? (value * Math.PI) / 180 : fallback;
}

/** `?el=N` — pinned starting orbit height factor (the drag-vertical state). */
function orbitHeightOverride(params: URLSearchParams, key: string, fallback: number): number {
  const value = Number(params.get(key) ?? Number.NaN);

  return Number.isFinite(value) ? value : fallback;
}

/** `?orbit=N` — the starting camera distance in engine units (the bench close-up). */
function orbitOverride(params: URLSearchParams): null | number {
  const orbit = Number(params.get('orbit') ?? Number.NaN);

  return Number.isFinite(orbit) && orbit > 0 ? orbit : null;
}

/** WASD pans the orbit FOCUS — streaming rings follow it (how you travel a full-city pak in the lab). */
function panFocus(focus: [number, number, number], held: ReadonlySet<string>, angle: number, pan: number): void {
  const fx = -Math.cos(angle);
  const fz = -Math.sin(angle);
  if (held.has('KeyW')) {
    focus[0] += fx * pan;
    focus[2] += fz * pan;
  }
  if (held.has('KeyS')) {
    focus[0] -= fx * pan;
    focus[2] -= fz * pan;
  }
  if (held.has('KeyA')) {
    focus[0] += fz * pan;
    focus[2] -= fx * pan;
  }
  if (held.has('KeyD')) {
    focus[0] -= fz * pan;
    focus[2] += fx * pan;
  }
}

/** Leak-relevant ledger categories (targets resize with the canvas; textures persist by design). */
function pick(
  ledger: Record<string, { bytes: number; count: number }>,
): Record<string, { bytes: number; count: number }> {
  return { cellIndex: ledger.cellIndex, cellVertex: ledger.cellVertex, uniform: ledger.uniform };
}

/** Resolve `?src` to a served GAME dir (an opensa-pack `--out`), which the probes read converted models from. */
async function requireGameDir(params: URLSearchParams): Promise<string> {
  const source = await resolvePakSource(params.get('src') ?? 'pak');
  if (!source.gameDir) {
    throw new Error(
      '?vehicle needs ?src pointing at a served game dir (an opensa-pack --out with opensa/ inside), ' +
        'e.g. ?src=http://localhost:3001/build/original/opensa',
    );
  }

  return source.gameDir;
}

/** The `?draw=` knob as StreamingRadii — empty when absent (defaults). */
function streamRadiiParam(params: URLSearchParams): { lodRadius?: number } {
  const drawDistance = drawDistanceParam(params);

  return drawDistance !== null ? { lodRadius: drawDistance } : {};
}

/** Stream-mode weather wiring: returns an applier that re-creates the timecyc driver for the weather
 *  (074/06 row 14); per-weather cover/dark come from the cloud profile inside the timecyc driver. */
function wireWeather(
  engine: Engine,
  timecyc: LabTimecyc | null,
  params: URLSearchParams,
  onDriver: (driver: EnvironmentDriver) => void,
): (weather: number) => void {
  const fogScale = Number(params.get('fogscale') ?? 2.5) || 2.5;
  const aces = params.get('aces') !== '0';
  const bloomParam = Number(params.get('bloom') ?? Number.NaN);
  const bloom = Number.isFinite(bloomParam) ? bloomParam : null;
  // `?draw=N` opt-in (074/21): mirror the game host's fog ⊂ LOD-ring invariant in the lab.
  const drawDistance = drawDistanceParam(params);
  const fogCap = drawDistance !== null ? drawDistance - FOG_RING_MARGIN : undefined;

  return (weather: number): void => {
    if (timecyc !== null) {
      onDriver(timecycDriver(engine, timecyc.text, weather, fogScale, aces, bloom, fogCap));
    }
  };
}

main().catch((error: unknown) => {
  const hud = document.getElementById('hud');
  if (hud) {
    hud.textContent = `engine failed:\n${error instanceof Error ? error.message : String(error)}`;
    hud.style.color = '#f66';
  }
});
