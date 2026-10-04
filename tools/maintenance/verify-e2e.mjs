#!/usr/bin/env node
/**
 * F3 final verification — agent-operated, no-human real-system QA for
 * `.omo/plans/flight-analysis-remediation-and-worktree-cleanup.md`.
 *
 * It drives the BUILT replay page (`web-replay/dist/opensa` served by `web-replay/local-server.mjs` on
 * 127.0.0.1:4173) in a FRESH throwaway Chrome profile over CDP, using the four real recordings named by the
 * plan, and asserts from the `window.__flight` probe — never from a screenshot alone:
 *
 *   1. markers   — the four CSVs import as 4 valid tracks; probe `markerCount === endpointCount ===
 *                  validTrackCount` (endpoint/track counts come from an independent CSV parse), the marker
 *                  track-ID set matches import order, and the flat 2D panel is gone
 *                  (`.analysis-heatmap === null`, `#analysis-heatmap === null`). The marker count is
 *                  re-asserted on a second clean page (flakiness guard).
 *   2. fly-to    — a synthetic click on a projected marker's screen position selects that track (probe
 *                  `markerPickedTrackId` / `markerActiveTrackId` / `activeTrackIndex` all switch) and starts
 *                  the free-camera fly-to; on the normal-mode page the same focus flow's tween is observed
 *                  completing with the camera target landing on the endpoint.
 *   3. audio     — the sibling WAV is imported beside the CSV; the synthesized Web Audio lane reports a
 *                  `running` AudioContext with live sources and rising updates, then the recorded-WAV
 *                  comparison path plays and advances. Gate-adaptive: G4=GO asserts synthesis (an approved
 *                  WAV-only descope asserts the WAV lane instead).
 *   4. export    — one production browser-backed export at the gate-appropriate rate is run through the
 *                  server's `/video-export` HTTP contract, downloaded, and ffprobe-verified: exact
 *                  `avg_frame_rate`, frame count, hardware-encoder proof (encoder-init/WebCodecs evidence,
 *                  not a codec name), no PNG in the frame stream, and no visible browser window (compositor
 *                  report + a Win32 process snapshot proving the export Chrome ran headless).
 *
 * Gate adaptation (read from `.omo/evidence/*.json`): G2=GO asserts the production export hardware-encodes
 * 60 fps; the documented 120 fps realtime limitation (task-28) is recorded as an OBSERVED LIMIT, never a
 * failure. G4=GO asserts synthesized audio.
 *
 * Usage (repo root):
 *   node tools/maintenance/verify-e2e.mjs
 *   node tools/maintenance/verify-e2e.mjs --url http://127.0.0.1:4173/ \
 *     --csv-a "GTA San Andreas\flight_recordings\flight_20260926_153900_322_m520_001.csv" \
 *     --csv-b "GTA San Andreas\flight_recordings\flight_20260926_155714_107_m476_001.csv" \
 *     --csv-c "GTA San Andreas\flight_recordings\flight_20260926_044304_980_m520_050.csv" \
 *     --csv-d "GTA San Andreas\flight_recordings\flight_20260926_044255_679_m520_049.csv"
 *
 * Exit code 0 only when every assertion holds; non-zero names the first failing assertion. The evidence
 * markdown (`.omo/evidence/F3-...md`), a marker-view PNG and the ffprobe JSON are written on every run.
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { platform, release, tmpdir, totalmem } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const requireFromOpensa = createRequire(join(REPO_ROOT, 'tools', 'opensa', 'package.json'));
const { chromium } = requireFromOpensa('playwright');

// ---------------------------------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------------------------------

const RECORDINGS = join(REPO_ROOT, 'GTA San Andreas', 'flight_recordings');
const EVIDENCE_DIR = join(REPO_ROOT, '.omo', 'evidence');
const EVIDENCE_MD = join(EVIDENCE_DIR, 'F3-flight-analysis-remediation-and-worktree-cleanup.md');
const EVIDENCE_PNG = join(EVIDENCE_DIR, 'F3-flight-analysis-remediation-and-worktree-cleanup.png');
const EVIDENCE_FFPROBE = join(EVIDENCE_DIR, 'F3-flight-analysis-remediation-and-worktree-cleanup.ffprobe.json');
const NO_AUTO_LOAD = '/verify-e2e-no-auto-load.csv';
const FAVICON = '/favicon.ico';
const GATE = (name) => join(EVIDENCE_DIR, `gate-${name}-flight-analysis-remediation-and-worktree-cleanup.json`);
const GATE_G2_BLOCKED = join(EVIDENCE_DIR, 'gate-G2-blocked.md');
const GATE_G4_BLOCKED = join(EVIDENCE_DIR, 'gate-G4-blocked.md');
const TASK28 = join(EVIDENCE_DIR, 'task-28-flight-analysis-remediation-and-worktree-cleanup.json');
const LAST_MILE = join(EVIDENCE_DIR, 'task-28-flight-analysis-remediation-and-worktree-cleanup.LAST-MILE.txt');

const DEFAULT_URL = 'http://127.0.0.1:4173/';
const DEFAULT_CSVS = {
  a: join(RECORDINGS, 'flight_20260926_153900_322_m520_001.csv'),
  b: join(RECORDINGS, 'flight_20260926_155714_107_m476_001.csv'),
  c: join(RECORDINGS, 'flight_20260926_044304_980_m520_050.csv'),
  d: join(RECORDINGS, 'flight_20260926_044255_679_m520_049.csv'),
};
const PAGE_WAIT_MS = 180_000;
const IMPORT_WAIT_MS = 90_000;
const EXPORT_TIMEOUT_MS = 300_000;
const WATCHDOG_MS = 20 * 60 * 1000;
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
/**
 * Black-frame guard (todo 33). The defect this catches: an unsynchronized GPU capture emitted fully-black
 * frames whose decoded luma is the TV black level (YAVG=16). `blackdetect` must therefore find ZERO events over
 * the whole clip, and the first frames (the part that was black for ~129 frames / ~2.15 s) must all sit well
 * above that level. Thresholds are observations of the defect, never a widened tolerance: 16 is TV black, and
 * a real frame on this Map is far brighter.
 */
const BLACK_LEVEL_YAVG = 20;
const FIRST_FRAME_WINDOW = 141;
const BLACKDETECT_FILTER = 'blackdetect=d=0.001:pix_th=0.10';
const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const round = (value) => (Number.isFinite(value) ? Number(value.toFixed(3)) : value);
const truncate = (value, max = 220) => (typeof value === 'string' && value.length > max ? `${value.slice(0, max)}…` : value);

// ---------------------------------------------------------------------------------------------------
// Assertion ledger — every check records its observed value, so the evidence reports facts, not a verdict
// ---------------------------------------------------------------------------------------------------

const results = [];
const observedLimits = [];
const findings = [];

function check(name, condition, observed) {
  const pass = condition === true;
  results.push({ name, pass, observed });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}  ::  ${JSON.stringify(observed)}`);

  return pass;
}

function recordObservedLimit(name, detail) {
  observedLimits.push({ name, detail });
  console.log(`LIMIT ${name}  ::  ${JSON.stringify(detail)}`);
}

function recordFinding(name, detail) {
  findings.push({ name, detail });
  console.log(`NOTE  ${name}  ::  ${JSON.stringify(detail)}`);
}

// ---------------------------------------------------------------------------------------------------
// Independent CSV oracle (duration / endpoint / sample count) — a second implementation, not the app's
// ---------------------------------------------------------------------------------------------------

function parseRecordingOracle(path) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.startsWith('local_timestamp,'));
  if (headerIndex < 0) {
    throw new Error(`${basename(path)}: not a FlightRecorder CSV (no local_timestamp header)`);
  }
  const header = lines[headerIndex].split(',').map((cell) => cell.trim());
  const at = new Map(header.map((cell, index) => [cell, index]));
  const cellsAt = (cells, column) => {
    const index = at.get(column);
    return index === undefined ? null : cells[index];
  };
  const rows = [];
  for (const line of lines.slice(headerIndex + 1)) {
    if (!line || line.startsWith('#')) {
      continue;
    }
    const cells = line.split(',');
    const x = Number(cellsAt(cells, 'x'));
    const y = Number(cellsAt(cells, 'y'));
    const z = Number(cellsAt(cells, 'z'));
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      continue;
    }
    const timeMs = Date.parse(cells[0]);
    const captured = cellsAt(cells, 'capture_elapsed_s');
    rows.push({ captured: captured === null || captured === '' ? null : Number(captured), timeMs, x, y, z });
  }
  if (rows.length < 2) {
    throw new Error(`${basename(path)}: not enough samples`);
  }
  const firstTime = rows.find((row) => Number.isFinite(row.timeMs))?.timeMs ?? 0;
  const last = rows[rows.length - 1];
  // Mirrors `parseFlightCsv`: `capture_elapsed_s` wins when present, else the timestamp span.
  const duration = Number.isFinite(last.captured) ? last.captured : (last.timeMs - firstTime) / 1000;
  return {
    duration,
    endpoint: [last.x, last.y, last.z],
    name: basename(path),
    samples: rows.length,
    version: Number((text.match(/version=(\d+)/) ?? [])[1] ?? 0),
  };
}

/** GTA world (x east, y north, z up) -> engine (x, z, -y), the app's single conversion seam. */
const gtaToEngine = (p) => [p[0], p[2], -p[1]];

function cameraView(center, distance, direction) {
  const length = Math.hypot(...direction) || 1;
  const position = center.map((value, index) => value + (direction[index] / length) * distance);

  return {
    mode: 'free',
    pitch: Math.atan2(center[1] - position[1], Math.hypot(center[0] - position[0], center[2] - position[2])),
    position: position.map((value) => Number(value.toFixed(3))),
    yaw: Math.atan2(center[0] - position[0], -(center[2] - position[2])),
  };
}

function boundsCenter(points) {
  const lows = [Infinity, Infinity, Infinity];
  const highs = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (let axis = 0; axis < 3; axis += 1) {
      lows[axis] = Math.min(lows[axis], point[axis]);
      highs[axis] = Math.max(highs[axis], point[axis]);
    }
  }

  return {
    center: [0, 1, 2].map((axis) => (lows[axis] + highs[axis]) / 2),
    span: Math.max(...[0, 1, 2].map((axis) => highs[axis] - lows[axis])),
  };
}

// ---------------------------------------------------------------------------------------------------
// Gate artifacts — F3 reads the verdicts and adapts its assertions
// ---------------------------------------------------------------------------------------------------

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function readGates() {
  const g1 = readJson(GATE('G1'));
  const g2 = readJson(GATE('G2'));
  const g4 = readJson(GATE('G4'));
  const g2Verdict = g2?.qsvVerdict ?? g2?.verdict ?? '';
  const g4Verdict = g4?.GENRL ?? g4?.verdict ?? '';
  const headless = g1?.HEADLESS ?? g1?.verdict ?? '';

  check('gate G2 artifact exists with a verdict', Boolean(g2 && g2Verdict), { path: GATE('G2'), verdict: g2Verdict });
  check('gate G4 artifact exists with a verdict', Boolean(g4 && g4Verdict), { path: GATE('G4'), verdict: g4Verdict });
  check('gate G2 permits export (GO/PARTIAL, no silent software downgrade)', ['GO', 'PARTIAL'].includes(g2Verdict), { verdict: g2Verdict });
  if (g2Verdict === 'NO-GO') {
    check('G2=NO-GO carries the recorded approval record', existsSync(GATE_G2_BLOCKED), GATE_G2_BLOCKED);
  }
  check('gate G4 permits audio, or records the approved WAV-only descope', g4Verdict === 'GO' || existsSync(GATE_G4_BLOCKED), {
    verdict: g4Verdict,
    approvalRecord: existsSync(GATE_G4_BLOCKED),
  });

  // The documented 120 fps realtime limitation is an observation, not an F3 failure. Record it verbatim.
  const task28 = readJson(TASK28);
  const rate120 = (task28?.browserLane?.rates ?? []).find((rate) => rate.fps === 120) ?? null;
  const lastMileText = existsSync(LAST_MILE) ? readFileSync(LAST_MILE, 'utf8') : '';
  check('120 fps limitation record is readable (task-28 artifact or LAST-MILE)', Boolean(rate120 || lastMileText.includes('DOCUMENTED LIMITATION')), {
    task28Rate120: rate120
      ? { avgFrameRate: rate120.avgFrameRate, frameCount: rate120.frameCount, hardwareEncoder: rate120.hardwareEncoder, perFrameMs: round(rate120.perFrameMs), budgetMs: round(rate120.budgetMs), sustained: rate120.sustained }
      : null,
    lastMileLimit: lastMileText.includes('DOCUMENTED LIMITATION'),
  });
  if (rate120) {
    recordObservedLimit('120 fps browser lane is slower than realtime on this host (documented, not faked)', {
      avgFrameRate: rate120.avgFrameRate,
      frameCount: `${rate120.frameCount}/${rate120.expectedFrames}`,
      hardwareEncoder: rate120.hardwareEncoder,
      perFrameMs: round(rate120.perFrameMs),
      budgetMs: round(rate120.budgetMs),
      sustained: rate120.sustained,
    });
  }
  if (headless === 'NO-GO') {
    recordFinding('G1=NO-GO: headless WebGPU export backend was auto-skipped; browser-backed export is the shipped lane', { headless });
  }

  return { g1, g2, g4, g2Verdict, g4Verdict, headless };
}

// ---------------------------------------------------------------------------------------------------
// Server + browser lifecycle (only self-started processes are killed)
// ---------------------------------------------------------------------------------------------------

async function serverUp(origin) {
  try {
    const response = await fetch(`${origin}/`, { redirect: 'follow', signal: AbortSignal.timeout(3000) });

    return response.ok;
  } catch {
    return false;
  }
}

let serverChild = null;
let serverStarted = false;
let chromeChild = null;

function killTree(child) {
  if (!child) {
    return;
  }
  try {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    // already gone
  }
}

process.on('exit', () => {
  killTree(chromeChild);
  if (serverStarted) {
    killTree(serverChild);
  }
});

async function ensureServer(origin) {
  if (await serverUp(origin)) {
    console.log(`server: already running at ${origin} (left untouched)`);

    return;
  }
  const port = new URL(origin).port || '80';
  // NO_OPEN: a server this script starts must not pop a browser of its own.
  serverChild = spawn(process.execPath, ['local-server.mjs'], {
    cwd: join(REPO_ROOT, 'web-replay'),
    env: { ...process.env, NO_OPEN: '1', PORT: port },
    stdio: 'ignore',
    windowsHide: true,
  });
  serverStarted = true;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(500);
    if (await serverUp(origin)) {
      console.log(`server: started ${origin} (pid ${serverChild.pid})`);

      return;
    }
    if (serverChild.exitCode !== null) {
      throw new Error(`server exited early with code ${serverChild.exitCode}`);
    }
  }
  throw new Error(`server did not answer at ${origin} within 30s`);
}

const freePort = () => new Promise((done, fail) => {
  const probe = createServer();
  probe.unref();
  probe.on('error', fail);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => done(port));
  });
});

async function launchChrome(origin) {
  const chrome = CHROME_PATHS.find((path) => path && existsSync(path));
  if (!chrome) {
    throw new Error('Chrome/Edge not found (looked in Program Files and LOCALAPPDATA)');
  }
  // A FRESH throwaway profile per run: never the reusable replay profile (closing that one corrupts it).
  const profile = join(tmpdir(), `opensa-f3-verify-e2e-${Date.now()}`);
  const port = await freePort();
  chromeChild = spawn(chrome, [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,800',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    `${origin}/opensa/flight-replay.html`,
  ], { stdio: 'ignore', windowsHide: false });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await sleep(500);
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    } catch {
      // Chrome is not listening yet
    }
  }
  throw new Error('could not connect to Chrome over CDP');
}

// ---------------------------------------------------------------------------------------------------
// Page driving + probes
// ---------------------------------------------------------------------------------------------------

function watchErrors(page) {
  const errors = [];
  const ignored = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') {
      return;
    }
    const url = message.location()?.url ?? '';
    const line = `console.error ${url || '(no url)'}: ${message.text()}`;
    // Only the deliberate 404s are ignored: the no-auto-load recording and the favicon.
    if (url.includes(NO_AUTO_LOAD) || url.includes(FAVICON)) {
      ignored.push(line);
    } else {
      errors.push(line);
    }
  });
  page.on('dialog', (dialog) => { void dialog.dismiss().catch(() => {}); });

  return { errors, ignored };
}

async function openPage(context, view, options = {}) {
  const page = await context.newPage();
  const tracker = watchErrors(page);
  page.setDefaultTimeout(PAGE_WAIT_MS);
  const query = new URLSearchParams({ recording: NO_AUTO_LOAD });
  if (options.videoExport) {
    query.set('videoExport', '1');
  }
  if (view) {
    query.set('exportView', JSON.stringify(view));
  }
  await page.goto(`${options.origin}/opensa/flight-replay.html?${query}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => globalThis.__flight?.worldReady === true, undefined, { timeout: PAGE_WAIT_MS });
  await page.waitForFunction(() => globalThis.__flight?.markerCount === 0, undefined, { timeout: 60_000 });

  return { page, tracker };
}

async function importCsvs(page, csvPaths, expectedTracks) {
  await page.setInputFiles('#picker', csvPaths);
  await page.waitForFunction((count) => globalThis.__flight?.markerCount === count, expectedTracks, { timeout: IMPORT_WAIT_MS });
  await page.waitForFunction((count) => document.querySelectorAll('.track').length === count, expectedTracks, { timeout: IMPORT_WAIT_MS });
}

async function markerProbe(page) {
  return page.evaluate(() => {
    const flight = globalThis.__flight;
    const canvas = document.getElementById('canvas');
    const rect = canvas?.getBoundingClientRect() ?? null;
    const activeRow = document.querySelector('.track.active');

    return {
      activeTrackIndex: flight?.activeTrackIndex ?? -1,
      aircraft: flight?.aircraft ?? '',
      cameraState: flight?.cameraState ?? null,
      canvas: rect ? { height: rect.height, left: rect.left, top: rect.top, width: rect.width } : null,
      densityMax: flight?.densityMax ?? -1,
      domActiveTrack: activeRow ? Number(activeRow.dataset.i) : -1,
      endpointListRows: document.querySelectorAll('.endpoint-list__row').length,
      error: flight?.error ?? null,
      flatPanelCanvasClass: document.querySelector('.analysis-heatmap__canvas') === null ? 'absent' : 'present',
      flatPanelClass: document.querySelector('.analysis-heatmap') === null ? 'absent' : 'present',
      flatPanelId: document.getElementById('analysis-heatmap') === null ? 'absent' : 'present',
      flyActive: flight?.flyActive ?? null,
      flyProgress: flight?.flyProgress ?? -1,
      markerActiveTrackId: flight?.markerActiveTrackId ?? -1,
      markerCapacity: flight?.markerCapacity ?? -1,
      markerCount: flight?.markerCount ?? -1,
      markerHalos: flight?.markerHalos ?? -1,
      markerPickRadius: flight?.markerPickRadius ?? -1,
      markerPickedTrackId: flight?.markerPickedTrackId ?? -99,
      markerRecreates: flight?.markerRecreates ?? -1,
      markerScreenPositions: flight?.markerScreenPositions ?? [],
      markerTrackIds: flight?.markerTrackIds ?? [],
      tracks: document.querySelectorAll('.track').length,
      worldReady: flight?.worldReady === true,
    };
  });
}

async function audioProbe(page) {
  return page.evaluate(() => {
    const flight = globalThis.__flight;

    return {
      audioSourceMode: flight?.audioSourceMode ?? '',
      audioStatus: document.getElementById('audioStatus')?.textContent ?? null,
      audioWavActive: flight?.audioWavActive ?? null,
      audioWavHasAudio: flight?.audioWavHasAudio ?? null,
      audioWavRate: flight?.audioWavRate ?? -1,
      audioWavTime: flight?.audioWavTime ?? -1,
      audioWebContext: flight?.audioWebContext ?? '',
      audioWebEngineGain: flight?.audioWebEngineGain ?? -1,
      audioWebEngineRate: flight?.audioWebEngineRate ?? -1,
      audioWebLiveSources: flight?.audioWebLiveSources ?? -1,
      audioWebNodesCreated: flight?.audioWebNodesCreated ?? -1,
      audioWebPlaying: flight?.audioWebPlaying ?? null,
      audioWebSamples: flight?.audioWebSamples ?? -1,
      audioWebState: flight?.audioWebState ?? '',
      audioWebUpdates: flight?.audioWebUpdates ?? -1,
      error: flight?.error ?? null,
      scrub: Number(document.getElementById('scrub')?.value ?? -1),
      tracks: document.querySelectorAll('.track').length,
    };
  });
}

/** In-page rAF sampler for the fly-to tween: sees it start and (when the loop runs) complete. */
async function flightTrace(page, limitMs) {
  return page.evaluate(async (limit) => {
    const samples = [];
    const start = performance.now();
    let sawActive = false;
    for (;;) {
      const flight = globalThis.__flight;
      const active = flight?.flyActive === true;
      samples.push({ t: Math.round(performance.now() - start), active, progress: flight?.flyProgress ?? -1 });
      if (active) {
        sawActive = true;
      }
      if (sawActive && !active) {
        break;
      }
      if (performance.now() - start > limit) {
        break;
      }
      await new Promise((done) => requestAnimationFrame(done));
    }

    return { ended: samples[samples.length - 1] ?? null, sawActive, samples: samples.slice(-24) };
  }, limitMs);
}

async function clickCanvas(page, clientX, clientY) {
  await page.evaluate(({ x, y }) => {
    const canvas = document.getElementById('canvas');
    if (!canvas) {
      throw new Error('canvas missing');
    }
    canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
  }, { x: clientX, y: clientY });
}

/** The on-screen marker farthest from every other on-screen marker, excluding the active track. */
function chooseTarget(projections, activeTrackId) {
  const onScreen = projections.filter((marker) => marker.onScreen === true);
  const candidates = onScreen.filter((marker) => marker.trackIndex !== activeTrackId);
  const scored = candidates.map((marker) => {
    const others = onScreen.filter((other) => other.trackIndex !== marker.trackIndex);
    const clearance = others.length === 0
      ? Infinity
      : Math.min(...others.map((other) => Math.hypot(other.x - marker.x, other.y - marker.y)));

    return { ...marker, clearance };
  });
  scored.sort((a, b) => b.clearance - a.clearance);

  return scored[0] ?? null;
}

function markerSnapshot(state) {
  return { count: state.markerCount, densityMax: state.densityMax, trackIds: state.markerTrackIds };
}

function assertMarkerState(state, ctx, label) {
  check(
    `${label}: probe markerCount === endpointCount === validTrackCount`,
    state.markerCount === ctx.endpointCount && state.markerCount === ctx.validTrackCount,
    { markerCount: state.markerCount, endpointCount: ctx.endpointCount, validTrackCount: ctx.validTrackCount },
  );
  check(
    `${label}: marker track-ID set equals the imported track IDs`,
    JSON.stringify(state.markerTrackIds) === JSON.stringify(ctx.trackIds),
    { markerTrackIds: state.markerTrackIds, expectedTrackIds: ctx.trackIds },
  );
  check(`${label}: density weighting present (densityMax >= 1)`, state.densityMax >= 1, { densityMax: state.densityMax, halos: state.markerHalos });
  check(`${label}: marker GPU buffer allocated`, state.markerCapacity > 0, { capacity: state.markerCapacity, recreates: state.markerRecreates });
  check(`${label}: flat 2D panel gone (.analysis-heatmap)`, state.flatPanelClass === 'absent', state.flatPanelClass);
  check(`${label}: flat 2D panel gone (#analysis-heatmap)`, state.flatPanelId === 'absent', state.flatPanelId);
  check(`${label}: flat 2D panel canvas gone (.analysis-heatmap__canvas)`, state.flatPanelCanvasClass === 'absent', state.flatPanelCanvasClass);
  check(`${label}: no replay error`, state.error === null, state.error);
}

// ---------------------------------------------------------------------------------------------------
// Phase 1 — four CSVs, marker completeness, flat panel gone, marker-click select + fly-to start
// ---------------------------------------------------------------------------------------------------

async function phaseMarkersRun1(context, ctx) {
  const { page, tracker } = await openPage(context, ctx.view, { origin: ctx.origin, videoExport: true });
  try {
    await importCsvs(page, ctx.csvPaths, ctx.validTrackCount);
    await page.waitForFunction(() => (globalThis.__flight?.aircraft ?? 'none') !== 'none', undefined, { timeout: PAGE_WAIT_MS });
    // Export mode applies the bird's-eye free-camera pose; after this the compositor drives frames.
    await page.evaluate(() => globalThis.__flightVideoExport.ready());
    await page.evaluate(() => globalThis.__flightVideoExport.renderFrame(0));
    const exportApi = await page.evaluate(() => ({
      hasRenderAudio: typeof globalThis.__flightVideoExport?.renderAudio === 'function',
      keys: Object.keys(globalThis.__flightVideoExport ?? {}).sort(),
    }));
    recordFinding('built page video-export API surface (checked at runtime)', exportApi);
    check('video-export page exposes the synthesized-audio bridge (renderAudio)', exportApi.hasRenderAudio === true, exportApi);
    if (!exportApi.hasRenderAudio) {
      recordFinding('the page exposes no renderAudio hook, so a real export with no same-name WAV has no synthesized audio lane (the exporter test covers the synthesized mux with a mock renderer)', {});
    }
    await sleep(300);

    const state = await markerProbe(page);
    ctx.markerRun1 = state;
    assertMarkerState(state, ctx, 'markers run 1');

    mkdirSync(EVIDENCE_DIR, { recursive: true });
    await page.locator('#canvas').screenshot({ path: EVIDENCE_PNG });
    check('markers run 1: marker-view screenshot captured (visual evidence only)', existsSync(EVIDENCE_PNG), EVIDENCE_PNG);

    const before = await markerProbe(page);
    const target = chooseTarget(before.markerScreenPositions, before.markerActiveTrackId);
    check(
      'marker click: an on-screen non-active marker is available',
      Boolean(target),
      {
        activeMarkerTrackId: before.markerActiveTrackId,
        onScreenTrackIds: before.markerScreenPositions.filter((marker) => marker.onScreen).map((marker) => marker.trackIndex),
      },
    );
    if (target) {
      check(
        'marker click: chosen marker is clear of other on-screen markers',
        target.clearance >= before.markerPickRadius * 2,
        { clearance: round(target.clearance), pickRadius: before.markerPickRadius },
      );
      await clickCanvas(page, before.canvas.left + target.x, before.canvas.top + target.y);
      // Under export driving the rAF loop is paused, so one injected frame refreshes the probe.
      await page.evaluate(() => globalThis.__flightVideoExport.renderFrame(0));
      await sleep(150);
      const after = await markerProbe(page);
      ctx.markerClick = { after, before, target };
      check('marker click: pick resolved to the clicked track', after.markerPickedTrackId === target.trackIndex, {
        pickedTrackId: after.markerPickedTrackId,
        targetTrackId: target.trackIndex,
      });
      check(
        'marker click: active track switched to the picked marker',
        after.activeTrackIndex === target.trackIndex && after.markerActiveTrackId === target.trackIndex && after.domActiveTrack === target.trackIndex,
        {
          activeTrackIndex: after.activeTrackIndex,
          beforeActiveTrackIndex: before.activeTrackIndex,
          domActiveTrack: after.domActiveTrack,
          markerActiveTrackId: after.markerActiveTrackId,
        },
      );
      check('marker click: active track actually changed', after.activeTrackIndex !== before.activeTrackIndex, {
        after: after.activeTrackIndex,
        before: before.activeTrackIndex,
      });
      const trace = await flightTrace(page, 1500);
      ctx.markerClick.trace = trace;
      check('marker click: free-camera fly-to started', trace.sawActive === true, { sawActive: trace.sawActive, ended: trace.ended });
      recordFinding(
        'fly-to completion is asserted on the normal-mode page: while `?videoExport=1` drives the compositor the rAF loop deliberately does not advance the camera (frozen by design)',
        { frozenEnded: trace.ended },
      );
    }
    check('markers run 1: no console/page errors', tracker.errors.length === 0, tracker.errors);
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------------------------------
// Phase 2 — clean marker-count rerun + completed fly-to through the same endpoint focus flow
// ---------------------------------------------------------------------------------------------------

async function phaseMarkersRun2AndFly(context, ctx) {
  // No `ready()` call on this page, so the rAF loop keeps advancing the free camera (normal replay mode).
  const { page, tracker } = await openPage(context, ctx.view, { origin: ctx.origin, videoExport: true });
  try {
    await importCsvs(page, ctx.csvPaths, ctx.validTrackCount);
    await page.waitForFunction(() => (globalThis.__flight?.aircraft ?? 'none') !== 'none', undefined, { timeout: PAGE_WAIT_MS });
    const state = await markerProbe(page);
    ctx.markerRun2 = state;
    assertMarkerState(state, ctx, 'markers run 2 (clean rerun)');
    check(
      'markers rerun: probe counts identical to run 1',
      JSON.stringify(markerSnapshot(state)) === JSON.stringify(markerSnapshot(ctx.markerRun1)),
      { run1: markerSnapshot(ctx.markerRun1), run2: markerSnapshot(state) },
    );

    const targetTrack = 1;
    const before = await markerProbe(page);
    await page.evaluate((trackIndex) => {
      const row = document.querySelector(`.endpoint-list__row[data-track-index="${trackIndex}"]`);
      if (!row) {
        throw new Error(`endpoint list row for track ${trackIndex} missing`);
      }
      row.click();
    }, targetTrack);
    const trace = await flightTrace(page, 8000);
    const after = await markerProbe(page);
    ctx.flyTo = { after, before, targetTrack, trace };
    check(
      'fly-to: tween observed active, then complete (active=false, progress=1)',
      trace.sawActive === true && trace.ended?.active === false && trace.ended?.progress === 1,
      { sawActive: trace.sawActive, ended: trace.ended },
    );
    check(
      'fly-to: selection switched to the focused endpoint',
      after.activeTrackIndex === targetTrack && after.markerActiveTrackId === targetTrack,
      { activeTrackIndex: after.activeTrackIndex, before: before.activeTrackIndex, markerActiveTrackId: after.markerActiveTrackId, targetTrack },
    );
    const endpoint = ctx.endpoints[targetTrack];
    const target = after.cameraState?.target ?? null;
    const distance = target ? Math.hypot(target[0] - endpoint[0], target[1] - endpoint[1], target[2] - endpoint[2]) : Infinity;
    check('fly-to: camera target landed on the endpoint', distance < 1, {
      cameraTarget: target,
      distance: round(distance),
      endpoint,
    });
    check('markers run 2: no console/page errors', tracker.errors.length === 0, tracker.errors);
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------------------------------
// Phase 3 — synthesized audio + recorded-WAV comparison (gate-adaptive)
// ---------------------------------------------------------------------------------------------------

async function phaseAudio(context, ctx) {
  if (!existsSync(ctx.wavA)) {
    check('audio: sibling WAV for the acceptance recording exists', false, ctx.wavA);

    return;
  }
  const { page, tracker } = await openPage(context, null, { origin: ctx.origin, videoExport: false });
  try {
    await page.setInputFiles('#picker', [ctx.csvA, ctx.wavA]);
    await page.waitForFunction(() => document.querySelectorAll('.track').length === 1, undefined, { timeout: IMPORT_WAIT_MS });
    await page.waitForFunction(() => globalThis.__flight?.audioWavHasAudio === true, undefined, { timeout: 60_000 });

    if (ctx.synthAudio) {
      await page.waitForFunction(() => globalThis.__flight?.audioWebState === 'ready', undefined, { timeout: 60_000 });
      const initial = await audioProbe(page);
      ctx.audio = { initial };
      const audioManifest = await (await fetch(`${ctx.origin}/map-pak/audio/manifest.json`)).json();
      const audioManifestSamples = Array.isArray(audioManifest.samples) ? audioManifest.samples : [];
      const expectedAudioSamples = audioManifestSamples.length;
      // The live source count is the model's engine LAYER count, read from the manifest's per-model engine
      // categories (Hydra 520 is the layered turbine: turbine/whine/distance/lift). Hardcoding 2 pinned this to
      // the pre-layering pair and broke once the layered jet landed (task 35).
      const expectedEngineLayers = new Set(
        audioManifestSamples
          .filter((sample) => sample.model === 520 && typeof sample.category === 'string' && sample.category.startsWith('engine '))
          .map((sample) => sample.category),
      ).size;
      check('audio: decoded pak samples match the baked manifest (G4=GO)', initial.audioWebSamples === expectedAudioSamples, {
        decoded: initial.audioWebSamples,
        manifest: expectedAudioSamples,
      });
      check('audio: graph is lazy before play', initial.audioWebNodesCreated === 0 && initial.audioWebLiveSources === 0, {
        liveSources: initial.audioWebLiveSources,
        nodesCreated: initial.audioWebNodesCreated,
      });

      await page.click('#play');
      await sleep(1800);
      const playing1 = await audioProbe(page);
      ctx.audio.playing1 = playing1;
      check('audio: AudioContext is running while playing', playing1.audioWebContext === 'running', playing1.audioWebContext);
      check('audio: synthesized lane plays with live sources', playing1.audioWebPlaying === true && playing1.audioWebLiveSources === expectedEngineLayers, {
        expectedEngineLayers,
        liveSources: playing1.audioWebLiveSources,
        playing: playing1.audioWebPlaying,
      });
      check('audio: engine voice is audible and pitched', playing1.audioWebEngineGain > 0 && playing1.audioWebEngineRate > 0, {
        gain: playing1.audioWebEngineGain,
        rate: playing1.audioWebEngineRate,
      });
      check('audio: audio node graph created', playing1.audioWebNodesCreated >= 10, playing1.audioWebNodesCreated);
      check('audio: replay clock advanced', playing1.scrub > 1, playing1.scrub);
      await sleep(1500);
      const playing2 = await audioProbe(page);
      ctx.audio.playing2 = playing2;
      check('audio: live parameter updates rise over time', playing2.audioWebUpdates > playing1.audioWebUpdates, {
        before: playing1.audioWebUpdates,
        after: playing2.audioWebUpdates,
      });

      // Recorded-WAV comparison: the untouched fallback/comparison path must still work.
      await page.selectOption('#audioSource', 'wav');
      await sleep(700);
      const wav1 = await audioProbe(page);
      ctx.audio.wav1 = wav1;
      check('audio: WAV comparison path is active', wav1.audioWavActive === true && wav1.audioWavHasAudio === true, {
        active: wav1.audioWavActive,
        hasAudio: wav1.audioWavHasAudio,
        rate: wav1.audioWavRate,
        sourceMode: wav1.audioSourceMode,
      });
      check('audio: synth silenced while the WAV plays', wav1.audioWebEngineGain === 0, wav1.audioWebEngineGain);
      await sleep(900);
      const wav2 = await audioProbe(page);
      ctx.audio.wav2 = wav2;
      check('audio: WAV element time advances', wav2.audioWavTime > wav1.audioWavTime, {
        after: round(wav2.audioWavTime),
        before: round(wav1.audioWavTime),
      });
    } else {
      // Approved WAV-only descope: assert the WAV lane and the explicit no-samples status instead.
      const state = await audioProbe(page);
      ctx.audio = { state };
      check('audio: approved WAV-only descope asserts the WAV lane', state.audioWavHasAudio === true, {
        audioWebState: state.audioWebState,
        hasAudio: state.audioWavHasAudio,
      });
      await page.click('#play');
      await sleep(1500);
      const playing = await audioProbe(page);
      check('audio: WAV plays and advances in the descoped lane', playing.audioWavActive === true && playing.audioWavTime > 0, {
        active: playing.audioWavActive,
        time: round(playing.audioWavTime),
      });
    }
    check('audio: no console/page errors', tracker.errors.length === 0, tracker.errors);
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------------------------------
// Phase 4 — production export + ffprobe verification + no-visible-window process evidence
// ---------------------------------------------------------------------------------------------------

function chromeSnapshot() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue';
$rows = @();
foreach ($p in Get-CimInstance Win32_Process -Filter "Name='chrome.exe' or Name='msedge.exe'") {
  $proc = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue;
  $hwnd = -1;
  if ($proc) { $hwnd = [int64]$proc.MainWindowHandle };
  $rows += [pscustomobject]@{ id = [int64]$p.ProcessId; hwnd = $hwnd; cmd = [string]$p.CommandLine }
}
ConvertTo-Json -InputObject $rows -Compress
`;
  const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    return { error: result.error?.message ?? `powershell exit ${result.status}`, ok: false, procs: [] };
  }
  const text = (result.stdout ?? '').trim();
  if (text.length === 0) {
    return { ok: true, procs: [] };
  }
  try {
    const parsed = JSON.parse(text);

    return { ok: true, procs: Array.isArray(parsed) ? parsed : [parsed] };
  } catch (error) {
    return { error: `bad snapshot JSON: ${text.slice(0, 160)} (${error.message})`, ok: false, procs: [] };
  }
}

function runCapture(command, args, timeoutMs) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: timeoutMs, windowsHide: true });
  if (result.error) {
    throw new Error(`${command} failed: ${result.error.message}`);
  }

  return result;
}

function probeVideo(videoPath) {
  const json = (args) => {
    const result = runCapture(FFPROBE, args, 120_000);
    if (result.status !== 0) {
      throw new Error(`ffprobe exited ${result.status}: ${(result.stderr ?? '').trim()}`);
    }
    return JSON.parse(result.stdout);
  };
  const video = json(['-v', 'error', '-count_frames', '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,avg_frame_rate,r_frame_rate,nb_read_frames',
    '-show_entries', 'format=duration', '-of', 'json', videoPath]);
  const audio = json(['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', '-of', 'json', videoPath]);
  const stream = video.streams?.[0] ?? {};

  return {
    audioCodec: audio.streams?.[0]?.codec_name ?? null,
    avgFrameRate: stream.avg_frame_rate ?? null,
    codec: stream.codec_name ?? null,
    durationSeconds: video.format?.duration !== undefined ? Number(video.format.duration) : null,
    frameCount: stream.nb_read_frames !== undefined ? Number(stream.nb_read_frames) : null,
    height: stream.height ?? null,
    rFrameRate: stream.r_frame_rate ?? null,
    width: stream.width ?? null,
  };
}

/**
 * Run ffmpeg `blackdetect` over an exported MP4 and count black events. `blackdetect` records every run of
 * frames whose luma is below `pix_th` for at least `d` seconds; the defect produced fully-black frames, so any
 * event at all is a failure. The command runs the decode to the null muxer and its diagnostics land on stderr.
 */
function blackdetectEvents(videoPath) {
  const result = spawnSync(FFMPEG, [
    '-hide_banner', '-nostats', '-i', videoPath,
    '-vf', BLACKDETECT_FILTER, '-an', '-f', 'null', '-',
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 300_000, windowsHide: true });
  if (result.error) {
    throw new Error(`ffmpeg blackdetect failed: ${result.error.message}`);
  }
  const stderr = result.stderr ?? '';
  const events = stderr.match(/black_start:-?[0-9.]+(?:\s+black_end:-?[0-9.]+)?/g) ?? [];
  const frames = stderr.match(/black_frames:[0-9]+/g) ?? [];

  return {
    command: `ffmpeg -hide_banner -nostats -i <mp4> -vf "${BLACKDETECT_FILTER}" -an -f null -`,
    count: events.length,
    events: events.slice(0, 20),
    frames: frames.slice(0, 20),
  };
}

/**
 * Decode the first `window` frames with `signalstats` and return each frame's luma average (YAVG). Frames
 * 0..`window-1` are the ones the black defect hit; every value must sit above `BLACK_LEVEL_YAVG`.
 */
function firstFrameYavg(videoPath, window) {
  const result = spawnSync(FFMPEG, [
    '-hide_banner', '-nostats', '-i', videoPath,
    '-vf', 'signalstats,metadata=print', '-an', '-f', 'null', '-',
  ], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 300_000, windowsHide: true });
  if (result.error) {
    throw new Error(`ffmpeg signalstats failed: ${result.error.message}`);
  }
  const text = `${result.stderr ?? ''}\n${result.stdout ?? ''}`;
  const values = [...text.matchAll(/lavfi\.signalstats\.YAVG=([0-9.]+)/g)].map((match) => Number(match[1]));

  return {
    command: `ffmpeg -hide_banner -nostats -i <mp4> -vf "signalstats,metadata=print" -an -f null -`,
    totalFrames: values.length,
    window: values.slice(0, window),
  };
}

function exportJobSummary(job) {
  return {
    audio: job.audio,
    audioSource: job.audioSource,
    compositor: job.compositor,
    createdAt: job.createdAt,
    encoderArgs: job.encoderArgs,
    encoderInitEvidence: job.encoderInitEvidence,
    fps: job.fps,
    frame: job.frame,
    frameStream: job.frameStream,
    hardwareEncoder: job.hardwareEncoder,
    id: job.id,
    message: job.message,
    perFrameMs: job.readyAt !== null && job.renderStartedAt !== null ? round((job.readyAt - job.renderStartedAt) / Math.max(1, job.totalFrames)) : null,
    readyAt: job.readyAt,
    renderMs: job.readyAt !== null && job.renderStartedAt !== null ? job.readyAt - job.renderStartedAt : null,
    renderStartedAt: job.renderStartedAt,
    state: job.state,
    totalFrames: job.totalFrames,
    videoEncode: job.videoEncode,
    wallMs: job.readyAt !== null && job.createdAt !== null ? job.readyAt - job.createdAt : null,
  };
}

async function startFreshServer() {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['local-server.mjs'], {
    cwd: join(REPO_ROOT, 'web-replay'),
    env: { ...process.env, NO_OPEN: '1', PORT: String(port) },
    stdio: 'ignore',
    windowsHide: true,
  });
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(500);
    if (await serverUp(origin)) {
      return { child, origin };
    }
    if (child.exitCode !== null) {
      throw new Error(`fresh local server exited early with code ${child.exitCode}`);
    }
  }
  killTree(child);
  throw new Error(`fresh local server did not answer at ${origin}`);
}

async function phaseExport(exportOrigin, ctx, attempt = 1) {
  const csvText = readFileSync(ctx.exportCsv, 'utf8');
  const filename = basename(ctx.exportCsv);
  const baseline = chromeSnapshot();
  check('export: Win32 Chrome process snapshot available before export', baseline.ok, baseline.ok ? { chromeProcesses: baseline.procs.length } : baseline.error);

  const response = await fetch(`${exportOrigin}/video-export`, {
    method: 'POST',
    headers: { Origin: exportOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ csv: csvText, filename, fps: ctx.exportFps, pakBase: '/map-pak', audioMode: 'synth' }),
  });
  const startText = await response.text();
  check('export: POST /video-export accepted with 202', response.status === 202, { body: truncate(startText, 200), status: response.status });
  if (response.status !== 202) {
    return;
  }
  const { id } = JSON.parse(startText);
  // A reused server may be an OLD process with a STALE in-memory exporter (the static page is read from disk
  // per request, but a long-running node process keeps its module graph). Detect it from the first status
  // poll and re-run the export on a fresh server instead of asserting a stale lane. The reused process is
  // left running, untouched.
  const first = await (await fetch(`${exportOrigin}/video-export/${id}`)).json();
  if (first.fps !== ctx.exportFps || !Object.hasOwn(first, 'videoEncode') || first.audioMode !== 'synth') {
    await fetch(`${exportOrigin}/video-export/${id}/cancel`, { method: 'POST', headers: { Origin: exportOrigin } }).catch(() => {});
    recordObservedLimit('the pre-existing local server runs a stale in-memory exporter and was not used as the built-app export oracle', {
      hasVideoEncodeField: Object.hasOwn(first, 'videoEncode'),
      jobFps: first.fps,
      jobState: first.state,
      requestedFps: ctx.exportFps,
      reusedOrigin: exportOrigin,
    });
    if (attempt >= 2) {
      check('export: a current exporter was reachable for the built-app lane', false, { attempt, origin: exportOrigin });

      return;
    }
    const fresh = await startFreshServer();
    ctx.exportOrigin = fresh.origin;
    recordFinding('the export lane was re-run on a fresh local server (same web-replay/dist, current code) while the reused process was left untouched', {
      freshOrigin: fresh.origin,
      reusedOrigin: exportOrigin,
    });
    try {
      return await phaseExport(fresh.origin, ctx, attempt + 1);
    } finally {
      killTree(fresh.child);
    }
  }
  ctx.exportOrigin = exportOrigin;
  const snapshots = [];
  const deadline = Date.now() + EXPORT_TIMEOUT_MS;
  let lastSnapshot = 0;
  let job = null;
  while (Date.now() < deadline) {
    job = await (await fetch(`${exportOrigin}/video-export/${id}`)).json();
    if (Date.now() - lastSnapshot >= 900) {
      const snapshot = chromeSnapshot();
      if (snapshot.ok) {
        snapshots.push(snapshot.procs);
      }
      lastSnapshot = Date.now();
    }
    if (['cancelled', 'failed', 'ready'].includes(job.state)) {
      break;
    }
    await sleep(120);
  }
  if (!job || !['cancelled', 'failed', 'ready'].includes(job.state)) {
    await fetch(`${exportOrigin}/video-export/${id}/cancel`, { method: 'POST', headers: { Origin: exportOrigin } }).catch(() => {});
    check('export: job finished within the timeout', false, { frame: job?.frame, state: job?.state, totalFrames: job?.totalFrames });

    return;
  }
  const summary = exportJobSummary(job);
  ctx.exportJob = summary;
  check('export: job reached ready state', job.state === 'ready', { message: job.message, state: job.state });
  if (job.state !== 'ready') {
    return;
  }

  const download = await fetch(`${exportOrigin}/video-export/${id}/download`);
  const body = Buffer.from(await download.arrayBuffer());
  check('export: MP4 download served', download.status === 200 && body.length > 1024, { bytes: body.length, status: download.status });
  const mp4Path = join(tmpdir(), `F3-verify-e2e-${id}.mp4`);
  writeFileSync(mp4Path, body);
  const probe = probeVideo(mp4Path);
  ctx.exportProbe = probe;
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(EVIDENCE_FFPROBE, JSON.stringify({
    command: `ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=codec_name,width,height,avg_frame_rate,r_frame_rate,nb_read_frames -show_entries format=duration -of json <download>`,
    generatedAt: new Date().toISOString(),
    job: summary,
    ffprobe: probe,
    mp4Bytes: body.length,
  }, null, 2));

  // Black-frame verification (todo 33): the export must contain ZERO black frames, and the first frames (the
  // ones the defect blacked out) must all be well above the TV black level. This reads the ACTUAL MP4, so a
  // capture regression can never pass silently. It is plain ffmpeg analysis, never post-processing the video.
  const blacks = blackdetectEvents(mp4Path);
  const firstFrames = firstFrameYavg(mp4Path, FIRST_FRAME_WINDOW);
  ctx.exportBlacks = { blackdetect: blacks, firstFrames };
  check('export: blackdetect finds 0 black events (whole clip, d=0.001 pix_th=0.10)', blacks.count === 0, {
    blackEvents: blacks.count,
    events: blacks.events,
    filter: BLACKDETECT_FILTER,
  });
  const firstValues = firstFrames.window;
  const firstMin = firstValues.length > 0 ? Math.min(...firstValues) : null;
  const atBlackLevel = firstValues.filter((value) => value <= BLACK_LEVEL_YAVG);
  check('export: no frame in 0..140 is at the black level (YAVG > 20)', firstValues.length >= Math.min(FIRST_FRAME_WINDOW, probe.frameCount ?? 0) && atBlackLevel.length === 0, {
    blackLevelYavg: BLACK_LEVEL_YAVG,
    checkedFrames: firstValues.length,
    minYavg: firstMin,
    atBlackLevel,
  });

  const expectedFrames = Math.ceil(ctx.exportCsvDuration * ctx.exportFps);
  const durationTarget = job.totalFrames / ctx.exportFps;
  const videoEncode = job.videoEncode ?? null;
  const evidence = job.encoderInitEvidence ?? {};
  const qsvLog = Boolean(evidence.deviceLine && evidence.mfxLine);
  const webcodecs = evidence.platform === 'webcodecs' && videoEncode?.supported === true &&
    videoEncode?.hardwareAcceleration === 'prefer-hardware' && typeof evidence.adapter === 'string' && evidence.adapter.length > 0;
  const hardwareOk = job.hardwareEncoder === true && (qsvLog || webcodecs);

  check('export: exact avg_frame_rate for the chosen rate', probe.avgFrameRate === `${ctx.exportFps}/1` && probe.rFrameRate === `${ctx.exportFps}/1`, {
    expected: `${ctx.exportFps}/1`,
    ffprobeAvg: probe.avgFrameRate,
    ffprobeR: probe.rFrameRate,
  });
  check('export: ffprobe frame count equals the job frame count', probe.frameCount === job.totalFrames, {
    ffprobeFrames: probe.frameCount,
    jobFrames: job.totalFrames,
  });
  check('export: frame count matches the independent CSV duration (<= 2 frames)', Math.abs(job.totalFrames - expectedFrames) <= 2, {
    csvDurationSeconds: round(ctx.exportCsvDuration),
    expectedFrames,
    jobFrames: job.totalFrames,
  });
  check('export: duration error within one frame', probe.durationSeconds !== null && Math.abs(probe.durationSeconds - durationTarget) <= 1 / ctx.exportFps + 1e-6, {
    durationSeconds: probe.durationSeconds,
    expectedSeconds: round(durationTarget),
  });
  if (ctx.expectExportHardware) {
    check('export: hardware encoder proof (not a codec name)', hardwareOk, {
      adapter: evidence.adapter ?? null,
      hardwareEncoder: job.hardwareEncoder,
      mode: videoEncode?.mode ?? null,
      proof: evidence.proof ?? null,
      qsvLog,
      webcodecs,
    });
    check('export: primary in-page hardware path, no silent fallback', videoEncode?.mode === 'in-page-hardware' && videoEncode?.fallback !== true, {
      fallback: videoEncode?.fallback ?? null,
      fallbackReason: videoEncode?.fallbackReason ?? null,
      mode: videoEncode?.mode ?? null,
    });
  } else {
    check('export: G2=NO-GO approved degraded contract asserted (hardware not required)', true, { hardwareEncoder: job.hardwareEncoder, mode: videoEncode?.mode ?? null });
  }
  // The user wants the SYNTHESIZED engine audio, never the recorded game WAV. The gate asserts the job's
  // audioSource, and that FFmpeg's mux input names the synthesized file the page rendered.
  check('export: audio source is the synthesized render (recording not muxed)', job.audioSource === 'synthesized' && job.audio === true && probe.audioCodec === 'aac', {
    audioCodec: probe.audioCodec,
    audioMode: job.audioMode,
    audioSource: job.audioSource,
    jobAudio: job.audio,
  });
  const muxWavArgs = Array.isArray(job.encoderArgs)
    ? job.encoderArgs.filter((argument) => typeof argument === 'string' && /\.wav$/i.test(argument))
    : [];
  const recordedWavName = basename(ctx.exportCsv).replace(/\.csv$/i, '.wav');
  check('export: FFmpeg mux args reference the synthesized WAV and not the recorded WAV', muxWavArgs.some((argument) => /\.synthesized\.wav$/i.test(argument)) && !muxWavArgs.some((argument) => argument.endsWith(recordedWavName)), {
    muxWavArgs,
    recordedWavName,
  });
  check('export: no PNG in the frame stream', job.frameStream?.pngSignatureSeen === false && job.frameStream?.chunks > 0 && job.frameStream?.inputFormat === 'h264', {
    chunks: job.frameStream?.chunks ?? null,
    inputFormat: job.frameStream?.inputFormat ?? null,
    pngSignatureSeen: job.frameStream?.pngSignatureSeen ?? null,
  });
  check('export: copy-mux with input -r before -i (exact cadence defect stays fixed)', Array.isArray(job.encoderArgs) &&
    job.encoderArgs.includes('copy') &&
    job.encoderArgs.indexOf('-r') !== -1 &&
    job.encoderArgs.indexOf('-i') !== -1 &&
    job.encoderArgs.indexOf('-r') < job.encoderArgs.indexOf('-i'), {
    encoderArgs: job.encoderArgs,
  });
  check('export: compositor reports a non-visible window', job.compositor?.visible === false, job.compositor);

  // No-visible-window, observed from the OS: every Chrome process that appeared during the export must be a
  // headless one (profile prefix `stunt-video-browser-`, no main window handle, `--headless` on the browser).
  const baselineIds = new Set(baseline.procs.map((proc) => proc.id));
  const seen = new Map();
  for (const snapshot of snapshots) {
    for (const proc of snapshot) {
      if (!baselineIds.has(proc.id)) {
        seen.set(proc.id, proc);
      }
    }
  }
  const newProcesses = [...seen.values()];
  const exportProcesses = newProcesses.filter((proc) => /stunt-video-browser-/.test(proc.cmd ?? ''));
  const visibleNew = newProcesses.filter((proc) => proc.hwnd > 0);
  const browserProcess = exportProcesses.find((proc) => !/--type=/.test(proc.cmd ?? ''));
  ctx.exportProcesses = {
    browserProcess: browserProcess ? { cmd: truncate(browserProcess.cmd), headless: /--headless/.test(browserProcess.cmd ?? ''), hwnd: browserProcess.hwnd, id: browserProcess.id } : null,
    newProcesses: newProcesses.length,
    exportProcesses: exportProcesses.length,
    snapshots: snapshots.length,
    visibleNew: visibleNew.map((proc) => ({ cmd: truncate(proc.cmd, 140), hwnd: proc.hwnd, id: proc.id })),
  };
  check('export: export renderer Chrome processes observed while rendering', exportProcesses.length > 0, {
    exportProcesses: exportProcesses.length,
    newProcesses: newProcesses.length,
    snapshots: snapshots.length,
  });
  check('export: no new Chrome process owns a visible main window', visibleNew.length === 0, ctx.exportProcesses.visibleNew);
  check('export: export browser was launched headless', Boolean(browserProcess) && /--headless/.test(browserProcess.cmd ?? ''), ctx.exportProcesses.browserProcess);

  rmSync(mp4Path, { force: true });
}

// ---------------------------------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------------------------------

function gitStatus() {
  try {
    return execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' })
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean);
  } catch {
    return null;
  }
}

function headCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function formatTableValue(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return (text ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function writeEvidence(ctx, worktree) {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const failed = results.filter((result) => !result.pass);
  const lines = [];
  lines.push('# F3 — Real-system QA (agent-operated, no human)');
  lines.push('');
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Command: \`node tools/maintenance/verify-e2e.mjs\` (repo root ${REPO_ROOT})`);
  lines.push(`- Head commit: ${headCommit()}`);
  lines.push(`- Host: ${platform()} ${release()} · node ${process.version} · ${Math.round(totalmem() / 1024 ** 3)} GB RAM`);
  lines.push(`- Server: ${ctx.serverWasRunning ? `reused existing server at ${ctx.origin} (left running)` : `started by this run at ${ctx.origin} (stopped afterwards)`}`);
  lines.push(`- Export lane origin: ${ctx.exportOrigin ?? ctx.origin}${ctx.exportOrigin && ctx.exportOrigin !== ctx.origin ? ' (fresh server started by this run: the reused process ran a stale in-memory exporter)' : ''}`);
  lines.push(`- Chrome: fresh throwaway profile, closed by this run only`);
  lines.push(`- Gate adaptation: G2=${ctx.gates.g2Verdict} → production export asserted at ${ctx.exportFps} fps hardware; G4=${ctx.gates.g4Verdict} → ${ctx.synthAudio ? 'synthesized replay audio asserted' : 'approved WAV-only lane asserted'}; G1=${ctx.gates.headless || 'n/a'} (context)`);
  lines.push('');
  lines.push('## Assertion ledger (every assertion with its observed value)');
  lines.push('');
  lines.push('| # | assertion | result | observed |');
  lines.push('| --- | --- | --- | --- |');
  results.forEach((result, index) => {
    lines.push(`| ${index + 1} | ${formatTableValue(result.name)} | ${result.pass ? 'PASS' : 'FAIL'} | ${formatTableValue(result.observed)} |`);
  });
  lines.push('');
  if (observedLimits.length > 0) {
    lines.push('## Observed limits (recorded, NOT failures)');
    lines.push('');
    for (const limit of observedLimits) {
      lines.push(`- **${limit.name}** — \`${JSON.stringify(limit.detail)}\``);
    }
    lines.push('');
  }
  if (findings.length > 0) {
    lines.push('## Findings / notes');
    lines.push('');
    for (const finding of findings) {
      lines.push(`- **${finding.name}** — \`${JSON.stringify(finding.detail)}\``);
    }
    lines.push('');
  }
  lines.push('## CSV set and independent oracle');
  lines.push('');
  lines.push('| slot | file | version | samples | duration (s) | endpoint (GTA) |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const slot of ['a', 'b', 'c', 'd']) {
    const recording = ctx.recordings?.[slot];
    if (!recording) {
      lines.push(`| ${slot} | (missing) | - | - | - | - |`);
      continue;
    }
    lines.push(`| ${slot} | ${recording.name} | v${recording.version} | ${recording.samples} | ${round(recording.duration)} | ${recording.endpoint.map(round).join(', ')} |`);
  }
  lines.push(`- endpointCount = ${ctx.endpointCount}; validTrackCount = ${ctx.validTrackCount}; trackIds = [${ctx.trackIds}]`);
  lines.push('');
  lines.push('## Probe snapshots (verbatim)');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify({
    audio: ctx.audio ?? null,
    export: ctx.exportJob ?? null,
    exportBlacks: ctx.exportBlacks ?? null,
    exportProcesses: ctx.exportProcesses ?? null,
    flyTo: ctx.flyTo ? { after: ctx.flyTo.after, before: ctx.flyTo.before, targetTrack: ctx.flyTo.targetTrack, trace: ctx.flyTo.trace } : null,
    markerClick: ctx.markerClick ? { after: ctx.markerClick.after, before: ctx.markerClick.before, target: ctx.markerClick.target, trace: ctx.markerClick.trace } : null,
    markersRun1: ctx.markerRun1 ?? null,
    markersRun2: ctx.markerRun2 ?? null,
  }, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## Export ffprobe');
  lines.push('');
  lines.push(`- ffprobe JSON: \`${EVIDENCE_FFPROBE}\``);
  lines.push(`- ffprobe: \`${JSON.stringify(ctx.exportProbe ?? null)}\``);
  lines.push('');
  lines.push('## Artifacts');
  lines.push('');
  lines.push(`- Marker-view screenshot (visual only): \`${EVIDENCE_PNG}\`${existsSync(EVIDENCE_PNG) ? '' : ' (not written)'}`);
  lines.push(`- ffprobe log: \`${EVIDENCE_FFPROBE}\`${existsSync(EVIDENCE_FFPROBE) ? '' : ' (not written)'}`);
  lines.push('');
  lines.push('## Worktree');
  lines.push('');
  lines.push(`- New porcelain entries during the run: ${worktree.added.length === 0 ? '(none)' : worktree.added.map((line) => `\`${line}\``).join(', ')}`);
  lines.push(`- Unexpected entries (not F3 evidence): ${worktree.unexpected.length === 0 ? '(none)' : worktree.unexpected.map((line) => `\`${line}\``).join(', ')}`);
  lines.push('');
  lines.push('## Verdict');
  lines.push('');
  lines.push(failed.length === 0 ? 'F3: APPROVED' : `F3: FAILED ${failed[0].name}`);
  lines.push('');
  writeFileSync(EVIDENCE_MD, lines.join('\n'));
  console.log(`evidence: ${EVIDENCE_MD}`);
}

// ---------------------------------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------------------------------

function parseArgs(argv) {
  const options = {
    csvA: DEFAULT_CSVS.a,
    csvB: DEFAULT_CSVS.b,
    csvC: DEFAULT_CSVS.c,
    csvD: DEFAULT_CSVS.d,
    fps: 60,
    url: DEFAULT_URL,
  };
  const takeValue = (arg, index) => {
    const eq = arg.indexOf('=');
    if (eq !== -1) {
      return { next: index, value: arg.slice(eq + 1) };
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`missing value for ${arg}`);
    }

    return { next: index + 1, value };
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--url' || arg.startsWith('--url=')) {
      const { next, value } = takeValue(arg, i);
      i = next;
      options.url = value;
    } else if (arg === '--csv-a' || arg.startsWith('--csv-a=')) {
      const { next, value } = takeValue(arg, i);
      i = next;
      options.csvA = resolve(value);
    } else if (arg === '--csv-b' || arg.startsWith('--csv-b=')) {
      const { next, value } = takeValue(arg, i);
      i = next;
      options.csvB = resolve(value);
    } else if (arg === '--csv-c' || arg.startsWith('--csv-c=')) {
      const { next, value } = takeValue(arg, i);
      i = next;
      options.csvC = resolve(value);
    } else if (arg === '--csv-d' || arg.startsWith('--csv-d=')) {
      const { next, value } = takeValue(arg, i);
      i = next;
      options.csvD = resolve(value);
    } else if (arg === '--fps' || arg.startsWith('--fps=')) {
      const { next, value } = takeValue(arg, i);
      i = next;
      options.fps = Number(value);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (![30, 60, 120].includes(options.fps)) {
    throw new Error(`unsupported frame rate: ${options.fps} (expected 30, 60 or 120)`);
  }
  options.url = options.url.replace(/\/+$/, '');

  return options;
}

function runPhase(name, fn) {
  return fn().catch((error) => {
    check(`${name}: completed without exception`, false, error instanceof Error ? error.message : String(error));
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const origin = options.url;
  const port = new URL(origin).port || '80';
  // The exporter's same-origin guard compares against its own `http://127.0.0.1:<port>` origin.
  const exportOrigin = `http://127.0.0.1:${port}`;
  const csvPaths = [options.csvA, options.csvB, options.csvC, options.csvD];
  for (const path of csvPaths) {
    check('csv: acceptance recording exists', existsSync(path), path);
  }
  if (csvPaths.some((path) => !existsSync(path))) {
    writeEvidence({ audio: null, endpointCount: 0, exportFps: options.fps, exportProbe: null, gates: {}, origin, recordings: {}, serverWasRunning: false, synthAudio: false, trackIds: [], validTrackCount: 0 }, { added: [], unexpected: [] });
    process.exitCode = 1;

    return;
  }

  if (spawnSync(FFPROBE, ['-version'], { stdio: 'ignore' }).status !== 0) {
    throw new Error('ffprobe is required on PATH (or FFPROBE_PATH)');
  }

  const gates = readGates();
  const recordings = {
    a: parseRecordingOracle(options.csvA),
    b: parseRecordingOracle(options.csvB),
    c: parseRecordingOracle(options.csvC),
    d: parseRecordingOracle(options.csvD),
  };
  const endpoints = csvPaths.map((path) => gtaToEngine(parseRecordingOracle(path).endpoint));

  // Export input: the acceptance recording with its recorded WAV beside it (the recorded lane is the one the
  // LAST-MILE measured; todo-19's synthesized mux path is exercised by the exporter's own test, not the page).
  const exportCsv = options.csvA;
  const exportCsvDuration = recordings.a.duration;
  const allowHardware = gates.g2Verdict === 'GO' || gates.g2Verdict === 'PARTIAL';
  const ratesPassed = gates.g2?.predicate?.ratesPassed ?? [60];
  const exportFps = allowHardware && !ratesPassed.includes(options.fps) ? ratesPassed[0] : options.fps;

  const ctx = {
    audio: null,
    csvA: options.csvA,
    csvPaths,
    endpointCount: endpoints.length,
    endpoints,
    exportCsv,
    exportCsvDuration,
    exportFps,
    exportJob: null,
    exportOrigin: exportOrigin,
    exportProbe: null,
    expectExportHardware: allowHardware,
    gates,
    markerClick: null,
    markerRun1: null,
    markerRun2: null,
    origin,
    recordings,
    serverWasRunning: false,
    synthAudio: gates.g4Verdict === 'GO',
    trackIds: endpoints.map((_, index) => index),
    validTrackCount: csvPaths.length,
    view: cameraView(...(() => {
      const { center, span } = boundsCenter(endpoints);

      return [center, Math.min(6000, Math.max(420, span * 1.05)), [0.06, 1.0, 0.09]];
    })()),
    wavA: options.csvA.replace(/\.csv$/i, '.wav'),
  };
  console.log(`csv: ${csvPaths.length} recordings, ${ctx.endpointCount} endpoints; export at ${exportFps} fps (G2=${gates.g2Verdict}, ratesPassed=${ratesPassed.join(',')})`);

  const worktreeBefore = gitStatus();
  ctx.serverWasRunning = await serverUp(origin);
  await ensureServer(origin);
  ctx.serverWasRunning = ctx.serverWasRunning || !serverStarted;

  let browser = null;
  try {
    browser = await launchChrome(origin);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    await runPhase('phase markers run 1 (4 CSVs, flat panel, marker click)', () => phaseMarkersRun1(context, ctx));
    await runPhase('phase markers run 2 (clean rerun, fly-to completion)', () => phaseMarkersRun2AndFly(context, ctx));
    await runPhase('phase audio (synthesis + WAV comparison)', () => phaseAudio(context, ctx));
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    killTree(chromeChild);
    chromeChild = null;
  }

  await runPhase('phase export (production browser lane + ffprobe)', () => phaseExport(exportOrigin, ctx));

  const worktreeAfter = gitStatus() ?? [];
  const beforeSet = new Set(worktreeBefore ?? []);
  const added = worktreeAfter.filter((line) => !beforeSet.has(line));
  const unexpected = added.filter((line) => !line.includes('F3-flight-analysis-remediation-and-worktree-cleanup'));
  check('worktree: the run added no files other than F3 evidence', unexpected.length === 0, { added, unexpected });

  if (serverStarted) {
    killTree(serverChild);
    serverChild = null;
  }
  writeEvidence(ctx, { added, unexpected });

  const failed = results.filter((result) => !result.pass);
  console.log(`\n${results.length - failed.length}/${results.length} assertions passed`);
  if (failed.length > 0) {
    for (const failure of failed) {
      console.error(`  FAIL ${failure.name} :: ${JSON.stringify(failure.observed)}`);
    }
    console.error(`F3: FAILED ${failed[0].name}`);
    process.exitCode = 1;
  } else {
    console.log('F3: APPROVED');
  }
}

const watchdog = setTimeout(() => {
  console.error(`F3 watchdog: exceeded ${WATCHDOG_MS / 60000} minutes; aborting`);
  process.exit(2);
}, WATCHDOG_MS);
watchdog.unref?.();

main().catch((error) => {
  console.error(`FAIL: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
